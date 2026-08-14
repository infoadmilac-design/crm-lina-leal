/* Constructores de mensajes de la WhatsApp Cloud API.
   Cada función devuelve el body exacto que se envía a
   POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
   Límites reales de la API que respetamos aquí:
   - listas: máx. 10 filas en total, título de fila máx. 24 caracteres, descripción máx. 72
   - botones de respuesta rápida: máx. 3 por mensaje, título máx. 20 caracteres */
'use strict';

const CATALOG = require('../catalog.js');
const { SERVICES, WEIGHTS, ROW_META, BUILDER_ROW_IDS, BARF_OPTIONS, TIER, cop, fmt, price } = CATALOG;

function base(to) {
  return { messaging_product: 'whatsapp', to, recipient_type: 'individual' };
}

function textMessage(to, body) {
  return { ...base(to), type: 'text', text: { body, preview_url: false } };
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

function buttonMessage(to, { body, footer, buttons }) {
  return {
    ...base(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  };
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

/* ---- 2a. Catálogo (8 servicios) ---- */
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

function catalogDetail(to, service) {
  const inBuilder = !!service.map;
  return buttonMessage(to, {
    body: `${service.emoji} *${service.title}*\n${service.desc}`,
    buttons: inBuilder
      ? [
          { id: `add_${service.map}`, title: 'Agregar a mi plan' },
          { id: 'back_menu', title: '‹ Volver al menú' },
        ]
      : [
          { id: 'notify_soon', title: 'Avísame cuando esté' },
          { id: 'back_menu', title: '‹ Volver al menú' },
        ],
  });
}

/* ---- 2b. Armar plan: paso 1, peso ---- */
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

/* ---- variante de paseo (2 botones) ---- */
function paseoVariantButtons(to) {
  return buttonMessage(to, {
    body: '🐕 Paseos: ¿con qué frecuencia?',
    buttons: [
      { id: 'paseo_sem', title: '1×/semana' },
      { id: 'paseo_mes', title: '5×/semana' },
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
  listMessage,
  buttonMessage,
  mainMenu,
  catalogList,
  catalogDetail,
  weightPicker,
  servicesChecklist,
  paseoVariantButtons,
  barfOptionsList,
  ticketSummary,
  planConfirmed,
  upcomingList,
  bookingActionButtons,
  humanHandoff,
};
