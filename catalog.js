/* ALLPETZ — catálogo y precios compartidos entre la app web y el bot de WhatsApp.
   Única fuente de verdad: no dupliques estos valores en otro lugar. */
(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog; // Node (bot de WhatsApp)
  root.ALLPETZ_CATALOG = catalog; // navegador (app web)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PR = {
    bano: [52000, 84500, 97500, 117000],
    paseoSem: [78000, 78000, 97500, 97500],
    paseoMes: [110500, 123500, 123500, 149500],
    vacunas: [0, 58500, 58500, 58500],
    dental: [78000, 78000, 104000, 104000],
  };
  const BARF = { 'pollo-250': 136500, 'pollo-500': 370500, 'pollo-1000': 643500, 'salmon-250': 429000, 'salmon-500': 663000, 'salmon-1000': 1053000 };
  const BARF_DEFAULT = ['pollo-250', 'pollo-500', 'pollo-1000', 'pollo-1000'];
  const BARF_OPTIONS = [
    { val: 'pollo-250', label: 'Pollo · 250g' },
    { val: 'pollo-500', label: 'Pollo · 500g' },
    { val: 'pollo-1000', label: 'Pollo · 1kg' },
    { val: 'salmon-250', label: 'Salmón · 250g' },
    { val: 'salmon-500', label: 'Salmón · 500g' },
    { val: 'salmon-1000', label: 'Salmón · 1kg' },
  ];
  const TIER = ['Mini · 5–8 kg', 'Pequeño · 8–15 kg', 'Mediano · 15.5–25 kg', 'Grande · 25.5+ kg'];
  const WEIGHTS = [
    { emo: '🐤', name: 'Mini', kg: '5–8' },
    { emo: '🐕', name: 'Peq', kg: '8–15' },
    { emo: '🐩', name: 'Med', kg: '15–25' },
    { emo: '🐺', name: 'Gde', kg: '25+' },
  ];
  const ROW_META = {
    bano: { id: 'bano', emoji: '🛁', label: 'Baño a domicilio', sub: 'Mensual' },
    paseo: { id: 'paseo', emoji: '🐕', label: 'Paseos', sub: 'Con GPS en vivo' },
    barf: { id: 'barf', emoji: '🥩', label: 'Alimentación BARF', sub: 'Plan 30 días' },
    vacunas: { id: 'vacunas', emoji: '💉', label: 'Vacunación anual', sub: 'Prorrateado' },
    dental: { id: 'dental', emoji: '🦷', label: 'Limpieza dental', sub: 'Profesional' },
  };
  const BUILDER_ROW_IDS = ['bano', 'paseo', 'barf', 'vacunas', 'dental'];
  const SERVICES = [
    { id: 'paseos', emoji: '🐕', title: 'Paseos', desc: 'GPS en vivo y fotos.', bg: '#FF5A40', text: '#0E0E12', map: 'paseo' },
    { id: 'grooming', emoji: '✂️', title: 'Grooming', desc: 'Baño y corte.', bg: '#D4FF3A', text: '#0E0E12', map: 'bano' },
    { id: 'barf', emoji: '🥩', title: 'BARF', desc: 'Comida natural.', bg: '#BEE3FF', text: '#0E0E12', map: 'barf' },
    { id: 'vet', emoji: '🏥', title: 'Vet', desc: 'A domicilio.', bg: '#2540FF', text: '#F4ECDC', map: 'vacunas' },
    { id: 'entrenamiento', emoji: '🎓', title: 'Entrenamiento', desc: 'Adiestramiento.', bg: '#FFD0C7', text: '#0E0E12', map: null },
    { id: 'transporte', emoji: '🚐', title: 'Transport', desc: 'Traslados.', bg: '#EBE0CB', text: '#0E0E12', map: null },
    { id: 'hotel', emoji: '🏨', title: 'Hotel', desc: 'Hospedaje.', bg: '#FF5A40', text: '#0E0E12', map: null },
    { id: 'seguro', emoji: '🛡️', title: 'Seguro', desc: 'Cobertura vet.', bg: '#D4FF3A', text: '#0E0E12', map: null },
  ];

  function cop(n) { return '$' + Math.round(n).toLocaleString('es-CO'); }
  function fmt(n) { return n === 0 ? 'Incluido' : cop(n); }

  /** Precio de un ítem del armador para un peso dado. weightIdx: 0..3. */
  function price(id, weightIdx, opts) {
    opts = opts || {};
    if (id === 'bano') return PR.bano[weightIdx];
    if (id === 'paseo') return opts.paseoVar === 'sem' ? PR.paseoSem[weightIdx] : PR.paseoMes[weightIdx];
    if (id === 'barf') return BARF[opts.barfKey || 'pollo-250'];
    if (id === 'vacunas') return PR.vacunas[weightIdx];
    if (id === 'dental') return PR.dental[weightIdx];
    return 0;
  }

  return { PR, BARF, BARF_DEFAULT, BARF_OPTIONS, TIER, WEIGHTS, ROW_META, BUILDER_ROW_IDS, SERVICES, cop, fmt, price };
});
