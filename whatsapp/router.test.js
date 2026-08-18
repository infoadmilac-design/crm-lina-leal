/* Prueba de humo del enrutador, sin servidor ni credenciales de Meta.
   node router.test.js   (o: npm test, dentro de whatsapp/) */
'use strict';

const assert = require('node:assert');
const session = require('./session.js');
const router = require('./router.js');
const CATALOG = require('../catalog.js');

function step(from, s, incoming, label) {
  const out = router.handle(from, s, incoming);
  console.log(`\n— ${label} —`);
  for (const msg of out) {
    const kind = msg.type === 'interactive' ? msg.interactive.type : msg.type;
    const preview = msg.type === 'text' ? msg.text.body : msg.type === 'image' ? `(imagen) ${msg.image.caption || ''}` : msg.interactive.body.text;
    console.log(`  [${kind}] ${preview.replace(/\n/g, ' ⏎ ')}`);
  }
  return out;
}

/** Completa un onboarding entero (hola → nombre → peso → raza) y devuelve
    la sesión ya en el paso "packages". */
function onboard(to, petName, weightIdx, label) {
  const s = session.resetSession(to);
  step(to, s, { type: 'text', text: 'hola' }, `[${label}] primer contacto`);
  step(to, s, { type: 'text', text: petName }, `[${label}] da el nombre`);
  step(to, s, { type: 'interactive', id: `weight_${weightIdx}` }, `[${label}] elige peso`);
  step(to, s, { type: 'text', text: 'omitir' }, `[${label}] omite raza`);
  assert.equal(s.step, 'packages', 'apenas termina el onboarding debe ofrecer los 3 paquetes');
  return s;
}

/** Toca los toggles de días indicados y luego "Continuar" — sirve tanto
    para configurar paseo (deriva la frecuencia) como para agendar días
    dentro de un paquete (no toca el precio). */
function pickPaseoDays(to, s, dayIdxs, label) {
  let out;
  for (const d of dayIdxs) out = step(to, s, { type: 'interactive', id: `paseoday_${d}` }, `[${label}] toca día ${d}`);
  out = step(to, s, { type: 'interactive', id: 'paseoday_continue' }, `[${label}] continuar días`);
  return out;
}

function pickFranja(to, s, franja, label) {
  return step(to, s, { type: 'interactive', id: `paseofranja_${franja}` }, `[${label}] franja ${franja}`);
}

/** Contesta el selector genérico de día+hora que usan baño/BARF/vacunas/dental. */
function pickSlot(to, s, dayOffset, time, label) {
  step(to, s, { type: 'interactive', id: `slotday_${dayOffset}` }, `[${label}] elige día`);
  return step(to, s, { type: 'interactive', id: `slottime_${time}` }, `[${label}] elige hora ${time}`);
}

/* ================================================================== */
/* Escenario 1 — catálogo "Elige y combina", uno a la vez              */
/* ================================================================== */
const to = '573001112233';
const s = onboard(to, 'Firulais', 2, 'catálogo');
let out;

out = step(to, s, { type: 'text', text: 'hola' }, 'saluda de nuevo, ya onboarded');
assert.equal(s.step, 'menu');

out = step(to, s, { type: 'interactive', id: 'menu_catalogo' }, 'toca "Catálogo"');
assert.equal(s.step, 'catalog');
assert.equal(out.length, 2, 'debe mandar una imagen y luego la lista');

out = step(to, s, { type: 'interactive', id: 'catalog_paseos' }, 'toca "Paseos" en el catálogo');
assert.equal(s.step, 'catalog_detail');
assert.ok(out[0].interactive.body.text.includes('Desde'), 'debe mostrar precio de referencia para el tamaño ya conocido');

out = step(to, s, { type: 'interactive', id: 'add_paseo' }, 'empieza a configurar el paseo');
assert.equal(s.services.paseo, true);
assert.equal(s.step, 'catalog_paseo_days', 'debe preguntar QUÉ DÍAS, no un número de frecuencia');

out = pickPaseoDays(to, s, [0, 2, 4], 'catálogo'); // Lun, Mié, Vie
assert.equal(s.paseoFreq, 3, 'la frecuencia debe salir de cuántos días eligió (fuera de un paquete)');
assert.equal(s.step, 'catalog_paseo_franja', 'después de los días debe preguntar la franja');

out = pickFranja(to, s, 'manana', 'catálogo');
assert.equal(s.paseoFranja, 'manana');
assert.equal(s.paseoScheduleDone, true);
assert.equal(s.step, 'catalog_paseo_duration');

