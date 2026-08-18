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
assert.equal(s.step, 'menu');
assert.ok(out[0].interactive.body.text.includes('Firulais'), 'el menú debe saludar con el nombre de la mascota');

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

console.log('\n✅ Todas las verificaciones pasaron — el nuevo flujo (onboarding + catálogo configurando cada servicio al vuelo) funciona de punta a punta.');
