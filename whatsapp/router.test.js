/* Prueba de humo del enrutador, sin servidor ni credenciales de Meta.
   node router.test.js   (o: npm test, dentro de whatsapp/) */
'use strict';

const assert = require('node:assert');
const session = require('./session.js');
const router = require('./router.js');

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

const to = '573001112233';
const s = session.resetSession(to);

// ---- Onboarding ----
let out = step(to, s, { type: 'text', text: 'hola' }, 'primer contacto: "hola"');
assert.equal(s.step, 'onboarding_petname', 'debe pedir el nombre de la mascota antes que nada');
assert.equal(s.onboarded, false);

out = step(to, s, { type: 'text', text: 'Firulais' }, 'da el nombre de la mascota');
assert.equal(s.petName, 'Firulais');
assert.equal(s.step, 'onboarding_weight');

out = step(to, s, { type: 'interactive', id: 'weight_2' }, 'elige peso Mediano');
assert.equal(s.weightIdx, 2);
assert.equal(s.step, 'onboarding_breed');

out = step(to, s, { type: 'text', text: 'Labrador' }, 'da la raza');
assert.equal(s.petBreed, 'Labrador');
assert.equal(s.onboarded, true, 'el onboarding debe quedar completo');
assert.equal(s.step, 'packages', 'apenas termina el onboarding debe ofrecer los 3 paquetes');
assert.equal(out.length, 2, 'debe mandar la descripción de los planes (texto) y luego la lista para elegir');
assert.ok(out[0].text.body.includes('Firulais'), 'la descripción de los planes debe saludar con el nombre de la mascota');
assert.ok(out[0].text.body.includes('Full Care') && out[0].text.body.includes('Activo') && out[0].text.body.includes('Esencial'), 'debe describir los 3 planes con nombre');
assert.equal(out[1].interactive.action.sections[0].rows.length, 4, 'debe mostrar 3 paquetes + armar plan propio');

// Un "hola" luego de onboarded debe ir directo al menú, no repetir onboarding.
out = step(to, s, { type: 'text', text: 'hola' }, 'saluda de nuevo, ya onboarded');
assert.equal(s.step, 'menu');

// ---- Catálogo: cada servicio se configura apenas se elige ----
out = step(to, s, { type: 'interactive', id: 'menu_catalogo' }, 'toca "Catálogo"');
assert.equal(s.step, 'catalog');
assert.equal(out.length, 2, 'debe mandar una imagen y luego la lista');

out = step(to, s, { type: 'interactive', id: 'catalog_paseos' }, 'toca "Paseos" en el catálogo');
assert.equal(s.step, 'catalog_detail');
assert.ok(out[0].interactive.body.text.includes('Desde'), 'debe mostrar precio de referencia para el tamaño ya conocido');

out = step(to, s, { type: 'interactive', id: 'add_paseo' }, 'empieza a configurar el paseo');
assert.equal(s.services.paseo, true);
assert.equal(s.step, 'catalog_paseo_freq', 'debe preguntar la frecuencia ahí mismo, no al final');

out = step(to, s, { type: 'interactive', id: 'paseofreq_5' }, 'elige 5×/semana');
assert.equal(s.paseoFreq, 5);
assert.equal(s.step, 'catalog_paseo_duration');

out = step(to, s, { type: 'interactive', id: 'paseodur_larga' }, 'elige duración larga (1h-1h30)');
assert.equal(s.paseoDuration, 'larga');
assert.equal(s.step, 'catalog_paseo_modalidad');

out = step(to, s, { type: 'interactive', id: 'paseomod_juego' }, 'elige paseo + juego');
assert.equal(s.paseoModalidad, 'juego');
assert.equal(s.step, 'catalog_pick_day', 'tras configurar, debe pedir que el cliente proponga día y hora');

out = step(to, s, { type: 'interactive', id: 'slotday_1' }, 'elige el día (mañana)');
assert.equal(s.step, 'catalog_pick_time');

out = step(to, s, { type: 'interactive', id: 'slottime_10:00' }, 'elige la hora (10:00 am)');
assert.ok(s.proposedSlots.paseo, 'debe quedar guardado el horario propuesto para el paseo');
assert.equal(s.step, 'catalog_added', 'tras proponer horario, debe ofrecer agregar otro o ver resumen');

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
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir horario para el baño');

