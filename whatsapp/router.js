/* Máquina de estados de la conversación. Pura: no hace red ni I/O, así que se
   puede probar sin credenciales de Meta (ver whatsapp/router.test.js).
   handle(session, incoming) muta `session` y devuelve un arreglo de mensajes
   (payloads de messages.js) para enviar, en orden. */
'use strict';

const CATALOG = require('../catalog.js');
const M = require('./messages.js');
const { ticketFor } = require('./session.js');

const GREETING_RE = /^(hola|hi|menu|inicio|buenas)/i;

function handle(to, session, incoming) {
  // Disparador global: "hola" / "menu" reinicia al menú principal desde cualquier paso.
  if (incoming.type === 'text' && GREETING_RE.test(incoming.text.trim())) {
    session.step = 'menu';
    return [M.mainMenu(to, session.petName === 'tu mascota' ? 'de nuevo' : session.petName)];
  }
  if (incoming.type === 'interactive' && incoming.id === 'back_menu') {
    session.step = 'menu';
    return [M.mainMenu(to, 'de nuevo')];
  }

  // Botones de "mis servicios" llegan con el id de la reserva incrustado,
  // se reconocen sin importar en qué paso esté la sesión.
  if (incoming.type === 'interactive' && /^booking_(confirm|reschedule|cancel)_/.test(incoming.id)) {
    return handleBookingAction(to, session, incoming.id);
  }

  switch (session.step) {
    case 'menu':
      return handleMenu(to, session, incoming);
    case 'catalog':
      return handleCatalog(to, session, incoming);
    case 'catalog_detail':
      return handleCatalogDetail(to, session, incoming);
    case 'plan_weight':
      return handlePlanWeight(to, session, incoming);
    case 'plan_services':
      return handlePlanServices(to, session, incoming);
    case 'plan_paseo_variant':
      return handlePaseoVariant(to, session, incoming);
    case 'plan_barf_variant':
      return handleBarfVariant(to, session, incoming);
    case 'plan_summary':
      return handlePlanSummary(to, session, incoming);
    case 'servicios':
      return handleServiciosList(to, session, incoming);
    case 'human':
      return [M.humanHandoff(to)];
    default:
      session.step = 'menu';
      return [M.mainMenu(to, 'de nuevo')];
  }
}

function handleMenu(to, session, incoming) {
  if (incoming.type !== 'interactive') return [M.mainMenu(to, 'de nuevo')];
  switch (incoming.id) {
    case 'menu_catalogo':
      session.step = 'catalog';
      return [M.catalogList(to)];
    case 'menu_plan':
      session.step = 'plan_weight';
      return [M.weightPicker(to)];
    case 'menu_servicios':
      session.step = 'servicios';
      return [M.upcomingList(to, session.bookings)];
    case 'menu_humano':
      session.step = 'human';
      return [M.humanHandoff(to)];
    default:
      return [M.mainMenu(to, 'de nuevo')];
  }
}

function handleCatalog(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('catalog_')) {
    const svcId = incoming.id.slice('catalog_'.length);
    const svc = CATALOG.SERVICES.find((s) => s.id === svcId);
    if (!svc) return [M.catalogList(to)];
    session.lastServiceId = svcId;
    session.step = 'catalog_detail';
    return [M.catalogDetail(to, svc)];
  }
  return [M.catalogList(to)];
}

function handleCatalogDetail(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('add_')) {
    const builderId = incoming.id.slice('add_'.length);
    session.services[builderId] = true;
    session.step = 'plan_services'; // salta el paso de peso: ya viene de un servicio concreto
    return [M.servicesChecklist(to, session.weightIdx, session.services)];
  }
  if (incoming.type === 'interactive' && incoming.id === 'notify_soon') {
    session.step = 'menu';
    return [M.textMessage(to, 'Anotado — te avisamos apenas esté disponible en la app 🐾'), M.mainMenu(to, 'de nuevo')];
  }
  session.step = 'menu';
  return [M.mainMenu(to, 'de nuevo')];
}

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
  if (session.services.paseo) {
    session.step = 'plan_paseo_variant';
    return [M.paseoVariantButtons(to)];
  }
  if (session.services.barf) {
    session.step = 'plan_barf_variant';
    return [M.barfOptionsList(to)];
  }
  session.step = 'plan_summary';
  const { lines, total } = ticketFor(session);
  return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
}

function handlePaseoVariant(to, session, incoming) {
  if (incoming.type === 'interactive' && (incoming.id === 'paseo_sem' || incoming.id === 'paseo_mes')) {
    session.paseoVar = incoming.id === 'paseo_sem' ? 'sem' : 'mes';
    if (session.services.barf) {
      session.step = 'plan_barf_variant';
      return [M.barfOptionsList(to)];
    }
    session.step = 'plan_summary';
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  return [M.paseoVariantButtons(to)];
}

function handleBarfVariant(to, session, incoming) {
  if (incoming.type === 'interactive' && incoming.id.startsWith('barf_')) {
    session.barfKey = incoming.id.slice('barf_'.length);
    session.step = 'plan_summary';
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  return [M.barfOptionsList(to)];
}

function handlePlanSummary(to, session, incoming) {
  if (incoming.type !== 'interactive') {
    const { lines, total } = ticketFor(session);
    return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
  }
  if (incoming.id === 'plan_confirm') {
    session.step = 'menu';
    session.planConfirmedAt = Date.now();
    return [M.planConfirmed(to, session.petName), M.mainMenu(to, 'de nuevo')];
  }
  if (incoming.id === 'plan_edit') {
    session.step = 'plan_services';
    return [M.servicesChecklist(to, session.weightIdx, session.services)];
  }
  const { lines, total } = ticketFor(session);
  return [M.ticketSummary(to, { weightIdx: session.weightIdx, lines, total })];
}

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
  if (!m) return [M.mainMenu(to, 'de nuevo')];
  const [, action, bookingId] = m;
  const booking = session.bookings.find((b) => b.id === bookingId);
  session.step = 'menu';
  if (!booking) return [M.mainMenu(to, 'de nuevo')];
  if (action === 'confirm') booking.status = 'confirmado';
  if (action === 'cancel') booking.status = 'cancelado';
  if (action === 'reschedule') booking.status = 'agendado';
  const verb = { confirm: 'confirmado', cancel: 'cancelado', reschedule: 'marcado para reagendar' }[action];
  return [M.textMessage(to, `Listo, ${booking.title.toLowerCase()} quedó ${verb} ✅`), M.mainMenu(to, 'de nuevo')];
}

module.exports = { handle };
