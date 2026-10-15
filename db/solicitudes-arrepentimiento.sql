create table if not exists public.solicitudes_arrepentimiento (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  booking_id text not null references public.reservas_hoteles(booking_id) on update cascade on delete restrict,
  email text not null,
  hotel_nombre text,
  checkin date,
  checkout date,
  estado text not null default 'recibida'
    check (estado in ('recibida', 'en_gestion', 'resuelta')),
  correo_cliente_enviado boolean not null default false,
  correo_valijeando_enviado boolean not null default false,
  nota_interna text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists solicitudes_arrepentimiento_unica_abierta
  on public.solicitudes_arrepentimiento (booking_id, email)
  where estado in ('recibida', 'en_gestion');
alter table public.solicitudes_arrepentimiento enable row level security;
revoke all on public.solicitudes_arrepentimiento from public, anon, authenticated;
grant select, insert, update on public.solicitudes_arrepentimiento to service_role;