out = step(to, s, { type: 'interactive', id: 'slotday_skip' }, 'omite proponer horario ("que ustedes me contacten")');
assert.equal(s.step, 'catalog_added');
assert.ok(!s.proposedSlots.bano, 'no debe quedar horario propuesto para el baño');

// ---- BARF: variante (proteína/cantidad) + frecuencia de entrega ----
out = step(to, s, { type: 'interactive', id: 'catalog_add_another' }, 'agrega BARF');
out = step(to, s, { type: 'interactive', id: 'catalog_barf' }, 'toca "BARF" en el catálogo');
out = step(to, s, { type: 'interactive', id: 'add_barf' }, 'empieza a configurar BARF');
assert.equal(s.step, 'catalog_barf_variant', 'debe preguntar proteína y cantidad ahí mismo');

out = step(to, s, { type: 'interactive', id: 'barf_pollo-500' }, 'elige pollo · 500g');
assert.equal(s.barfKey, 'pollo-500');
assert.equal(s.step, 'catalog_barf_entrega', 'debe preguntar cómo prefiere la entrega');

out = step(to, s, { type: 'interactive', id: 'barfentrega_2' }, 'elige 2 entregas al mes');
assert.equal(s.barfEntregas, 2);
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir horario para BARF');

out = step(to, s, { type: 'interactive', id: 'slotday_skip' }, 'omite horario para BARF');
assert.equal(s.step, 'catalog_added');

// ---- Dental: solo pregunta frecuencia, sin variante previa ----
out = step(to, s, { type: 'interactive', id: 'catalog_add_another' }, 'agrega limpieza dental');
out = step(to, s, { type: 'interactive', id: 'catalog_dental' }, 'toca "Dental" en el catálogo');
out = step(to, s, { type: 'interactive', id: 'add_dental' }, 'empieza a configurar dental');
assert.equal(s.step, 'catalog_dental_freq', 'debe preguntar cada cuánto ahí mismo');

out = step(to, s, { type: 'interactive', id: 'dentalfreq_semestral' }, 'elige cada 6 meses');
assert.equal(s.dentalFreq, 'semestral');
assert.equal(s.step, 'catalog_pick_day', 'también debe pedir horario para dental');

out = step(to, s, { type: 'interactive', id: 'slotday_skip' }, 'omite horario para dental');
assert.equal(s.step, 'catalog_added');

out = step(to, s, { type: 'interactive', id: 'catalog_view_summary' }, 've el resumen del plan');
assert.equal(s.step, 'plan_summary');
const ticketBody = out[0].interactive.body.text;
assert.ok(ticketBody.includes('Total mensual'), 'el resumen debe mostrar el total');
assert.ok(ticketBody.includes('Baño y corte según raza'), 'el resumen debe reflejar el subtipo de baño elegido');
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

// ---- Paquetes inteligentes: elegir uno arma el plan completo de una sola vez ----
const CATALOG = require('../catalog.js');
const to2 = '573001112244';
const s2 = session.resetSession(to2);
step(to2, s2, { type: 'text', text: 'hola' }, '[paquetes] primer contacto');
step(to2, s2, { type: 'text', text: 'Rocky' }, '[paquetes] da el nombre');
step(to2, s2, { type: 'interactive', id: 'weight_1' }, '[paquetes] elige peso Pequeño');
out = step(to2, s2, { type: 'text', text: 'omitir' }, '[paquetes] omite raza');
assert.equal(s2.step, 'packages', 'debe ofrecer los paquetes apenas termina el onboarding');

out = step(to2, s2, { type: 'interactive', id: 'pkg_activo' }, '[paquetes] elige el paquete Activo');
assert.equal(s2.step, 'plan_summary', 'elegir un paquete debe ir directo al resumen');
assert.equal(s2.services.paseo, true);
assert.equal(s2.services.bano, true);
assert.equal(s2.services.barf, true);
assert.equal(s2.services.vacunas, undefined, 'Activo no incluye vacunas');
assert.equal(s2.paseoFreq, 5);
assert.equal(s2.banoVariant, 'corte');
assert.equal(s2.banoFreq, 2);
const expectedTotal = CATALOG.packageTotal('activo', s2.weightIdx);
assert.ok(out[1].interactive.body.text.includes(CATALOG.cop(expectedTotal)), 'el total del resumen debe coincidir con CATALOG.packageTotal("activo")');

