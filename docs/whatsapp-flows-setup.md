# Publicar los WhatsApp Flows de selección múltiple

Hoy, al armar un plan por WhatsApp, elegir servicios o elegir los días de
paseo se hace tocando una fila a la vez: WhatsApp cierra la lista apenas
tocas una opción, y el bot tiene que mandar un mensaje nuevo para que puedas
tocar la siguiente. Es una limitación real de los mensajes de lista/botones
de la API de WhatsApp — no admiten selección múltiple en una sola pantalla.

La solución oficial de Meta para esto es un **WhatsApp Flow**: una pantalla
con checkboxes de verdad, dentro del mismo chat, donde marcas varias
opciones y las mandas todas juntas con un botón "Continuar". Este proyecto
ya trae listo:

- `whatsapp/flows/services.json` — pantalla para marcar varios servicios
  (baño, paseos, BARF, vacunas, dental) a la vez.
- `whatsapp/flows/paseo-days.json` — pantalla para marcar varios días de
  paseo a la vez.
- El código del bot (`whatsapp/messages.js`, `whatsapp/router.js`,
  `whatsapp/webhook.js`) ya sabe usarlos.

**Mientras no publiques estos Flows, el bot sigue funcionando exactamente
igual que hoy** (listas de toque-uno-a-la-vez) — no hay nada roto ni a medio
camino. Se activan solo cuando completas los pasos de abajo.

## 1. Publicar cada Flow en el WhatsApp Manager

Repite esto dos veces, una por cada archivo (`services.json` y
`paseo-days.json`):

1. Entra a [business.facebook.com](https://business.facebook.com) →
   WhatsApp Manager → tu cuenta de WhatsApp Business → **Flows**.
2. **Create Flow** → ponle un nombre (ej. "ALLPETZ — Servicios del plan" /
   "ALLPETZ — Días de paseo") → categoría "Otro" (Other) sirve.
3. En el editor, usa el menú **⋮ → Import Flow JSON** y sube el archivo
   correspondiente (`whatsapp/flows/services.json` o
   `whatsapp/flows/paseo-days.json`).
4. El editor valida el JSON al importarlo. Si Meta marca algún error de
   esquema (a veces ajustan detalles menores de un formato de Flow a otro),
   el propio editor te dice la línea/propiedad exacta a corregir — es un
   archivo hecho a mano siguiendo el formato documentado de Meta, así que
   puede necesitar un ajuste mínimo si su versión del editor espera algo
   distinto.
5. Revisa la vista previa (el editor tiene un simulador de WhatsApp al
   lado) — confirma que se vean las casillas y el botón "Continuar".
6. **Publish**. Al publicar, Meta te da un **Flow ID** (un número largo) —
   cópialo.

## 2. Configurar las variables de entorno

En Render (o donde esté desplegado el bot) → Environment → agrega:

```
WHATSAPP_FLOW_ID_SERVICES=<el Flow ID de services.json>
WHATSAPP_FLOW_ID_PASEO_DAYS=<el Flow ID de paseo-days.json>
```

(En local, lo mismo en tu `whatsapp/.env` — ver `whatsapp/.env.example`.)

Reinicia el servicio. A partir de ahí, cada vez que el bot necesite que el
cliente elija servicios o días, manda el Flow en vez de la lista — se puede
confirmar viendo los logs o probando por WhatsApp directamente.

## 3. Probarlo sin gastar mensajes reales (opcional)

`whatsapp/webhook.js` expone `/dev/simulate` para simular la RESPUESTA de un
Flow ya completado, sin tener el Flow publicado todavía — sirve para probar
que el bot procesa bien la selección múltiple antes de meterte con Meta:

```bash
curl -s localhost:3000/dev/simulate -H 'content-type: application/json' \
  -d '{"from":"573001112233","flowData":{"selected":["bano","paseo","dental"]}}' | jq
```

Esto simula que el cliente marcó baño, paseo y dental de una sola vez y
tocó "Continuar" — deberías ver en la respuesta que los 3 quedaron
activos en la sesión y que el bot ya avanzó a configurar el primero.

## Una limitación a tener en cuenta

El `data-source` de cada Flow (la lista de servicios o de días que se
muestran) es JSON **estático**, publicado una vez en Meta — a diferencia de
la lista de respaldo, que se genera en vivo en cada mensaje. Esto quiere
decir que si desactivas un servicio desde **Configuración → Servicios** en
el panel de admin, el Flow seguirá mostrando su casilla (el bot igual lo
descarta del lado del servidor si alguien lo marca, así que nunca se agrega
al plan — solo queda visible aunque no debería). Si desactivas un servicio
de forma permanente, lo más simple es editar `services.json`, quitar esa
fila del `data-source`, y volver a publicar el Flow con el mismo Flow ID
(Meta permite actualizar un Flow ya publicado).
