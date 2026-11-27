-- =====================================================================
-- Test der Zugriffsregeln (Row Level Security)
-- =====================================================================
-- Prüft automatisch: Moers sieht nur Moers, Goch nur Goch, die Zentrale alles,
-- Vorschläge funktionieren, Sperren funktionieren, Dateien sind geschützt.
--
-- Kann auch in Supabase (SQL Editor) ausgeführt werden, NACH schema.sql.
-- Alles läuft in einer Transaktion und wird am Ende zurückgerollt:
-- Es bleiben keine Testdaten zurück.
-- Ergebnis: Am Ende steht „ALLE TESTS BESTANDEN“. Bei einem Fehler bricht
-- das Skript mit einer Meldung „TEST FEHLGESCHLAGEN: …“ ab.
-- =====================================================================
begin;

create schema test;
grant usage on schema test to authenticated, anon;

create function test.ok(bedingung boolean, was text) returns void language plpgsql as $$
begin
  if bedingung is distinct from true then raise exception 'TEST FEHLGESCHLAGEN: %', was; end if;
  raise notice 'ok – %', was;
end $$;

-- erwartet, dass ein Befehl abgelehnt wird (Fehler oder 0 betroffene Zeilen)
create function test.verboten(befehl text, was text) returns void language plpgsql as $$
declare n integer;
begin
  begin
    execute befehl;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'ok – % (abgelehnt: %)', was, sqlerrm;
    return;
  end;
  if n = 0 then raise notice 'ok – % (keine Zeile betroffen)', was; return; end if;
  raise exception 'TEST FEHLGESCHLAGEN: % wurde erlaubt', was;
end $$;

grant execute on all functions in schema test to authenticated, anon;

create function test.als(nutzer uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', nutzer, 'role', 'authenticated')::text, true);
end $$;
grant execute on function test.als(uuid) to authenticated, anon;

-- Testnutzer
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'zentrale@test.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'moers@test.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'goch@test.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'neu@test.invalid');
update public.profile set rolle = 'zentrale' where id = '00000000-0000-0000-0000-00000000000a';
update public.profile set standort = 'moe'   where id = '00000000-0000-0000-0000-00000000000b';
update public.profile set standort = 'goc'   where id = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.profile where id::text like '00000000-0000-0000-0000-00000000000%') = 4,
               'Profile werden für neue Nutzer automatisch angelegt');

-- ---------------- Moers legt Daten an ----------------
set local role authenticated;
select test.als('00000000-0000-0000-0000-00000000000b');
insert into public.fahrzeuge (id, daten) values ('moe0', '{"sto":"moe","bez":"LKW Moers"}');
select test.verboten($$insert into public.fahrzeuge (id, daten) values ('x1', '{"sto":"goc"}')$$,
                     'Moers darf kein Fahrzeug für Goch anlegen');
insert into public.baustellen (id, daten) values ('b1', '{"name":"Baustelle Moers","notiz":"Tor 2"}');
insert into public.auftraege (id, daten) values
  ('o1', '{"id":1,"sto":"moe","ursprung":"moe","kunde":"Kunde A","bsId":"b1"}'),
  ('o2', '{"id":2,"sto":"moe","ursprung":"moe","kunde":"Kunde B","tourId":5,"doc":{"asset":"moe/y.pdf"}}'),
  ('o3', '{"id":3,"sto":"moe","ursprung":"moe","kunde":"Kunde C","tourId":6}');
insert into public.touren (id, daten) values
  ('t5', '{"num":5,"sto":"moe","stops":[{"auftragId":2}],"docs":[{"asset":"moe/x.pdf"}]}'),
  ('t6', '{"num":6,"sto":"moe","stops":[{"auftragId":3}]}');
insert into storage.objects (bucket_id, name) values ('lieferscheine', 'moe/x.pdf'), ('lieferscheine', 'moe/y.pdf');
select test.verboten($$insert into storage.objects (bucket_id, name) values ('lieferscheine', 'goc/z.pdf')$$,
                     'Moers darf nicht in den Ordner von Goch hochladen');
select test.ok((select sto from public.baustellen where id = 'b1') = 'moe', 'Baustelle gehört automatisch zu Moers');
select test.ok((select count(*) from public.auftraege) = 3, 'Moers sieht seine 3 Aufträge');