out = step(to2, s2, { type: 'interactive', id: 'plan_confirm' }, '[paquetes] confirma el plan del paquete');
assert.equal(s2.step, 'menu');
assert.ok(s2.planConfirmedAt, 'el plan armado por paquete también debe quedar confirmado');

// ---- Editar un paquete: "Editar" debe recorrer TODOS los servicios activos
// (antes se saltaba baño y dental, solo preguntaba paseo y BARF) ----
const to3 = '573001112255';
const s3 = session.resetSession(to3);
step(to3, s3, { type: 'text', text: 'hola' }, '[editar] primer contacto');
step(to3, s3, { type: 'text', text: 'Nala' }, '[editar] da el nombre');
step(to3, s3, { type: 'interactive', id: 'weight_2' }, '[editar] elige peso Mediano');
step(to3, s3, { type: 'text', text: 'omitir' }, '[editar] omite raza');
step(to3, s3, { type: 'interactive', id: 'pkg_fullcare' }, '[editar] elige Full Care (incluye baño, paseo, BARF y dental)');
assert.equal(s3.step, 'plan_summary');

out = step(to3, s3, { type: 'interactive', id: 'plan_edit' }, '[editar] toca "Editar"');
assert.equal(s3.step, 'plan_services', 'Editar debe llevar al checklist de servicios');
const banoRow = out[0].interactive.action.sections[0].rows.find((r) => r.id === 'toggle_bano');
assert.ok(banoRow.description.includes('corte según raza') && banoRow.description.includes('2×/mes'), 'el checklist debe mostrar el detalle REAL ya configurado, no el precio por defecto');

out = step(to3, s3, { type: 'interactive', id: 'services_continue' }, '[editar] continuar (debe re-preguntar cada servicio activo)');
assert.equal(s3.step, 'catalog_bano_variant', 'debe empezar por baño, no saltárselo');
assert.equal(s3.packageDiscountPct, null, 'editar debe quitar el descuento de paquete cerrado');

out = step(to3, s3, { type: 'interactive', id: 'bano_general' }, '[editar] cambia el baño a general');
out = step(to3, s3, { type: 'interactive', id: 'banofreq_1' }, '[editar] cambia a 1×/mes');
out = step(to3, s3, { type: 'text', text: 'ninguna' }, '[editar] sin notas');
assert.equal(s3.step, 'catalog_paseo_freq', 'tras baño debe seguir con paseo (antes se saltaba directo a BARF)');

out = step(to3, s3, { type: 'interactive', id: 'paseofreq_3' }, '[editar] baja paseos a 3×/semana');
out = step(to3, s3, { type: 'interactive', id: 'paseodur_corta' }, '[editar] duración corta');
out = step(to3, s3, { type: 'interactive', id: 'paseomod_solo' }, '[editar] modalidad individual');
assert.equal(s3.step, 'catalog_barf_variant', 'tras paseo debe seguir con BARF');

out = step(to3, s3, { type: 'interactive', id: 'barf_pollo-500' }, '[editar] BARF pollo 500g');
out = step(to3, s3, { type: 'interactive', id: 'barfentrega_1' }, '[editar] 1 entrega');
assert.equal(s3.step, 'catalog_dental_freq', 'tras BARF debe seguir con dental — antes esto nunca pasaba en el armador por lotes');

out = step(to3, s3, { type: 'interactive', id: 'dentalfreq_mensual' }, '[editar] dental mensual');
assert.equal(s3.step, 'plan_summary', 'al terminar de editar todo debe volver al resumen');
assert.equal(s3.banoVariant, 'general');
assert.equal(s3.paseoFreq, 3);
assert.equal(s3.dentalFreq, 'mensual');

console.log('\n✅ Todas las verificaciones pasaron — el nuevo flujo (onboarding + paquetes inteligentes con descripción y edición real + catálogo configurando cada servicio al vuelo) funciona de punta a punta.');
