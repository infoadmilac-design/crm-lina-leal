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
    const preview = msg.type === 'text' ? msg.text.body : msg.interactive.body.text;
    console.log(`  [${kind}] ${preview.replace(/\n/g, ' ⏎ ')}`);
  }
  return out;
}

const to = '573001112233';
const s = session.resetSession(to);

let out = step(to, s, { type: 'text', text: 'hola' }, 'saludo inicial');
assert.equal(s.step, 'menu');
assert.equal(out[0].interactive.action.sections[0].rows.length, 4, 'el menú debe tener 4 opciones');

out = step(to, s, { type: 'interactive', id: 'menu_plan' }, 'toca "Armar mi plan"');
assert.equal(s.step, 'plan_weight');

out = step(to, s, { type: 'interactive', id: 'weight_2' }, 'elige peso Mediano');
assert.equal(s.step, 'plan_services');
assert.equal(s.weightIdx, 2);
assert.equal(s.barfKey, 'pollo-1000', 'debe tomar el default de BARF para ese peso');

assert.equal(s.services.dental, true, 'dental viene activo por default');
out = step(to, s, { type: 'interactive', id: 'toggle_dental' }, 'desactiva limpieza dental');
assert.equal(s.services.dental, false, 'el toggle debe invertir el valor');

out = step(to, s, { type: 'interactive', id: 'services_continue' }, 'continuar');
assert.equal(s.step, 'plan_paseo_variant', 'paseos está activo por default, debe preguntar variante');

out = step(to, s, { type: 'interactive', id: 'paseo_mes' }, 'elige 5×/semana');
assert.equal(s.step, 'plan_barf_variant', 'BARF sigue activo, debe preguntar variante');

out = step(to, s, { type: 'interactive', id: 'barf_salmon-500' }, 'elige Salmón · 500g');
assert.equal(s.step, 'plan_summary');
assert.equal(s.barfKey, 'salmon-500');
const ticketBody = out[0].interactive.body.text;
assert.ok(ticketBody.includes('Total mensual'), 'el resumen debe mostrar el total');
console.log('  (total calculado en el resumen ⇧)');

out = step(to, s, { type: 'interactive', id: 'plan_confirm' }, 'confirmar plan');
assert.equal(s.step, 'menu');
assert.ok(s.planConfirmedAt, 'debe quedar marcado como confirmado');

out = step(to, s, { type: 'interactive', id: 'menu_servicios' }, 'ver mis servicios');
assert.equal(s.step, 'servicios');

const firstBookingId = `booking_${s.bookings[0].id}`;
out = step(to, s, { type: 'interactive', id: firstBookingId }, 'abre el primer servicio agendado');

out = step(to, s, { type: 'interactive', id: `booking_confirm_${s.bookings[0].id}` }, 'confirma ese servicio (o llega vía plantilla de recordatorio)');
assert.equal(s.bookings[0].status, 'confirmado');

console.log('\n✅ Todas las verificaciones pasaron — el flujo completo del diagrama funciona de punta a punta.');