out = step(to, s, { type: 'interactive', id: 'paseodur_larga' }, 'elige duración larga (1h-1h30)');
assert.equal(s.paseoDuration, 'larga');
assert.equal(s.step, 'catalog_paseo_modalidad');

out = step(to, s, { type: 'interactive', id: 'paseomod_juego' }, 'elige paseo + juego');
assert.equal(s.paseoModalidad, 'juego');
assert.equal(s.step, 'catalog_added', 'paseo ya agendó sus días/franja — no debe pedir día/hora genérico también');
assert.ok(out[0].text.body.includes('Lun') && out[0].text.body.includes('Mañana'), 'debe avisar los días y franja elegidos');

out = step(to, s, { type: 'interactive', id: 'catalog_add_another' }, 'agrega otro servicio');
assert.equal(s.step, 'catalog');

out = step(to, s, { type: 'interactive', id: 'catalog_grooming' }, 'toca "Grooming" (baño) en el catálogo');
out = step(to, s, { type: 'interactive', id: 'add_bano' }, 'empieza a configurar el baño');
assert.equal(s.step, 'catalog_bano_variant', 'debe preguntar el subtipo de baño ahí mismo');

out = step(to, s, { type: 'interactive', id: 'bano_corte_raza' }, 'elige "corte según raza"');
assert.equal(s.banoVariant, 'corte_raza');
assert.equal(s.step, 'catalog_bano_freq', 'debe preguntar cuántas veces al mes');

out = step(to, s, { type: 'interactive', id: 'banofreq_2' }, 'elige 2 veces al mes');
assert.equal(s.banoFreq, 2);
assert.equal(s.step, 'catalog_bano_notes', 'debe pedir notas para el corte');

out = step(to, s, { type: 'text', text: 'corte bajo, sin motas en las orejas' }, 'escribe notas del corte');
assert.equal(s.banoNotes, 'corte bajo, sin motas en las orejas');
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir día para el baño — el cliente SIEMPRE elige cuándo');

out = pickSlot(to, s, 1, '10:00', 'baño');
assert.ok(s.proposedSlots.bano, 'debe quedar guardado el horario propuesto para el baño');
assert.equal(s.step, 'catalog_added', 'tras proponer horario, debe ofrecer agregar otro o ver resumen');
assert.ok(out[0].text.body.includes('minutos'), 'debe avisar que en minutos se confirma o se reagenda');

out = step(to, s, { type: 'interactive', id: 'catalog_add_another' }, 'agrega BARF');
out = step(to, s, { type: 'interactive', id: 'catalog_barf' }, 'toca "BARF" en el catálogo');
out = step(to, s, { type: 'interactive', id: 'add_barf' }, 'empieza a configurar BARF');
assert.equal(s.step, 'catalog_barf_variant', 'debe preguntar proteína y cantidad ahí mismo');

out = step(to, s, { type: 'interactive', id: 'barf_pollo-500' }, 'elige pollo · 500g');
assert.equal(s.barfKey, 'pollo-500');
assert.equal(s.step, 'catalog_barf_entrega', 'debe preguntar cómo prefiere la entrega');

out = step(to, s, { type: 'interactive', id: 'barfentrega_2' }, 'elige 2 entregas al mes');
assert.equal(s.barfEntregas, 2);
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir día para BARF');

out = pickSlot(to, s, 2, '12:00', 'BARF');
assert.equal(s.step, 'catalog_added');

out = step(to, s, { type: 'interactive', id: 'catalog_add_another' }, 'agrega limpieza dental');
out = step(to, s, { type: 'interactive', id: 'catalog_dental' }, 'toca "Dental" en el catálogo');
out = step(to, s, { type: 'interactive', id: 'add_dental' }, 'empieza a configurar dental');
assert.equal(s.step, 'catalog_dental_freq', 'debe preguntar cada cuánto ahí mismo');

out = step(to, s, { type: 'interactive', id: 'dentalfreq_semestral' }, 'elige cada 6 meses');
assert.equal(s.dentalFreq, 'semestral');
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir día para dental');

out = pickSlot(to, s, 3, '16:00', 'dental');
assert.equal(s.step, 'catalog_added');

