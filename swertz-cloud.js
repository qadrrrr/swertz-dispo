/* =====================================================================
   Swertz Dispo – Anbindung an Supabase („Cloud-Brücke“)
   =====================================================================
   Das Programm (index.html) wurde als Claude-Artefakt gebaut und spricht mit
   den Schnittstellen window.claude.use("db" | "user" | "assets" | "sample" | "mcp").
   Diese Datei stellt genau dieselben Schnittstellen bereit – nur mit Supabase
   dahinter. Dadurch bleibt die gesamte Programmlogik unverändert.

   Verhalten:
   * Läuft die Seite in Claude (window.claude vorhanden) → diese Datei tut nichts.
   * Ist cloud-config.js nicht ausgefüllt → diese Datei tut nichts
     (Programm speichert wie bisher nur auf dem Gerät).
   * Sonst: Anmeldung mit E-Mail und Passwort, danach sieht jeder Nutzer nur
     die Daten seines Standorts (wird in der Datenbank erzwungen).
   ===================================================================== */
(function () {
  "use strict";
  var CFG = window.SWERTZ_CLOUD_CONFIG || {};
  if (window.claude) return;                       // in Claude: nichts ändern
  if (!CFG.url || !CFG.anonKey) return;            // noch nicht eingerichtet

  var BUCKET = "lieferscheine";
  var MAX_DATEI = 20 * 1024 * 1024;
  var K_BLEIBEN = "sw_cloud_bleiben";              // "0" = nur bis zum Schließen
  var K_PROFIL = "sw_cloud_prof";                  // zuletzt bekanntes Profil (für schnellen Start)
  var K_AUTH = "sw-dispo-auth";                    // Supabase-Sitzung

  /* ---------- kleine Helfer ---------- */
  function lsGet(st, k) { try { return st.getItem(k); } catch (e) { return null; } }
  function lsSet(st, k, v) { try { st.setItem(k, v); } catch (e) {} }
  function lsDel(st, k) { try { st.removeItem(k); } catch (e) {} }
  function jsonGet(st, k) { try { return JSON.parse(lsGet(st, k) || "null"); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fehler(code, message, extra) { var e = new Error(message || code); e.code = code; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
  function nieFertig() { return new Promise(function () {}); }
  function sauber(x) { return JSON.parse(JSON.stringify(x === undefined ? null : x)); }

  var bleiben = lsGet(localStorage, K_BLEIBEN) !== "0";
  var authSpeicher = bleiben ? localStorage : sessionStorage;

  // Einladungs- oder „Passwort vergessen“-Link? (vor dem Start von supabase-js merken)
  var linkTyp = (/[#&?]type=(invite|recovery)/.exec(location.hash + location.search) || [])[1] || null;

  /* ---------- Anmeldemaske (eigene Oberfläche, Apple-Stil) ---------- */
  var CSS =
    "#swc{position:fixed;inset:0;z-index:2147483000;background:rgba(245,246,248,.92);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#202124}" +
    "#swc .k{background:#fff;border:1px solid #E8EAED;border-radius:22px;box-shadow:0 20px 60px rgba(32,33,36,.12);width:100%;max-width:440px;padding:32px 28px}" +
    "#swc .t{display:inline-block;font-weight:800;letter-spacing:.12em;font-size:13px;color:#2878E5;background:#EAF2FD;border-radius:8px;padding:5px 10px}" +
    "#swc h2{font-size:28px;margin:16px 0 6px;font-weight:700}" +
    "#swc p{font-size:17px;line-height:1.5;color:#737780;margin:0 0 18px}" +
    "#swc label{display:block;font-size:17px;font-weight:600;margin:14px 0 6px}" +
    "#swc input[type=email],#swc input[type=password]{width:100%;box-sizing:border-box;font:inherit;font-size:19px;padding:14px 16px;border:1px solid #E8EAED;border-radius:14px;background:#F5F6F8;color:#202124}" +
    "#swc input:focus{outline:3px solid rgba(40,120,229,.35);border-color:#2878E5;background:#fff}" +
    "#swc .cb{display:flex;align-items:center;gap:12px;font-weight:400;cursor:pointer;margin-top:18px}" +
    "#swc .cb input{width:24px;height:24px;accent-color:#2878E5}" +
    "#swc button{width:100%;min-height:56px;margin-top:22px;border:0;border-radius:14px;background:#2878E5;color:#fff;font:inherit;font-size:19px;font-weight:700;cursor:pointer}" +
    "#swc button:disabled{opacity:.6;cursor:wait}" +
    "#swc button.l{background:transparent;color:#2878E5;min-height:48px;margin-top:8px;font-weight:600}" +
    "#swc .m{min-height:24px;margin-top:14px;font-size:16px;line-height:1.45;color:#C5221F}" +
    "#swc .m.ok{color:#188038}";

  function maske(html) {
    var alt = document.getElementById("swc");
    if (alt) alt.remove();
    if (!document.getElementById("swcCss")) {
      var st = document.createElement("style"); st.id = "swcCss"; st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    var d = document.createElement("div");
    d.id = "swc"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = '<div class="k"><span class="t">SWERTZ</span>' + html + "</div>";
    var dazu = function () { document.body.appendChild(d); var f = d.querySelector("input"); if (f) f.focus(); };
    if (document.body) dazu(); else document.addEventListener("DOMContentLoaded", dazu);
    return d;
  }
  function meldung(d, text, ok) { var m = d.querySelector(".m"); if (m) { m.textContent = text || ""; m.className = "m" + (ok ? " ok" : ""); } }

  /* ---------- Supabase starten ---------- */
  if (!window.supabase || !window.supabase.createClient) {
    maske("<h2>Keine Verbindung</h2><p>Die Verbindung zur Datenbank konnte nicht geladen werden. Bitte Internetverbindung prüfen und die Seite neu laden.</p>" +
          '<button onclick="location.reload()">Neu laden</button>');
    window.claude = { use: function () { return nieFertig(); } };
    return;
  }
  function neuerClient(speicher) {
    return window.supabase.createClient(CFG.url, CFG.anonKey, {
      auth: { storage: speicher, storageKey: K_AUTH, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  var sb = neuerClient(authSpeicher);

  /* ---------- Schnellstart: Standort sofort setzen, damit das Programm ohne Umweg startet ---------- */
  var gemerkt = jsonGet(localStorage, K_PROFIL);
  function standortVorbelegen(p) {
    // Das Programm liest beim Start „sw_login“ (localStorage = angemeldet bleiben, sessionStorage = nur Sitzung).
    var v = JSON.stringify({ sto: p.sto, only: !!p.only });
    if (bleiben) { lsSet(localStorage, "sw_login", v); lsDel(sessionStorage, "sw_login"); }
    else { lsSet(sessionStorage, "sw_login", v); lsDel(localStorage, "sw_login"); }
  }
  function standortVergessen() { lsDel(localStorage, "sw_login"); lsDel(sessionStorage, "sw_login"); }
  if (lsGet(authSpeicher, K_AUTH) && gemerkt && gemerkt.sto) standortVorbelegen(gemerkt);
  else standortVergessen();

  /* ---------- Anmelden ---------- */
  function anmeldeMaske() {
    var d = maske(
      '<h2>Anmelden</h2><p>Swertz Dispo – bitte mit Ihrer E-Mail-Adresse und Ihrem Passwort anmelden.</p>' +
      '<form id="swcF" novalidate>' +
      '<label for="swcE">E-Mail-Adresse</label><input id="swcE" type="email" autocomplete="username" required>' +
      '<label for="swcP">Passwort</label><input id="swcP" type="password" autocomplete="current-password" required>' +
      '<label class="cb"><input id="swcB" type="checkbox"' + (bleiben ? " checked" : "") + '> Angemeldet bleiben</label>' +
      '<button type="submit" id="swcG">Anmelden</button>' +
      '<button type="button" class="l" id="swcV">Passwort vergessen?</button>' +
      '<div class="m" aria-live="polite"></div></form>');
    d.querySelector("#swcF").onsubmit = function (ev) {
      ev.preventDefault();
      var mail = d.querySelector("#swcE").value.trim(), pw = d.querySelector("#swcP").value;
      var bl = d.querySelector("#swcB").checked;
      if (!mail || !pw) { meldung(d, "Bitte E-Mail-Adresse und Passwort eingeben."); return; }
      var knopf = d.querySelector("#swcG"); knopf.disabled = true; knopf.textContent = "Wird angemeldet …"; meldung(d, "");
      lsSet(localStorage, K_BLEIBEN, bl ? "1" : "0");
      // Sitzung im richtigen Speicher anlegen (angemeldet bleiben oder nur bis zum Schließen)
      lsDel(localStorage, K_AUTH); lsDel(sessionStorage, K_AUTH);
      var c = neuerClient(bl ? localStorage : sessionStorage);
      c.auth.signInWithPassword({ email: mail, password: pw }).then(function (r) {
        if (r.error) {
          knopf.disabled = false; knopf.textContent = "Anmelden";
          var m = String(r.error.message || "");
          meldung(d, /invalid login|invalid credentials/i.test(m) ? "E-Mail-Adresse oder Passwort stimmt nicht."
            : /email not confirmed/i.test(m) ? "Die E-Mail-Adresse ist noch nicht bestätigt. Bitte den Link in der E-Mail anklicken."
            : /fetch|network/i.test(m) ? "Keine Verbindung zum Server. Bitte Internetverbindung prüfen."
            : "Anmeldung fehlgeschlagen: " + m);
          return;
        }
        lsDel(localStorage, K_PROFIL); standortVergessen();
        location.reload();
      });
    };
    d.querySelector("#swcV").onclick = function () {
      var mail = d.querySelector("#swcE").value.trim();
      if (!mail) { meldung(d, "Bitte zuerst oben Ihre E-Mail-Adresse eingeben."); return; }
      sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname }).then(function (r) {
        meldung(d, r.error ? "Das hat nicht geklappt: " + r.error.message
          : "Falls die Adresse bekannt ist, kommt gleich eine E-Mail mit einem Link zum neuen Passwort.", !r.error);
      });
    };
  }

  function passwortMaske(einladung) {
    return new Promise(function (fertig) {
      var d = maske(
        "<h2>" + (einladung ? "Willkommen!" : "Neues Passwort") + "</h2><p>Bitte legen Sie Ihr " + (einladung ? "" : "neues ") +
        "Passwort fest (mindestens 10 Zeichen).</p><form id=\"swcF\" novalidate>" +
        '<label for="swcP">Neues Passwort</label><input id="swcP" type="password" autocomplete="new-password">' +
        '<label for="swcQ">Passwort wiederholen</label><input id="swcQ" type="password" autocomplete="new-password">' +
        '<button type="submit" id="swcG">Passwort speichern</button><div class="m" aria-live="polite"></div></form>');
      d.querySelector("#swcF").onsubmit = function (ev) {
        ev.preventDefault();
        var a = d.querySelector("#swcP").value, b = d.querySelector("#swcQ").value;
        if (a.length < 10) { meldung(d, "Das Passwort braucht mindestens 10 Zeichen."); return; }
        if (a !== b) { meldung(d, "Die beiden Passwörter sind nicht gleich."); return; }
        var k = d.querySelector("#swcG"); k.disabled = true;
        sb.auth.updateUser({ password: a }).then(function (r) {
          if (r.error) { k.disabled = false; meldung(d, "Das hat nicht geklappt: " + r.error.message); return; }
          try { history.replaceState(null, "", location.pathname); } catch (e) {}
          d.remove(); fertig();
        });
      };
    });
  }

  function hinweisMaske(titel, text) {
    var d = maske("<h2>" + esc(titel) + "</h2><p>" + esc(text) + '</p><button id="swcN">Erneut versuchen</button><button class="l" id="swcA">Abmelden</button>');
    d.querySelector("#swcN").onclick = function () { location.reload(); };
    d.querySelector("#swcA").onclick = abmelden;
  }

  function abmelden() {
    var weg = function () {
      lsDel(localStorage, K_PROFIL); standortVergessen();
      lsDel(localStorage, K_AUTH); lsDel(sessionStorage, K_AUTH);
      location.reload();
    };
    sb.auth.signOut().then(weg, weg);
  }

  /* ---------- Sitzung + Profil laden ---------- */
  var ICH = { uid: null, profil: null, sto: null, mail: "" };

  function profilLaden(uid) {
    return sb.from("profile").select("id,name,standort,rolle,nur_mein_standort").eq("id", uid).maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  var bereit = sb.auth.getSession().then(function (r) {
    var s = r.data && r.data.session;
    if (!s) { anmeldeMaske(); return nieFertig(); }
    ICH.uid = s.user.id; ICH.mail = s.user.email || "";
    var weiter = linkTyp ? passwortMaske(linkTyp === "invite") : Promise.resolve();
    return weiter.then(function () { return profilLaden(ICH.uid); }).then(function (p) {
      if (!p || (!p.standort && p.rolle !== "zentrale")) {
        hinweisMaske("Noch kein Standort", "Ihr Zugang (" + ICH.mail + ") ist noch keinem Standort zugeordnet. Bitte wenden Sie sich an die Zentrale.");
        return nieFertig();
      }
      ICH.profil = p;
      ICH.sto = p.rolle === "zentrale" ? "all" : p.standort;
      var neu = { uid: ICH.uid, sto: ICH.sto, only: !!p.nur_mein_standort, name: p.name || "" };
      if (!gemerkt || gemerkt.uid !== neu.uid || gemerkt.sto !== neu.sto) {
        // Erster Start oder Standort geändert: Programm einmal sauber neu starten
        lsSet(localStorage, K_PROFIL, JSON.stringify(neu));
        standortVorbelegen(neu);
        location.reload();
        return nieFertig();
      }
      lsSet(localStorage, K_PROFIL, JSON.stringify(neu));
      return ICH;
    }, function (e) {
      // Offline: mit dem zuletzt bekannten Profil weiterarbeiten
      if (gemerkt && gemerkt.uid === ICH.uid && gemerkt.sto) {
        ICH.sto = gemerkt.sto;
        ICH.profil = { id: ICH.uid, name: gemerkt.name || "", standort: gemerkt.sto === "all" ? null : gemerkt.sto, rolle: gemerkt.sto === "all" ? "zentrale" : "standort", nur_mein_standort: !!gemerkt.only };
        return ICH;
      }
      hinweisMaske("Keine Verbindung", "Die Datenbank ist gerade nicht erreichbar (" + (e && e.message || "unbekannter Fehler") + ").");
      return nieFertig();
    });
  }, function () { anmeldeMaske(); return nieFertig(); });

  // Sitzung abgelaufen oder anderswo abgemeldet → Anmeldemaske
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "SIGNED_OUT" && ICH.uid) { lsDel(localStorage, K_PROFIL); standortVergessen(); anmeldeMaske(); }
    if (ev === "PASSWORD_RECOVERY" && !linkTyp) passwortMaske(false);
  });

  /* ---------- Fehler aus der Datenbank in die Sprache des Programms übersetzen ---------- */
  function dbFehler(e) {
    var m = String((e && (e.message || e.details)) || "");
    if (e && (e.code === "42501" || e.code === "23505" || /row-level security|permission denied/i.test(m))) {
      return fehler("invalid_argument", "Keine Schreibrechte für diesen Eintrag.");
    }
    if (/fetch|network|Failed to/i.test(m)) return fehler("unavailable", "Keine Verbindung zur Datenbank.", { retryable: true });
    return fehler("db_error", m || "Speichern fehlgeschlagen.");
  }

  /* ---------- Datenbank im Stil des bisherigen Claude-Speichers ---------- */
  var TABELLEN = { fahrzeuge: 1, baustellen: 1, auftraege: 1, touren: 1, vorschlaege: 1, sperren: 1 };

  function alleZeilen(tab) {
    var seite = 1000, alle = [];
    function holen(ab) {
      return sb.from(tab).select("id,daten").order("id").range(ab, ab + seite - 1).then(function (r) {
        if (r.error) throw r.error;
        alle = alle.concat(r.data || []);
        return (r.data || []).length === seite ? holen(ab + seite) : alle;
      });
    }
    return holen(0);
  }

  function schnappschuss(zeilen) {
    var docs = [];
    zeilen.forEach(function (z) {
      docs.push({ id: z.id, exists: true, data: function () { return sauber(z.daten || {}); } });
    });
    return { docs: docs, empty: docs.length === 0, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  function dokument(tab, id) {
    if (!TABELLEN[tab]) throw fehler("invalid_argument", "Unbekannte Sammlung: " + tab);
    return {
      id: id,
      get: function () {
        return sb.from(tab).select("id,daten").eq("id", id).maybeSingle().then(function (r) {
          if (r.error) throw dbFehler(r.error);
          var d = r.data;
          return { id: id, exists: !!d, data: function () { return d ? sauber(d.daten) : undefined; } };
        });
      },
      set: function (body) {
        if (tab === "sperren") return Promise.reject(fehler("invalid_argument", "Sperren nur über acquire."));
        var daten = sauber(body);
        // Erst ändern; gibt es den Eintrag noch nicht, neu anlegen.
        return sb.from(tab).update({ daten: daten }).eq("id", id).select("id").then(function (r) {
          if (r.error) throw dbFehler(r.error);
          if (r.data && r.data.length) return;
          return sb.from(tab).insert({ id: id, daten: daten }).then(function (r2) { if (r2.error) throw dbFehler(r2.error); });
        });
      },
      delete: function () {
        return sb.from(tab).delete().eq("id", id).then(function (r) { if (r.error) throw dbFehler(r.error); });
      },
      acquire: function (o) {
        o = o || {};
        return sb.rpc("sperre_holen", { p_id: id, p_holder: String(o.holder || ICH.uid), p_ttl_ms: Math.max(0, Math.round(+o.ttlMs || 0)), p_daten: sauber(o.data || {}) })
          .then(function (r) { if (r.error) throw dbFehler(r.error); return { acquired: r.data === true }; });
      }
    };
  }

  var kanalNr = 0;
  function beobachten(tab, weiter, fehlerFn) {
    if (!TABELLEN[tab]) { if (fehlerFn) fehlerFn(fehler("invalid_argument", "Unbekannte Sammlung: " + tab)); return function () {}; }
    var zeilen = new Map(), ersterLauf = true, aktiv = true, laeuft = null;
    var melden = function () { if (aktiv) weiter(schnappschuss(Array.from(zeilen.values()))); };
    var neuLaden = function () {
      if (laeuft) return laeuft;
      laeuft = alleZeilen(tab).then(function (alle) {
        zeilen.clear(); alle.forEach(function (z) { zeilen.set(z.id, z); }); ersterLauf = false; melden();
      }, function (e) {
        if (ersterLauf && fehlerFn) fehlerFn(dbFehler(e));
      }).then(function () { laeuft = null; });
      return laeuft;
    };
    var kanal = sb.channel("dispo-" + tab + "-" + (++kanalNr))
      .on("postgres_changes", { event: "*", schema: "public", table: tab }, function (p) {
        if (p.eventType === "DELETE") { if (p.old && p.old.id != null) zeilen.delete(p.old.id); }
        else if (p.new && p.new.id != null) zeilen.set(p.new.id, { id: p.new.id, daten: p.new.daten });
        melden();
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED" && !ersterLauf) neuLaden();       // nach Verbindungsabbruch alles neu holen
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setTimeout(neuLaden, 5000);
      });
    neuLaden();
    // Sicherheitsnetz: regelmäßig und beim Zurückkehren zur Seite vollständig abgleichen
    var uhr = setInterval(neuLaden, 120000);
    var sicht = function () { if (document.visibilityState === "visible") neuLaden(); };
    document.addEventListener("visibilitychange", sicht);
    window.addEventListener("online", neuLaden);
    return function () {
      aktiv = false; clearInterval(uhr);
      document.removeEventListener("visibilitychange", sicht); window.removeEventListener("online", neuLaden);
      sb.removeChannel(kanal);
    };
  }

  // Bisher: data/users/<id>/profile → jetzt Tabelle „profile“ (Standort kommt von der Zentrale, nicht vom Nutzer)
  function profilDokument() {
    return {
      id: "profile",
      get: function () {
        var p = ICH.profil || {};
        return Promise.resolve({ id: "profile", exists: !!ICH.sto, data: function () { return { sto: ICH.sto, only: !!p.nur_mein_standort, at: null }; } });
      },
      set: function (body) {
        var nur = !!(body && body.only);
        if (ICH.profil) ICH.profil.nur_mein_standort = nur;
        var g = jsonGet(localStorage, K_PROFIL); if (g) { g.only = nur; lsSet(localStorage, K_PROFIL, JSON.stringify(g)); }
        return sb.from("profile").update({ nur_mein_standort: nur }).eq("id", ICH.uid).then(function () {});
      },
      delete: function () { return Promise.resolve(); }   // Standort-Zuordnung bleibt in der Datenbank
    };
  }

  var DB = {
    collection: function (pfad) {
      pfad = String(pfad);
      if (/^data\/users\//.test(pfad)) return { doc: function () { return profilDokument(); } };
      return {
        doc: function (id) { return dokument(pfad, String(id)); },
        onSnapshot: function (weiter, fehlerFn) { return beobachten(pfad, weiter, fehlerFn); }
      };
    },
    doc: function (pfad) {
      var t = String(pfad).split("/");
      return dokument(t[0], t.slice(1).join("/"));
    }
  };

  /* ---------- Nutzer ---------- */
  var NUTZER = {
    id: function () { return Promise.resolve(ICH.uid); },
    profiles: function (ids) {
      ids = (ids || []).filter(function (i) { return /^[0-9a-f-]{36}$/i.test(String(i)); });
      if (!ids.length) return Promise.resolve({});
      return sb.from("profile").select("id,name").in("id", ids).then(function (r) {
        if (r.error) throw dbFehler(r.error);
        var aus = {}; (r.data || []).forEach(function (p) { aus[p.id] = { name: p.name || "" }; });
        return aus;
      });
    }
  };

  /* ---------- Lieferschein-Dateien (privater Speicher, Ordner pro Standort) ---------- */
  var ENDUNG = { "application/pdf": "pdf", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/jpeg": "jpg" };
  var DATEIEN = {
    upload: function (blob, opt) {
      var typ = (opt && opt.type) || blob.type || "application/octet-stream";
      if (blob.size > MAX_DATEI) return Promise.reject(fehler("too_large", "Datei zu groß (max. 20 MB)."));
      if (!ENDUNG[typ]) return Promise.reject(fehler("bad_type", "Nur Fotos oder PDFs."));
      var ordner = ICH.sto === "all" ? "zentrale" : ICH.sto;
      var zufall = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      var pfad = ordner + "/" + new Date().toISOString().slice(0, 7) + "/" + zufall + "." + ENDUNG[typ];
      return sb.storage.from(BUCKET).upload(pfad, blob, { contentType: typ, upsert: false }).then(function (r) {
        if (r.error) {
          var m = String(r.error.message || "");
          throw fehler(/exceed|too large|maximum|413/i.test(m) ? "too_large" : "upload_failed", m);
        }
        return { id: pfad, url: "/_blob/" + pfad, sizeBytes: blob.size };
      });
    }
  };

  // Dateien werden im Programm als /_blob/<pfad> angezeigt. Ein kleiner Service Worker
  // (sw-blob.js) holt sie mit der Anmeldung des Nutzers aus dem privaten Speicher.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (ev) {
      if (!ev.data || ev.data.typ !== "sw-token" || !ev.ports || !ev.ports[0]) return;
      sb.auth.getSession().then(function (r) {
        ev.ports[0].postMessage({ token: (r.data && r.data.session && r.data.session.access_token) || null });
      }, function () { ev.ports[0].postMessage({ token: null }); });
    });
    var swUrl = "/sw-blob.js?u=" + encodeURIComponent(CFG.url) + "&k=" + encodeURIComponent(CFG.anonKey) + "&b=" + BUCKET;
    navigator.serviceWorker.register(swUrl, { scope: "/" }).catch(function () {});
  }

  /* ---------- Edge Functions (Scan und TomTom) ---------- */
  function funktion(name, body) {
    return sb.functions.invoke(name, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var ctx = r.error.context;
      var lesen = ctx && typeof ctx.json === "function" ? ctx.json().catch(function () { return null; }) : Promise.resolve(null);
      return lesen.then(function (j) {
        var e = (j && j.error) || {};
        var status = ctx && ctx.status;
        throw fehler(e.code || (status ? "server_unavailable" : "unavailable"),
          e.message || (status ? "Dienst antwortet mit Fehler " + status : "Keine Verbindung zum Server."),
          { retryable: !!e.retryable || status === 503 || !status });
      });
    });
  }

  function alsBase64(blob) {
    return new Promise(function (ok, nein) {
      var r = new FileReader();
      r.onload = function () { ok({ media_type: blob.type || "image/jpeg", data: String(r.result).split(",")[1] || "" }); };
      r.onerror = function () { nein(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function SCAN(eingabe, opt) {
    var bilder = (opt && opt.images) || [];
    return Promise.all(bilder.map(alsBase64)).then(function (imgs) {
      return funktion("scan", { prompt: String(eingabe), images: imgs });
    }).then(function (d) { return { text: (d && d.text) || "" }; });
  }
  SCAN.limits = function () { return Promise.resolve({ images: true }); };

  var MCP = {
    callTool: function (server, werkzeug, eingabe) {
      if (!/tomtom/i.test(String(server))) return Promise.reject(fehler("server_not_connected", "Unbekannter Dienst."));
      return funktion("tomtom", { tool: werkzeug, input: eingabe || {} }).then(function (d) { return { payload: d && d.payload }; });
    }
  };

  /* ---------- Schnittstelle wie in Claude bereitstellen ---------- */
  var API = { db: DB, user: NUTZER, assets: DATEIEN, sample: SCAN, mcp: MCP };
  window.claude = {
    use: function (name) { return bereit.then(function () { return API[name] || null; }); }
  };

  // Für index.html: Standort-Rechte und Abmelden
  window.SW_CLOUD = {
    aktiv: true,
    darf: function (sto) { return ICH.sto === "all" || (!!ICH.sto && sto === ICH.sto) || (!ICH.sto && !!gemerkt && (gemerkt.sto === "all" || gemerkt.sto === sto)); },
    name: function () { return (ICH.profil && ICH.profil.name) || ICH.mail || (gemerkt && gemerkt.name) || "Ihrem Konto"; },
    abmelden: abmelden,
    bereit: bereit
  };
})();
