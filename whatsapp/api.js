/* API REST para la app (login por código y datos del cliente) — comparte la
   misma base de datos que usa el bot de WhatsApp (ver db.js). Montada en
   webhook.js bajo /api. */
'use strict';

const express = require('express');
const db = require('./db.js');
const CATALOG = require('../catalog.js');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d]/g, '');
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Envuelve un handler async: si la promesa rechaza, responde 500 en vez de
    tumbar el proceso entero con un unhandled rejection. */
function ah(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error('Error en ruta /api:', err);
      res.status(500).json({ error: 'error interno' });
    });
  };
}

/** send: la función send(payload) de webhook.js, ya sabe hablar con la Graph API (o DRY_RUN). */
function createApiRouter({ send, textMessage }) {
  const router = express.Router();
  router.use(express.json());

  router.post('/auth/request-code', ah(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'falta "phone"' });
    if (!db.enabled) return res.status(503).json({ error: 'base de datos no configurada (DATABASE_URL)' });
    const code = genCode();
    await db.saveAuthCode(phone, code, CODE_TTL_MS);
    await send(textMessage(phone, `🐾 Tu código ALLPETZ para entrar a la app es: ${code}\nVence en 10 minutos.`));
    res.json({ sent: true });
  }));

  router.post('/auth/verify-code', ah(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '');
    if (!phone || !code) return res.status(400).json({ error: 'falta "phone" o "code"' });
    const ok = await db.verifyAuthCode(phone, code);
    if (!ok) return res.status(401).json({ error: 'código inválido o vencido' });
    const token = await db.createAuthToken(phone, TOKEN_TTL_MS);
    res.json({ token, phone });
  }));

  const requireAuth = ah(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const phone = token && (await db.phoneForToken(token));
    if (!phone) return res.status(401).json({ error: 'no autenticado' });
    req.phone = phone;
    next();
  });

  router.get('/me', requireAuth, ah(async (req, res) => {
    const data = await db.getCustomerFull(req.phone);
    if (!data) return res.status(404).json({ error: 'cliente no encontrado' });
    res.json(data);
  }));

  router.post('/bookings', requireAuth, ah(async (req, res) => {
    const { petId, services, weightIdx, priceOpts } = req.body || {};
    if (!Array.isArray(services) || !services.length) return res.status(400).json({ error: 'falta "services"' });
    const opts = priceOpts || {};
    const lines = services.map((serviceId) => ({
      serviceId,
      label: CATALOG.ROW_META[serviceId]?.label || serviceId,
      priceValue: CATALOG.price(serviceId, weightIdx || 0, opts),
    }));
    await db.createBookingsForPlan(req.phone, {
      petId: petId || (await db.latestPetId(req.phone)),
      lines,
      services,
      weightIdx: weightIdx || 0,
      priceOpts: opts,
      source: 'app',
    });
    res.json({ created: lines.length });
  }));

  router.get('/collaborators/:id/bookings', ah(async (req, res) => {
    const rows = await db.listCollaboratorBookings(req.params.id);
    res.json({ bookings: rows });
  }));

  // Pública (sin auth): overrides de comisión/textos que el admin haya guardado,
  // para que app.js/colaboradores.js calculen los mismos precios que el bot.
  router.get('/settings', ah(async (req, res) => {
    const settings = await db.getSettings();
    res.json(settings);
  }));

  return router;
}

module.exports = { createApiRouter };
