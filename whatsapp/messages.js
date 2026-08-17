/* Constructores de mensajes de la WhatsApp Cloud API.
   Cada función devuelve el body exacto que se envía a
   POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
   Límites reales de la API que respetamos aquí:
   - listas: máx. 10 filas en total, título de fila máx. 24 caracteres, descripción máx. 72
   - botones de respuesta rápida: máx. 3 por mensaje, título máx. 20 caracteres */
'use strict';

const CATALOG = require('../catalog.js');
const {
  SERVICES, WEIGHTS, ROW_META, BUILDER_ROW_IDS, BARF_OPTIONS, TIER, cop, fmt, price,
  BANO_VARIANT_ORDER, PASEO_FREQ_OPTIONS, PASEO_DURATION, PASEO_MODALIDAD,
} = CATALOG;

function base(to) {
  return { messaging_product: 'whatsapp', to, recipient_type: 'individual' };
}

function textMessage(to, body) {
  return { ...base(to), type: 'text', text: { body, preview_url: false } };
}

function imageMessage(to, link, caption) {
  return { ...base(to), type: 'image', image: { link, ...(caption ? { caption } : {}) } };
}

function listMessage(to, { header, body, footer, buttonLabel, sections }) {
  return {
    ...base(to),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { button: buttonLabel, sections },
    },
  };
}

