/* API REST para el panel de colaboradores (disponibilidad + asignación de
   citas) — comparte la misma base de datos y el mismo login por
   teléfono+código que la app de clientes (ver api.js, db.js). Montada en
   webhook.js bajo /api/collab. */
'use strict';

const express = require('express');
const db = require('./db.js');
const CATALOG = require('../catalog.js');

function ah(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error('Error en ruta /api/collab:', err);
      res.status(500).json({ error: 'error interno' });
    });
  };
}

const ASSIGN_ERROR_MESSAGES = {
  not_found: 'la reserva no existe',
  already_assigned: 'esa reserva ya tiene colaborador asignado',
  invalid_date: 'fecha u hora inválida',
  outside_availability: 'ese horario está fuera de tu disponibilidad declarada',
  overlap: 'ese horario choca con otra cita que ya tienes asignada',
  db_disabled: 'base de datos no configurada (DATABASE_URL)',
};

function fmtWhen(date) {
  return date.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' });
}

/** send/textMessage: los mismos que usa webhook.js para hablar con WhatsApp (o DRY_RUN). */
function createCollabApiRouter({ send, textMessage }) {
  const router = express.Router();
  router.use(express.json());

  const requireCollaborator = ah(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const phone = token && (await db.phoneForToken(token));
    const collaborator = phone && (await db.getCollaboratorByPhone(phone));
    if (!collaborator) return res.status(401).json({ error: 'no autenticado como colaborador' });
    req.collaborator = collaborator;
    next();
  });

  router.get('/me', requireCollaborator, ah(async (req, res) => {
    const [availability, bookings] = await Promise.all([
      db.getAvailability(req.collaborator.id),
      db.listCollaboratorBookings(req.collaborator.id),
    ]);
    res.json({ collaborator: req.collaborator, availability, bookings });
  }));

  router.put('/availability', requireCollaborator, ah(async (req, res) => {
    const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
    const clean = slots
      .filter((s) => Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && /^\d{2}:\d{2}$/.test(s.start) && /^\d{2}:\d{2}$/.test(s.end))
      .map((s) => ({ weekday: s.weekday, start: s.start, end: s.end }));
    await db.replaceAvailability(req.collaborator.id, clean);
    res.json({ availability: clean });
  }));

  router.get('/pending', requireCollaborator, ah(async (req, res) => {
    const rows = await db.listPendingBookings(req.collaborator.specialties || []);
    res.json({ bookings: rows });
  }));

  router.post('/bookings/:id/assign', requireCollaborator, ah(async (req, res) => {
    const scheduledAt = req.body?.scheduledAt; // "YYYY-MM-DDTHH:MM" hora de Bogotá
    if (!scheduledAt) return res.status(400).json({ error: 'falta "scheduledAt"' });

    // La duración depende del servicio (y, para paseos, de la duración elegida
    // por el cliente al armar el plan — ver catalog.js).
    const pending = await db.listPendingBookings(req.collaborator.specialties || []);
    const target = pending.find((b) => b.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'esa reserva no está pendiente o no coincide con tu especialidad' });
    const durationMin = CATALOG.durationMinutes(target.service_id, target.variant || {});

    const result = await db.assignBooking(req.params.id, req.collaborator.id, scheduledAt, durationMin);
    if (!result.ok) return res.status(409).json({ error: ASSIGN_ERROR_MESSAGES[result.reason] || result.reason });

    const label = (CATALOG.ROW_META[target.service_id] || {}).label || target.service_id;
    const whenLabel = fmtWhen(new Date(result.booking.scheduled_at));
    await send(textMessage(
      result.booking.customer_phone,
      `✅ ¡Tu cita quedó confirmada! ${label}${result.petName ? ` para ${result.petName}` : ''}, el ${whenLabel}. Te escribimos antes para recordarte 🐾`
    ));

    res.json({ booking: result.booking });
  }));

  router.post('/bookings/:id/release', requireCollaborator, ah(async (req, res) => {
    const result = await db.releaseBooking(req.params.id, req.collaborator.id);
    if (!result.ok) return res.status(404).json({ error: ASSIGN_ERROR_MESSAGES[result.reason] || result.reason });
    res.json({ released: true });
  }));

  return router;
}

module.exports = { createCollabApiRouter };
