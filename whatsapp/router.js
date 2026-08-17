/* Máquina de estados de la conversación. Pura: no hace red ni I/O, así que se
   puede probar sin credenciales de Meta (ver whatsapp/router.test.js).
   handle(session, incoming) muta `session` y devuelve un arreglo de mensajes
   (payloads de messages.js) para enviar, en orden. */
'use strict';

const CATALOG = require('../catalog.js');
const M = require('./messages.js');
const { ticketFor } = require('./session.js');

const GREETING_RE = /^(hola|hi|menu|inicio|buenas)/i;
// Steps donde cualquier texto se captura como dato (nombre, raza, notas),
// nunca como el atajo global de saludo.
const FREE_TEXT_STEPS = ['onboarding_petname', 'onboarding_breed', 'catalog_bano_notes'];
const ONBOARDING_STEPS = ['onboarding_petname', 'onboarding_weight', 'onboarding_breed'];

function handle(to, session, incoming) {
  const inFreeTextCapture = FREE_TEXT_STEPS.includes(session.step);

  // Disparador global: "hola" / "menu" reinicia al menú principal desde
  // cualquier paso — salvo mientras se está esperando texto libre (nombre,
  // raza, notas), donde ese mismo texto es un dato, no un comando.
  if (incoming.type === 'text' && !inFreeTextCapture && GREETING_RE.test(incoming.text.trim())) {
    if (!session.onboarded) return startOnboarding(to, session);
    session.step = 'menu';
    return [M.mainMenu(to, session.petName || 'de nuevo')];
  }
  if (incoming.type === 'interactive' && incoming.id === 'back_menu') {
    if (!session.onboarded) return startOnboarding(to, session);
    session.step = 'menu';
    return [M.mainMenu(to, session.petName || 'de nuevo')];
  }

  // Botones de "mis servicios" llegan con el id de la reserva incrustado,
  // se reconocen sin importar en qué paso esté la sesión.
  if (incoming.type === 'interactive' && /^booking_(confirm|reschedule|cancel)_/.test(incoming.id)) {
    return handleBookingAction(to, session, incoming.id);
  }

  // Todo usuario nuevo pasa por onboarding antes que cualquier otra cosa.
  if (!session.onboarded && !ONBOARDING_STEPS.includes(session.step)) {
    return startOnboarding(to, session);
  }

  switch (session.step) {
    case 'onboarding_petname':
      return handleOnboardingPetName(to, session, incoming);
    case 'onboarding_weight':
      return handleOnboardingWeight(to, session, incoming);
    case 'onboarding_breed':
      return handleOnboardingBreed(to, session, incoming);
    case 'menu':
      return handleMenu(to, session, incoming);
    case 'catalog':
      return handleCatalog(to, session, incoming);
    case 'catalog_detail':
      return handleCatalogDetail(to, session, incoming);
    case 'catalog_bano_variant':
      return handleCatalogBanoVariant(to, session, incoming);
    case 'catalog_bano_notes':
      return handleCatalogBanoNotes(to, session, incoming);
    case 'catalog_paseo_freq':
      return handleCatalogPaseoFreq(to, session, incoming);
    case 'catalog_paseo_duration':
      return handleCatalogPaseoDuration(to, session, incoming);
    case 'catalog_paseo_modalidad':
      return handleCatalogPaseoModalidad(to, session, incoming);
    case 'catalog_barf_variant':
      return handleCatalogBarfVariant(to, session, incoming);
    case 'catalog_pick_day':
      return handleCatalogPickDay(to, session, incoming);
    case 'catalog_pick_time':
      return handleCatalogPickTime(to, session, incoming);
    case 'catalog_added':
      return handleCatalogAdded(to, session, incoming);
    case 'reschedule_pick_day':
      return handleReschedulePickDay(to, session, incoming);
    case 'reschedule_pick_time':
      return handleReschedulePickTime(to, session, incoming);
    case 'plan_weight':
      return handlePlanWeight(to, session, incoming);
    case 'plan_services':
      return handlePlanServices(to, session, incoming);
    case 'plan_summary':
      return handlePlanSummary(to, session, incoming);
    case 'servicios':
      return handleServiciosList(to, session, incoming);
    case 'human':
      return [M.humanHandoff(to)];
    default:
      session.step = 'menu';
      return [M.mainMenu(to, session.petName || 'de nuevo')];
  }
}

