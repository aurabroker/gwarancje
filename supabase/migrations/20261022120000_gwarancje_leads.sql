-- Zgłoszenia z formularza kontaktowego na gwarancje.pro.
-- Zapis wyłącznie przez Edge Function gwarancje-submit (service_role).
-- Odczyt i edycja statusu: admini (profiles.rola = 'admin'), jak przy aura_articles.
create table if not exists public.gwarancje_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  imie_nazwisko text not null,
  nip           text,
  email         text not null,
  telefon       text,
  produkt       text,
  wiadomosc     text,
  rodo_zgoda    boolean not null default false,
  source_url    text,
  status        text not null default 'nowe' check (status in ('nowe','w_toku','zamkniete')),
  notatki       text,
  mail_wyslany  boolean not null default false,
  mail_blad     text
);

create index if not exists gwarancje_leads_created_at_idx on public.gwarancje_leads (created_at desc);
create index if not exists gwarancje_leads_email_idx on public.gwarancje_leads (lower(email));

alter table public.gwarancje_leads enable row level security;

create policy "gwarancje_leads_admin_select" on public.gwarancje_leads
  for select to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rola = 'admin'));

create policy "gwarancje_leads_admin_update" on public.gwarancje_leads
  for update to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rola = 'admin'))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rola = 'admin'));

create policy "gwarancje_leads_admin_delete" on public.gwarancje_leads
  for delete to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rola = 'admin'));
