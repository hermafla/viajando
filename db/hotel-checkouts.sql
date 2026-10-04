-- Ejecutar en Supabase antes de habilitar el pago SDK o las reservas reales.
begin;
create table if not exists public.hotel_checkouts (
  id uuid primary key,
  environment text not null check (environment in ('sandbox','production')),
  prebook_id text not null unique,
  transaction_id text not null unique,
  client_reference text not null unique,
  reservation jsonb not null,
  holder jsonb,
  guests jsonb,
  state text not null check (state in ('prepared','ready','booking','confirmed','rejected','uncertain')),
  provider_result jsonb,
  email_sent boolean not null default false,
  saved boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hotel_checkouts enable row level security;
revoke all on public.hotel_checkouts from anon, authenticated;
grant all on public.hotel_checkouts to service_role;
-- El guardado de la confirmación también debe ser único ante dos respuestas simultáneas.
create unique index if not exists reservas_hoteles_booking_id_unique
  on public.reservas_hoteles (booking_id) where booking_id is not null;
commit;