-- ---------------- Goch ----------------
select test.als('00000000-0000-0000-0000-00000000000c');
insert into public.fahrzeuge (id, daten) values ('goc0', '{"sto":"goc","bez":"LKW Goch 1"}');
select test.ok((select count(*) from public.fahrzeuge) = 1, 'Goch sieht nur sein eigenes Fahrzeug');
select test.ok((select count(*) from public.auftraege) = 0, 'Goch sieht keine Aufträge von Moers');
select test.ok((select count(*) from public.touren) = 0, 'Goch sieht keine Touren von Moers');
select test.ok((select count(*) from public.baustellen) = 0, 'Goch sieht keine Baustellen von Moers');
select test.ok((select count(*) from storage.objects) = 0, 'Goch sieht keine Lieferschein-Dateien von Moers');
select test.verboten($$update public.auftraege set daten = daten || '{"kunde":"X"}' where id = 'o1'$$,
                     'Goch darf Aufträge von Moers nicht ändern');
select test.verboten($$insert into public.auftraege (id, daten) values ('o1', '{"id":1,"sto":"goc"}')
                       on conflict (id) do update set daten = excluded.daten$$,
                     'Goch darf Aufträge von Moers nicht per Upsert übernehmen');
select test.verboten($$delete from public.fahrzeuge where id = 'moe0'$$, 'Goch darf Fahrzeuge von Moers nicht löschen');
select test.verboten($$update public.profile set standort = 'moe' where id = auth.uid()$$,
                     'Niemand darf seinen eigenen Standort ändern');
update public.profile set nur_mein_standort = true where id = auth.uid();
select test.ok((select nur_mein_standort from public.profile where id = auth.uid()), 'Schalter „Nur mein Standort“ ist speicherbar');

-- ---------------- Neuer Nutzer ohne Standort ----------------
select test.als('00000000-0000-0000-0000-00000000000d');
select test.ok((select count(*) from public.fahrzeuge) = 0, 'Nutzer ohne Standort sieht nichts');
select test.verboten($$insert into public.fahrzeuge (id, daten) values ('n1', '{"sto":"moe"}')$$,
                     'Nutzer ohne Standort darf nichts anlegen');

-- ---------------- Zentrale ----------------
select test.als('00000000-0000-0000-0000-00000000000a');
select test.ok((select count(*) from public.fahrzeuge) = 2, 'Zentrale sieht alle Fahrzeuge');
select test.ok((select count(*) from public.auftraege) = 3, 'Zentrale sieht alle Aufträge');
select test.ok((select count(*) from storage.objects) = 2, 'Zentrale sieht alle Dateien');

-- ---------------- Vorschlag: Auftrag 2 von Moers an Goch ----------------
select test.als('00000000-0000-0000-0000-00000000000b');
select test.verboten($$insert into public.vorschlaege (id, daten) values ('vx', '{"type":"auftrag","ids":[1],"from":"goc","to":"moe"}')$$,
                     'Moers darf keinen Vorschlag im Namen von Goch anlegen');
insert into public.vorschlaege (id, daten) values ('v1', '{"type":"auftrag","ids":[2],"from":"moe","to":"goc","status":"offen"}');
select test.ok((select tour_ids from public.vorschlaege where id = 'v1') = '[5]'::jsonb, 'Vorschlag merkt sich die Tour des Auftrags');

select test.als('00000000-0000-0000-0000-00000000000c');
select test.ok((select count(*) from public.vorschlaege) = 1, 'Goch sieht den Vorschlag');
select test.ok((select count(*) from public.auftraege where id = 'o2') = 1, 'Goch sieht den vorgeschlagenen Auftrag');
select test.ok((select count(*) from public.auftraege where id = 'o1') = 0, 'Goch sieht andere Aufträge weiterhin nicht');
select test.ok((select count(*) from public.touren where id = 't5') = 1, 'Goch sieht die Tour, aus der der Auftrag kommt');
-- Annahme so, wie das Programm sie speichert (Upsert der ganzen Dokumente)
insert into public.touren (id, daten) values ('t5', '{"num":5,"sto":"moe","stops":[],"docs":[{"asset":"moe/x.pdf"}]}')
  on conflict (id) do update set daten = excluded.daten;
insert into public.auftraege (id, daten) values ('o2', '{"id":2,"sto":"goc","ursprung":"moe","kunde":"Kunde B","tourId":null,"doc":{"asset":"moe/y.pdf"}}')
  on conflict (id) do update set daten = excluded.daten;
-- Vorschläge werden (wie im Programm) per Update beantwortet
update public.vorschlaege set daten = '{"type":"auftrag","ids":[2],"from":"moe","to":"goc","status":"angenommen"}' where id = 'v1';
select test.verboten($$insert into public.vorschlaege (id, daten) values ('vy', '{"type":"auftrag","ids":[1],"from":"moe","to":"goc"}')$$,
                     'Goch kann sich keinen Vorschlag von Moers selbst ausstellen');
