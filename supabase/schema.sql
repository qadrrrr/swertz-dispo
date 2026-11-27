-- =====================================================================
-- Swertz Dispo – Datenbank für Supabase
-- =====================================================================
-- So verwenden:
--   Supabase → Projekt → „SQL Editor“ → „New query“ → diesen ganzen Text
--   einfügen → „Run“. Das Skript kann gefahrlos mehrfach ausgeführt werden;
--   es löscht keine Daten.
--
-- Grundregeln (Row Level Security):
--   * Standort-Nutzer sehen und ändern nur Zeilen ihres eigenen Standorts.
--   * Die Zentrale sieht und ändert alles.
--   * Vorschläge sehen Absender und Empfänger. Solange ein Vorschlag offen ist
--     (und bis 15 Minuten nach der Annahme), darf der Empfänger genau die
--     vorgeschlagenen Aufträge bzw. die vorgeschlagene Tour sehen und übernehmen.
--   * Wer zu welchem Standort gehört, steht in der Tabelle „profile“. Das kann
--     nur die Zentrale bzw. der Administrator im Supabase-Dashboard ändern.
--
-- Datenaufbau: Das Programm speichert jeden Eintrag als Dokument (JSON) in der
-- Spalte „daten“. Die Spalten sto/ursprung/von/an werden automatisch aus dem
-- Dokument übernommen und dienen den Zugriffsregeln.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Standorte
-- ---------------------------------------------------------------------
create table if not exists public.standorte (
  id      text primary key,
  name    text not null,
  adresse text not null,
  farbe   text not null
);

insert into public.standorte (id, name, adresse, farbe) values
  ('moe', 'Moers',    'Dr.-Berns-Straße 41, 47441 Moers',                  'Gelb'),
  ('goc', 'Goch',     'Weezer Str. 65b, 47574 Goch',                        'Rot'),
  ('kle', 'Kleve',    'Flutstr. 53-61, 47533 Kleve',                        'Silber'),
  ('emm', 'Emmerich', 'Albert-Einstein-Str. 5, 46446 Emmerich am Rhein',   'Weiß'),
  ('vie', 'Viersen',  'Feldstr. 12, 41749 Viersen',                         'Grau'),
  ('str', 'Straelen', 'Annastraße 89-103, 47638 Straelen',                  'Orange'),
  ('gel', 'Geldern',  'Martinistr. 71, 47608 Geldern',                      'Hellblau')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Profile (Nutzer → Standort, Rolle)
-- ---------------------------------------------------------------------
create table if not exists public.profile (
  id                 uuid primary key references auth.users (id) on delete cascade,
  name               text not null default '',
  standort           text references public.standorte (id),
  rolle              text not null default 'standort' check (rolle in ('standort', 'zentrale')),
  nur_mein_standort  boolean not null default false,
  erstellt_am        timestamptz not null default now()
);

-- Neuer Nutzer im Dashboard angelegt → Profil ohne Standort (= noch kein Zugriff).
create or replace function public.neues_profil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists profil_bei_neuem_nutzer on auth.users;
create trigger profil_bei_neuem_nutzer
  after insert on auth.users
  for each row execute function public.neues_profil();

-- Hilfsfunktionen für die Zugriffsregeln
create or replace function public.mein_standort()
returns text language sql stable security definer set search_path = public as $$
  select standort from public.profile where id = auth.uid()
$$;

create or replace function public.ist_zentrale()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rolle = 'zentrale' from public.profile where id = auth.uid()), false)
$$;