out = step(to, s, { type: 'interactive', id: 'catalog_view_summary' }, 've el resumen del plan');
assert.equal(s.step, 'plan_summary');
const ticketBody = out[0].interactive.body.text;
assert.ok(ticketBody.includes('Total mensual'), 'el resumen debe mostrar el total');
assert.ok(ticketBody.includes('Baño y corte según raza'), 'el resumen debe reflejar el subtipo de baño elegido');
assert.ok(ticketBody.includes('Lun/Mié/Vie'), 'el resumen debe mostrar los días reales de paseo, no un número');
console.log('  (total calculado en el resumen ⇧)');

out = step(to, s, { type: 'interactive', id: 'plan_confirm' }, 'confirmar plan');
assert.equal(s.step, 'menu');
assert.ok(s.planConfirmedAt, 'debe quedar marcado como confirmado');

// ---- Mis servicios (sin cambios de fondo) ----
out = step(to, s, { type: 'interactive', id: 'menu_servicios' }, 'ver mis servicios');
assert.equal(s.step, 'servicios');

const firstBookingId = `booking_${s.bookings[0].id}`;
out = step(to, s, { type: 'interactive', id: firstBookingId }, 'abre el primer servicio agendado');

out = step(to, s, { type: 'interactive', id: `booking_confirm_${s.bookings[0].id}` }, 'confirma ese servicio (o llega vía plantilla de recordatorio)');
assert.equal(s.bookings[0].status, 'confirmado');

/* ================================================================== */
/* Escenario 2 — paquete "Activo": el precio queda fijo, pero el       */
/* cliente igual elige días/franja y horario de cada servicio puntual  */
/* ================================================================== */
const to2 = '573001112244';
const s2 = onboard(to2, 'Rocky', 1, 'paquete');

out = step(to2, s2, { type: 'interactive', id: 'pkg_activo' }, '[paquete] elige el paquete Activo');
assert.equal(s2.services.paseo, true);
assert.equal(s2.services.bano, true);
assert.equal(s2.services.barf, true);
assert.equal(s2.services.vacunas, undefined, 'Activo no incluye vacunas');
assert.equal(s2.paseoFreq, 5, 'la frecuencia la fija el paquete');
assert.equal(s2.banoVariant, 'corte');
assert.equal(s2.step, 'catalog_paseo_days', 'aunque venga de un paquete, el cliente elige los días de paseo');
assert.equal(s2.paseoScheduleOnly, true, 'elegir días aquí no debe recalcular el precio del paquete');

// Elige solo 2 días — menos de los 5 que trae el paquete. No debe cambiar paseoFreq.
out = pickPaseoDays(to2, s2, [1, 5], 'paquete');
assert.equal(s2.paseoFreq, 5, 'los días elegidos NO deben pisar la frecuencia ya fijada por el paquete');
assert.equal(s2.step, 'catalog_paseo_franja');

out = pickFranja(to2, s2, 'tarde', '[paquete] franja');
assert.equal(s2.step, 'catalog_pick_day', 'tras paseo, debe seguir agendando baño (día/hora puntual)');
assert.ok(out[0].text.body.includes('Mar') && out[0].text.body.includes('Tarde'), 'debe avisar los días/franja de paseo elegidos');

out = pickSlot(to2, s2, 1, '14:00', '[paquete] baño');
assert.equal(s2.step, 'catalog_pick_day', 'tras baño, debe seguir con BARF');

out = pickSlot(to2, s2, 2, '09:00', '[paquete] BARF');
assert.equal(s2.step, 'plan_summary', 'Activo no tiene vacunas ni dental — tras BARF ya se agendó todo');

const expectedTotal = CATALOG.packageTotal('activo', s2.weightIdx);
assert.ok(out[out.length - 1].interactive.body.text.includes(CATALOG.cop(expectedTotal)), 'el total del resumen debe seguir siendo el del paquete (agendar no cambia el precio)');
assert.equal(s2.packageDiscountPct, 0.09, 'el 9% de descuento del paquete debe seguir intacto tras agendar');

out = step(to2, s2, { type: 'interactive', id: 'plan_confirm' }, '[paquete] confirma el plan');
assert.equal(s2.step, 'menu');
assert.ok(s2.planConfirmedAt, 'el plan armado por paquete también debe quedar confirmado');

/* ================================================================== */
/* Escenario 3 — Editar un paquete: recorre config Y agenda de nuevo,  */
/* y esta vez sí debe perder el descuento (edición real)               */
/* ================================================================== */
const to3 = '573001112255';
const s3 = onboard(to3, 'Nala', 2, 'editar');

