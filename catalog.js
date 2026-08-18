/* ALLPETZ — catálogo y precios compartidos entre la app web y el bot de WhatsApp.
   Única fuente de verdad: no dupliques estos valores en otro lugar.

   Precios calibrados contra investigación de mercado en Bogotá y la Sabana
   (agosto 2026) — ver el documento "Estrategia de Paquetes ALLPETZ". Margen
   ALLPETZ objetivo: 10–15% (12% por defecto, ver COMMISSION_PCT). Todos los
   números base de este archivo son el DEFAULT — el panel de administrador
   los puede sobreescribir en caliente vía setOverrides() (ver Configuración
   → Calculadora de precios). */
(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog; // Node (bot de WhatsApp)
  root.ALLPETZ_CATALOG = catalog; // navegador (app web)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function round500(n) { return Math.round(n / 500) * 500; }

  const PR = {
    // Baño: precio por VISITA, variante "general" (sin corte), por tier de peso.
    // Calibrado contra Wakypet Bogotá (servicio real a domicilio).
    bano: [68000, 82000, 103000, 132000],
    // Paseos: precio POR PASEO, por tier de peso × frecuencia semanal (1..7).
    // Cae ~5% por cada nivel de frecuencia — más volumen, menos por unidad.
    paseoPorPaseo: [
      [19500, 18000, 16500, 15500, 14500, 13500, 13000], // Mini
      [22000, 20000, 18500, 17500, 16000, 15000, 14500], // Pequeño
      [23000, 21000, 19500, 18000, 17000, 16000, 15000], // Mediano
      [26500, 24000, 22500, 21000, 19500, 18500, 17500], // Grande
    ],
    // Vacunación anual, prorrateada por mes. Mismo valor en los 4 tiers: la
    // dosis de la vacuna no varía por tamaño del perro, a diferencia del
    // baño o el paseo. Calibrado contra GoVet (hexadog + antirrábica a
    // domicilio, transporte incluido en su tarifa).
    vacunas: [12500, 12500, 12500, 12500],
    // Limpieza dental: precio por visita (trimestral/semestral). El plan
    // mensual recurrente tiene descuento aparte, ver DENTAL_FREQ_MULT.
    dental: [78000, 78000, 104000, 104000],
  };
  const BARF = { 'pollo-250': 136500, 'pollo-500': 370500, 'pollo-1000': 643500, 'salmon-250': 429000, 'salmon-500': 663000, 'salmon-1000': 1053000 };
  const BARF_DEFAULT = ['pollo-250', 'pollo-500', 'pollo-1000', 'pollo-1000'];
  // Entregar en 2 tandas al mes es logística, no más comida — no baja el
  // precio como paseo/baño, se cobra el viaje extra del colaborador.
  const BARF_ENTREGA_FEE = 12000;
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

  // ---- Transporte: domicilio fijo, se le paga entero al colaborador (no
  // entra a la comisión de ALLPETZ). Aplica a servicios de visita puntual —
  // paseo y BARF no lo llevan (paseo ya trae la eficiencia de ruta metida en
  // su tabla por frecuencia; BARF no requiere que alguien "atienda" nada).
  // Vacunas tampoco: el precio de mercado con el que se calibró ya lo incluye.
  const CONFIG = { transporte: 8000 };
  const TRANSPORTE_SERVICES = { bano: true, dental: true };
  function transporteFor(serviceId) { return TRANSPORTE_SERVICES[serviceId] ? CONFIG.transporte : 0; }

  // ---- Baño: 3 subtipos + frecuencia mensual (1 o 2 veces) ----
  const BANO_VARIANTS = {
    general: { label: 'Baño general', mult: 1 },
    corte: { label: 'Baño y corte', mult: 1.15 },
    corte_raza: { label: 'Baño y corte según raza', mult: 1.35 },
  };
  const BANO_VARIANT_ORDER = ['general', 'corte', 'corte_raza'];
  const BANO_FREQ_OPTIONS = [1, 2];
  // 2×/mes: -8% por visita — premia el compromiso, igual que dental mensual.
  const BANO_FREQ_MULT = { 1: 1, 2: 0.92 };

  /** Precio de UNA visita de baño (variante + descuento por frecuencia), transporte incluido. */
  function banoVisitPrice(weightIdx, variant, freq) {
    const v = BANO_VARIANTS[variant] || BANO_VARIANTS.general;
    const freqMult = BANO_FREQ_MULT[freq] != null ? BANO_FREQ_MULT[freq] : 1;
    return round500(PR.bano[weightIdx] * v.mult * freqMult) + transporteFor('bano');
  }

  /** Precio mensual de baño: visitas × precio por visita. */
  function banoVariantPrice(weightIdx, variant, freq) {
    const f = BANO_FREQ_OPTIONS.includes(freq) ? freq : 1;
    return banoVisitPrice(weightIdx, variant, f) * f;
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
  const SEMANAS_MES = 4.345;

  /** Precio por UN paseo (antes de duración/modalidad), según tier y frecuencia semanal. */
  function paseoFreqBase(weightIdx, freq) {
    const row = PR.paseoPorPaseo[weightIdx] || PR.paseoPorPaseo[2];
    const f = Math.min(7, Math.max(1, Math.round(freq || 1)));
    return row[f - 1];
  }

  /** Precio TOTAL MENSUAL de paseos: precio por paseo × paseos/mes. */
  function paseoPrice(weightIdx, freq, duration, modalidad) {
    const f = Math.min(7, Math.max(1, Math.round(freq || 1)));
    const base = paseoFreqBase(weightIdx, f);
    const durMult = (PASEO_DURATION[duration] || PASEO_DURATION.corta).mult;
    const modMult = (PASEO_MODALIDAD[modalidad] || PASEO_MODALIDAD.solo).mult;
    const porPaseo = round500(base * durMult * modMult);
    return round500(porPaseo * f * SEMANAS_MES);
  }

  // ---- Limpieza dental: el cliente elige cada cuánto ----
  const DENTAL_FREQ_OPTIONS = {
    mensual: { label: 'Mensual (recurrente)', mult: 0.82 },
    trimestral: { label: 'Cada 3 meses', mult: 1 },
    semestral: { label: 'Cada 6 meses', mult: 1 },
  };
  const DENTAL_FREQ_ORDER = ['mensual', 'trimestral', 'semestral'];

  function dentalPrice(weightIdx, freq) {
    const f = DENTAL_FREQ_OPTIONS[freq] || DENTAL_FREQ_OPTIONS.trimestral;
    return round500(PR.dental[weightIdx] * f.mult) + transporteFor('dental');
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

  // ---- Comisión de ALLPETZ por servicio — margen objetivo 10-15%, 12% por
  // defecto (ver "Estrategia de Paquetes ALLPETZ", sección de verificación
  // de margen). Editable por servicio desde el panel de administrador. ----
  const COMMISSION_PCT = { bano: 0.12, paseo: 0.12, barf: 0.12, vacunas: 0.12, dental: 0.12 };

  /** Reparte el precio de una reserva entre la utilidad del colaborador y la
      comisión de ALLPETZ. El transporte (si aplica al servicio) se descuenta
      antes de calcular la comisión — es reembolso de gasto del colaborador,
      no utilidad de ALLPETZ, y se le paga completo. */
  function splitEarnings(price, serviceId) {
    const transporte = transporteFor(serviceId);
    const base = Math.max(0, price - transporte);
    const pct = COMMISSION_PCT[serviceId] != null ? COMMISSION_PCT[serviceId] : 0.12;
    const commission = Math.round(base * pct);
    return { commission, payout: price - commission, transporte, base };
  }

  /** Desglose transparente cliente / ALLPETZ / colaborador para un ítem del
      armador — usado por la calculadora de precios del panel de admin y
      reusable en cualquier otro lugar que necesite mostrar el reparto. */
  function priceBreakdown(id, weightIdx, opts) {
    const total = price(id, weightIdx, opts);
    const { commission, payout, transporte, base } = splitEarnings(total, id);
    return { cliente: total, allpetz: commission, colaborador: payout, transporte, base, pct: COMMISSION_PCT[id] };
  }

  /** Aplica valores editables desde el panel de administrador (comisión,
      transporte y tablas de precio base) sobre los mapas fijos de este
      módulo — muta en memoria, sigue siendo síncrono/sin red, así que
      router.js (que requiere catalog.js sin poder hacer I/O) no se ve
      afectado. Se llama una vez al arrancar el servidor y cada vez que el
      admin guarda un cambio (ver webhook.js). */
  function setOverrides(overrides) {
    if (!overrides) return;
    if (overrides.commission) Object.assign(COMMISSION_PCT, overrides.commission);
    if (overrides.pricing) {
      const p = overrides.pricing;
      if (p.transporte != null) CONFIG.transporte = p.transporte;
      if (p.bano) Object.assign(PR, { bano: p.bano });
      if (p.paseoPorPaseo) Object.assign(PR, { paseoPorPaseo: p.paseoPorPaseo });
      if (p.vacunas) Object.assign(PR, { vacunas: p.vacunas });
      if (p.dental) Object.assign(PR, { dental: p.dental });
      if (p.barfEntregaFee != null) BARF_ENTREGA_FEE_STATE.value = p.barfEntregaFee;
    }
  }

  // BARF_ENTREGA_FEE es un valor con nombre (no un objeto), y setOverrides
  // necesita mutar algo en memoria sin romper la referencia exportada —
  // por eso vive dentro de un contenedor mutable.
  const BARF_ENTREGA_FEE_STATE = { value: BARF_ENTREGA_FEE };

  /** Precio de un ítem del armador para un peso dado. weightIdx: 0..3. */
  function price(id, weightIdx, opts) {
    opts = opts || {};
    if (id === 'bano') return banoVariantPrice(weightIdx, opts.banoVariant || 'general', opts.banoFreq || 1);
    if (id === 'paseo') return paseoPrice(weightIdx, opts.paseoFreq || 1, opts.paseoDuration || 'corta', opts.paseoModalidad || 'solo');
    if (id === 'barf') return BARF[opts.barfKey || 'pollo-250'] + (opts.barfEntregas === 2 ? BARF_ENTREGA_FEE_STATE.value : 0);
    if (id === 'vacunas') return PR.vacunas[weightIdx];
    if (id === 'dental') return dentalPrice(weightIdx, opts.dentalFreq || 'trimestral');
    return 0;
  }

  return {
    PR, BARF, BARF_DEFAULT, BARF_OPTIONS, BARF_ENTREGA_FEE_STATE, TIER, WEIGHTS, ROW_META, BUILDER_ROW_IDS, SERVICES, cop, fmt, price,
    BANO_VARIANTS, BANO_VARIANT_ORDER, BANO_FREQ_OPTIONS, BANO_FREQ_MULT, banoVariantPrice, banoVisitPrice,
    PASEO_FREQ_OPTIONS, PASEO_DURATION, PASEO_MODALIDAD, paseoPrice, paseoFreqBase,
    DENTAL_FREQ_OPTIONS, DENTAL_FREQ_ORDER, dentalPrice,
    SERVICE_DURATION_MIN, durationMinutes,
    COMMISSION_PCT, splitEarnings, priceBreakdown, transporteFor, CONFIG,
    setOverrides,
  };
});
