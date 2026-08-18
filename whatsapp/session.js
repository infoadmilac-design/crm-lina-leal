/* Estado de conversación por número de teléfono.
   En memoria = se pierde al reiniciar el proceso. Para producción, cambia
   `store` por Redis o una tabla (una fila por número, mismas claves). */
'use strict';

const CATALOG = require('../catalog.js');

const store = new Map();

// Lun..Dom, en el orden en que se muestran los toggles de días de paseo.
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_NAMES_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const FRANJA_LABEL = { manana: 'Mañana', tarde: 'Tarde' };

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
    banoFreq: null,
    banoNotes: null,
    paseoFreq: null,
    paseoDays: [], // índices 0..6 (Lun..Dom) que el cliente eligió para pasear
    paseoFranja: null, // 'manana' | 'tarde'
    paseoScheduleOnly: false, // true mientras se piden días/franja sin tocar precio (viene de un paquete)
    paseoScheduleDone: false,
    paseoDuration: null,
    paseoModalidad: null,
    barfKey: 'pollo-250',
    barfEntregas: null,
    dentalFreq: null,
    packageDiscountPct: null,
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

/** Aplica un paquete inteligente completo a la sesión: activa sus servicios
    y copia las opciones de precio del paquete (mismas claves que
    priceOpts(), por eso el Object.assign directo funciona). */
function applyPackage(session, packageId) {
  const pkg = CATALOG.PACKAGES[packageId];
  if (!pkg) return false;
  const opts = pkg.opts(session.weightIdx);
  session.services = {};
  pkg.servicesList.forEach((id) => { session.services[id] = true; });
  Object.assign(session, opts);
  // El descuento de paquete se mantiene mientras el plan siga siendo
  // exactamente el del paquete — cualquier reconfiguración manual lo borra
  // (ver startServiceConfig / handlePlanServices en router.js).
  session.packageDiscountPct = pkg.bundleDiscount || 0;
  // Un paquete fija QUÉ y CUÁNTO, pero nunca CUÁNDO — el cliente siempre
  // elige los días y la franja de los paseos aparte (ver advanceBulkSchedule
  // en router.js), sin que eso afecte el precio ni el descuento.
  session.paseoDays = [];
  session.paseoFranja = null;
  session.paseoScheduleDone = false;
  session.proposedSlots = {};
  return true;
}

function priceOpts(session) {
  return {
    banoVariant: session.banoVariant,
    banoFreq: session.banoFreq,
    paseoFreq: session.paseoFreq,
    paseoDuration: session.paseoDuration,
    paseoModalidad: session.paseoModalidad,
    // paseoDays/paseoFranja no afectan el precio (CATALOG.price los ignora),
    // pero SÍ hay que guardarlos — es la única constancia de qué días y
    // franja pidió el cliente, ya que el paseo no usa proposedSlots (es
    // recurrente, no una cita puntual).
    paseoDays: session.paseoDays,
    paseoFranja: session.paseoFranja,
    barfKey: session.barfKey,
    barfEntregas: session.barfEntregas,
    dentalFreq: session.dentalFreq,
  };
}

function ticketFor(session) {
  const opts = priceOpts(session);
  const lines = activeServiceIds(session).map((id) => {
    const meta = CATALOG.ROW_META[id];
    let label = meta.label;
    if (id === 'bano' && session.banoVariant) {
      label = CATALOG.BANO_VARIANTS[session.banoVariant].label;
      label += ` (${session.banoFreq || 1}×/mes)`;
    }
    if (id === 'paseo' && session.paseoFreq) {
      const freqLabel = (session.paseoDays && session.paseoDays.length)
        ? session.paseoDays.slice().sort((a, b) => a - b).map((d) => DAY_NAMES_SHORT[d]).join('/')
        : `${session.paseoFreq}×/semana`;
      const durLabel = CATALOG.PASEO_DURATION[session.paseoDuration || 'corta'].label;
      const MODALIDAD_SHORT = { juego: '+juego', grupal: 'grupal' };
      const modLabel = MODALIDAD_SHORT[session.paseoModalidad] ? ' · ' + MODALIDAD_SHORT[session.paseoModalidad] : '';
      const franjaLabel = session.paseoFranja ? ` · ${FRANJA_LABEL[session.paseoFranja]}` : '';
      label += ` (${freqLabel} · ${durLabel}${modLabel}${franjaLabel})`;
    }
    if (id === 'barf') {
      const opt = CATALOG.BARF_OPTIONS.find((o) => o.val === session.barfKey);
      label += ' · ' + (opt ? opt.label : '');
      label += session.barfEntregas === 2 ? ' · 2 entregas/mes' : ' · 1 entrega/mes';
    }
    if (id === 'dental' && session.dentalFreq) {
      label += ` (${CATALOG.DENTAL_FREQ_OPTIONS[session.dentalFreq].label})`;
    }
    const p = CATALOG.price(id, session.weightIdx, opts);
    return { label, price: CATALOG.fmt(p) };
  });
  const rawTotal = activeServiceIds(session).reduce((sum, id) => sum + CATALOG.price(id, session.weightIdx, opts), 0);
  const discount = session.packageDiscountPct || 0;
  const total = discount ? CATALOG.round500(rawTotal * (1 - discount)) : rawTotal;
  return { lines, total };
}

module.exports = {
  getSession, resetSession, activeServiceIds, ticketFor, priceOpts, applyPackage,
  DAY_NAMES, DAY_NAMES_SHORT, FRANJA_LABEL,
};
