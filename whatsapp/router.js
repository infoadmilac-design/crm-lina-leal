/* Máquina de estados de la conversación. Pura: no hace red ni I/O, así que se
   puede probar sin credenciales de Meta (ver whatsapp/router.test.js).
   handle(session, incoming) muta `session` y devuelve un arreglo de mensajes
   (payloads de messages.js) para enviar, en orden. */
'use strict';

const CATALOG = require('../catalog.js');
const M = require('./messages.js');
const { ticketFor, applyPackage } = require('./session.js');

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
    case 'packages':
      return handlePackages(to, session, incoming);
    case 'catalog':
      return handleCatalog(to, session, incoming);
    case 'catalog_detail':
      return handleCatalogDetail(to, session, incoming);
    case 'catalog_bano_variant':
      return handleCatalogBanoVariant(to, session, incoming);
    case 'catalog_bano_freq':
      return handleCatalogBanoFreq(to, session, incoming);
    case 'catalog_bano_notes':
      return handleCatalogBanoNotes(to, session, incoming);
    case 'catalog_paseo_days':
      return handleCatalogPaseoDays(to, session, incoming);
    case 'catalog_paseo_franja':
      return handleCatalogPaseoFranja(to, session, incoming);
    case 'catalog_paseo_duration':
      return handleCatalogPaseoDuration(to, session, incoming);
    case 'catalog_paseo_modalidad':
      return handleCatalogPaseoModalidad(to, session, incoming);
    case 'catalog_barf_variant':
      return handleCatalogBarfVariant(to, session, incoming);
    case 'catalog_barf_entrega':
      return handleCatalogBarfEntrega(to, session, incoming);
    case 'catalog_dental_freq':
      return handleCatalogDentalFreq(to, session, incoming);
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
  return [M.welcomePhoto(to), M.welcomeIntro(to), M.askPetName(to)];
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
    session.step = 'packages';
    return [M.packagesDetail(to, session.petName, session.weightIdx), M.packagesList(to, session.petName, session.weightIdx)];
  }
  return [M.askBreed(to, session.petName)];
}

/* ---- Paquetes inteligentes: se ofrecen apenas se conoce la mascota (peso),
   tanto la primera vez (fin del onboarding) como cada vez que el cliente
   entra a "Arma tu plan" desde el menú. ---- */
function handlePackages(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('pkg_')) {
    const pkgId = incoming.id.slice('pkg_'.length);
    if (pkgId === 'custom') {
      session.returnTo = 'bulk';
      session.step = 'plan_services';
      return [M.servicesChecklist(to, session)];
    }
    if (applyPackage(session, pkgId)) {
      // Un paquete fija qué y cuánto, pero el cliente siempre elige cuándo —
      // antes del resumen se agenda cada servicio (paseo: días + franja;
      // los demás: día y hora), sin tocar el precio ya cerrado del paquete.
      session.returnTo = 'bulk';
      return [M.packageAppliedIntro(to, pkgId), ...advanceBulkSchedule(to, session, null)];
    }
  }
  return [M.packagesList(to, session.petName, session.weightIdx)];
}

