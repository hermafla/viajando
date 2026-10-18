-- Ejecutar junto con el despliegue del checkout Nuitee Flights.
-- Las dos tablas quedan aisladas del navegador: solo service_role accede mediante las rutas de Vercel.
begin;
create table if not exists public.flight_checkouts (
  id uuid primary key,
  environment text not null check (environment in ('sandbox','production')),
  prebook_id text not null unique,
  transaction_id text not null unique,
  client_reference text not null unique,
  email text not null,
  flight jsonb not null,
  price numeric not null check (price > 0),
  currency text not null,
  state text not null check (state in ('prepared','booking','confirmed','pending_confirmation','rejected','uncertain')),
  expires_at timestamptz,
  provider_booking_id text,
  booking_ref text,
  provider_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.reservas_vuelos (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  proveedor text not null default 'Nuitee',
  provider_booking_id text not null unique,
  booking_ref text,
  origen text not null,
  destino text not null,
  salida timestamptz,
  regreso timestamptz,
  moneda text not null,
  total numeric not null check (total > 0),
  estado text not null check (estado in ('pendiente','confirmada','cancelada')),
  itinerario jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.flight_checkouts enable row level security;
alter table public.reservas_vuelos enable row level security;
revoke all on public.flight_checkouts from anon, authenticated;
revoke all on public.reservas_vuelos from anon, authenticated;
grant all on public.flight_checkouts to service_role;
grant all on public.reservas_vuelos to service_role;
commit;