/* ---- 0. Onboarding ---- */
function startOnboarding(to, session) {
  session.step = 'onboarding_petname';
  return [M.welcomeIntro(to), M.askPetName(to)];
}

function handleOnboardingPetName(to, session, incoming) {
  if (incoming.type === 'text' && incoming.text.trim()) {
    session.petName = incoming.text.trim();
    session.step = 'onboarding_weight';
    return [M.weightPicker(to)];
  }
  return [M.askPetName(to)];
}

function handleOnboardingWeight(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('weight_')) {
    const idx = Number(incoming.id.slice('weight_'.length));
    session.weightIdx = idx;
    session.barfKey = CATALOG.BARF_DEFAULT[idx];
    session.step = 'onboarding_breed';
    return [M.askBreed(to, session.petName)];
  }
  return [M.weightPicker(to)];
}

function handleOnboardingBreed(to, session, incoming) {
  if (incoming.type === 'text') {
    const t = incoming.text.trim();
    session.petBreed = /^omitir$/i.test(t) ? null : t;
    session.onboarded = true;
    session.step = 'menu';
    return [M.mainMenu(to, session.petName)];
  }
  return [M.askBreed(to, session.petName)];
}

/* ---- menú y catálogo ---- */
function handleMenu(to, session, incoming) {
  if (incoming.type !== 'interactive') return [M.mainMenu(to, session.petName || 'de nuevo')];
  switch (incoming.id) {
    case 'menu_catalogo':
      session.step = 'catalog';
      return [M.catalogIntro(to), M.catalogList(to)];
    case 'menu_plan':
      if (session.onboarded) {
        session.step = 'plan_services';
        return [M.servicesChecklist(to, session.weightIdx, session.services)];
      }
      session.step = 'plan_weight';
      return [M.weightPicker(to)];
    case 'menu_servicios':
      session.step = 'servicios';
      return [M.upcomingList(to, session.bookings)];
    case 'menu_humano':
      session.step = 'human';
      return [M.humanHandoff(to)];
    default:
      return [M.mainMenu(to, session.petName || 'de nuevo')];
  }
}

function handleCatalog(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('catalog_')) {
    const svcId = incoming.id.slice('catalog_'.length);
    const svc = CATALOG.SERVICES.find((s) => s.id === svcId);
    if (!svc) return [M.catalogList(to)];
    session.lastServiceId = svcId;
    session.step = 'catalog_detail';
    return [M.catalogDetail(to, svc, session.weightIdx)];
  }
  return [M.catalogList(to)];
}

function handleCatalogDetail(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('add_')) {
    const builderId = incoming.id.slice('add_'.length);
    session.services[builderId] = true;
    session.returnTo = 'catalog';
    return startServiceConfig(to, session, builderId);
  }
  if (incoming.type === 'interactive' && incoming.id === 'notify_soon') {
    session.step = 'menu';
    return [M.textMessage(to, 'Anotado — te avisamos apenas esté disponible en la app 🐾'), M.mainMenu(to, session.petName || 'de nuevo')];
  }
  session.step = 'menu';
  return [M.mainMenu(to, session.petName || 'de nuevo')];
}

/* Cada servicio con variantes se configura aquí mismo, apenas se elige —
   tanto desde el catálogo (session.returnTo = 'catalog') como desde el
   armador de plan por lote (session.returnTo = 'bulk'). */
function startServiceConfig(to, session, builderId) {
  if (builderId === 'bano') {
    session.step = 'catalog_bano_variant';
    return [M.banoVariantList(to, session.weightIdx)];
  }
  if (builderId === 'paseo') {
    session.step = 'catalog_paseo_freq';
    return [M.paseoFrequencyList(to, session.weightIdx)];
  }
  if (builderId === 'barf') {
    session.step = 'catalog_barf_variant';
    return [M.barfOptionsList(to)];
  }
  // vacunas / dental: sin variantes, se agregan directo.
  return finishServiceConfig(to, session, builderId);
}

