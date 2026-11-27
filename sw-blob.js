/* Swertz Dispo – Lieferschein-Dateien anzeigen
   Das Programm zeigt gespeicherte Dateien unter der Adresse /_blob/<pfad> an.
   Dieser kleine Hintergrunddienst (Service Worker) holt sie mit der Anmeldung
   des Nutzers aus dem privaten Supabase-Speicher. Ohne gültige Anmeldung gibt
   es keine Datei. Alle anderen Anfragen bleiben unberührt. */
"use strict";
var P = new URL(self.location.href).searchParams;
var URL_ = (P.get("u") || "").replace(/\/+$/, "");
var KEY = P.get("k") || "";
var BUCKET = P.get("b") || "lieferscheine";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (ev) { ev.waitUntil(self.clients.claim()); });

function tokenHolen(clientId) {
  var fragen = function (c) {
    return new Promise(function (ok) {
      var kanal = new MessageChannel();
      var uhr = setTimeout(function () { ok(null); }, 4000);
      kanal.port1.onmessage = function (ev) { clearTimeout(uhr); ok(ev.data && ev.data.token); };
      c.postMessage({ typ: "sw-token" }, [kanal.port2]);
    });
  };
  return (clientId ? self.clients.get(clientId) : Promise.resolve(null)).then(function (c) {
    if (c) return fragen(c);
    return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (alle) {
      var reihe = Promise.resolve(null);
      alle.forEach(function (k) { reihe = reihe.then(function (t) { return t || fragen(k); }); });
      return reihe;
    });
  });
}

function seite(text, status) {
  return new Response('<!doctype html><meta charset="utf-8"><title>Lieferschein</title><body style="font:18px -apple-system,Segoe UI,sans-serif;padding:32px;color:#202124;background:#F5F6F8">' + text + "</body>",
    { status: status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", function (ev) {
  var u = new URL(ev.request.url);
  if (u.origin !== self.location.origin || u.pathname.indexOf("/_blob/") !== 0 || ev.request.method !== "GET") return;
  var pfad = u.pathname.slice("/_blob/".length).split("/").map(decodeURIComponent).filter(Boolean);
  if (!URL_ || !pfad.length || pfad.some(function (t) { return t === ".." || t === "."; })) {
    ev.respondWith(seite("Datei nicht gefunden.", 404));
    return;
  }
  ev.respondWith(tokenHolen(ev.clientId || ev.resultingClientId).then(function (token) {
    if (!token) return seite("Bitte zuerst in Swertz Dispo anmelden und die Datei dann erneut öffnen.", 401);
    var ziel = URL_ + "/storage/v1/object/authenticated/" + encodeURIComponent(BUCKET) + "/" + pfad.map(encodeURIComponent).join("/");
    return fetch(ziel, { headers: { Authorization: "Bearer " + token, apikey: KEY } }).then(function (r) {
      if (r.ok) return r;
      return seite(r.status === 400 || r.status === 404 ? "Datei nicht gefunden oder keine Berechtigung für diesen Standort." : "Datei konnte nicht geladen werden (Fehler " + r.status + ").", r.status === 400 ? 404 : r.status);
    });
  }).catch(function () { return seite("Keine Verbindung – Datei konnte nicht geladen werden.", 503); }));
});
