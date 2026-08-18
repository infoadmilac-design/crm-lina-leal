/* Constructores de mensajes de la WhatsApp Cloud API.
   Cada función devuelve el body exacto que se envía a
   POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
   Límites reales de la API que respetamos aquí:
   - listas: máx. 10 filas en total, título de fila máx. 24 caracteres, descripción máx. 72
   - botones de respuesta rápida: máx. 3 por mensaje, título máx. 20 caracteres */
'use strict';

const CATALOG = require('../catalog.js');
const Session = require('./session.js');
const {
  SERVICES, WEIGHTS, ROW_META, BUILDER_ROW_IDS, BARF_OPTIONS, TIER, cop, fmt, price,
  BANO_VARIANT_ORDER, PASEO_FREQ_OPTIONS, PASEO_DURATION, PASEO_MODALIDAD,
} = CATALOG;
const { DAY_NAMES, DAY_NAMES_SHORT, FRANJA_LABEL } = Session;

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
/* Textos editables desde el panel de administrador (Configuración > Textos
   del bot) — solo estos dos, por ser mensajes de texto simple sin botones
   ni listas (ver el plan: reescribir los demás es más arriesgado). Si no
   hay override guardado, se usa el texto por defecto de siempre. */
const DEFAULT_BOT_TEXTS = {
  welcome:
    '¡Guau, hola! 🐾 Soy la voz (bueno, la patita escritora) de ALLPETZ: el ecosistema que junta en un solo lugar TODO lo que tu mejor amigo de cuatro patas va a necesitar — paseos, baño, comida rica, vacunas, dientes limpios, entrenamiento, transporte, hotel y hasta seguro.\n\n' +
    'Nada de andar buscando 5 contactos distintos cada vez que se te ocurre algo. En unos minutos armamos el plan perfecto según su tamaño, y listo: tú te olvidas de estar pendiente, porque nosotros te recordamos cada cita a tiempo. Menos preocupaciones para ti, más cariño para tu peludo 🐶✨',
  humanHandoff: '🙋 Te conecto con el equipo de ALLPETZ, en un momento te escriben por aquí mismo.',
};
const BOT_TEXTS = Object.assign({}, DEFAULT_BOT_TEXTS);

/** Aplica los textos guardados por el admin — mismo patrón que
    catalog.js::setOverrides(), síncrono/sin red. */
function setOverrides(overrides) {
  if (overrides && overrides.botTexts) Object.assign(BOT_TEXTS, overrides.botTexts);
}

// Pieza oficial de marca — la misma que se usa en el mockup del ecosistema.
const WELCOME_PHOTO = 'https://infoadmilac-design.github.io/crm-lina-leal/images/portada1.jpg';

function welcomePhoto(to) {
  return imageMessage(to, WELCOME_PHOTO, 'ALLPETZ 🐾 — Membresía Integral de Cuidado Canino');
}

