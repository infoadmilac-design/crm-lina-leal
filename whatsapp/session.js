/* Estado de conversación por número de teléfono.
   En memoria = se pierde al reiniciar el proceso. Para producción, cambia
   `store` por Redis o una tabla (una fila por número, mismas claves). */
'use strict';

const CATALOG = require('../catalog.js');

const store = new Map();

function defaultSession() {
  return {
    step: 'menu',
    onboarded: false,
    ownerName: null,
    petName: null,
    petBreed: null,
    weightIdx: 0,
    lastServiceId: null,
    banoVariant: null,
    banoNotes: null,
    paseoFreq: null,
    paseoDuration: null,
    paseoModalidad: null,
    barfKey: 'pollo-250',
    services: {},
    // Negociación de horario cliente↔colaborador (ver router.js)
    proposedSlots: {}, // { [serviceId]: "YYYY-MM-DDTHH:MM" }
    pendingSlotService: null,
    pendingSlotDate: null,
    reschedulingBookingId: null,
    rescheduleProposedAt: null,
    bookings: [
      { id: 'b1', icon: '✂️', title: 'Grooming pro', when: 'Hoy · 4:00 pm', status: 'confirmado' },
      { id: 'b2', icon: '🐕', title: 'Paseo matinal', when: 'Mañana · 7:00 am', status: 'agendado' },
    ],
  };
}

function getSession(phone) {
  if (!store.has(phone)) store.set(phone, defaultSession());
  return store.get(phone);
}

function resetSession(phone) {
  store.set(phone, defaultSession());
  return store.get(phone);
}

function activeServiceIds(session) {
  return CATALOG.BUILDER_ROW_IDS.filter((id) => session.services[id]);
}

function priceOpts(session) {
  return {
    banoVariant: session.banoVariant,
    paseoFreq: session.paseoFreq,
    paseoDuration: session.paseoDuration,
    paseoModalidad: session.paseoModalidad,
    barfKey: session.barfKey,
  };
}

function ticketFor(session) {
  const opts = priceOpts(session);
  const lines = activeServiceIds(session).map((id) => {
    const meta = CATALOG.ROW_META[id];
    let label = meta.label;
    if (id === 'bano' && session.banoVariant) {
      label = CATALOG.BANO_VARIANTS[session.banoVariant].label;
    }
    if (id === 'paseo' && session.paseoFreq) {
      const freqLabel = `${session.paseoFreq}×/semana`;
      const durLabel = CATALOG.PASEO_DURATION[session.paseoDuration || 'corta'].label;
      const MODALIDAD_SHORT = { juego: '+juego', grupal: 'grupal' };
      const modLabel = MODALIDAD_SHORT[session.paseoModalidad] ? ' · ' + MODALIDAD_SHORT[session.paseoModalidad] : '';
      label += ` (${freqLabel} · ${durLabel}${modLabel})`;
    }
    if (id === 'barf') {
      const opt = CATALOG.BARF_OPTIONS.find((o) => o.val === session.barfKey);
      label += ' · ' + (opt ? opt.label : '');
    }
    const p = CATALOG.price(id, session.weightIdx, opts);
    return { label, price: CATALOG.fmt(p) };
  });
  const total = activeServiceIds(session).reduce((sum, id) => sum + CATALOG.price(id, session.weightIdx, opts), 0);
  return { lines, total };
}

module.exports = { getSession, resetSession, activeServiceIds, ticketFor };
