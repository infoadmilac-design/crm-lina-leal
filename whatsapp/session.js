/* Estado de conversación por número de teléfono.
   En memoria = se pierde al reiniciar el proceso. Para producción, cambia
   `store` por Redis o una tabla (una fila por número, mismas claves). */
'use strict';

const CATALOG = require('../catalog.js');

const store = new Map();

function defaultSession() {
  return {
    step: 'menu',
    petName: 'tu mascota',
    weightIdx: 0,
    paseoVar: 'mes',
    barfKey: 'pollo-250',
    services: { bano: true, paseo: true, barf: true, vacunas: true, dental: true },
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

function ticketFor(session) {
  const lines = activeServiceIds(session).map((id) => {
    const meta = CATALOG.ROW_META[id];
    let label = meta.label;
    if (id === 'paseo') label += session.paseoVar === 'sem' ? ' (1×)' : ' (5×)';
    if (id === 'barf') {
      const opt = CATALOG.BARF_OPTIONS.find((o) => o.val === session.barfKey);
      label += ' · ' + (opt ? opt.label : '');
    }
    const p = CATALOG.price(id, session.weightIdx, { paseoVar: session.paseoVar, barfKey: session.barfKey });
    return { label, price: CATALOG.fmt(p) };
  });
  const total = activeServiceIds(session).reduce(
    (sum, id) => sum + CATALOG.price(id, session.weightIdx, { paseoVar: session.paseoVar, barfKey: session.barfKey }),
    0
  );
  return { lines, total };
}

module.exports = { getSession, resetSession, activeServiceIds, ticketFor };
