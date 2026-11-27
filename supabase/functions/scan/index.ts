// Swertz Dispo – Lieferschein-Texterkennung über Supabase (Edge Function „scan“)
//
// Liest Fotos/Scans von Lieferscheinen mit Claude aus. Der Anthropic-Schlüssel
// liegt NUR hier auf dem Server (Supabase Secret ANTHROPIC_API_KEY) und nie im
// Programm im Browser. Nur angemeldete Nutzer dürfen diese Funktion aufrufen
// (Supabase prüft die Anmeldung automatisch).
//
// Anfrage:  { prompt: string, images?: [{ media_type: "image/jpeg", data: "<base64>" }] }
// Antwort:  { text: string }

import Anthropic from "npm:@anthropic-ai/sdk@1.14.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const fehler = (code: string, message: string, status: number) => json({ error: { code, message } }, status);

const BILDTYPEN = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BILDER = 6;
const MAX_BILD_BASE64 = 7_000_000; // ca. 5 MB pro Bild
const MAX_PROMPT = 30_000;

const SYSTEM =
  "Du liest deutsche Lieferscheine eines Baustoff-Großhandels aus. " +
  "Antworte ausschließlich mit dem verlangten JSON, ohne weiteren Text. " +
  "Erfinde nichts: Unlesbares bleibt leer.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fehler("bad_request", "Nur POST erlaubt.", 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return fehler("not_configured", "Texterkennung ist noch nicht eingerichtet (Secret ANTHROPIC_API_KEY fehlt).", 503);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fehler("bad_request", "Ungültige Anfrage.", 400);
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return fehler("bad_request", "Kein Auftrag übergeben.", 400);
  if (prompt.length > MAX_PROMPT) return fehler("too_large", "Der Text ist zu lang.", 413);

  const bilder = Array.isArray(body?.images) ? body.images : [];
  if (bilder.length > MAX_BILDER) return fehler("too_large", `Höchstens ${MAX_BILDER} Bilder auf einmal.`, 413);
  const inhalt: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const b of bilder) {
    const typ = String(b?.media_type ?? "");
    const daten = String(b?.data ?? "");
    if (!BILDTYPEN.has(typ) || !/^[A-Za-z0-9+/=]+$/.test(daten)) {
      return fehler("bad_request", "Ungültiges Bild.", 400);
    }
    if (daten.length > MAX_BILD_BASE64) return fehler("too_large", "Ein Bild ist zu groß.", 413);
    inhalt.push({
      type: "image",
      source: { type: "base64", media_type: typ as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: daten },
    });
  }
  inhalt.push({ type: "text", text: prompt });

  const client = new Anthropic({ apiKey });
  try {
    // Server-seitiger Ausweich-Mechanismus: Lehnt das Modell eine Anfrage aus
    // Sicherheitsgründen ab, übernimmt automatisch ein passendes anderes Modell.
    const antwort = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: inhalt }],
    });
    if (antwort.stop_reason === "refusal") {
      return fehler("refused", "Die Texterkennung hat dieses Dokument abgelehnt. Bitte manuell eintragen.", 422);
    }
    const text = antwort.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return json({ text, truncated: antwort.stop_reason === "max_tokens" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return fehler("rate_limited", "Gerade zu viele Anfragen – bitte gleich nochmal versuchen.", 429);
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return fehler("not_configured", "Der Anthropic-Schlüssel ist ungültig oder gesperrt.", 503);
    }
    if (e instanceof Anthropic.BadRequestError) {
      return fehler("bad_request", "Das Dokument konnte nicht verarbeitet werden.", 400);
    }
    if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
      return fehler("unavailable", "Texterkennung gerade nicht erreichbar – bitte gleich nochmal versuchen.", 503);
    }
    if (e instanceof Anthropic.APIError) {
      return fehler("unavailable", "Texterkennung fehlgeschlagen.", 502);
    }
    return fehler("unavailable", "Texterkennung fehlgeschlagen.", 500);
  }
});