/* ---- menú y catálogo ---- */
function handleMenu(to, session, incoming) {
  if (incoming.type !== 'interactive') return [M.mainMenu(to, session.petName || 'de nuevo')];
  switch (incoming.id) {
    case 'menu_catalogo':
      session.step = 'catalog';
      return [M.catalogIntro(to), M.catalogList(to)];
    case 'menu_plan':
      session.step = 'packages';
      return [M.packagesDetail(to, session.petName, session.weightIdx), M.packagesList(to, session.petName, session.weightIdx)];
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
  // Configurar algo a mano rompe el precio cerrado del paquete — a partir de
  // aquí se cobra servicio por servicio, como en el armador de siempre.
  session.packageDiscountPct = null;
  if (builderId === 'bano') {
    session.step = 'catalog_bano_variant';
    return [M.banoVariantList(to, session.weightIdx)];
  }
  if (builderId === 'paseo') {
    // Arranca en blanco: si venía de un paquete o de una vuelta anterior de
    // edición, esos días ya no aplican a esta configuración nueva.
    session.paseoScheduleOnly = false;
    session.paseoDays = [];
    session.paseoFranja = null;
    session.step = 'catalog_paseo_days';
    return [M.paseoDaysChecklist(to, session)];
  }
  if (builderId === 'barf') {
    session.step = 'catalog_barf_variant';
    return [M.barfOptionsList(to)];
  }
  if (builderId === 'dental') {
    session.step = 'catalog_dental_freq';
    return [M.dentalFrequencyButtons(to, session.weightIdx)];
  }
  // vacunas: es anual, sin variantes ni frecuencia que elegir — se agrega directo.
  return finishServiceConfig(to, session, builderId);
}

function finishServiceConfig(to, session, builderId) {
  // Paseo ya eligió sus propios días y franja como parte de su configuración
  // (ver handleCatalogPaseoFranja) — no vuelve a pasar por el selector de
  // día/hora genérico, que es para citas puntuales de un solo servicio.
  if (builderId === 'paseo') {
    // Esto solo se alcanza cuando paseo pasó por su configuración COMPLETA
    // (catálogo o armador por lotes) — el camino "solo agendar" de un
    // paquete nunca llega aquí, sale directo desde handleCatalogPaseoFranja.
    const notice = [M.paseoScheduleNotice(to, session)];
    if (session.returnTo === 'bulk') return [...notice, ...advanceBulkConfig(to, session, 'paseo')];
    session.step = 'catalog_added';
    return [...notice, M.serviceAddedButtons(to, `${CATALOG.ROW_META.paseo.emoji} Paseos agregado a tu plan.`)];
  }
  if (session.returnTo === 'bulk') {
    return advanceBulkConfig(to, session, builderId);
  }
  // Vía Catálogo: el cliente propone día y hora para este servicio antes de
  // seguir — el colaborador solo acepta o rechaza (ver handleCatalogAdded /
  // whatsapp/collab-api.js para el lado del colaborador).
  session.pendingSlotService = builderId;
  session.step = 'catalog_pick_day';
  return [M.dayPickerList(to)];
}

function handleCatalogPickDay(to, session, incoming) {
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
  const slot = session.proposedSlots && session.proposedSlots[builderId];
  const notice = slot ? [M.slotProposedNotice(to, meta.label, M.formatSlotLabel(slot))] : [];
  if (session.returnTo === 'bulk') {
    return [...notice, ...advanceBulkSchedule(to, session, builderId)];
  }
  session.step = 'catalog_added';
  return [...notice, M.serviceAddedButtons(to, `${meta.emoji} ${meta.label} agregado a tu plan.`)];
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
    session.step = 'catalog_bano_freq';
    return [M.banoFrequencyButtons(to, session.weightIdx, session.banoVariant)];
  }
  return [M.banoVariantList(to, session.weightIdx)];
}

function handleCatalogBanoFreq(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('banofreq_')) {
    session.banoFreq = Number(incoming.id.slice('banofreq_'.length));
    session.step = 'catalog_bano_notes';
    return [M.banoNotesPrompt(to)];
  }
  return [M.banoFrequencyButtons(to, session.weightIdx, session.banoVariant)];
}

function handleCatalogBanoNotes(to, session, incoming) {
  if (incoming.type === 'text') {
    const t = incoming.text.trim();
    session.banoNotes = /^ninguna$/i.test(t) ? null : t;
    return finishServiceConfig(to, session, 'bano');
  }
  return [M.banoNotesPrompt(to)];
}

function handleCatalogPaseoDays(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('paseoday_')) {
    const rest = incoming.id.slice('paseoday_'.length);
    if (rest === 'continue') {
      if (!session.paseoDays || !session.paseoDays.length) return [M.paseoDaysChecklist(to, session)];
      // Fuera de un paquete, los días elegidos SON la frecuencia (más días,
      // menos por paseo). Dentro de un paquete la frecuencia ya viene fija
      // y esto es solo para saber cuáles días prefiere — no toca el precio.
      if (!session.paseoScheduleOnly) session.paseoFreq = session.paseoDays.length;
      session.step = 'catalog_paseo_franja';
      return [M.paseoFranjaButtons(to)];
    }
    const dayIdx = Number(rest);
    session.paseoDays = session.paseoDays || [];
    const pos = session.paseoDays.indexOf(dayIdx);
    if (pos >= 0) session.paseoDays.splice(pos, 1); else session.paseoDays.push(dayIdx);
    return [M.paseoDaysChecklist(to, session)];
  }
  return [M.paseoDaysChecklist(to, session)];
}