-- darf(sto): Zentrale immer, sonst nur der eigene Standort.
create or replace function public.darf(p_sto text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ist_zentrale()
      or (p_sto is not null and p_sto = public.mein_standort())
$$;

-- Zahl aus einer Kennung wie „o17“ oder „t5“ (sonst null, nie ein Fehler).
create or replace function public.nummer(p text)
returns numeric language sql immutable as $$
  select case when regexp_replace(coalesce(p, ''), '\D', '', 'g') <> ''
              then regexp_replace(p, '\D', '', 'g')::numeric end
$$;

-- ---------------------------------------------------------------------
-- 3. Datentabellen (je ein Dokument pro Zeile)
-- ---------------------------------------------------------------------
create table if not exists public.fahrzeuge (
  id text primary key, sto text references public.standorte (id),
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.baustellen (
  id text primary key, sto text references public.standorte (id),
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.auftraege (
  id text primary key, sto text references public.standorte (id),
  ursprung text references public.standorte (id),
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.touren (
  id text primary key, sto text references public.standorte (id),
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.vorschlaege (
  id text primary key,
  von text references public.standorte (id),
  an  text references public.standorte (id),
  typ text, status text not null default 'offen',
  ids jsonb not null default '[]'::jsonb,
  tour_ids jsonb not null default '[]'::jsonb,
  beantwortet_am timestamptz,
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid
);
-- Bearbeitungs-Sperren für Aufträge (nur Nutzerkennung und Ablaufzeit)
create table if not exists public.sperren (
  id text primary key,
  holder text not null,
  bis timestamptz not null,
  daten jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists auftraege_sto_idx    on public.auftraege (sto);
create index if not exists auftraege_urspr_idx  on public.auftraege (ursprung);
create index if not exists auftraege_tour_idx   on public.auftraege ((daten->>'tourId'));
create index if not exists touren_sto_idx       on public.touren (sto);
create index if not exists fahrzeuge_sto_idx    on public.fahrzeuge (sto);
create index if not exists baustellen_sto_idx   on public.baustellen (sto);
create index if not exists vorschlaege_an_idx   on public.vorschlaege (an, status);
create index if not exists vorschlaege_von_idx  on public.vorschlaege (von);

-- Spalten automatisch aus dem Dokument füllen, Zeitstempel setzen
create or replace function public.zeile_vorbereiten()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_table_name in ('fahrzeuge', 'touren') then
    new.sto := coalesce(nullif(new.daten->>'sto', ''), nullif(new.daten->>'start', ''), new.sto);
  elsif tg_table_name = 'auftraege' then
    new.sto      := coalesce(nullif(new.daten->>'sto', ''), nullif(new.daten->>'ursprung', ''), new.sto);
    new.ursprung := coalesce(nullif(new.daten->>'ursprung', ''), new.sto);
  elsif tg_table_name = 'baustellen' then
    -- Baustellen gehören dem Standort, der sie angelegt hat (Zentrale: ohne Standort).
    if tg_op = 'INSERT' then
      new.sto := coalesce(new.sto, public.mein_standort());
    else
      new.sto := old.sto;
    end if;
  end if;
  -- Unbekannte Standort-Kennungen (z. B. „all“) nicht als Fremdschlüssel speichern
  if new.sto is not null and not exists (select 1 from public.standorte s where s.id = new.sto) then
    new.sto := null;
  end if;
  if tg_table_name = 'auftraege' then
    if new.ursprung is not null
       and not exists (select 1 from public.standorte s where s.id = new.ursprung) then
      new.ursprung := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists vorbereiten on public.fahrzeuge;
create trigger vorbereiten before insert or update on public.fahrzeuge
  for each row execute function public.zeile_vorbereiten();
drop trigger if exists vorbereiten on public.baustellen;
create trigger vorbereiten before insert or update on public.baustellen
  for each row execute function public.zeile_vorbereiten();
drop trigger if exists vorbereiten on public.auftraege;
create trigger vorbereiten before insert or update on public.auftraege
  for each row execute function public.zeile_vorbereiten();
drop trigger if exists vorbereiten on public.touren;
create trigger vorbereiten before insert or update on public.touren
  for each row execute function public.zeile_vorbereiten();

-- Vorschläge: Absender/Empfänger/Typ/IDs aus dem Dokument, danach unveränderlich
create or replace function public.vorschlag_vorbereiten()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.status := coalesce(nullif(new.daten->>'status', ''), 'offen');
  if tg_op = 'INSERT' then
    new.von := nullif(new.daten->>'from', '');
    new.an  := nullif(new.daten->>'to', '');
    new.typ := nullif(new.daten->>'type', '');
    new.ids := coalesce(new.daten->'ids', '[]'::jsonb);
    if jsonb_typeof(new.ids) <> 'array' then new.ids := '[]'::jsonb; end if;
    -- Touren, in denen die vorgeschlagenen Aufträge gerade stecken
    select coalesce(jsonb_agg(distinct public.nummer(a.daten->>'tourId')), '[]'::jsonb)
      into new.tour_ids
      from public.auftraege a
     where new.typ = 'auftrag'
       and public.nummer(a.id) in (select public.nummer(x) from jsonb_array_elements_text(new.ids) x)
       and public.nummer(a.daten->>'tourId') is not null;
    new.beantwortet_am := null;
  else
    new.von := old.von; new.an := old.an; new.typ := old.typ;
    new.ids := old.ids; new.tour_ids := old.tour_ids;
    -- Ein beantworteter Vorschlag kann nicht wieder „offen“ werden.
    if old.status <> 'offen' and new.status = 'offen' then
      new.status := old.status;
      new.daten := jsonb_set(new.daten, '{status}', to_jsonb(old.status));
    end if;
    if new.status = 'angenommen' and old.status is distinct from 'angenommen' then
      new.beantwortet_am := now();
    else
      new.beantwortet_am := old.beantwortet_am;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists vorbereiten on public.vorschlaege;
create trigger vorbereiten before insert or update on public.vorschlaege
  for each row execute function public.vorschlag_vorbereiten();

-- Freigabe durch einen Vorschlag an meinen Standort (offen oder gerade angenommen)
create or replace function public.vs_freigabe_auftrag(p_id text, p_daten jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vorschlaege v
     where v.an = public.mein_standort()
       and (v.status = 'offen'
            or (v.status = 'angenommen' and v.beantwortet_am > now() - interval '15 minutes'))
       and (   (v.typ = 'auftrag' and v.ids @> to_jsonb(public.nummer(p_id)))
            or (v.typ = 'tour' and public.nummer(p_daten->>'tourId') is not null
                and v.ids @> to_jsonb(public.nummer(p_daten->>'tourId'))))
  )
$$;

create or replace function public.vs_freigabe_tour(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vorschlaege v
     where v.an = public.mein_standort()
       and (v.status = 'offen'
            or (v.status = 'angenommen' and v.beantwortet_am > now() - interval '15 minutes'))
       and (   (v.typ = 'tour'    and v.ids      @> to_jsonb(public.nummer(p_id)))
            or (v.typ = 'auftrag' and v.tour_ids @> to_jsonb(public.nummer(p_id))))
  )
$$;

-- Sperre holen/verlängern/freigeben (für „gleichzeitiges Bearbeiten“)
create or replace function public.sperre_holen(p_id text, p_holder text, p_ttl_ms integer, p_daten jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if auth.uid() is null then return false; end if;
  insert into public.sperren as s (id, holder, bis, daten, updated_at)
  values (p_id, p_holder, now() + make_interval(secs => greatest(p_ttl_ms, 0) / 1000.0), coalesce(p_daten, '{}'::jsonb), now())
  on conflict (id) do update
    set holder = excluded.holder, bis = excluded.bis, daten = excluded.daten, updated_at = now()
    where s.holder = excluded.holder or s.bis < now()
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- ---------------------------------------------------------------------
-- 4. Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.standorte   enable row level security;
alter table public.profile     enable row level security;
alter table public.fahrzeuge   enable row level security;
alter table public.baustellen  enable row level security;
alter table public.auftraege   enable row level security;
alter table public.touren      enable row level security;
alter table public.vorschlaege enable row level security;
alter table public.sperren     enable row level security;

-- Nicht angemeldete Besucher bekommen gar nichts.
revoke all on public.standorte, public.profile, public.fahrzeuge, public.baustellen,
              public.auftraege, public.touren, public.vorschlaege, public.sperren from anon;

grant select on public.standorte to authenticated;
grant select on public.profile to authenticated;
revoke update on public.profile from authenticated;
grant update (name, nur_mein_standort) on public.profile to authenticated;
grant select, insert, update, delete on public.fahrzeuge, public.baustellen,
      public.auftraege, public.touren, public.vorschlaege to authenticated;
revoke insert, update, delete on public.sperren from authenticated;
grant select on public.sperren to authenticated;
grant execute on function public.sperre_holen(text, text, integer, jsonb) to authenticated;
revoke execute on function public.sperre_holen(text, text, integer, jsonb) from anon, public;

-- Standorte: alle Angemeldeten dürfen lesen
drop policy if exists lesen on public.standorte;
create policy lesen on public.standorte for select to authenticated using (true);

-- Profile: Namen der Kollegen lesen; nur das eigene Profil (Name, Schalter) ändern
drop policy if exists lesen on public.profile;
create policy lesen on public.profile for select to authenticated using (true);
drop policy if exists eigenes_aendern on public.profile;
create policy eigenes_aendern on public.profile for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Fahrzeuge
drop policy if exists lesen on public.fahrzeuge;
create policy lesen on public.fahrzeuge for select to authenticated using (public.darf(sto));
drop policy if exists anlegen on public.fahrzeuge;
create policy anlegen on public.fahrzeuge for insert to authenticated with check (public.darf(sto));
drop policy if exists aendern on public.fahrzeuge;
create policy aendern on public.fahrzeuge for update to authenticated
  using (public.darf(sto)) with check (public.darf(sto));
drop policy if exists loeschen on public.fahrzeuge;
create policy loeschen on public.fahrzeuge for delete to authenticated using (public.darf(sto));

-- Baustellen: eigener Standort, oder die Baustelle gehört zu einem Auftrag, den ich sehe
drop policy if exists lesen on public.baustellen;
create policy lesen on public.baustellen for select to authenticated using (
  public.darf(sto)
  or exists (select 1 from public.auftraege a where a.daten->>'bsId' = baustellen.id)
);
drop policy if exists anlegen on public.baustellen;
create policy anlegen on public.baustellen for insert to authenticated
  with check (public.ist_zentrale() or sto is null or sto = public.mein_standort());
drop policy if exists aendern on public.baustellen;
create policy aendern on public.baustellen for update to authenticated
  using (public.darf(sto) or (sto is null and public.ist_zentrale()))
  with check (public.darf(sto) or (sto is null and public.ist_zentrale()));
drop policy if exists loeschen on public.baustellen;
create policy loeschen on public.baustellen for delete to authenticated
  using (public.darf(sto) or (sto is null and public.ist_zentrale()));

-- Aufträge: zuständiger Standort oder Ursprungsstandort, plus Vorschlags-Freigabe
drop policy if exists lesen on public.auftraege;
create policy lesen on public.auftraege for select to authenticated using (
  public.darf(sto) or public.darf(ursprung) or public.vs_freigabe_auftrag(id, daten)
);
drop policy if exists anlegen on public.auftraege;
-- (Upsert prüft auch die Anlege-Regel, deshalb gilt die Vorschlags-Freigabe hier ebenfalls)
create policy anlegen on public.auftraege for insert to authenticated
  with check (public.darf(sto) or public.vs_freigabe_auftrag(id, daten));
drop policy if exists aendern on public.auftraege;
create policy aendern on public.auftraege for update to authenticated
  using (public.darf(sto) or public.darf(ursprung) or public.vs_freigabe_auftrag(id, daten))
  with check (public.darf(sto) or public.darf(ursprung) or public.vs_freigabe_auftrag(id, daten));
drop policy if exists loeschen on public.auftraege;
create policy loeschen on public.auftraege for delete to authenticated using (public.darf(sto));

-- Touren
drop policy if exists lesen on public.touren;
create policy lesen on public.touren for select to authenticated using (
  public.darf(sto) or public.vs_freigabe_tour(id)
);
drop policy if exists anlegen on public.touren;
create policy anlegen on public.touren for insert to authenticated
  with check (public.darf(sto) or public.vs_freigabe_tour(id));
drop policy if exists aendern on public.touren;
create policy aendern on public.touren for update to authenticated
  using (public.darf(sto) or public.vs_freigabe_tour(id))
  with check (public.darf(sto) or public.vs_freigabe_tour(id));
drop policy if exists loeschen on public.touren;
create policy loeschen on public.touren for delete to authenticated using (public.darf(sto));

-- Vorschläge: Absender und Empfänger
drop policy if exists lesen on public.vorschlaege;
create policy lesen on public.vorschlaege for select to authenticated using (
  public.ist_zentrale() or von = public.mein_standort() or an = public.mein_standort()
);
drop policy if exists anlegen on public.vorschlaege;
create policy anlegen on public.vorschlaege for insert to authenticated with check (
  public.ist_zentrale() or von = public.mein_standort()
);
drop policy if exists aendern on public.vorschlaege;
create policy aendern on public.vorschlaege for update to authenticated
  using (public.ist_zentrale() or von = public.mein_standort() or an = public.mein_standort())
  with check (public.ist_zentrale() or von = public.mein_standort() or an = public.mein_standort());
drop policy if exists loeschen on public.vorschlaege;
create policy loeschen on public.vorschlaege for delete to authenticated using (
  public.ist_zentrale() or von = public.mein_standort()
);

-- Sperren: alle Angemeldeten dürfen sehen, wer gerade bearbeitet (schreiben nur über sperre_holen)
drop policy if exists lesen on public.sperren;
create policy lesen on public.sperren for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 5. Live-Aktualisierung (andere Nutzer sehen Änderungen sofort)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fahrzeuge','baustellen','auftraege','touren','vorschlaege','sperren'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Lieferschein-Dateien (privater Speicher, ein Ordner pro Standort)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lieferscheine', 'lieferscheine', false, 20971520,
        array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;

-- Hochladen: nur in den Ordner des eigenen Standorts (Zentrale: Ordner „zentrale“ oder beliebig)
drop policy if exists "lieferscheine hochladen" on storage.objects;
create policy "lieferscheine hochladen" on storage.objects for insert to authenticated with check (
  bucket_id = 'lieferscheine'
  and (public.ist_zentrale() or (storage.foldername(name))[1] = public.mein_standort())
);

-- Ansehen: eigener Ordner, Zentrale, oder die Datei hängt an einem Auftrag/einer Tour, die ich sehe
drop policy if exists "lieferscheine ansehen" on storage.objects;
create policy "lieferscheine ansehen" on storage.objects for select to authenticated using (
  bucket_id = 'lieferscheine'
  and (
    public.ist_zentrale()
    or (storage.foldername(name))[1] = public.mein_standort()
    or exists (select 1 from public.auftraege a where a.daten->'doc'->>'asset' = objects.name)
    or exists (select 1 from public.touren t
                where t.daten @> jsonb_build_object('docs', jsonb_build_array(jsonb_build_object('asset', objects.name)))
                   or t.daten @> jsonb_build_object('stops', jsonb_build_array(
                        jsonb_build_object('doc', jsonb_build_object('asset', objects.name)))))
  )
);

-- Löschen: nur die Zentrale (Regel: keine Daten verlieren)
drop policy if exists "lieferscheine loeschen" on storage.objects;
create policy "lieferscheine loeschen" on storage.objects for delete to authenticated using (
  bucket_id = 'lieferscheine' and public.ist_zentrale()
);
