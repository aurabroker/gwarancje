import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * gwarancje-submit — formularz „Wyślij zapytanie" na gwarancje.pro.
 *
 * 1. Zapisuje zgłoszenie do public.gwarancje_leads (service_role; tabela nie ma
 *    polityk dla anon, więc front nie pisze do niej bezpośrednio).
 * 2. Wysyła powiadomienie na biuro@gwarancje.pro przez Resend (reply-to = Klient).
 * 3. Wysyła Klientowi potwierdzenie (limit: 1 na skrzynkę na dobę).
 *
 * Brak klucza Resend (GW_RESEND_API_KEY) nie gubi zgłoszenia: lead ląduje w bazie
 * z mail_blad, a panel admina (/admin.html → Zgłoszenia) pokazuje go i tak.
 */

const NOTIFY_TO = "biuro@gwarancje.pro";
// Domena gwarancje.pro czeka na weryfikację w Resend (rekordy DNS). Do tego czasu
// wysyłamy z auraconsulting.pl (spółka-matka, domena zweryfikowana).
const MAIL_FROM = Deno.env.get("GW_MAIL_FROM") ?? "Gwarancje.PRO <formularz@auraconsulting.pl>";

const ALLOWED_ORIGINS = new Set([
  "https://gwarancje.pro",
  "https://www.gwarancje.pro",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const PRODUKTY = new Set([
  "Gwarancja wadialna",
  "Należyte wykonanie (NWK)",
  "Usunięcie wad i usterek (UWU)",
  "Zwrot zaliczki",
  "Umowa limitu — analiza rynku",
  "Inny rodzaj gwarancji",
]);

const MAX = { imie: 150, nip: 20, email: 254, telefon: 40, wiadomosc: 3000, source: 1000 };

// Formularz jest publiczny: limity liczone ze wszystkich zgłoszeń z ostatniej godziny.
const STORE_PER_HOUR = 100;
const NOTIFY_PER_HOUR = 30;
const CONFIRM_PER_MAILBOX_24H = 1;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"'*]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/i;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://gwarancje.pro",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* NIP: 10 cyfr + suma kontrolna. Formularz wymaga NIP-u, więc walidujemy na serio. */
function nipValid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((acc, wi, i) => acc + wi * Number(digits[i]), 0);
  return sum % 11 === Number(digits[9]);
}

/* Wzorzec (regex Postgresa, ~*) obejmujący aliasy tej samej skrzynki (+dopisek, kropki w Gmailu). */
function mailboxPattern(addr: string): string {
  const a = addr.toLowerCase();
  const at = a.lastIndexOf("@");
  const local = a.slice(0, at).replace(/\+.*$/, "");
  const dom = a.slice(at + 1);
  const re = (s: string) => s.replace(/[^a-z0-9]/g, "\\$&");
  const tag = "(\\+[^@]*)?@";
  if (dom === "gmail.com" || dom === "googlemail.com") {
    const l = local.replace(/\./g, "");
    return "^\\.*" + [...l].map((c) => re(c) + "\\.*").join("") + tag + "(gmail|googlemail)\\.com$";
  }
  return "^" + re(local) + tag + re(dom) + "$";
}

async function sendEmail(apiKey: string, payload: object): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };
  const text = (await res.text()).slice(0, 500);
  console.error("Resend error:", res.status, text);
  return { ok: false, error: `Resend ${res.status}: ${text}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Nieprawidłowy format danych." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(req, 400, { error: "Nieprawidłowy format danych." });
  }

  // Honeypot: pole niewidoczne dla ludzi. Bot, który je wypełni, dostaje „ok" i nic nie zapisujemy.
  if (str(body.firma_www, 200)) return json(req, 200, { ok: true });

  const imie_nazwisko = str(body.imie_nazwisko, MAX.imie);
  const nipRaw        = str(body.nip, MAX.nip);
  const nip           = nipRaw.replace(/\D/g, "");
  const email         = str(body.email, MAX.email).toLowerCase();
  const telefon       = str(body.telefon, MAX.telefon);
  const produktRaw    = str(body.produkt, 100);
  const produkt       = PRODUKTY.has(produktRaw) ? produktRaw : "";
  const wiadomosc     = str(body.wiadomosc, MAX.wiadomosc);
  const rodo_zgoda    = body.rodo_zgoda === true;

  if (!imie_nazwisko || !nipRaw || !email) {
    return json(req, 400, { error: "Uzupełnij imię i nazwisko, NIP oraz e-mail." });
  }
  if (!nipValid(nip)) return json(req, 400, { error: "Nieprawidłowy NIP (10 cyfr, zgodnie z sumą kontrolną)." });
  if (!EMAIL_RE.test(email)) return json(req, 400, { error: "Nieprawidłowy adres e-mail." });
  if (telefon && (telefon.match(/\d/g) ?? []).length < 9) {
    return json(req, 400, { error: "Nieprawidłowy numer telefonu." });
  }
  if (!rodo_zgoda) return json(req, 400, { error: "Zaznacz zgodę na przetwarzanie danych." });

  const referer = req.headers.get("referer");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo  = new Date(Date.now() - 86400_000).toISOString();

  const lastHour = await supabase.from("gwarancje_leads").select("id", { count: "exact", head: true }).gte("created_at", hourAgo);
  const hourCount = lastHour.error ? null : (lastHour.count ?? 0) + 1;
  if (lastHour.error) console.error("gwarancje-submit: licznik godzinowy", lastHour.error.message);
  if (hourCount !== null && hourCount > STORE_PER_HOUR) {
    console.warn("gwarancje-submit: limit zapisu przekroczony", hourCount);
    return json(req, 503, { error: "Zbyt wiele zgłoszeń. Zadzwoń: 500 502 702." });
  }

  const sameMailbox = await supabase.from("gwarancje_leads").select("id", { count: "exact", head: true })
    .filter("email", "imatch", mailboxPattern(email)).gte("created_at", dayAgo);
  const priorSameMailbox = sameMailbox.error ? null : (sameMailbox.count ?? 0);

  const { data: lead, error: dbError } = await supabase.from("gwarancje_leads").insert({
    imie_nazwisko,
    nip,
    email,
    telefon:    telefon   || null,
    produkt:    produkt   || null,
    wiadomosc:  wiadomosc || null,
    rodo_zgoda,
    source_url: referer ? referer.slice(0, MAX.source) : null,
  }).select("id").single();

  if (dbError || !lead) {
    console.error("gwarancje-submit: DB insert", dbError?.message);
    return json(req, 500, { error: "Nie udało się zapisać zgłoszenia. Zadzwoń: 500 502 702." });
  }

  const apiKey = Deno.env.get("GW_RESEND_API_KEY");
  const markMail = (ok: boolean, err?: string) =>
    supabase.from("gwarancje_leads").update({ mail_wyslany: ok, mail_blad: err ?? null }).eq("id", lead.id);

  if (!apiKey) {
    console.error("gwarancje-submit: brak GW_RESEND_API_KEY — zgłoszenie zapisane, mail niewysłany");
    await markMail(false, "Brak sekretu GW_RESEND_API_KEY");
    return json(req, 200, { ok: true });
  }

  if (hourCount !== null && hourCount > NOTIFY_PER_HOUR) {
    console.warn("gwarancje-submit: limit powiadomień przekroczony", hourCount);
    if (hourCount === NOTIFY_PER_HOUR + 1) {
      await sendEmail(apiKey, {
        from: MAIL_FROM,
        to: [NOTIFY_TO],
        subject: "Formularz gwarancje.pro: wstrzymano powiadomienia (dużo zgłoszeń w ciągu godziny)",
        html: `<p>W ciągu ostatniej godziny przyszło ponad ${NOTIFY_PER_HOUR} zgłoszeń z formularza. ` +
          `Kolejne są zapisywane w bazie (panel /admin.html → Zgłoszenia), ale nie są wysyłane e-mailem. ` +
          `Powiadomienia wrócą, gdy liczba zgłoszeń z ostatniej godziny spadnie poniżej limitu.</p>`,
      });
    }
    await markMail(false, "Limit powiadomień na godzinę");
    return json(req, 200, { ok: true });
  }

  const rows: [string, string][] = [
    ["Imię i nazwisko", imie_nazwisko],
    ["NIP", nip],
    ["E-mail", email],
    ...(telefon   ? [["Telefon", telefon] as [string, string]] : []),
    ...(produkt   ? [["Produkt", produkt] as [string, string]] : []),
    ...(wiadomosc ? [["Wiadomość", wiadomosc] as [string, string]] : []),
    ["Zgoda RODO", "tak"],
    ...(referer   ? [["Strona", referer.slice(0, 200)] as [string, string]] : []),
  ];
  const rowsHtml = rows.map(([label, val]) =>
    `<tr><td style="padding:6px 16px 6px 0;font-weight:600;color:#555;white-space:nowrap;vertical-align:top;">${esc(label)}:</td>` +
    `<td style="padding:6px 0;white-space:pre-wrap;">${esc(val)}</td></tr>`).join("");

  const notifHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;padding:24px;">
<h2 style="margin-bottom:4px;color:#01696f;">Nowe zapytanie z gwarancje.pro</h2>
<p style="margin-top:0;color:#666;font-size:13px;">Aura Consulting · formularz kontaktowy</p>
<table style="border-collapse:collapse;margin-top:16px;">${rowsHtml}</table>
<hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
<p style="font-size:12px;color:#999;">Odpowiedz na ten e-mail, aby napisać bezpośrednio do Klienta. Zgłoszenie nr ${esc(lead.id)}.</p>
</body></html>`;

  const notif = await sendEmail(apiKey, {
    from: MAIL_FROM,
    to: [NOTIFY_TO],
    reply_to: email,
    subject: `Nowe zapytanie: ${produkt || "gwarancja"} — ${imie_nazwisko.replace(/[\r\n]+/g, " ").slice(0, 80)}`,
    html: notifHtml,
  });
  await markMail(notif.ok, notif.error);
  if (!notif.ok) {
    // Zgłoszenie jest w bazie. Klientowi mówimy „ok" — nie każemy mu wysyłać drugi raz.
    return json(req, 200, { ok: true });
  }

  // Potwierdzenie dla Klienta: 1 na skrzynkę na dobę, tylko gdy licznik zadziałał.
  if (priorSameMailbox === null || priorSameMailbox >= CONFIRM_PER_MAILBOX_24H) {
    return json(req, 200, { ok: true });
  }

  const confirmHtml = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <tr><td style="background:#01696f;padding:28px 40px;">
    <p style="margin:0;color:rgba(255,255,255,.75);font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Aura Consulting · broker ubezpieczeniowy</p>
    <h1 style="margin:4px 0 0;color:#fff;font-size:20px;font-weight:600;">Gwarancje.PRO</h1>
  </td></tr>
  <tr><td style="padding:36px 40px;">
    <h2 style="margin:0 0 12px;font-size:22px;color:#1a1a1a;">Dziękujemy za zapytanie!</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#444;">
      Twoje zgłoszenie dotarło do naszego zespołu. Odezwiemy się w ciągu <strong>2 godzin</strong> w dni robocze.
    </p>
    ${produkt ? `<p style="margin:0 0 20px;font-size:14px;color:#333;background:#f0faf9;border-radius:6px;padding:14px 18px;"><strong>Produkt:</strong> ${esc(produkt)}</p>` : ""}
    <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#444;">Jeśli sprawa jest pilna, zadzwoń:</p>
    <a href="tel:+48500502702" style="display:inline-block;background:#01696f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;margin-bottom:28px;">&#128222; 500&#160;502&#160;702</a>
    <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
      Odpowiedź na tę wiadomość trafi do nas na <a href="mailto:${NOTIFY_TO}" style="color:#01696f;">${NOTIFY_TO}</a>.
    </p>
  </td></tr>
  <tr><td style="background:#f0f4f4;padding:20px 40px;border-top:1px solid #e0e8e8;">
    <p style="margin:0;font-size:12px;color:#888;line-height:1.7;">
      <strong style="color:#555;">Aura Consulting sp. z o.o.</strong><br>
      ul. Bolkowska 2A/28, 01-466 Warszawa · Zezwolenie KNF nr 1972/13<br>
      <a href="https://gwarancje.pro" style="color:#01696f;text-decoration:none;">gwarancje.pro</a>
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

  await sendEmail(apiKey, {
    from: MAIL_FROM,
    to: [email],
    reply_to: NOTIFY_TO,
    subject: "Potwierdzenie zapytania — Gwarancje.PRO",
    html: confirmHtml,
  });

  return json(req, 200, { ok: true });
});