function buttonMessage(to, { header, body, footer, buttons }) {
  return {
    ...base(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  };
}

/* ---- 0. Onboarding: bienvenida emocional + nombre, peso y raza ---- */
function welcomeIntro(to) {
  return textMessage(
    to,
    '¡Guau, hola! 🐾 Soy la voz (bueno, la patita escritora) de ALLPETZ: el ecosistema que junta en un solo lugar TODO lo que tu mejor amigo de cuatro patas va a necesitar — paseos, baño, comida rica, vacunas, dientes limpios, entrenamiento, transporte, hotel y hasta seguro.\n\n' +
      'Nada de andar buscando 5 contactos distintos cada vez que se te ocurre algo. En unos minutos armamos el plan perfecto según su tamaño, y listo: tú te olvidas de estar pendiente, porque nosotros te recordamos cada cita a tiempo. Menos preocupaciones para ti, más cariño para tu peludo 🐶✨'
  );
}

function askPetName(to) {
  return textMessage(to, 'Para empezar, cuéntame: ¿cómo se llama tu mascota?');
}

function askBreed(to, petName) {
  return textMessage(to, `Perfecto 🐕 ¿Qué raza es ${petName} (o mezcla)? Escribe "omitir" si prefieres no decirlo.`);
}

/* ---- 1. Menú principal ---- */
function mainMenu(to, userName) {
  return listMessage(to, {
    body: `¡Hola ${userName}! 🐾 Soy el asistente de ALLPETZ. ¿En qué te ayudo hoy?`,
    buttonLabel: 'Ver opciones',
    sections: [
      {
        title: 'Menú',
        rows: [
          { id: 'menu_catalogo', title: '📋 Catálogo', description: 'Servicios disponibles' },
          { id: 'menu_plan', title: '🧩 Armar mi plan', description: 'Arma el plan de tu mascota' },
          { id: 'menu_servicios', title: '📅 Mis servicios', description: 'Ver, confirmar, reagendar' },
          { id: 'menu_humano', title: '🙋 Hablar con alguien', description: 'Te conectamos con el equipo' },
        ],
      },
    ],
  });
}

/* ---- 2a. Catálogo (9 servicios) ---- */
// Foto genérica de banco de imágenes, servida como miniatura <1MB (no es una foto real de ALLPETZ).
const CATALOG_HERO_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Girl_walking_dog_001.jpg/960px-Girl_walking_dog_001.jpg';

function catalogIntro(to) {
  return imageMessage(to, CATALOG_HERO_PHOTO, 'ALLPETZ 🐾 — cuidado para tu mascota');
}

function catalogList(to) {
  return listMessage(to, {
    body: 'Elige y combina 🐾',
    buttonLabel: 'Ver catálogo',
    sections: [
      {
        title: 'Servicios',
        rows: SERVICES.map((s) => ({
          id: `catalog_${s.id}`,
          title: `${s.emoji} ${s.title}`,
          description: s.desc,
        })),
      },
    ],
  });
}

function catalogDetail(to, service, weightIdx) {
  const inBuilder = !!service.map;
  const priceLine = inBuilder && weightIdx != null
    ? `\n\nDesde *${fmt(price(service.map, weightIdx, {}))}* para tu mascota.`
    : '';
  const body = `${service.emoji} *${service.title}*\n\n${service.pitch || service.desc}${priceLine}`;
  return buttonMessage(to, {
    ...(service.photo ? { header: { type: 'image', image: { link: service.photo } } } : {}),
    body,
    buttons: inBuilder
      ? [
          { id: `add_${service.map}`, title: 'Empezar a configurar' },
          { id: 'back_menu', title: '‹ Volver al menú' },
        ]
      : [
          { id: 'notify_soon', title: 'Avísame cuando esté' },
          { id: 'back_menu', title: '‹ Volver al menú' },
        ],
  });
}

/* ---- 2b. Armar plan: paso 1, peso (también usado en onboarding) ---- */
function weightPicker(to) {
  return listMessage(to, {
    body: '¿Cuánto pesa tu mascota?',
    buttonLabel: 'Elegir peso',
    sections: [
      {
        title: 'Peso',
        rows: WEIGHTS.map((w, idx) => ({
          id: `weight_${idx}`,
          title: `${w.emo} ${w.name} · ${w.kg} kg`,
          description: TIER[idx],
        })),
      },
    ],
  });
}

/* ---- paso 2, checklist de servicios (multi-select simulado) ---- */
function servicesChecklist(to, weightIdx, selected) {
  return listMessage(to, {
    body: '¿Qué incluye su plan? Toca una fila para activarla o desactivarla.',
    buttonLabel: 'Ver servicios',
    sections: [
      {
        title: 'Servicios',
        rows: [
          ...BUILDER_ROW_IDS.map((id) => {
            const row = ROW_META[id];
            const on = !!selected[id];
            return {
              id: `toggle_${id}`,
              title: `${on ? '✅' : '◻️'} ${row.emoji} ${row.label}`,
              description: fmt(price(id, weightIdx, {})),
            };
          }),
          { id: 'services_continue', title: '▶️ Continuar', description: 'Ir al resumen' },
        ],
      },
    ],
  });
}

/* ---- baño: subtipo + notas ---- */
const BANO_ROW_LABEL = {
  general: 'Baño general',
  corte: 'Baño y corte',
  corte_raza: 'Corte según raza',
};

function banoVariantList(to, weightIdx) {
  return listMessage(to, {
    body: '🛁 Baño: ¿qué tipo de servicio quieres?',
    buttonLabel: 'Elegir tipo',
    sections: [
      {
        title: 'Tipos de baño',
        rows: BANO_VARIANT_ORDER.map((key) => ({
          id: `bano_${key}`,
          title: BANO_ROW_LABEL[key],
          description: fmt(CATALOG.banoVariantPrice(weightIdx, key)),
        })),
      },
    ],
  });
}

function banoNotesPrompt(to) {
  return textMessage(to, '¿Alguna instrucción especial para el corte (largo, estilo, zonas a evitar)? Escríbela, o responde "ninguna".');
}

/* ---- paseo: frecuencia + duración + modalidad ---- */
function paseoFrequencyList(to, weightIdx) {
  return listMessage(to, {
    body: '🐕 Paseos: ¿con qué frecuencia a la semana?',
    buttonLabel: 'Elegir frecuencia',
    sections: [
      {
        title: 'Frecuencia',
        rows: PASEO_FREQ_OPTIONS.map((n) => ({
          id: `paseofreq_${n}`,
          title: `${n}×/semana`,
          description: fmt(CATALOG.paseoPrice(weightIdx, n, 'corta', 'solo')),
        })),
      },
    ],
  });
}

function paseoDurationButtons(to) {
  return buttonMessage(to, {
    body: '⏱️ ¿Cuánto debe durar cada paseo?',
    buttons: [
      { id: 'paseodur_corta', title: PASEO_DURATION.corta.label },
      { id: 'paseodur_larga', title: '1h - 1h30' },
    ],
  });
}

function paseoModalidadButtons(to) {
  return buttonMessage(to, {
    body: '🎾 ¿Cómo prefieres el paseo: individual, en grupo pequeño con juego, o grupal?',
    buttons: [
      { id: 'paseomod_solo', title: 'Individual' },
      { id: 'paseomod_juego', title: 'Con juego (máx 3)' },
      { id: 'paseomod_grupal', title: 'Grupal (máx 8)' },
    ],
  });
}

/* ---- variante de BARF (lista, 6 combos) ---- */
function barfOptionsList(to) {
  return listMessage(to, {
    body: '🥩 BARF: ¿qué proteína y tamaño?',
    buttonLabel: 'Elegir BARF',
    sections: [
      {
        title: 'Combos',
        rows: BARF_OPTIONS.map((o) => ({ id: `barf_${o.val}`, title: o.label, description: fmt(CATALOG.BARF[o.val]) })),
      },
    ],
  });
}

/* ---- elegir horario: día (próximos 7, hora de Bogotá) + franja fija ----
   router.js es puro/síncrono y no puede consultar la agenda real de los
   colaboradores; el cliente propone día+hora "a ciegas" y la validación de
   choque/disponibilidad ocurre cuando el colaborador acepta (ver
   whatsapp/db.js::assignBooking). */
const WD_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MO_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

function bogotaTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}
function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateStrForOffset(offset) { return addDaysStr(bogotaTodayStr(), offset); }
function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${WD_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MO_SHORT[d.getUTCMonth()]}`;
}
function timeLabel(t) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
/** "YYYY-MM-DDTHH:MM" -> "Lun 18 ago, 10:00 am" (para mensajes de confirmación). */
function formatSlotLabel(iso) {
  const [datePart, timePart] = String(iso || '').split('T');
  if (!datePart || !timePart) return '';
  return `${dayLabel(datePart)}, ${timeLabel(timePart)}`;
}

function dayPickerList(to) {
  const rows = [{ id: 'slotday_skip', title: 'Que ustedes me contacten', description: 'Un colaborador te propone el horario' }];
  for (let i = 0; i < 6; i++) {
    rows.push({ id: `slotday_${i}`, title: dayLabel(dateStrForOffset(i)), description: i === 0 ? 'Hoy' : '' });
  }
  return listMessage(to, {
    body: '📅 ¿Qué día te gustaría agendar tu cita?',
    buttonLabel: 'Elegir día',
    sections: [{ title: 'Próximos días', rows }],
  });
}

function timePickerList(to) {
  return listMessage(to, {
    body: '⏰ ¿A qué hora te queda mejor?',
    buttonLabel: 'Elegir hora',
    sections: [{ title: 'Horario', rows: TIME_SLOTS.map((t) => ({ id: `slottime_${t}`, title: timeLabel(t), description: '' })) }],
  });
}

/* ---- tras configurar un servicio: seguir agregando o ver resumen ---- */
function serviceAddedButtons(to, summaryLine) {
  return buttonMessage(to, {
    body: `✅ ${summaryLine}\n¿Quieres agregar otro servicio o ver el resumen de tu plan?`,
    buttons: [
      { id: 'catalog_add_another', title: '➕ Agregar otro' },
      { id: 'catalog_view_summary', title: '🧾 Ver resumen' },
    ],
  });
}

/* ---- resumen / ticket ---- */
function ticketSummary(to, { weightIdx, lines, total }) {
  const body =
    `*Tu paquete* — ${TIER[weightIdx]}\n\n` +
    lines.map((l) => `${l.label}: *${l.price}*`).join('\n') +
    `\n\n*Total mensual: ${cop(total)}*\nCancela cuando quieras.`;
  return buttonMessage(to, {
    body,
    buttons: [
      { id: 'plan_confirm', title: '✅ Confirmar plan' },
      { id: 'plan_edit', title: '✏️ Editar' },
    ],
  });
}

function planConfirmed(to, petName) {
  return textMessage(to, `¡Listo! El plan de ${petName} quedó activo. Te escribo antes de cada servicio 🐾`);
}

/* ---- mis servicios ---- */
function upcomingList(to, bookings) {
  if (!bookings.length) {
    return textMessage(to, 'No tienes servicios próximos todavía. Escribe *menu* para armar uno 🐾');
  }
  return listMessage(to, {
    body: 'Tus próximos servicios:',
    buttonLabel: 'Ver servicios',
    sections: [
      {
        title: 'Agenda',
        rows: bookings.slice(0, 10).map((b) => ({
          id: `booking_${b.id}`,
          title: `${b.icon} ${b.title}`,
          description: `${b.when} · ${b.status}`,
        })),
      },
    ],
  });
}

function bookingActionButtons(to, booking) {
  return buttonMessage(to, {
    body: `${booking.icon} *${booking.title}*\n${booking.when}`,
    buttons: [
      { id: `booking_confirm_${booking.id}`, title: 'Confirmar' },
      { id: `booking_reschedule_${booking.id}`, title: 'Reagendar' },
      { id: `booking_cancel_${booking.id}`, title: 'Cancelar' },
    ],
  });
}

/* ---- handoff a humano ---- */
function humanHandoff(to) {
  return textMessage(to, '🙋 Te conecto con el equipo de ALLPETZ, en un momento te escriben por aquí mismo.');
}

module.exports = {
  textMessage,
  imageMessage,
  listMessage,
  buttonMessage,
  welcomeIntro,
  askPetName,
  askBreed,
  mainMenu,
  catalogIntro,
  catalogList,
  catalogDetail,
  weightPicker,
  servicesChecklist,
  banoVariantList,
  banoNotesPrompt,
  paseoFrequencyList,
  paseoDurationButtons,
  paseoModalidadButtons,
  barfOptionsList,
  dateStrForOffset,
  formatSlotLabel,
  dayPickerList,
  timePickerList,
  serviceAddedButtons,
  ticketSummary,
  planConfirmed,
  upcomingList,
  bookingActionButtons,
  humanHandoff,
};
