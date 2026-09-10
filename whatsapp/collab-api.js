/* API REST para el panel de colaboradores (disponibilidad + asignación de
   citas) — comparte la misma base de datos y el mismo login por
   teléfono+código que la app de clientes (ver api.js, db.js). Montada en
   webhook.js bajo /api/collab. */
'use strict';

const express = require('express');
const db = require('./db.js');
const session = require('./session.js');
const M = require('./messages.js');
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

  async function sendServiceConfirmation(target, booking, petName) {
    const label = (CATALOG.ROW_META[target.service_id] || {}).label || target.service_id;
    const whenLabel = fmtWhen(new Date(booking.scheduled_at));
    await send(textMessage(
      booking.customer_phone,
      `✅ ¡Tu cita quedó confirmada! ${label}${petName ? ` para ${petName}` : ''}, el ${whenLabel}. Te escribimos antes para recordarte 🐾`
    ));
  }

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

    await sendServiceConfirmation(target, result.booking, result.petName);
    res.json({ booking: result.booking });
  }));

  router.post('/bookings/:id/release', requireCollaborator, ah(async (req, res) => {
    const result = await db.releaseBooking(req.params.id, req.collaborator.id);
    if (!result.ok) return res.status(404).json({ error: ASSIGN_ERROR_MESSAGES[result.reason] || result.reason });
    res.json({ released: true });
  }));

  router.get('/proposals', requireCollaborator, ah(async (req, res) => {
    const rows = await db.listProposals(req.collaborator.specialties || []);
    res.json({ bookings: rows });
  }));

  router.post('/bookings/:id/accept', requireCollaborator, ah(async (req, res) => {
    const proposals = await db.listProposals(req.collaborator.specialties || []);
    const target = proposals.find((b) => b.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'esa reserva no está propuesta o no coincide con tu especialidad' });
    const durationMin = CATALOG.durationMinutes(target.service_id, target.variant || {});

    const result = await db.acceptProposedBooking(req.params.id, req.collaborator.id, durationMin);
    if (!result.ok) return res.status(409).json({ error: ASSIGN_ERROR_MESSAGES[result.reason] || result.reason });

    await sendServiceConfirmation(target, result.booking, result.petName);
    res.json({ booking: result.booking });
  }));

  router.post('/bookings/:id/decline', requireCollaborator, ah(async (req, res) => {
    const result = await db.declineProposal(req.params.id, req.collaborator.specialties || []);
    if (!result.ok) return res.status(404).json({ error: ASSIGN_ERROR_MESSAGES[result.reason] || result.reason });

    // El cliente vuelve a elegir día y hora — router.js retoma esto en
    // 'reschedule_pick_day' cuando responda (ver whatsapp/router.js).
    const s = session.getSession(result.booking.customer_phone);
    s.reschedulingBookingId = result.booking.id;
    s.step = 'reschedule_pick_day';
    await send(M.textMessage(result.booking.customer_phone, 'El colaborador no pudo con ese horario 😕 ¿Qué otro día te queda bien?'));
    await send(M.dayPickerList(result.booking.customer_phone));

    res.json({ declined: true });
  }));

  router.get('/earnings', requireCollaborator, ah(async (req, res) => {
    const bookings = await db.listCollaboratorBookings(req.collaborator.id);
    const monthKey = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7); // YYYY-MM
    const thisMonth = bookings.filter((b) =>
      b.status === 'confirmado' && b.scheduled_at &&
      new Date(b.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7) === monthKey
    );
    const byService = {};
    let totalPayout = 0;
    let totalCommission = 0;
    for (const b of thisMonth) {
      const { commission, payout } = CATALOG.splitEarnings(b.price, b.service_id);
      totalPayout += payout;
      totalCommission += commission;
      const key = b.service_id;
      byService[key] = byService[key] || { serviceId: key, label: (CATALOG.ROW_META[key] || {}).label || key, count: 0, payout: 0, commission: 0 };
      byService[key].count += 1;
      byService[key].payout += payout;
      byService[key].commission += commission;
    }
    res.json({ month: monthKey, servicesCount: thisMonth.length, totalPayout, totalCommission, byService: Object.values(byService) });
  }));

  return router;
}

module.exports = { createCollabApiRouter };
