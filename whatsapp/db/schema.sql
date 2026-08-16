-- ALLPETZ — esquema compartido entre el bot de WhatsApp y la app.
-- Ejecutar una vez contra la base de datos apuntada por DATABASE_URL:
--   psql "$DATABASE_URL" -f db/schema.sql

create extension if not exists pgcrypto;

create table if not exists customers (
  phone text primary key,
  owner_name text,
  created_at timestamptz not null default now()
);

create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null references customers(phone) on delete cascade,
  name text not null,
  breed text,
  weight_idx int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists collaborators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  specialty text,
  active boolean not null default true
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null references customers(phone) on delete cascade,
  pet_id uuid references pets(id) on delete set null,
  service_id text not null,
  variant jsonb not null default '{}',
  price int not null default 0,
  status text not null default 'agendado',
  scheduled_at timestamptz,
  assigned_collaborator_id uuid references collaborators(id) on delete set null,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now()
);

create index if not exists bookings_customer_phone_idx on bookings(customer_phone);
create index if not exists bookings_assigned_collaborator_idx on bookings(assigned_collaborator_id);

create table if not exists auth_codes (
  phone text primary key,
  code text not null,
  expires_at timestamptz not null
);

create table if not exists auth_tokens (
  token text primary key,
  phone text not null,
  expires_at timestamptz not null
);
