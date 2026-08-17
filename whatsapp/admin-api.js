/* API REST para el panel de administrador — comparte base de datos y login
   por teléfono+código con la app de clientes y el panel de colaboradores
   (ver api.js, collab-api.js, db.js). Montada en webhook.js bajo /api/admin. */
'use strict';

const express = require('express');
const db = require('./db.js');
const M = require('./messages.js');
const CATALOG = require('../catalog.js');

const ALLOWED_SETTING_KEYS = ['commission', 'business_info', 'bot_texts'];

function ah(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error('Error en ruta /api/admin:', err);
      res.status(500).json({ error: 'error interno' });
    });
  };
}

const REASSIGN_ERROR_MESSAGES = {
  not_found: 'la reserva no existe',
  not_scheduled: 'esa reserva todavía no tiene horario asignado',
  outside_availability: 'ese horario está fuera de la disponibilidad declarada del colaborador',
  overlap: 'ese horario choca con otra cita que ya tiene el colaborador',
  db_disabled: 'base de datos no configurada (DATABASE_URL)',
};

function createAdminApiRouter() {
  const router = express.Router();
  router.use(express.json());

  const requireAdmin = ah(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const phone = token && (await db.phoneForToken(token));
    const admin = phone && (await db.getAdminByPhone(phone));
    if (!admin) return res.status(401).json({ error: 'no autenticado como administrador' });
    req.admin = admin;
    next();
  });

  router.get('/me', requireAdmin, ah(async (req, res) => {
    res.json({ admin: req.admin });
  }));

  router.get('/collaborators', requireAdmin, ah(async (req, res) => {
    const rows = await db.listAdminCollaborators();
    res.json({ collaborators: rows });
  }));

  router.post('/collaborators', requireAdmin, ah(async (req, res) => {
    const { name, phone, specialties } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'falta "name"' });
    const clean = Array.isArray(specialties) ? specialties.filter((s) => CATALOG.ROW_META[s]) : [];
    const collaborator = await db.createCollaborator({ name: String(name).trim(), phone: phone ? String(phone).replace(/[^\d]/g, '') : null, specialties: clean });
    res.json({ collaborator });
  }));

  router.patch('/collaborators/:id', requireAdmin, ah(async (req, res) => {
    const { name, phone, specialties, active } = req.body || {};
    const clean = Array.isArray(specialties) ? specialties.filter((s) => CATALOG.ROW_META[s]) : undefined;
    const collaborator = await db.updateCollaborator(req.params.id, {
      name, phone: phone ? String(phone).replace(/[^\d]/g, '') : undefined, specialties: clean, active,
    });
    if (!collaborator) return res.status(404).json({ error: 'colaborador no encontrado' });
    res.json({ collaborator });
  }));

  router.get('/customers', requireAdmin, ah(async (req, res) => {
    const rows = await db.listCustomersAdmin(req.query.search ? String(req.query.search) : null);
    res.json({ customers: rows });
  }));

  router.get('/customers/:phone', requireAdmin, ah(async (req, res) => {
    const data = await db.getCustomerFull(req.params.phone);
    if (!data) return res.status(404).json({ error: 'cliente no encontrado' });
    res.json(data);
  }));

  router.get('/bookings', requireAdmin, ah(async (req, res) => {
    const rows = await db.listAllBookings({
      status: req.query.status ? String(req.query.status) : undefined,
      collaboratorId: req.query.collaboratorId ? String(req.query.collaboratorId) : undefined,
    });
    res.json({ bookings: rows });
  }));

  router.post('/bookings/:id/reassign', requireAdmin, ah(async (req, res) => {
    const { collaboratorId, force } = req.body || {};
    if (!collaboratorId) return res.status(400).json({ error: 'falta "collaboratorId"' });
    const target = await db.getBookingById(req.params.id);
    if (!target) return res.status(404).json({ error: 'la reserva no existe' });
    const durationMin = CATALOG.durationMinutes(target.service_id, target.variant || {});
    const result = await db.reassignBooking(req.params.id, collaboratorId, durationMin, !!force);
    if (!result.ok) return res.status(409).json({ error: REASSIGN_ERROR_MESSAGES[result.reason] || result.reason });
    res.json({ booking: result.booking });
  }));

  /* ---- Configuración (comisión, datos de la empresa, textos del bot) ---- */

  router.get('/settings', requireAdmin, ah(async (req, res) => {
    const settings = await db.getSettings();
    res.json({
      settings,
      defaults: { commission: CATALOG.COMMISSION_PCT, botTexts: M.DEFAULT_BOT_TEXTS },
    });
  }));

  router.put('/settings/:key', requireAdmin, ah(async (req, res) => {
    const key = req.params.key;
    if (!ALLOWED_SETTING_KEYS.includes(key)) return res.status(400).json({ error: 'clave de configuración no válida' });
    const value = req.body?.value;
    if (!value || typeof value !== 'object') return res.status(400).json({ error: 'falta "value"' });
    await db.setSetting(key, value);
    // Se aplica en caliente en este mismo proceso — sin reiniciar el servidor.
    if (key === 'commission') CATALOG.setOverrides({ commission: value });
    if (key === 'bot_texts') M.setOverrides({ botTexts: value });
    res.json({ key, value });
  }));

  /* ---- Reporte financiero ---- */

  router.get('/financial', requireAdmin, ah(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (!from || !to) return res.status(400).json({ error: 'faltan "from" y "to" (YYYY-MM-DD, rango exclusivo al final)' });
    const rows = await db.listBookingsInRange(`${from}T00:00:00-05:00`, `${to}T00:00:00-05:00`, 'confirmado');

    const byService = {};
    const byCollaborator = {};
    let totalRevenue = 0;
    let totalCommission = 0;
    let totalPayout = 0;
    for (const b of rows) {
      const { commission, payout } = CATALOG.splitEarnings(b.price, b.service_id);
      totalRevenue += b.price;
      totalCommission += commission;
      totalPayout += payout;

      const sKey = b.service_id;
      byService[sKey] = byService[sKey] || { serviceId: sKey, label: (CATALOG.ROW_META[sKey] || {}).label || sKey, count: 0, revenue: 0, commission: 0, payout: 0 };
      byService[sKey].count += 1;
      byService[sKey].revenue += b.price;
      byService[sKey].commission += commission;
      byService[sKey].payout += payout;

      const cKey = b.assigned_collaborator_id || 'sin_asignar';
      byCollaborator[cKey] = byCollaborator[cKey] || { collaboratorId: b.assigned_collaborator_id, name: b.collaborator_name || 'Sin asignar', count: 0, revenue: 0, commission: 0, payout: 0 };
      byCollaborator[cKey].count += 1;
      byCollaborator[cKey].revenue += b.price;
      byCollaborator[cKey].commission += commission;
      byCollaborator[cKey].payout += payout;
    }

    res.json({
      from, to, count: rows.length,
      totalRevenue, totalCommission, totalPayout,
      byService: Object.values(byService),
      byCollaborator: Object.values(byCollaborator),
    });
  }));

  return router;
}

module.exports = { createAdminApiRouter };
