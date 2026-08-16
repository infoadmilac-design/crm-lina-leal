/* Servidor de ejemplo: expone el webhook real de WhatsApp Cloud API y, además,
   una ruta /dev/simulate para probar todo el flujo sin credenciales de Meta.

   Arrancar:      cd whatsapp && npm install && cp .env.example .env && node webhook.js
   Probar sin Meta: curl -s localhost:3000/dev/simulate -H 'content-type: application/json' \
                      -d '{"from":"573001112233","text":"hola"}' | jq
   Ver todo lo que "envió" el bot (modo DRY_RUN): curl -s localhost:3000/dev/sent | jq */
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('./session.js');
const router = require('./router.js');
const { createReminderScheduler } = require('./reminders.js');
const db = require('./db.js');
const { createApiRouter } = require('./api.js');
const M = require('./messages.js');
const CATALOG = require('../catalog.js');

const {
  VERIFY_TOKEN = 'allpetz-dev-token',
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_API_VERSION = 'v20.0',
  PORT = 3000,
  DRY_RUN = !WHATSAPP_TOKEN || !PHONE_NUMBER_ID, // sin credenciales -> nunca llama a Meta de verdad
} = process.env;

const app = express();
app.use(cors());
app.use(express.json());

const sentLog = [];

async function send(payload) {
  sentLog.push({ at: new Date().toISOString(), payload });
  if (sentLog.length > 200) sentLog.shift();

  if (DRY_RUN) {
    console.log('[DRY_RUN] no se llamó a Meta, mensaje simulado:\n', JSON.stringify(payload, null, 2));
    return { simulated: true };
  }
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error('Error enviando a WhatsApp:', res.status, await res.text());
    return null;
  }
  return res.json();
}

/** Convierte el payload crudo de Meta en el formato que espera router.handle(). */
function normalizeIncoming(message) {
  if (message.type === 'text') return { type: 'text', text: message.text.body };
  if (message.type === 'interactive') {
    const i = message.interactive;
    if (i.type === 'list_reply') return { type: 'interactive', id: i.list_reply.id };
    if (i.type === 'button_reply') return { type: 'interactive', id: i.button_reply.id };
  }
  if (message.type === 'button') return { type: 'interactive', id: message.button.payload }; // tap en botón de plantilla
  return { type: 'text', text: '' };
}

/** Guarda en la base de datos los dos momentos de negocio que le importan al
    resto del sistema (app + colaboradores) — el motor de conversación
    (router.js) sigue siendo puro y no sabe nada de esto. */
async function persistBusinessEvents(from, s, wasOnboarded, hadPlanConfirmedAt) {
  if (!db.enabled) return;
  try {
    if (!wasOnboarded && s.onboarded) {
      await db.upsertCustomerAndPet(from, {
        ownerName: s.ownerName,
        petName: s.petName,
        petBreed: s.petBreed,
        weightIdx: s.weightIdx,
      });
    }
    if (!hadPlanConfirmedAt && s.planConfirmedAt) {
      const activeIds = session.activeServiceIds(s);
      const opts = {
        banoVariant: s.banoVariant,
        paseoFreq: s.paseoFreq,
        paseoDuration: s.paseoDuration,
        paseoModalidad: s.paseoModalidad,
        barfKey: s.barfKey,
      };
      const petId = await db.latestPetId(from);
      const lines = activeIds.map((serviceId) => ({
        serviceId,
        label: CATALOG.ROW_META[serviceId].label,
        priceValue: CATALOG.price(serviceId, s.weightIdx, opts),
      }));
      await db.createBookingsForPlan(from, { petId, lines, services: activeIds, weightIdx: s.weightIdx, priceOpts: opts, source: 'whatsapp' });
    }
  } catch (err) {
    console.error('Error guardando en base de datos:', err);
  }
}

async function handleTurn(from, incoming, profileName) {
  const s = session.getSession(from);
  if (profileName && !s.ownerName) s.ownerName = profileName;
  const wasOnboarded = s.onboarded;
  const hadPlanConfirmedAt = s.planConfirmedAt;
  const outgoing = router.handle(from, s, incoming);
  for (const payload of outgoing) await send(payload);
  await persistBusinessEvents(from, s, wasOnboarded, hadPlanConfirmedAt);
  return outgoing;
}

/* ---- Webhook real de Meta ---- */

// Meta llama esto una vez, al configurar la URL del webhook, para verificar que te pertenece.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // reconoce rápido; Meta reintenta si tardas
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return; // status updates (entregado/leído) no traen "messages"
    const profileName = value?.contacts?.[0]?.profile?.name || null;
    await handleTurn(message.from, normalizeIncoming(message), profileName);
  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});

/* ---- Rutas de desarrollo, sin necesidad de credenciales de Meta ---- */

// Simula un turno de conversación: { "from": "57300...", "text": "hola" } o { "from": "...", "id": "menu_plan" }
app.post('/dev/simulate', async (req, res) => {
  const { from, text, id } = req.body || {};
  if (!from) return res.status(400).json({ error: 'falta "from" (cualquier número de prueba, ej. 573001112233)' });
  const incoming = id ? { type: 'interactive', id } : { type: 'text', text: text || 'hola' };
  try {
    const outgoing = await handleTurn(from, incoming);
    res.json({ dryRun: !!DRY_RUN, session: session.getSession(from), outgoing });
  } catch (err) {
    console.error('Error en /dev/simulate:', err);
    res.status(500).json({ error: 'error interno' });
  }
});

app.post('/dev/reset', (req, res) => {
  const { from } = req.body || {};
  if (!from) return res.status(400).json({ error: 'falta "from"' });
  res.json({ session: session.resetSession(from) });
});

app.get('/dev/sent', (req, res) => res.json(sentLog));

/* ---- API para la app (login por código + datos del cliente) ---- */
app.use('/api', createApiRouter({ send, textMessage: M.textMessage }));

const scheduler = createReminderScheduler(send);
app.get('/dev/reminders/pending', (req, res) => res.json({ pending: scheduler.pending() }));

app.listen(PORT, () => {
  console.log(`ALLPETZ WhatsApp bot escuchando en :${PORT}${DRY_RUN ? '  [DRY_RUN: no se llama a Meta]' : ''}${db.enabled ? '' : '  [DB: sin DATABASE_URL, solo memoria]'}`);
});
