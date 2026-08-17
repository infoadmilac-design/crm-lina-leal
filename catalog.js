/* ALLPETZ — catálogo y precios compartidos entre la app web y el bot de WhatsApp.
   Única fuente de verdad: no dupliques estos valores en otro lugar.

   Los precios de PASEO por frecuencia/duración/modalidad y los de los 3
   subtipos de BAÑO son ESTIMADOS (calculados a partir de los precios reales
   que ya existían), pendientes de que el dueño los ajuste con sus números
   reales — ver banoVariantPrice() y paseoPrice() más abajo. */
(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog; // Node (bot de WhatsApp)
  root.ALLPETZ_CATALOG = catalog; // navegador (app web)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function round500(n) { return Math.round(n / 500) * 500; }

  const PR = {
    bano: [52000, 84500, 97500, 117000],
    // anclas reales conservadas: 1×/semana y 5×/semana. El resto de
    // frecuencias (2,3,4,6,7) se interpola/extrapola en paseoPrice().
    paseo1x: [78000, 78000, 97500, 97500],
    paseo5x: [110500, 123500, 123500, 149500],
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

  // Fotos genéricas de banco de imágenes (Wikimedia Commons, licencia libre,
  // servidas como miniatura <1MB — el original en resolución completa supera
  // el límite de 5MB de WhatsApp y hace fallar el mensaje completo) — NO son
  // fotos reales de ALLPETZ, son un marcador visual temporal. Reemplaza la
  // URL por una foto real del negocio cuando esté disponible.
  //
  // `desc`: una línea corta para la fila del catálogo (máx. 72 caracteres).
  // `pitch`: el texto largo que se muestra al abrir el detalle del servicio,
  // escrito en primera persona — como si la mascota le hablara al dueño.
  // Fotos reales de ALLPETZ (marca propia), servidas desde GitHub Pages —
  // reemplazan las de banco de imágenes genéricas que se usaban antes.
  const SERVICE_IMAGES_BASE = 'https://infoadmilac-design.github.io/crm-lina-leal/images/servicios/';

  const SERVICES = [
    { id: 'paseos', emoji: '🐕', title: 'Paseos', desc: 'GPS en vivo y fotos.', bg: '#FF5A40', text: '#0E0E12', map: 'paseo',
      photo: SERVICE_IMAGES_BASE + 'paseos.jpg',
      pitch: '¡Sácame ya! 🐾 Llevo todo el día mirando la puerta y todavía no hemos ido a explorar el barrio. Necesito mis vueltas, oler cada poste y saludar a mis amigos peludos — si no, empiezo a hacer travesuras, ¡tú ya sabes!' },
    { id: 'grooming', emoji: '✂️', title: 'Grooming', desc: 'Baño y corte.', bg: '#D4FF3A', text: '#0E0E12', map: 'bano',
      photo: SERVICE_IMAGES_BASE + 'grooming.jpg',
      pitch: 'Psss... humano, creo que ya rompí récord de días sin bañarme y hasta las moscas se están quejando 😅. ¿Me consientes con un baño? Prometo salir oliendo tan rico que hasta vas a querer abrazarme más de la cuenta.' },
    { id: 'barf', emoji: '🥩', title: 'BARF', desc: 'Comida natural.', bg: '#BEE3FF', text: '#0E0E12', map: 'barf',
      photo: SERVICE_IMAGES_BASE + 'barf.jpg',
      pitch: 'Esa comida seca de bolsa ya me aburrió 🙄. Yo lo que quiero es carne de verdad, fresca, como mis ancestros lobos (bueno, casi). Dame mi plan BARF y vas a ver cómo brilla mi pelo y salto más alto que nunca.' },
    { id: 'vet', emoji: '🏥', title: 'Vet', desc: 'A domicilio.', bg: '#2540FF', text: '#F4ECDC', map: 'vacunas',
      photo: SERVICE_IMAGES_BASE + 'vet.jpg',
      pitch: 'No me gusta la palabra "inyección", lo sé 💉. Pero prefiero mil veces que el doctor venga a la casa a revisarme en mi propio sofá, a que me lleves a una sala llena de gatos mirándome raro. Cuida mi salud sin el drama del transporte.' },
    { id: 'dental', emoji: '🦷', title: 'Dental', desc: 'Limpieza profesional.', bg: '#C9FFDA', text: '#0E0E12', map: 'dental',
      photo: SERVICE_IMAGES_BASE + 'dental.jpg',
      pitch: 'Huele mi aliento... ¿ya? 😬 Exacto. Necesito una limpiadita profesional antes de que me prohíbas darte besos. Dientes sanos, aliento fresco, más besos para ti — trato justo, ¿no crees?' },
    { id: 'entrenamiento', emoji: '🎓', title: 'Entrenamiento', desc: 'Adiestramiento.', bg: '#FFD0C7', text: '#0E0E12', map: null,
      photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Military_working_dog%2C_obedience_training%2C_Davis-Monthan_Air_Force_Base.jpg/960px-Military_working_dog%2C_obedience_training%2C_Davis-Monthan_Air_Force_Base.jpg',
      pitch: 'Sé que a veces me pongo terco y no hago caso ni jalando la correa 🙈. No es que no te quiera, es que nadie me ha enseñado bien los modales. Con un entrenador experto, en poco tiempo seré el perro más obediente del barrio (bueno, casi).' },
    { id: 'transporte', emoji: '🚐', title: 'Transport', desc: 'Traslados.', bg: '#EBE0CB', text: '#0E0E12', map: null,
      photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Dogtainers_Pet_Transport_Clipper_Cat_Cage_Plastic_Travel_Crate_Labelled.jpg/960px-Dogtainers_Pet_Transport_Clipper_Cat_Cage_Plastic_Travel_Crate_Labelled.jpg',
      pitch: '¿Te toca trabajar y no puedes llevarme al veterinario o a mi cita de spa? Tranquilo, un chofer especializado en mascotas pasa por mí, me cuida en el camino y me entrega sano y salvo — como un domicilio, pero con más olfateadas por la ventana 🚐.' },
    { id: 'hotel', emoji: '🏨', title: 'Hotel', desc: 'Hospedaje.', bg: '#FF5A40', text: '#0E0E12', map: null,
      photo: null,
      pitch: '¿Te vas de viaje y no sabes qué hacer conmigo? No me dejes solo con el vecino que ni me quiere dar snacks 😢. Llévame a un hotel para mascotas donde voy a jugar, comer rico y dormir como rey mientras tú descansas tranquilo.' },
    { id: 'seguro', emoji: '🛡️', title: 'Seguro', desc: 'Cobertura vet.', bg: '#D4FF3A', text: '#0E0E12', map: null,
      photo: null,
      pitch: 'Los accidentes pasan hasta a los perros más cuidadosos (culpa mía, lo admito, ese salto del sofá no fue buena idea 🛋️). Con un seguro para mí, tú no te preocupas por la cuenta del veterinario y yo sigo haciendo travesuras sin culpa.' },
  ];

  // ---- Baño: 3 subtipos (multiplicador estimado sobre el precio general) ----
  const BANO_VARIANTS = {
    general: { label: 'Baño general', mult: 1 },
    corte: { label: 'Baño y corte', mult: 1.4 },
    corte_raza: { label: 'Baño y corte según raza', mult: 1.7 },
  };
  const BANO_VARIANT_ORDER = ['general', 'corte', 'corte_raza'];

  function banoVariantPrice(weightIdx, variant) {
    const v = BANO_VARIANTS[variant] || BANO_VARIANTS.general;
    return round500(PR.bano[weightIdx] * v.mult);
  }

  // ---- Paseos: frecuencia (1–7×/semana) + duración + modalidad ----
  const PASEO_FREQ_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
  const PASEO_DURATION = {
    corta: { label: '45 min', mult: 1 },
    larga: { label: '1h – 1h30 (más energía)', mult: 1.25 },
  };
  const PASEO_MODALIDAD = {
    solo: { label: 'Paseo individual', mult: 1 },
    juego: { label: 'Paseo + juego (grupo de hasta 3 perros)', mult: 1.3 },
    grupal: { label: 'Paseo grupal (hasta 8 perros)', mult: 0.85 },
  };

  /** Precio base por frecuencia: interpola/extrapola entre las anclas 1×/5× reales. */
  function paseoFreqBase(weightIdx, freq) {
    const p1 = PR.paseo1x[weightIdx];
    const p5 = PR.paseo5x[weightIdx];
    const step = (p5 - p1) / 4;
    return p1 + step * (freq - 1);
  }

  function paseoPrice(weightIdx, freq, duration, modalidad) {
    const base = paseoFreqBase(weightIdx, freq || 1);
    const durMult = (PASEO_DURATION[duration] || PASEO_DURATION.corta).mult;
    const modMult = (PASEO_MODALIDAD[modalidad] || PASEO_MODALIDAD.solo).mult;
    return round500(base * durMult * modMult);
  }

  function cop(n) { return '$' + Math.round(n).toLocaleString('es-CO'); }
  function fmt(n) { return n === 0 ? 'Incluido' : cop(n); }

  // ---- Duración estimada por servicio, para calendario de colaboradores ----
  const SERVICE_DURATION_MIN = { bano: 60, barf: 20, vacunas: 30, dental: 60 };

  /** Minutos estimados que ocupa un servicio en la agenda de un colaborador. */
  function durationMinutes(serviceId, opts) {
    opts = opts || {};
    if (serviceId === 'paseo') return Math.round((PASEO_DURATION[opts.paseoDuration] || PASEO_DURATION.corta).mult * 60);
    return SERVICE_DURATION_MIN[serviceId] || 30;
  }

  // ---- Comisión de ALLPETZ por servicio (placeholder 20% en los cinco,
  // ajustar cuando el dueño dé los números reales de cada servicio) ----
  const COMMISSION_PCT = { bano: 0.20, paseo: 0.20, barf: 0.20, vacunas: 0.20, dental: 0.20 };

  /** Reparte el precio de una reserva entre la utilidad del colaborador y la comisión de ALLPETZ. */
  function splitEarnings(price, serviceId) {
    const pct = COMMISSION_PCT[serviceId] != null ? COMMISSION_PCT[serviceId] : 0.20;
    const commission = Math.round(price * pct);
    return { commission, payout: price - commission };
  }

  /** Aplica valores editables desde el panel de administrador (comisión por
      ahora) sobre los mapas fijos de este módulo — muta en memoria, sigue
      siendo síncrono/sin red, así que router.js (que requiere catalog.js
      sin poder hacer I/O) no se ve afectado. Se llama una vez al arrancar
      el servidor y cada vez que el admin guarda un cambio (ver webhook.js). */
  function setOverrides(overrides) {
    if (overrides && overrides.commission) Object.assign(COMMISSION_PCT, overrides.commission);
  }

  /** Precio de un ítem del armador para un peso dado. weightIdx: 0..3. */
  function price(id, weightIdx, opts) {
    opts = opts || {};
    if (id === 'bano') return banoVariantPrice(weightIdx, opts.banoVariant || 'general');
    if (id === 'paseo') return paseoPrice(weightIdx, opts.paseoFreq || 1, opts.paseoDuration || 'corta', opts.paseoModalidad || 'solo');
    if (id === 'barf') return BARF[opts.barfKey || 'pollo-250'];
    if (id === 'vacunas') return PR.vacunas[weightIdx];
    if (id === 'dental') return PR.dental[weightIdx];
    return 0;
  }

  return {
    PR, BARF, BARF_DEFAULT, BARF_OPTIONS, TIER, WEIGHTS, ROW_META, BUILDER_ROW_IDS, SERVICES, cop, fmt, price,
    BANO_VARIANTS, BANO_VARIANT_ORDER, banoVariantPrice,
    PASEO_FREQ_OPTIONS, PASEO_DURATION, PASEO_MODALIDAD, paseoPrice,
    SERVICE_DURATION_MIN, durationMinutes,
    COMMISSION_PCT, splitEarnings,
    setOverrides,
  };
});
