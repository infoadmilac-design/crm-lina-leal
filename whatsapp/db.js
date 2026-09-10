/* Acceso a datos compartido entre el bot de WhatsApp y la API de la app.
   Un solo pool de Postgres contra DATABASE_URL (Render lo inyecta solo al
   enlazar la base de datos al servicio). Sin DATABASE_URL, todas las
   funciones son no-op silenciosos: el bot sigue funcionando en modo memoria
   (útil en local sin Postgres a mano). */
'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : null;

const enabled = !!pool;

async function query(text, params) {
  if (!pool) return { rows: [] };
  return pool.query(text, params);
}

/** Crea o actualiza el cliente y su primera mascota (datos del onboarding). */
async function upsertCustomerAndPet(phone, { ownerName, petName, petBreed, weightIdx }) {
  if (!enabled) return null;
  await query(
    `insert into customers (phone, owner_name) values ($1, $2)
     on conflict (phone) do update set owner_name = coalesce(excluded.owner_name, customers.owner_name)`,
    [phone, ownerName || null]
  );
  const { rows } = await query(
    `insert into pets (customer_phone, name, breed, weight_idx) values ($1, $2, $3, $4) returning id`,
    [phone, petName, petBreed || null, weightIdx || 0]
  );
  return rows[0]?.id || null;
}

/** El id de la mascota más reciente de un cliente (para asociar reservas). */
async function latestPetId(phone) {
  if (!enabled) return null;
  const { rows } = await query(
    `select id from pets where customer_phone = $1 order by created_at desc limit 1`,
    [phone]
  );
  return rows[0]?.id || null;
}

/** Inserta una reserva por cada servicio activo del plan confirmado. Si el
    cliente propuso horario para un servicio (line.proposedAt, "YYYY-MM-DDTHH:MM"
    hora de Bogotá), la reserva nace en estado 'propuesto' con ese horario. */
async function createBookingsForPlan(phone, { petId, lines, services, weightIdx, priceOpts, source }) {
  if (!enabled) return;
  for (const line of lines) {
    const parsed = line.proposedAt ? parseLocalDateTime(line.proposedAt) : null;
    const status = parsed ? 'propuesto' : 'agendado';
    await query(
      `insert into bookings (customer_phone, pet_id, service_id, variant, price, status, proposed_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [phone, petId, line.serviceId, JSON.stringify({ ...priceOpts, weightIdx, label: line.label }), line.priceValue, status, parsed ? parsed.instant : null, source]
    );
  }
}

async function getCustomerFull(phone) {
  if (!enabled) return null;
  const { rows: custRows } = await query(`select phone, owner_name, created_at from customers where phone = $1`, [phone]);
  if (!custRows[0]) return null;
  const { rows: pets } = await query(`select id, name, breed, weight_idx from pets where customer_phone = $1 order by created_at`, [phone]);
  const { rows: bookings } = await query(
    `select id, pet_id, service_id, variant, price, status, scheduled_at, source, created_at
     from bookings where customer_phone = $1 order by created_at desc`,
    [phone]
  );
  return { customer: custRows[0], pets, bookings };
}

async function listCollaboratorBookings(collaboratorId) {
  if (!enabled) return [];
  const { rows } = await query(
    `select b.*, c.owner_name, p.name as pet_name
     from bookings b
     join customers c on c.phone = b.customer_phone
     left join pets p on p.id = b.pet_id
     where b.assigned_collaborator_id = $1
     order by b.scheduled_at nulls last, b.created_at`,
    [collaboratorId]
  );
  return rows;
}

async function saveAuthCode(phone, code, ttlMs) {
  if (!enabled) return;
  await query(
    `insert into auth_codes (phone, code, expires_at) values ($1, $2, now() + ($3 || ' milliseconds')::interval)
     on conflict (phone) do update set code = excluded.code, expires_at = excluded.expires_at`,
    [phone, code, String(ttlMs)]
  );
}

async function verifyAuthCode(phone, code) {
  if (!enabled) return false;
  const { rows } = await query(
    `select 1 from auth_codes where phone = $1 and code = $2 and expires_at > now()`,
    [phone, code]
  );
  if (rows[0]) await query(`delete from auth_codes where phone = $1`, [phone]);
  return !!rows[0];
}

async function createAuthToken(phone, ttlMs) {
  if (!enabled) return null;
  const token = require('crypto').randomBytes(24).toString('hex');
  await query(
    `insert into auth_tokens (token, phone, expires_at) values ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [token, phone, String(ttlMs)]
  );
  return token;
}

async function phoneForToken(token) {
  if (!enabled) return null;
  const { rows } = await query(`select phone from auth_tokens where token = $1 and expires_at > now()`, [token]);
  return rows[0]?.phone || null;
}

/* ---- Colaboradores: disponibilidad semanal y asignación de citas ----
   ALLPETZ opera en hora de Bogotá (UTC-5, sin horario de verano). Los
   horarios que manda el panel de colaboradores llegan como
   "YYYY-MM-DDTHH:MM" en hora local — se les agrega el offset explícito
   antes de mandarlos a Postgres para que el instante guardado sea
   correcto sin depender de la zona horaria del proceso de Node. */
const BOGOTA_OFFSET = '-05:00';

function parseLocalDateTime(scheduledAtLocal) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(scheduledAtLocal || ''));
  if (!m) return null;
  const [, datePart, hh, mm] = m;
  const weekday = new Date(`${datePart}T00:00:00Z`).getUTCDay();
  return { hh, mm, weekday, minutesOfDay: Number(hh) * 60 + Number(mm), instant: `${datePart}T${hh}:${mm}:00${BOGOTA_OFFSET}` };
}

