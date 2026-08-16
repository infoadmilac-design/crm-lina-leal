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

/** Inserta una reserva por cada servicio activo del plan confirmado. */
async function createBookingsForPlan(phone, { petId, lines, services, weightIdx, priceOpts, source }) {
  if (!enabled) return;
  for (const line of lines) {
    await query(
      `insert into bookings (customer_phone, pet_id, service_id, variant, price, status, source)
       values ($1, $2, $3, $4, $5, 'agendado', $6)`,
      [phone, petId, line.serviceId, JSON.stringify({ ...priceOpts, weightIdx, label: line.label }), line.priceValue, source]
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
};