function finishServiceConfig(to, session, builderId) {
  if (session.returnTo === 'bulk') {
    if (builderId === 'paseo' && session.services.barf) {
      return startServiceConfig(to, session, 'barf');
    }
    session.step = 'plan_summary';
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  // Vía Catálogo: el cliente propone día y hora para este servicio antes de
  // seguir — el colaborador solo acepta o rechaza (ver handleCatalogAdded /
  // whatsapp/collab-api.js para el lado del colaborador).
  session.pendingSlotService = builderId;
  session.step = 'catalog_pick_day';
  return [M.dayPickerList(to)];
}

function handleCatalogPickDay(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id === 'slotday_skip') {
    return finishAfterSlot(to, session);
  }
  if (incoming.type === 'interactive' && incoming.id.startsWith('slotday_')) {
    const offset = Number(incoming.id.slice('slotday_'.length));
    session.pendingSlotDate = M.dateStrForOffset(offset);
    session.step = 'catalog_pick_time';
    return [M.timePickerList(to)];
  }
  return [M.dayPickerList(to)];
}

function handleCatalogPickTime(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('slottime_')) {
    const time = incoming.id.slice('slottime_'.length);
    const serviceId = session.pendingSlotService;
    session.proposedSlots = session.proposedSlots || {};
    session.proposedSlots[serviceId] = `${session.pendingSlotDate}T${time}`;
    return finishAfterSlot(to, session);
  }
  return [M.timePickerList(to)];
}

function finishAfterSlot(to, session) {
  const builderId = session.pendingSlotService;
  const meta = CATALOG.ROW_META[builderId];
  session.step = 'catalog_added';
  const slot = session.proposedSlots && session.proposedSlots[builderId];
  const whenLine = slot ? ` Propusiste ${M.formatSlotLabel(slot)} — el colaborador lo confirma o te propone otro horario.` : '';
  return [M.serviceAddedButtons(to, `${meta.emoji} ${meta.label} agregado a tu plan.${whenLine}`)];
}

/* ---- Re-proponer horario cuando el colaborador rechazó el anterior ----
   Entra directo a estos pasos porque collab-api.js los activa desde fuera
   del chat (ver whatsapp/collab-api.js::declineProposal). */
function handleReschedulePickDay(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id === 'slotday_skip') {
    session.reschedulingBookingId = null;
    session.step = 'menu';
    return [M.textMessage(to, 'Sin problema, un colaborador te contacta pronto para cuadrar el horario 🐾'), M.mainMenu(to, session.petName || 'de nuevo')];
  }
  if (incoming.type === 'interactive' && incoming.id.startsWith('slotday_')) {
    const offset = Number(incoming.id.slice('slotday_'.length));
    session.pendingSlotDate = M.dateStrForOffset(offset);
    session.step = 'reschedule_pick_time';
    return [M.timePickerList(to)];
  }
  return [M.dayPickerList(to)];
}

function handleReschedulePickTime(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('slottime_')) {
    const time = incoming.id.slice('slottime_'.length);
    session.rescheduleProposedAt = `${session.pendingSlotDate}T${time}`;
    session.step = 'menu';
    return [
      M.textMessage(to, `Listo, le propusimos al colaborador tu nuevo horario: ${M.formatSlotLabel(session.rescheduleProposedAt)}. Te avisamos apenas confirme ✅`),
      M.mainMenu(to, session.petName || 'de nuevo'),
    ];
  }
  return [M.timePickerList(to)];
}

function handleCatalogBanoVariant(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('bano_')) {
    session.banoVariant = incoming.id.slice('bano_'.length);
    session.step = 'catalog_bano_notes';
    return [M.banoNotesPrompt(to)];
  }
  return [M.banoVariantList(to, session.weightIdx)];
}

function handleCatalogBanoNotes(to, session, incoming) {
  if (incoming.type === 'text') {
    const t = incoming.text.trim();
    session.banoNotes = /^ninguna$/i.test(t) ? null : t;
    return finishServiceConfig(to, session, 'bano');
  }
  return [M.banoNotesPrompt(to)];
}

function handleCatalogPaseoFreq(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('paseofreq_')) {
    session.paseoFreq = Number(incoming.id.slice('paseofreq_'.length));
    session.step = 'catalog_paseo_duration';
    return [M.paseoDurationButtons(to)];
  }
  return [M.paseoFrequencyList(to, session.weightIdx)];
}

