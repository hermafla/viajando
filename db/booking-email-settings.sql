-- Global switch for Valijeando's own Nuitee hotel confirmation email.
-- If the row is missing, application code defaults to keeping Valijeando email enabled.
create table if not exists public.valijeando_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.valijeando_settings enable row level security;
revoke all on public.valijeando_settings from anon, authenticated;
grant all on public.valijeando_settings to service_role;

insert into public.valijeando_settings (setting_key, setting_value)
values ('nuitee_confirmation_email_enabled', 'true'::jsonb)
on conflict (setting_key) do nothing;
