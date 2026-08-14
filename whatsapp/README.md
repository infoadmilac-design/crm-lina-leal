# ALLPETZ en WhatsApp

Bot de WhatsApp Cloud API que ofrece el mismo catálogo y armador de plan que la
app (`../catalog.js` es la única fuente de verdad de precios y servicios).

## Probar sin cuenta de Meta (ahora mismo)

```bash
npm install
node webhook.js          # arranca en modo DRY_RUN: nunca llama a Meta
```

En otra terminal:

```bash
# Un mensaje de texto:
curl -s localhost:3000/dev/simulate -H 'content-type: application/json' \
  -d '{"from":"573001112233","text":"hola"}'

# Un tap en una opción del menú/lista/botón (el "id" es el que devuelve messages.js):
curl -s localhost:3000/dev/simulate -H 'content-type: application/json' \
  -d '{"from":"573001112233","id":"menu_plan"}'

# Ver todo lo que el bot "envió":
curl -s localhost:3000/dev/sent
```

También corre `npm test` (o `node router.test.js`) para ver todo el flujo del
diagrama (menú → catálogo/plan → resumen → confirmar → mis servicios)
ejecutado de punta a punta con asserts, sin red.

## Probar de verdad con tu celular

1. Crea una app de Meta en [developers.facebook.com](https://developers.facebook.com) → producto **WhatsApp**.
2. Meta te da un **número de prueba** gratis. En "API Setup" agrega tu celular
   personal como número de destino de prueba (hasta 5, sin verificación).
3. Copia el token temporal y el `Phone number ID` a `.env` (basado en `.env.example`).
4. Expón este servidor a internet, ej. `npx ngrok http 3000`.
5. En "Configuration" del producto WhatsApp, pon la URL del webhook
   (`https://<tu-ngrok>.ngrok.app/webhook`) y el mismo `VERIFY_TOKEN` de tu `.env`.
6. Suscríbete al campo `messages`.
7. Escríbele "hola" al número de prueba desde tu celular.

El token temporal del paso 3 expira en 24h — para algo más estable, crea un
System User y un token permanente antes de mostrarlo a alguien más.

## Recordatorios

Un recordatorio no lo dispara el usuario, así que no puede ir como mensaje
interactivo normal — Meta exige una **plantilla pre-aprobada** para todo lo
que el negocio envía fuera de la ventana de 24h desde el último mensaje del
usuario. `reminders.js` trae:

- `REMINDER_TEMPLATE_DEFINITION` — el payload para crear la plantilla una vez
  (Meta Business Manager → WhatsApp Manager → Plantillas, o vía API). Tarda
  minutos a ~1 día en aprobarse.
- `buildReminderMessage()` — el envío real de esa plantilla ya aprobada.
- `createReminderScheduler()` — un planificador de ejemplo en memoria (se
  pierde al reiniciar). En producción cámbialo por una cola durable o un cron
  contra una tabla de citas.

Cuando el usuario toca "Confirmar / Reagendar / Cancelar" en el recordatorio,
el webhook lo recibe como `type: "button"` (no `interactive`) — `webhook.js`
ya lo normaliza igual que un tap normal, y cae en el mismo manejador que usa
"Mis servicios" (`router.js`, `handleBookingAction`).

## Archivos

| Archivo | Qué hace |
|---|---|
| `messages.js` | Arma cada payload de la Cloud API (listas, botones, texto) |
| `session.js` | Estado de conversación por número (en memoria) |
| `router.js` | Máquina de estados pura — sin red, fácil de probar |
| `reminders.js` | Plantilla de recordatorio + planificador de ejemplo |
| `webhook.js` | Servidor Express: webhook real de Meta + rutas `/dev/*` para probar local |
| `router.test.js` | Prueba de humo del flujo completo |
