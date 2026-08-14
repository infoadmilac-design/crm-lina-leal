/* Recordatorios: mensajes que el negocio dispara (no el usuario), por lo que
   caen fuera de la ventana de 24h de conversación y DEBEN ir como plantilla
   pre-aprobada por Meta — un mensaje interactivo normal no se puede enviar aquí. */
'use strict';

/* Payload de referencia para crear la plantilla una sola vez, vía
   POST https://graph.facebook.com/v20.0/{WABA_ID}/message_templates
   (o desde Meta Business Manager > WhatsApp Manager > Plantillas de mensaje).
   Meta tarda entre minutos y ~1 día en aprobarla. */
const REMINDER_TEMPLATE_DEFINITION = {
  name: 'allpetz_recordatorio_servicio',
  language: 'es_CO',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: '🔔 Recordatorio: {{1}} de {{2}} el {{3}}. ¿Confirmas?',
      example: { body_text: [['Grooming', 'Luna', 'mañana 4:00 pm']] },
    },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Confirmar' },
        { type: 'QUICK_REPLY', text: 'Reagendar' },
        { type: 'QUICK_REPLY', text: 'Cancelar' },
      ],
    },
  ],
};

/** Payload de ENVÍO de esa plantilla ya aprobada — este es el que se dispara en cada recordatorio real. */
function buildReminderMessage(to, { serviceLabel, petName, whenLabel, bookingId }) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: REMINDER_TEMPLATE_DEFINITION.name,
      language: { code: REMINDER_TEMPLATE_DEFINITION.language },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: serviceLabel },
            { type: 'text', text: petName },
            { type: 'text', text: whenLabel },
          ],
        },
        // Los botones ya están fijos en la plantilla aprobada; aquí solo va el
        // payload que vuelve en el webhook cuando el usuario toca cada uno.
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `booking_confirm_${bookingId}` }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `booking_reschedule_${bookingId}` }] },
        { type: 'button', sub_type: 'quick_reply', index: '2', parameters: [{ type: 'payload', payload: `booking_cancel_${bookingId}` }] },
      ],
    },
  };
}

/** Ej.: 24h y 2h antes de la cita. Devuelve timestamps epoch-ms. */
function reminderTimesFor(appointmentDate) {
  const t = appointmentDate.getTime();
  return [t - 24 * 60 * 60 * 1000, t - 2 * 60 * 60 * 1000].filter((ts) => ts > Date.now());
}

/* Planificador de ejemplo: en producción usa una cola durable (BullMQ, cron
   con una tabla "reminders_pending", etc.) — esto es solo para ver el flujo
   completo funcionando en el ejemplo local, y se pierde al reiniciar. */
function createReminderScheduler(sendFn, { pollMs = 30000 } = {}) {
  const queue = []; // { at, to, params }

  function schedule(to, params, appointmentDate) {
    for (const at of reminderTimesFor(appointmentDate)) queue.push({ at, to, params });
  }

  const timer = setInterval(() => {
    const now = Date.now();
    const due = queue.filter((j) => j.at <= now);
    for (const job of due) sendFn(buildReminderMessage(job.to, job.params));
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= now) queue.splice(i, 1);
  }, pollMs);
  timer.unref?.();

  return { schedule, stop: () => clearInterval(timer), pending: () => queue.length };
}

module.exports = { REMINDER_TEMPLATE_DEFINITION, buildReminderMessage, reminderTimesFor, createReminderScheduler };