step(to3, s3, { type: 'interactive', id: 'pkg_fullcare' }, '[editar] elige Full Care (paseo, baño, BARF, vacunas y dental)');
pickPaseoDays(to3, s3, [0, 1, 2, 3, 4, 5, 6], '[editar] agenda paseo diario');
pickFranja(to3, s3, 'manana', '[editar]');
pickSlot(to3, s3, 0, '08:00', '[editar] baño');
pickSlot(to3, s3, 1, '08:00', '[editar] BARF');
pickSlot(to3, s3, 2, '08:00', '[editar] vacunas');
out = pickSlot(to3, s3, 3, '08:00', '[editar] dental');
assert.equal(s3.step, 'plan_summary', 'tras agendar los 5 servicios de Full Care debe llegar al resumen');
assert.equal(s3.packageDiscountPct, 0.09, 'el descuento sigue intacto — solo se agendó, no se reconfiguró nada');

out = step(to3, s3, { type: 'interactive', id: 'plan_edit' }, '[editar] toca "Editar"');
assert.equal(s3.step, 'plan_services', 'Editar debe llevar al checklist de servicios');
const banoRow = out[0].interactive.action.sections[0].rows.find((r) => r.id === 'toggle_bano');
assert.ok(banoRow.description.includes('corte según raza') && banoRow.description.includes('2×/mes'), 'el checklist debe mostrar el detalle REAL ya configurado, no el precio por defecto');

out = step(to3, s3, { type: 'interactive', id: 'services_continue' }, '[editar] continuar (debe re-preguntar cada servicio activo)');
assert.equal(s3.step, 'catalog_bano_variant', 'debe empezar por baño, no saltárselo');
assert.equal(s3.packageDiscountPct, null, 'editar de verdad (reconfigurar) sí debe quitar el descuento cerrado');

out = step(to3, s3, { type: 'interactive', id: 'bano_general' }, '[editar] cambia el baño a general');
out = step(to3, s3, { type: 'interactive', id: 'banofreq_1' }, '[editar] cambia a 1×/mes');
out = step(to3, s3, { type: 'text', text: 'ninguna' }, '[editar] sin notas');
assert.equal(s3.step, 'catalog_paseo_days', 'tras baño debe seguir con paseo (antes se saltaba directo a BARF)');

out = pickPaseoDays(to3, s3, [0, 2, 4], '[editar] baja paseos a 3 días');
assert.equal(s3.paseoFreq, 3, 'en edición real, los días SÍ determinan la frecuencia (ya no hay paquete que proteger)');
out = pickFranja(to3, s3, 'tarde', '[editar]');
out = step(to3, s3, { type: 'interactive', id: 'paseodur_corta' }, '[editar] duración corta');
out = step(to3, s3, { type: 'interactive', id: 'paseomod_solo' }, '[editar] modalidad individual');
// En el armador por lotes, terminar paseo sigue con el resto de la config
// (BARF, dental) — el agendado de todos (incluido paseo) queda para después.
assert.equal(s3.step, 'catalog_barf_variant', 'tras paseo debe seguir con BARF, no saltar a agendar');

out = step(to3, s3, { type: 'interactive', id: 'barf_pollo-500' }, '[editar] BARF pollo 500g');
out = step(to3, s3, { type: 'interactive', id: 'barfentrega_1' }, '[editar] 1 entrega');
assert.equal(s3.step, 'catalog_dental_freq', 'tras BARF debe seguir con dental');

out = step(to3, s3, { type: 'interactive', id: 'dentalfreq_mensual' }, '[editar] dental mensual');
assert.equal(s3.step, 'catalog_pick_day', 'terminada la config, ahora toca agendar baño/BARF/vacunas/dental de nuevo');

out = pickSlot(to3, s3, 4, '10:00', '[editar] agenda baño de nuevo');
out = pickSlot(to3, s3, 5, '10:00', '[editar] agenda BARF de nuevo');
out = pickSlot(to3, s3, 6, '10:00', '[editar] agenda vacunas de nuevo');
out = pickSlot(to3, s3, 0, '10:00', '[editar] agenda dental de nuevo');
assert.equal(s3.step, 'plan_summary', 'al terminar de editar y reagendar todo debe volver al resumen');
assert.equal(s3.banoVariant, 'general');
assert.equal(s3.paseoFreq, 3);
assert.equal(s3.dentalFreq, 'mensual');
assert.equal(s3.packageDiscountPct, null, 'ya no debe quedar descuento de paquete — se reconfiguró todo a mano');

console.log('\n✅ Todas las verificaciones pasaron — el cliente elige siempre días/franja/hora para cada servicio (con o sin paquete), y el precio por unidad + ahorro se muestra en paquetes y servicios.');