select test.ok((select sto from public.auftraege where id = 'o2') = 'goc', 'Auftrag 2 ist jetzt bei Goch');
select test.ok((select count(*) from storage.objects where name = 'moe/y.pdf') = 1, 'Goch sieht den Lieferschein des übernommenen Auftrags');
select test.ok((select count(*) from storage.objects where name = 'moe/x.pdf') = 1, 'Goch sieht kurz nach der Annahme noch die Tour-Datei');
-- Wiederöffnen eines beantworteten Vorschlags ist nicht möglich
update public.vorschlaege set daten = '{"type":"auftrag","ids":[2],"from":"moe","to":"goc","status":"offen"}' where id = 'v1';
select test.ok((select status from public.vorschlaege where id = 'v1') = 'angenommen', 'Beantworteter Vorschlag bleibt beantwortet');

select test.als('00000000-0000-0000-0000-00000000000b');
select test.ok((select count(*) from public.auftraege where id = 'o2') = 1, 'Moers sieht den abgegebenen Auftrag weiter (Ursprung)');

-- 15 Minuten später: Freigabe erlischt
reset role;
alter table public.vorschlaege disable trigger vorbereiten; -- Zeit „vorspulen“ ohne Trigger
update public.vorschlaege set beantwortet_am = now() - interval '16 minutes' where id = 'v1';
alter table public.vorschlaege enable trigger vorbereiten;
set local role authenticated;
select test.als('00000000-0000-0000-0000-00000000000c');
select test.ok((select count(*) from public.touren where id = 't5') = 0, 'Nach 15 Minuten sieht Goch die Tour von Moers nicht mehr');
select test.ok((select count(*) from public.auftraege where id = 'o2') = 1, 'Goch behält den übernommenen Auftrag');
select test.verboten($$update public.touren set daten = daten where id = 't5'$$, 'Goch darf die Tour von Moers danach nicht mehr ändern');

-- ---------------- Vorschlag: ganze Tour 6 ----------------
select test.als('00000000-0000-0000-0000-00000000000b');
insert into public.vorschlaege (id, daten) values ('v2', '{"type":"tour","ids":[6],"from":"moe","to":"goc","status":"offen"}');
select test.als('00000000-0000-0000-0000-00000000000c');
select test.ok((select count(*) from public.touren where id = 't6') = 1, 'Goch sieht die vorgeschlagene Tour');
select test.ok((select count(*) from public.auftraege where id = 'o3') = 1, 'Goch sieht die Aufträge der vorgeschlagenen Tour');
insert into public.touren (id, daten) values ('t6', '{"num":6,"sto":"goc","lkw":"goc0","stops":[{"auftragId":3}]}')
  on conflict (id) do update set daten = excluded.daten;
insert into public.auftraege (id, daten) values ('o3', '{"id":3,"sto":"goc","ursprung":"moe","tourId":6}')
  on conflict (id) do update set daten = excluded.daten;
update public.vorschlaege set daten = '{"type":"tour","ids":[6],"from":"moe","to":"goc","status":"angenommen"}' where id = 'v2';
select test.ok((select sto from public.touren where id = 't6') = 'goc', 'Tour 6 gehört jetzt Goch');

-- ---------------- Sperren ----------------
select test.als('00000000-0000-0000-0000-00000000000b');
select test.ok(public.sperre_holen('o1', 'moers', 90000, '{"by":"moers"}'), 'Moers bekommt die Sperre');
select test.als('00000000-0000-0000-0000-00000000000c');
select test.ok(not public.sperre_holen('o1', 'goch', 90000, '{"by":"goch"}'), 'Goch bekommt die Sperre nicht, solange Moers bearbeitet');
select test.ok((select count(*) from public.sperren where id = 'o1') = 1, 'Goch sieht, dass gerade jemand bearbeitet');
select test.verboten($$delete from public.sperren$$, 'Sperren können nicht direkt gelöscht werden');
select test.als('00000000-0000-0000-0000-00000000000b');
select test.ok(public.sperre_holen('o1', 'moers', 90000, '{"by":"moers"}'), 'Moers kann die Sperre verlängern');
reset role;
update public.sperren set bis = now() - interval '1 second' where id = 'o1';
set local role authenticated;
select test.als('00000000-0000-0000-0000-00000000000c');
select test.ok(public.sperre_holen('o1', 'goch', 90000, '{"by":"goch"}'), 'Nach Ablauf bekommt Goch die Sperre');

-- ---------------- Nicht angemeldet ----------------
reset role;
set local role anon;
select test.als(null);
select test.verboten($$select * from public.auftraege$$, 'Nicht angemeldete Besucher sehen keine Aufträge');
select test.verboten($$select public.sperre_holen('o1', 'x', 1000, '{}')$$, 'Nicht angemeldete Besucher können nichts sperren');

reset role;
select 'ALLE TESTS BESTANDEN' as ergebnis;
rollback;