function handleCatalogPaseoFranja(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('paseofranja_')) {
    session.paseoFranja = incoming.id.slice('paseofranja_'.length);
    session.paseoScheduleDone = true;
    if (session.paseoScheduleOnly) {
      session.paseoScheduleOnly = false;
      return [M.paseoScheduleNotice(to, session), ...advanceBulkSchedule(to, session, 'paseo')];
    }
    session.step = 'catalog_paseo_duration';
    return [M.paseoDurationButtons(to)];
  }
  return [M.paseoFranjaButtons(to)];
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
    session.step = 'catalog_barf_entrega';
    return [M.barfEntregaButtons(to)];
  }
  return [M.barfOptionsList(to)];
}

function handleCatalogBarfEntrega(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('barfentrega_')) {
    session.barfEntregas = Number(incoming.id.slice('barfentrega_'.length));
    return finishServiceConfig(to, session, 'barf');
  }
  return [M.barfEntregaButtons(to)];
}

function handleCatalogDentalFreq(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('dentalfreq_')) {
    session.dentalFreq = incoming.id.slice('dentalfreq_'.length);
    return finishServiceConfig(to, session, 'dental');
  }
  return [M.dentalFrequencyButtons(to, session.weightIdx)];
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
    return [M.servicesChecklist(to, session)];
  }
  return [M.weightPicker(to)];
}

function handlePlanServices(to, session, incoming) {
  if (incoming.type !== 'interactive') return [M.servicesChecklist(to, session)];
  if (incoming.id.startsWith('toggle_')) {
    const id = incoming.id.slice('toggle_'.length);
    session.services[id] = !session.services[id];
    session.packageDiscountPct = null;
    return [M.servicesChecklist(to, session)];
  }
  if (incoming.id === 'services_continue') {
    return advancePastServices(to, session);
  }
  return [M.servicesChecklist(to, session)];
}

function advancePastServices(to, session) {
  session.returnTo = 'bulk';
  return advanceBulkConfig(to, session, null);
}

// Orden en el que se pregunta cada servicio activo al armar/editar un plan
// por lotes — vacunas no tiene nada que preguntar, no aparece aquí.
const BULK_CONFIG_ORDER = ['bano', 'paseo', 'barf', 'dental'];

/** Avanza al siguiente servicio activo sin configurar todavía (después de
    `justConfiguredId`, o desde el principio si es null) — así "Continuar" y
    "Editar" en el resumen recorren baño/paseo/BARF/dental por igual, no
    solo paseo y BARF como antes. */
function advanceBulkConfig(to, session, justConfiguredId) {
  const startIdx = justConfiguredId ? BULK_CONFIG_ORDER.indexOf(justConfiguredId) + 1 : 0;
  for (let i = startIdx; i < BULK_CONFIG_ORDER.length; i++) {
    const id = BULK_CONFIG_ORDER[i];
    if (session.services[id]) return startServiceConfig(to, session, id);
  }
  // Ya se sabe QUÉ lleva el plan — ahora falta que el cliente diga CUÁNDO
  // quiere cada servicio, uno por uno, antes de ver el resumen.
  return advanceBulkSchedule(to, session, null);
}

function startPaseoSchedule(to, session) {
  session.paseoScheduleOnly = true;
  session.step = 'catalog_paseo_days';
  return [M.paseoDaysChecklist(to, session)];
}

// Servicios de visita puntual que agendan día y hora en esta fase — paseo
// no está aquí porque ya eligió sus propios días/franja (ver arriba).
const BULK_SCHEDULE_ORDER = ['bano', 'barf', 'vacunas', 'dental'];

/** El cliente SIEMPRE elige cuándo, sin excepción — recorre paseo (días +
    franja) y luego cada servicio puntual activo (día + hora), uno a la vez,
    y solo al terminar todos muestra el resumen. */
function advanceBulkSchedule(to, session, justDoneId) {
  if (session.services.paseo && !session.paseoScheduleDone && justDoneId !== 'paseo') {
    return startPaseoSchedule(to, session);
  }
  const startIdx = justDoneId && BULK_SCHEDULE_ORDER.includes(justDoneId) ? BULK_SCHEDULE_ORDER.indexOf(justDoneId) + 1 : 0;
  for (let i = startIdx; i < BULK_SCHEDULE_ORDER.length; i++) {
    const id = BULK_SCHEDULE_ORDER[i];
    if (session.services[id]) {
      session.pendingSlotService = id;
      session.step = 'catalog_pick_day';
      return [M.dayPickerList(to)];
    }
  }
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
    return [M.servicesChecklist(to, session)];
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