function handleCatalogPaseoDuration(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('paseodur_')) {
    session.paseoDuration = incoming.id.slice('paseodur_'.length);
    session.step = 'catalog_paseo_modalidad';
    return [M.paseoModalidadButtons(to)];
  }
  return [M.paseoDurationButtons(to)];
}

function handleCatalogPaseoModalidad(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('paseomod_')) {
    session.paseoModalidad = incoming.id.slice('paseomod_'.length);
    return finishServiceConfig(to, session, 'paseo');
  }
  return [M.paseoModalidadButtons(to)];
}

function handleCatalogBarfVariant(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('barf_')) {
    session.barfKey = incoming.id.slice('barf_'.length);
    return finishServiceConfig(to, session, 'barf');
  }
  return [M.barfOptionsList(to)];
}

function handleCatalogAdded(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id === 'catalog_add_another') {
    session.step = 'catalog';
    return [M.catalogList(to)];
  }
  if (incoming.type === 'interactive' && incoming.id === 'catalog_view_summary') {
    session.step = 'plan_summary';
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  return [M.serviceAddedButtons(to, 'Tu plan se sigue armando.')];
}

/* ---- Armar mi plan (selección múltiple por lote) ---- */
function handlePlanWeight(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('weight_')) {
    const idx = Number(incoming.id.slice('weight_'.length));
    session.weightIdx = idx;
    session.barfKey = CATALOG.BARF_DEFAULT[idx];
    session.step = 'plan_services';
    return [M.servicesChecklist(to, session.weightIdx, session.services)];
  }
  return [M.weightPicker(to)];
}

function handlePlanServices(to, session, incoming) {
  if (incoming.type !== 'interactive') return [M.servicesChecklist(to, session.weightIdx, session.services)];
  if (incoming.id.startsWith('toggle_')) {
    const id = incoming.id.slice('toggle_'.length);
    session.services[id] = !session.services[id];
    return [M.servicesChecklist(to, session.weightIdx, session.services)];
  }
  if (incoming.id === 'services_continue') {
    return advancePastServices(to, session);
  }
  return [M.servicesChecklist(to, session.weightIdx, session.services)];
}

function advancePastServices(to, session) {
  session.returnTo = 'bulk';
  if (session.services.paseo) return startServiceConfig(to, session, 'paseo');
  if (session.services.barf) return startServiceConfig(to, session, 'barf');
  session.step = 'plan_summary';
  const { lines, total } = ticketFor(session);
  return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
}

function handlePlanSummary(to, session, incoming) {
  if (incoming.type !== 'interactive') {
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  if (incoming.id === 'plan_confirm') {
    session.step = 'menu';
    session.planConfirmedAt = Date.now();
    return [M.planConfirmed(to, session.petName), M.mainMenu(to, session.petName || 'de nuevo')];
  }
  if (incoming.id === 'plan_edit') {
    session.step = 'plan_services';
    return [M.servicesChecklist(to, session.weightIdx, session.services)];
  }
  const { lines, total } = ticketFor(session);
  return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
}

/* ---- mis servicios ---- */
function handleServiciosList(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('booking_')) {
    const bookingId = incoming.id.slice('booking_'.length);
    const booking = session.bookings.find((b) => b.id === bookingId);
    if (booking) return [M.bookingActionButtons(to, booking)];
  }
  return [M.upcomingList(to, session.bookings)];
}

function handleBookingAction(to, session, id) {
  const m = id.match(/^booking_(confirm|reschedule|cancel)_(.+)$/);
  if (!m) return [M.mainMenu(to, session.petName || 'de nuevo')];
  const [, action, bookingId] = m;
  const booking = session.bookings.find((b) => b.id === bookingId);
  session.step = 'menu';
  if (!booking) return [M.mainMenu(to, session.petName || 'de nuevo')];
  if (action === 'confirm') booking.status = 'confirmado';
  if (action === 'cancel') booking.status = 'cancelado';
  if (action === 'reschedule') booking.status = 'agendado';
  const verb = { confirm: 'confirmado', cancel: 'cancelado', reschedule: 'marcado para reagendar' }[action];
  return [M.textMessage(to, `Listo, ${booking.title.toLowerCase()} quedó ${verb} ✅`), M.mainMenu(to, session.petName || 'de nuevo')];
}

module.exports = { handle };
