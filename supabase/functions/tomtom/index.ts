// Swertz Dispo – TomTom über Supabase (Edge Function „tomtom“)
//
// Der TomTom-Schlüssel liegt NUR hier auf dem Server (Supabase Secret
// TOMTOM_API_KEY) und nie im Programm im Browser. Nur angemeldete Nutzer
// dürfen diese Funktion aufrufen (Supabase prüft die Anmeldung automatisch).
//
// Die Antworten haben dasselbe Format wie bisher der TomTom-Konnektor in
// Claude, damit das Programm unverändert weiterarbeitet:
//   tomtom-geocode  → { features: [{ geometry: { coordinates: [lon, lat] } }] }
//   tomtom-routing  → { features: [{ properties: { summary, sections: { leg, traffic, importantRoadStretch } } }] }
//   tomtom-traffic  → { incidents: [...], incidentSummary: { incidentsByCategory } }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const fehler = (code: string, message: string, status: number, retryable = false) =>
  json({ error: { code, message, retryable } }, status);

class TomTomFehler extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Nur angemeldete Nutzer: Die Anmeldung wird bei Supabase selbst nachgeprüft
// (zusätzlich zur Einstellung „Verify JWT“, damit es in jedem Fall sicher ist).
async function angemeldet(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  const basis = Deno.env.get("SUPABASE_URL");
  if (!basis || !/^Bearer\s+\S+/.test(auth) || !apikey) return false;
  try {
    const r = await fetch(`${basis}/auth/v1/user`, {
      headers: { authorization: auth, apikey },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return false;
    const u = await r.json();
    return typeof u?.id === "string" && u.id.length > 0;
  } catch {
    return false;
  }
}

const TT = "https://api.tomtom.com";

async function tt(path: string, params: URLSearchParams): Promise<any> {
  const key = Deno.env.get("TOMTOM_API_KEY");
  if (!key) throw new TomTomFehler("TomTom-Schlüssel ist in Supabase nicht hinterlegt (Secret TOMTOM_API_KEY).", 503);
  params.set("key", key);
  const r = await fetch(`${TT}${path}?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 300).replaceAll(key, "***");
    throw new TomTomFehler(`TomTom antwortet mit ${r.status}: ${text}`, r.status);
  }
  return r.json();
}

const zahl = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const strecke = (x: any) => (typeof x === "string" ? x : x && typeof x.text === "string" ? x.text : null);

// ---------- Geokodierung ----------
async function geocode(input: any) {
  const query = String(input?.query ?? "").trim().slice(0, 300);
  if (!query) return { features: [] };
  const p = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(input?.limit) || 1, 1), 5)),
    language: "de-DE",
  });
  const lander = Array.isArray(input?.countries) ? input.countries.filter((c: unknown) => /^[A-Z]{2}$/.test(String(c))) : [];
  if (lander.length) p.set("countrySet", lander.join(","));
  const d = await tt(`/search/2/geocode/${encodeURIComponent(query)}.json`, p);
  return {
    features: (d.results ?? [])
      .filter((r: any) => r?.position && zahl(r.position.lat) && zahl(r.position.lon))
      .map((r: any) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.position.lon, r.position.lat] },
        properties: { address: r.address?.freeformAddress ?? "", score: r.score ?? null, type: r.type ?? "" },
      })),
  };
}

// ---------- LKW-Route mit Verkehr ----------
const VERKEHR: Record<string, string> = {
  JAM: "jam",
  ROAD_WORK: "roadworks",
  ROAD_CLOSURE: "road-closed",
  OTHER: "other",
};

async function routing(input: any) {
  const locs: unknown[] = Array.isArray(input?.locations) ? input.locations : [];
  const punkte = locs
    .filter((l): l is [number, number] => Array.isArray(l) && zahl(l[0]) && zahl(l[1]))
    .map(([lon, lat]) => `${lat},${lon}`);
  if (punkte.length < 2) throw new TomTomFehler("Für eine Route werden mindestens zwei Punkte gebraucht.", 400);
  if (punkte.length > 150) throw new TomTomFehler("Zu viele Stopps für eine Route (höchstens 150).", 400);

  const p = new URLSearchParams({
    traffic: input?.traffic === "none" ? "false" : "true",
    travelMode: "truck",
    vehicleCommercial: "true",
    routeRepresentation: "summaryOnly",
    language: "de-DE",
  });
  if (zahl(input?.vehicleWeight)) p.set("vehicleWeight", String(Math.round(input.vehicleWeight)));
  if (zahl(input?.vehicleMaxSpeed)) p.set("vehicleMaxSpeed", String(Math.round(input.vehicleMaxSpeed)));
  const typen = Array.isArray(input?.sectionType) ? input.sectionType : ["traffic"];
  for (const t of typen) if (/^[A-Za-z]+$/.test(String(t))) p.append("sectionType", String(t));
  if (typeof input?.departAt === "string" && !Number.isNaN(Date.parse(input.departAt))) {
    p.set("departAt", new Date(input.departAt).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }

  const d = await tt(`/routing/1/calculateRoute/${punkte.join(":")}/json`, p);
  const route = d.routes?.[0];
  if (!route) return { features: [] };
  const abschnitte: any[] = route.sections ?? [];
  return {
    features: [{
      type: "Feature",
      geometry: null,
      properties: {
        summary: route.summary ?? {},
        sections: {
          leg: (route.legs ?? []).map((l: any) => ({ summary: l.summary ?? {} })),
          traffic: abschnitte
            .filter((s) => s.sectionType === "TRAFFIC")
            .map((s) => ({
              startPointIndex: s.startPointIndex,
              endPointIndex: s.endPointIndex,
              delayInSeconds: s.delayInSeconds ?? 0,
              magnitudeOfDelay: s.magnitudeOfDelay ?? null,
              effectiveSpeedInKmh: s.effectiveSpeedInKmh ?? null,
              categories: [VERKEHR[s.simpleCategory] ?? "other"],
            })),
          importantRoadStretch: abschnitte
            .filter((s) => s.sectionType === "IMPORTANT_ROAD_STRETCH")
            .map((s) => ({
              streetName: strecke(s.streetName),
              roadNumbers: (s.roadNumbers ?? []).map(strecke).filter(Boolean),
            })),
        },
      },
    }],
  };
}

// ---------- Verkehrslage (Staus, Unfälle, Sperrungen) ----------
const KAT_NACH_CODE: Record<number, string> = {
  1: "accident", 6: "jam", 7: "lane-closed", 8: "road-closed", 9: "roadworks", 14: "broken-down-vehicle",
};
const CODE_NACH_KAT: Record<string, number> = { accident: 1, jam: 6, "lane-closed": 7, "road-closed": 8, roadworks: 9 };

async function traffic(input: any) {
  const bbox = Array.isArray(input?.bbox) && input.bbox.length === 4 && input.bbox.every(zahl)
    ? input.bbox
    : [6.0, 51.15, 7.08, 51.89];
  const p = new URLSearchParams({
    bbox: bbox.join(","),
    language: String(input?.language ?? "de-DE").replace(/[^A-Za-z-]/g, ""),
    timeValidityFilter: "present",
    fields: "{incidents{type,properties{iconCategory,magnitudeOfDelay,events{description,code},from,to,length,delay,roadNumbers}}}",
  });
  const kat = (Array.isArray(input?.categoryFilter) ? input.categoryFilter : [])
    .map((c: string) => CODE_NACH_KAT[c]).filter(Boolean);
  if (kat.length) p.set("categoryFilter", kat.join(","));

  const d = await tt("/traffic/services/5/incidentDetails", p);
  const alle = (d.incidents ?? []).map((i: any) => {
    const pr = i.properties ?? {};
    return {
      category: KAT_NACH_CODE[pr.iconCategory] ?? "other",
      delayInSeconds: pr.delay ?? 0,
      magnitudeOfDelay: pr.magnitudeOfDelay ?? null,
      from: pr.from ?? "",
      to: pr.to ?? "",
      roadNumbers: pr.roadNumbers ?? [],
      lengthInMeters: pr.length ?? null,
      description: pr.events?.[0]?.description ?? "",
    };
  });
  const incidentsByCategory: Record<string, number> = {};
  for (const i of alle) incidentsByCategory[i.category] = (incidentsByCategory[i.category] ?? 0) + 1;
  const max = Math.min(Math.max(Number(input?.maxResults) || 12, 1), 50);
  return {
    incidents: [...alle].sort((a, b) => b.delayInSeconds - a.delayInSeconds).slice(0, max),
    incidentSummary: { total: alle.length, incidentsByCategory },
  };
}

const WERKZEUGE: Record<string, (input: any) => Promise<unknown>> = {
  "tomtom-geocode": geocode,
  "tomtom-routing": routing,
  "tomtom-traffic": traffic,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fehler("bad_request", "Nur POST erlaubt.", 405);
  if (!(await angemeldet(req))) return fehler("not_signed_in", "Bitte in Swertz Dispo anmelden.", 401);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fehler("bad_request", "Ungültige Anfrage.", 400);
  }
  const fn = WERKZEUGE[String(body?.tool)];
  if (!fn) return fehler("bad_request", "Unbekannte TomTom-Funktion.", 400);
  try {
    return json({ payload: await fn(body.input ?? {}) });
  } catch (e) {
    if (e instanceof TomTomFehler) {
      const retry = e.status === 429 || e.status >= 500;
      return fehler(e.status === 503 ? "server_unavailable" : "tool_error", e.message, retry ? 503 : 502, retry);
    }
    return fehler("server_unavailable", "TomTom ist gerade nicht erreichbar.", 503, true);
  }
});