function minutesToHHMM(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

async function getCollaboratorByPhone(phone) {
  if (!enabled) return null;
  const { rows } = await query(
    `select id, name, phone, specialties from collaborators where phone = $1 and active`,
    [phone]
  );
  return rows[0] || null;
}

async function getAvailability(collaboratorId) {
  if (!enabled) return [];
  const { rows } = await query(
    `select weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
     from collaborator_availability where collaborator_id = $1 order by weekday, start_time`,
    [collaboratorId]
  );
  return rows;
}

/** Reemplaza toda la disponibilidad de un colaborador por la lista dada. */
async function replaceAvailability(collaboratorId, slots) {
  if (!enabled) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`delete from collaborator_availability where collaborator_id = $1`, [collaboratorId]);
    for (const s of slots) {
      await client.query(
        `insert into collaborator_availability (collaborator_id, weekday, start_time, end_time) values ($1, $2, $3, $4)`,
        [collaboratorId, s.weekday, s.start, s.end]
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Reservas sin horario propuesto ("que ustedes me contacten") cuyo servicio
    coincide con alguna de las especialidades dadas — respaldo para cuando el
    cliente no propuso nada; ver listProposals() para las que sí propusieron. */
async function listPendingBookings(specialties) {
  if (!enabled || !specialties || !specialties.length) return [];
  const { rows } = await query(
    `select b.*, c.owner_name, p.name as pet_name
     from bookings b
     join customers c on c.phone = b.customer_phone
     left join pets p on p.id = b.pet_id
     where b.assigned_collaborator_id is null and b.status = 'agendado' and b.service_id = any($1::text[])
     order by b.created_at`,
    [specialties]
  );
  return rows;
}

/** Reservas con un horario propuesto por el cliente, esperando que un
    colaborador con la especialidad correspondiente lo acepte o rechace. */
async function listProposals(specialties) {
  if (!enabled || !specialties || !specialties.length) return [];
  const { rows } = await query(
    `select b.*, c.owner_name, p.name as pet_name
     from bookings b
     join customers c on c.phone = b.customer_phone
     left join pets p on p.id = b.pet_id
     where b.status = 'propuesto' and b.service_id = any($1::text[])
     order by b.proposed_at`,
    [specialties]
  );
  return rows;
}

/** Asigna una reserva a un colaborador en un horario, validando disponibilidad
    semanal y que no choque con otra cita ya asignada al mismo colaborador. */
async function assignBooking(bookingId, collaboratorId, scheduledAtLocal, durationMin) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const parsed = parseLocalDateTime(scheduledAtLocal);
  if (!parsed) return { ok: false, reason: 'invalid_date' };
  // Nuestro modelo de disponibilidad es de un solo día (por weekday) — un
  // servicio que termine después de medianoche nunca puede caber en él.
  if (parsed.minutesOfDay + durationMin > 1440) return { ok: false, reason: 'outside_availability' };
  const endHHMM = minutesToHHMM(parsed.minutesOfDay + durationMin);

  const client = await pool.connect();
  try {
    await client.query('begin');

    const { rows: bookingRows } = await client.query(
      `select id, assigned_collaborator_id from bookings where id = $1 for update`,
      [bookingId]
    );
    const booking = bookingRows[0];
    if (!booking) { await client.query('rollback'); return { ok: false, reason: 'not_found' }; }
    if (booking.assigned_collaborator_id) { await client.query('rollback'); return { ok: false, reason: 'already_assigned' }; }

    const { rows: availRows } = await client.query(
      `select 1 from collaborator_availability
       where collaborator_id = $1 and weekday = $2 and start_time <= $3::time and end_time >= $4::time`,
      [collaboratorId, parsed.weekday, `${parsed.hh}:${parsed.mm}`, endHHMM]
    );
    if (!availRows[0]) { await client.query('rollback'); return { ok: false, reason: 'outside_availability' }; }

    const { rows: overlapRows } = await client.query(
      `select 1 from bookings
       where assigned_collaborator_id = $1 and id <> $2 and scheduled_at is not null
         and scheduled_at < ($3::timestamptz + ($4 || ' minutes')::interval)
         and (scheduled_at + (coalesce(nullif(variant->>'durationMin', ''), '60') || ' minutes')::interval) > $3::timestamptz`,
      [collaboratorId, bookingId, parsed.instant, String(durationMin)]
    );
    if (overlapRows[0]) { await client.query('rollback'); return { ok: false, reason: 'overlap' }; }

    const { rows: updated } = await client.query(
      `update bookings set scheduled_at = $1::timestamptz, assigned_collaborator_id = $2, status = 'confirmado',
         variant = jsonb_set(coalesce(variant, '{}'::jsonb), '{durationMin}', to_jsonb($3::int))
       where id = $4
       returning id, customer_phone, pet_id, service_id, variant, price, status, scheduled_at`,
      [parsed.instant, collaboratorId, durationMin, bookingId]
    );
    const { rows: petRows } = await client.query(`select name from pets where id = $1`, [updated[0].pet_id]);

    await client.query('commit');
    return { ok: true, booking: updated[0], petName: petRows[0]?.name || null };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Convierte un instante (timestamptz de Postgres, o Date de node-pg) a
    "YYYY-MM-DDTHH:MM" en hora de Bogotá, sin depender de la zona horaria
    del proceso de Node — inverso de parseLocalDateTime(). */
function instantToLocalString(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** El colaborador acepta el horario que el cliente propuso — reutiliza toda
    la validación de disponibilidad/choque de assignBooking(). */
async function acceptProposedBooking(bookingId, collaboratorId, durationMin) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const { rows } = await query(`select proposed_at from bookings where id = $1 and status = 'propuesto'`, [bookingId]);
  const proposedAt = rows[0]?.proposed_at;
  if (!proposedAt) return { ok: false, reason: 'not_found' };
  return assignBooking(bookingId, collaboratorId, instantToLocalString(proposedAt), durationMin);
}

/** El colaborador rechaza el horario propuesto: la reserva vuelve a quedar
    sin horario, lista para que el cliente proponga otro (ver
    whatsapp/collab-api.js, que dispara el mensaje de WhatsApp con esto). */
async function declineProposal(bookingId, specialties) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const { rows } = await query(
    `update bookings set proposed_at = null, status = 'agendado'
     where id = $1 and status = 'propuesto' and service_id = any($2::text[])
     returning id, customer_phone`,
    [bookingId, specialties || []]
  );
  return rows[0] ? { ok: true, booking: rows[0] } : { ok: false, reason: 'not_found' };
}

/** Guarda el nuevo horario que el cliente re-propuso tras un rechazo. */
async function updateProposedTime(bookingId, proposedAtLocal) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const parsed = parseLocalDateTime(proposedAtLocal);
  if (!parsed) return { ok: false, reason: 'invalid_date' };
  const { rows } = await query(
    `update bookings set proposed_at = $1::timestamptz, status = 'propuesto' where id = $2 returning id`,
    [parsed.instant, bookingId]
  );
  return rows[0] ? { ok: true } : { ok: false, reason: 'not_found' };
}

/** Libera una reserva previamente asignada, para que vuelva al pool sin asignar. */
async function releaseBooking(bookingId, collaboratorId) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const { rows } = await query(
    `update bookings set scheduled_at = null, assigned_collaborator_id = null, status = 'agendado'
     where id = $1 and assigned_collaborator_id = $2 returning id`,
    [bookingId, collaboratorId]
  );
  return rows[0] ? { ok: true } : { ok: false, reason: 'not_found' };
}

/* ---- Panel de administrador: colaboradores, clientes, reservas globales ---- */

async function getAdminByPhone(phone) {
  if (!enabled) return null;
  const { rows } = await query(`select phone, name from admins where phone = $1`, [phone]);
  return rows[0] || null;
}

async function listAdminCollaborators() {
  if (!enabled) return [];
  const { rows } = await query(`select id, name, phone, specialties, active from collaborators order by name`);
  return rows;
}

async function createCollaborator({ name, phone, specialties }) {
  if (!enabled) return null;
  const { rows } = await query(
    `insert into collaborators (name, phone, specialties) values ($1, $2, $3::jsonb)
     returning id, name, phone, specialties, active`,
    [name, phone || null, JSON.stringify(specialties || [])]
  );
  return rows[0];
}

/** Actualiza solo los campos presentes en `patch` (undefined = no tocar). */
async function updateCollaborator(id, { name, phone, specialties, active }) {
  if (!enabled) return null;
  const { rows } = await query(
    `update collaborators set
       name = coalesce($2, name),
       phone = coalesce($3, phone),
       specialties = coalesce($4::jsonb, specialties),
       active = coalesce($5, active)
     where id = $1
     returning id, name, phone, specialties, active`,
    [id, name ?? null, phone ?? null, specialties ? JSON.stringify(specialties) : null, active === undefined ? null : active]
  );
  return rows[0] || null;
}

/** Lista de clientes para el panel de admin, con búsqueda opcional por teléfono/nombre. */
async function listCustomersAdmin(search) {
  if (!enabled) return [];
  if (search) {
    const { rows } = await query(
      `select phone, owner_name, created_at from customers
       where phone ilike $1 or owner_name ilike $1
       order by created_at desc limit 100`,
      [`%${search}%`]
    );
    return rows;
  }
  const { rows } = await query(`select phone, owner_name, created_at from customers order by created_at desc limit 100`);
  return rows;
}

/** Todas las reservas del negocio (no solo las de un colaborador), con filtros opcionales. */
async function listAllBookings({ status, collaboratorId } = {}) {
  if (!enabled) return [];
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }
  if (collaboratorId) { params.push(collaboratorId); conditions.push(`b.assigned_collaborator_id = $${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const { rows } = await query(
    `select b.*, c.owner_name, p.name as pet_name, col.name as collaborator_name
     from bookings b
     join customers c on c.phone = b.customer_phone
     left join pets p on p.id = b.pet_id
     left join collaborators col on col.id = b.assigned_collaborator_id
     ${where}
     order by b.scheduled_at nulls last, b.created_at desc
     limit 300`,
    params
  );
  return rows;
}

/* ---- Configuración editable desde el panel de administrador ---- */
const SETTINGS_KEY_TO_CAMEL = { commission: 'commission', business_info: 'businessInfo', bot_texts: 'botTexts' };

async function getSettings() {
  if (!enabled) return {};
  const { rows } = await query(`select key, value from settings`);
  const out = {};
  for (const r of rows) out[SETTINGS_KEY_TO_CAMEL[r.key] || r.key] = r.value;
  return out;
}

async function setSetting(key, value) {
  if (!enabled) return null;
  const { rows } = await query(
    `insert into settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value
     returning key, value`,
    [key, JSON.stringify(value)]
  );
  return rows[0];
}

/** Reservas confirmadas con scheduled_at en [fromInstant, toInstant) — base
    del reporte financiero del admin (whatsapp/admin-api.js hace el cálculo
    de comisión/utilidad con CATALOG.splitEarnings, aquí solo se traen los
    datos crudos). */
async function listBookingsInRange(fromInstant, toInstant, status) {
  if (!enabled) return [];
  const conditions = [`b.scheduled_at >= $1::timestamptz`, `b.scheduled_at < $2::timestamptz`];
  const params = [fromInstant, toInstant];
  if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }
  const { rows } = await query(
    `select b.*, col.name as collaborator_name
     from bookings b
     left join collaborators col on col.id = b.assigned_collaborator_id
     where ${conditions.join(' and ')}
     order by b.scheduled_at`,
    params
  );
  return rows;
}

async function getBookingById(id) {
  if (!enabled) return null;
  const { rows } = await query(
    `select b.*, c.owner_name, p.name as pet_name
     from bookings b
     join customers c on c.phone = b.customer_phone
     left join pets p on p.id = b.pet_id
     where b.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** El admin mueve una reserva YA agendada a otro colaborador. Sin `force`,
    valida disponibilidad/choque contra el nuevo colaborador igual que
    assignBooking(); con `force`, lo salta (el admin asume la responsabilidad). */
async function reassignBooking(bookingId, newCollaboratorId, durationMin, force) {
  if (!enabled) return { ok: false, reason: 'db_disabled' };
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: bookingRows } = await client.query(
      `select id, scheduled_at from bookings where id = $1 for update`,
      [bookingId]
    );
    const booking = bookingRows[0];
    if (!booking) { await client.query('rollback'); return { ok: false, reason: 'not_found' }; }
    if (!booking.scheduled_at) { await client.query('rollback'); return { ok: false, reason: 'not_scheduled' }; }

    if (!force) {
      const parsed = parseLocalDateTime(instantToLocalString(booking.scheduled_at));
      const endHHMM = minutesToHHMM(parsed.minutesOfDay + durationMin);
      const { rows: availRows } = await client.query(
        `select 1 from collaborator_availability
         where collaborator_id = $1 and weekday = $2 and start_time <= $3::time and end_time >= $4::time`,
        [newCollaboratorId, parsed.weekday, `${parsed.hh}:${parsed.mm}`, endHHMM]
      );
      if (!availRows[0]) { await client.query('rollback'); return { ok: false, reason: 'outside_availability' }; }

      const { rows: overlapRows } = await client.query(
        `select 1 from bookings
         where assigned_collaborator_id = $1 and id <> $2 and scheduled_at is not null
           and scheduled_at < ($3::timestamptz + ($4 || ' minutes')::interval)
           and (scheduled_at + (coalesce(nullif(variant->>'durationMin', ''), '60') || ' minutes')::interval) > $3::timestamptz`,
        [newCollaboratorId, bookingId, booking.scheduled_at, String(durationMin)]
      );
      if (overlapRows[0]) { await client.query('rollback'); return { ok: false, reason: 'overlap' }; }
    }

    const { rows: updated } = await client.query(
      `update bookings set assigned_collaborator_id = $1 where id = $2
       returning id, customer_phone, pet_id, service_id, variant, price, status, scheduled_at`,
      [newCollaboratorId, bookingId]
    );
    await client.query('commit');
    return { ok: true, booking: updated[0] };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  enabled,
  upsertCustomerAndPet,
  latestPetId,
  createBookingsForPlan,
  getCustomerFull,
  listCollaboratorBookings,
  saveAuthCode,
  verifyAuthCode,
  createAuthToken,
  phoneForToken,
  getCollaboratorByPhone,
  getAvailability,
  replaceAvailability,
  listPendingBookings,
  listProposals,
  assignBooking,
  acceptProposedBooking,
  declineProposal,
  updateProposedTime,
  releaseBooking,
  getAdminByPhone,
  listAdminCollaborators,
  createCollaborator,
  updateCollaborator,
  listCustomersAdmin,
  listAllBookings,
  getBookingById,
  reassignBooking,
  getSettings,
  setSetting,
  listBookingsInRange,
};
