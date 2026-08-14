/* Servidor de ejemplo: expone el webhook real de WhatsApp Cloud API y, además,
   una ruta /dev/simulate para probar todo el flujo sin credenciales de Meta.

   Arrancar:      cd whatsapp && npm install && cp .env.example .env && node webhook.js
   Probar sin Meta: curl -s localhost:3000/dev/simulate -H 'content-type: application/json' \
                      -d '{"from":"573001112233","text":"hola"}' | jq
   Ver todo lo que "envió" el bot (modo DRY_RUN): curl -s localhost:3000/dev/sent | jq */
'use strict';

require('dotenv').config();
const express = require('express');
const session = require('./session.js');
const router = require('./router.js');
const { createReminderScheduler } = require('./reminders.js');

const {
  VERIFY_TOKEN = 'allpetz-dev-token',
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  GRAPH_API_VERSION = 'v20.0',
  PORT = 3000,
  DRY_RUN = !WHATSAPP_TOKEN || !PHONE_NUMBER_ID, // sin credenciales -> nunca llama a Meta de verdad
} = process.env;

const app = express();
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
  if (!res.ok) console.error('Error enviando a WhatsApp:', res.status, await res.text());
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

async function handleTurn(from, incoming) {
  const s = session.getSession(from);
  const outgoing = router.handle(from, s, incoming);
  for (const payload of outgoing) await send(payload);
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
    await handleTurn(message.from, normalizeIncoming(message));
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
  const outgoing = await handleTurn(from, incoming);
  res.json({ dryRun: !!DRY_RUN, session: session.getSession(from), outgoing });
});

app.post('/dev/reset', (req, res) => {
  const { from } = req.body || {};
  if (!from) return res.status(400).json({ error: 'falta "from"' });
  res.json({ session: session.resetSession(from) });
});

app.get('/dev/sent', (req, res) => res.json(sentLog));

const scheduler = createReminderScheduler(send);
app.get('/dev/reminders/pending', (req, res) => res.json({ pending: scheduler.pending() }));

app.listen(PORT, () => {
  console.log(`ALLPETZ WhatsApp bot escuchando en :${PORT}${DRY_RUN ? '  [DRY_RUN: no se llama a Meta]' : ''}`);
});