function welcomeIntro(to) {
  return textMessage(to, BOT_TEXTS.welcome);
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

/* ---- paso 2, checklist de servicios (multi-select simulado) ----
   Recibe la sesión completa (no solo weightIdx + on/off) para poder mostrar
   el precio y el detalle REAL de cada servicio ya configurado — antes
   mostraba siempre el precio por defecto, sin reflejar lo que el cliente
   ya había elegido (frecuencia, variante, etc). */
function servicesChecklist(to, session) {
  const opts = {
    banoVariant: session.banoVariant, banoFreq: session.banoFreq,
    paseoFreq: session.paseoFreq, paseoDuration: session.paseoDuration, paseoModalidad: session.paseoModalidad,
    barfKey: session.barfKey, barfEntregas: session.barfEntregas,
    dentalFreq: session.dentalFreq,
  };
  return listMessage(to, {
    body: '¿Qué incluye su plan? Toca una fila para activarla o desactivarla. "Continuar" te deja ajustar la frecuencia de cada una antes del resumen.',
    buttonLabel: 'Ver servicios',
    sections: [
      {
        title: 'Servicios',
        rows: [
          ...BUILDER_ROW_IDS.map((id) => {
            const row = ROW_META[id];
            const on = !!session.services[id];
            const p = fmt(price(id, session.weightIdx, opts));
            const detail = on ? CATALOG.serviceDetailLabel(id, session.weightIdx, opts) : `Desde`;
            return {
              id: `toggle_${id}`,
              title: `${on ? '✅' : '◻️'} ${row.emoji} ${row.label}`,
              description: `${detail} · ${p}`,
            };
          }),
          { id: 'services_continue', title: '▶️ Continuar', description: 'Ajustar cada una y ver el resumen' },
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

/* ---- Paquetes inteligentes (se ofrecen apenas se conoce la mascota) ----
   WhatsApp no tiene "tarjetas": la aproximación más cercana es un mensaje de
   texto con un bloque bien separado por plan (nombre, qué incluye sin
   ambigüedad, precio, ahorro) — packagesDetail() — seguido de la lista para
   elegir (packagesList()). Así el cliente entiende qué está comparando
   antes de tocar nada. */
function packagesDetail(to, petName, weightIdx) {
  const intro = `¡Hola${petName ? ' ' + petName : ''}! 🐾 Así se ven los 3 planes que armé según su tamaño:\n\n`;
  const blocks = CATALOG.PACKAGE_ORDER.map((id) => {
    const pkg = CATALOG.PACKAGES[id];
    const opts = pkg.opts(weightIdx);
    const lines = pkg.servicesList.map((sid) => {
      const meta = ROW_META[sid];
      return `${meta.emoji} ${meta.label} — ${CATALOG.serviceDetailLabel(sid, weightIdx, opts)}`;
    }).join('\n');
    const total = CATALOG.packageTotal(id, weightIdx);
    const aLaCarte = CATALOG.packageALaCarteTotal(id, weightIdx);
    const savings = aLaCarte - total;
    const savingsLine = savings > 0 ? `\n💰 Ahorras ${fmt(savings)}/mes vs. armarlo por separado` : '';
    return `*${pkg.label}* — ${pkg.badge}\n_${pkg.tagline}_\n${lines}\n*Total: ${fmt(total)}/mes*${savingsLine}`;
  });
  return textMessage(to, intro + blocks.join('\n\n') + '\n\n👇 Elige uno, o toca "Arma tu propio plan" para armarlo tú mismo.');
}

function packagesList(to, petName, weightIdx) {
  const rows = CATALOG.PACKAGE_ORDER.map((id) => {
    const pkg = CATALOG.PACKAGES[id];
    const total = CATALOG.packageTotal(id, weightIdx);
    return { id: `pkg_${id}`, title: pkg.label, description: `${fmt(total)}/mes · ${pkg.badge}`.slice(0, 72) };
  });
  rows.push({ id: 'pkg_custom', title: 'Arma tu propio plan', description: 'Elige y combina servicio por servicio' });
  return listMessage(to, {
    body: '¿Cuál eliges?',
    buttonLabel: 'Ver planes',
    sections: [{ title: 'Planes sugeridos', rows }],
  });
}

function packageAppliedIntro(to, packageId) {
  const pkg = CATALOG.PACKAGES[packageId];
  return textMessage(to, `¡Buena elección! 🐾 Así quedó el plan ${pkg.label}:`);
}

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

function banoFrequencyButtons(to, weightIdx, variant) {
  const p1 = fmt(CATALOG.banoVariantPrice(weightIdx, variant, 1));
  const p2 = fmt(CATALOG.banoVariantPrice(weightIdx, variant, 2));
  return buttonMessage(to, {
    body: `🛁 ¿Cuántas veces al mes? 1× sale ${p1}/mes · 2× sale ${p2}/mes (menos por visita).`,
    buttons: [
      { id: 'banofreq_1', title: '1 vez al mes' },
      { id: 'banofreq_2', title: '2 veces al mes' },
    ],
  });
}

/* ---- paseo: frecuencia + duración + modalidad ---- */
/* ---- Paseos: el cliente elige los DÍAS (no un número) — el precio por
   paseo baja mientras más días elige, ver catalog.js::paseoFreqBase(). ---- */
function paseoDaysChecklist(to, session) {
  const days = session.paseoDays || [];
  const rows = DAY_NAMES.map((name, i) => ({
    id: `paseoday_${i}`,
    title: `${days.includes(i) ? '✅' : '◻️'} ${name}`,
    description: '',
  }));
  rows.push({
    id: 'paseoday_continue',
    title: '▶️ Continuar',
    description: days.length ? `${days.length} día${days.length === 1 ? '' : 's'} elegido${days.length === 1 ? '' : 's'} — ${fmt(CATALOG.paseoFreqBase(session.weightIdx, days.length))}/paseo` : 'Elige al menos un día',
  });
  const p1 = fmt(CATALOG.paseoFreqBase(session.weightIdx, 1));
  const p7 = fmt(CATALOG.paseoFreqBase(session.weightIdx, 7));
  const body = session.paseoScheduleOnly
    ? `🐕 Tu plan incluye ${session.paseoFreq}×/semana de paseo — ¿qué días prefieres? (esto no cambia el precio, ya está cerrado en tu plan)`
    : `🐕 ¿Qué días quieres que salga a pasear? Entre más días elijas, más baja el precio por cada paseo: 1 día/semana sale ${p1}/paseo, 7 días/semana baja a ${p7}/paseo.`;
  return listMessage(to, { body, buttonLabel: 'Elegir días', sections: [{ title: 'Días de paseo', rows }] });
}

function paseoFranjaButtons(to) {
  return buttonMessage(to, {
    body: '⏰ ¿En qué franja prefieres los paseos?',
    buttons: [
      { id: 'paseofranja_manana', title: '🌅 Mañana' },
      { id: 'paseofranja_tarde', title: '🌇 Tarde' },
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

function barfEntregaButtons(to) {
  const fee = fmt(CATALOG.BARF_ENTREGA_FEE_STATE.value);
  return buttonMessage(to, {
    body: `📦 ¿Cómo prefieres la entrega? La cantidad del mes es la misma en ambos casos — 2 entregas cuesta ${fee} más por el viaje extra, pero llega más fresco.`,
    buttons: [
      { id: 'barfentrega_1', title: 'Todo de una vez' },
      { id: 'barfentrega_2', title: '2 entregas' },
    ],
  });
}

/* ---- frecuencia de limpieza dental ---- */
function dentalFrequencyButtons(to, weightIdx) {
  const mensual = fmt(CATALOG.dentalPrice(weightIdx, 'mensual'));
  const estandar = fmt(CATALOG.dentalPrice(weightIdx, 'trimestral'));
  return buttonMessage(to, {
    body: `🦷 ¿Cada cuánto? Mensual sale ${mensual}/visita (recurrente, más barato). Cada 3 o 6 meses sale ${estandar}/visita.`,
    buttons: [
      { id: 'dentalfreq_mensual', title: 'Mensual' },
      { id: 'dentalfreq_trimestral', title: 'Cada 3 meses' },
      { id: 'dentalfreq_semestral', title: 'Cada 6 meses' },
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
  const rows = [];
  for (let i = 0; i < 7; i++) {
    rows.push({ id: `slotday_${i}`, title: dayLabel(dateStrForOffset(i)), description: i === 0 ? 'Hoy' : '' });
  }
  return listMessage(to, {
    body: '📅 Tú eliges el día — ¿cuál te queda mejor?',
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

/* ---- Aviso que se manda apenas el cliente propone un horario, para
   cualquier servicio — el cliente siempre elige, y siempre sabe qué sigue. ---- */
function slotProposedNotice(to, serviceLabel, whenLabel) {
  return textMessage(to, `⏳ Perfecto — en unos minutos te confirmamos si *${serviceLabel}* puede ser el *${whenLabel}* que elegiste. Si tu colaborador no puede a esa hora, te va a proponer otro horario para que tú decidas. 🐾`);
}

function paseoScheduleNotice(to, session) {
  const days = (session.paseoDays || []).slice().sort((a, b) => a - b).map((d) => DAY_NAMES_SHORT[d]).join(', ');
  const franja = FRANJA_LABEL[session.paseoFranja] || '';
  return textMessage(to, `⏳ Perfecto — quedaron tus paseos para *${days}*, en la *${franja}*. En unos minutos lo confirmamos con tu colaborador, o te proponemos otro horario si hace falta. 🐾`);
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
  return textMessage(to, BOT_TEXTS.humanHandoff);
}

module.exports = {
  textMessage,
  imageMessage,
  listMessage,
  buttonMessage,
  setOverrides,
  DEFAULT_BOT_TEXTS,
  welcomePhoto,
  welcomeIntro,
  askPetName,
  askBreed,
  mainMenu,
  catalogIntro,
  catalogList,
  catalogDetail,
  weightPicker,
  servicesChecklist,
  packagesDetail,
  packagesList,
  packageAppliedIntro,
  banoVariantList,
  banoFrequencyButtons,
  banoNotesPrompt,
  paseoDaysChecklist,
  paseoFranjaButtons,
  paseoDurationButtons,
  paseoModalidadButtons,
  barfOptionsList,
  barfEntregaButtons,
  dentalFrequencyButtons,
  dateStrForOffset,
  formatSlotLabel,
  dayPickerList,
  timePickerList,
  slotProposedNotice,
  paseoScheduleNotice,
  serviceAddedButtons,
  ticketSummary,
  planConfirmed,
  upcomingList,
  bookingActionButtons,
  humanHandoff,
};
