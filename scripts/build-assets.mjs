#!/usr/bin/env node
/**
 * build-assets.mjs — generuje rastrowe zasoby marki Gwarancje.PRO do public/.
 *
 * Uruchomienie:  node scripts/build-assets.mjs
 *
 * Tworzy:
 *   public/logo.png             800×400   logotyp na białym tle (Organization.logo w JSON-LD)
 *   public/og-image.png         1200×630  karta do podglądu w social mediach (og:image / twitter:image)
 *   public/apple-touch-icon.png 180×180   monogram, kwadrat (iOS sam zaokrągla rogi)
 *   public/icon-192.png         192×192   monogram do site.webmanifest
 *   public/icon-512.png         512×512   monogram do site.webmanifest
 *   public/favicon.ico          32×32     PNG z zaokrąglonym tłem, opakowany w kontener ICO
 *
 * Wymagania: Node ≥ 18, Playwright (chromium). Bez zależności z npm w repo —
 * skrypt importuje Playwright z globalnej instalacji (ścieżka poniżej) albo z
 * pakietu "playwright", jeśli jest dostępny w node_modules.
 *
 * Renderowanie używa wyłącznie inline CSS/SVG i zainstalowanych czcionek
 * (Inter, a w razie braku system-ui/Helvetica/Arial). Żadnych CDN.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Ścieżki i stałe marki
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const BRAND = '#01696f';      // kolor marki (nav, przyciski)
const BRAND_DARK = '#111210'; // tło ciemnych sekcji / stopki
const ACCENT = '#6ee7df';     // akcent na ciemnym tle (hero h1 em, liczby)
const MUTED = '#6b6b66';      // ".PRO" w nawigacji (--c-muted)
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const PLAYWRIGHT_GLOBAL = '/opt/node-tools/node_modules/playwright/index.mjs';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

// ---------------------------------------------------------------------------
// Monogram "G" — ten sam rysunek co w public/favicon.svg (viewBox 0 0 64 64).
// Pierścień o promieniu 18 i grubości 8.5 (zewn. 22.25) z przerwą po prawej
// u góry; pozioma belka od środka do prawej krawędzi, zakończona łukiem
// o promieniu zewnętrznym pierścienia, żeby sylwetka była ciągła.
// ---------------------------------------------------------------------------

const G_PATHS =
  '<path d="M46.2 20.9A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="8.5"/>' +
  '<path d="M32.5 27.75H53.84A22.25 22.25 0 0 1 53.84 36.25H32.5Z" fill="#fff"/>';

/** Monogram na pełnym (niezaokrąglonym) kwadracie — iOS/Android same zaokrąglają. */
function monogramSquareSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" fill="${BRAND}"/>` +
    G_PATHS +
    '</svg>'
  );
}

/** Monogram na zaokrąglonym kwadracie z przezroczystymi rogami — favicon. */
function monogramRoundedSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" rx="14" fill="${BRAND}"/>` +
    G_PATHS +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Szablony HTML (inline CSS, zero zasobów zewnętrznych)
// ---------------------------------------------------------------------------

function page(width, height, body, extraCss = '') {
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden}
  body{font-family:${FONT};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  .wordmark{font-weight:700;letter-spacing:-.02em;line-height:1;white-space:nowrap}
  .wordmark span{font-weight:400}
  ${extraCss}
</style></head><body>${body}</body></html>`;
}

/** 800×400, białe tło, logotyp wyśrodkowany. */
function logoHtml() {
  return page(
    800,
    400,
    `<div class="wrap"><div class="wordmark" id="fit">Gwarancje<span>.PRO</span></div></div>`,
    `
    body{background:#ffffff}
    .wrap{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
    .wordmark{color:${BRAND};font-size:100px}
    .wordmark span{color:${MUTED}}
    `
  );
}

/** 1200×630, ciemne tło z delikatnym akcentem marki. */
function ogHtml() {
  return page(
    1200,
    630,
    `
    <div class="glow"></div>
    <div class="bar"></div>
    <div class="card">
      <div class="wordmark" id="fit">Gwarancje<span>.PRO</span></div>
      <div class="tagline">Broker gwarancji ubezpieczeniowych<br>dla firm budowlanych</div>
      <div class="meta">Aura Consulting&nbsp;&nbsp;·&nbsp;&nbsp;Zezwolenie KNF 1972/13&nbsp;&nbsp;·&nbsp;&nbsp;gwarancje.pro</div>
    </div>
    `,
    `
    body{background:${BRAND_DARK};position:relative;color:#fff}
    .glow{position:absolute;inset:0;background:
      radial-gradient(900px 560px at 92% -10%, rgba(1,105,111,.55) 0%, rgba(1,105,111,0) 65%),
      radial-gradient(700px 420px at -5% 110%, rgba(1,105,111,.28) 0%, rgba(1,105,111,0) 65%)}
    .bar{position:absolute;left:0;top:0;bottom:0;width:14px;background:${BRAND}}
    .card{position:absolute;left:96px;top:0;bottom:0;right:80px;display:flex;flex-direction:column;justify-content:center}
    .wordmark{color:${ACCENT};font-size:132px;margin-bottom:34px}
    .wordmark span{color:rgba(255,255,255,.5)}
    .tagline{font-size:46px;font-weight:600;line-height:1.2;letter-spacing:-.02em;color:#fff;margin-bottom:44px}
    .meta{font-size:24px;font-weight:500;color:rgba(255,255,255,.62);letter-spacing:.01em}
    `
  );
}

/** Kwadratowe ikony (monogram wypełnia całą kanwę). */
function iconHtml(size, svg) {
  return page(
    size,
    size,
    svg,
    `body{background:transparent;display:block} svg{display:block;width:${size}px;height:${size}px}`
  );
}

// ---------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------

async function loadPlaywright() {
  if (existsSync(PLAYWRIGHT_GLOBAL)) return import(PLAYWRIGHT_GLOBAL);
  return import('playwright');
}

async function launchChromium(chromium) {
  const opts = { headless: true };
  if (existsSync(CHROMIUM_PATH)) {
    try {
      return await chromium.launch({ ...opts, executablePath: CHROMIUM_PATH });
    } catch (err) {
      console.warn(`[build-assets] nie udało się uruchomić ${CHROMIUM_PATH}: ${err.message}; próba domyślnej instalacji`);
    }
  }
  return chromium.launch(opts);
}

/**
 * Renderuje stronę do PNG o dokładnie zadanych wymiarach.
 * `fit` — selektor elementu, którego szerokość ma zmieścić się w `fitWidth`
 * (skrypt zmniejsza font-size, jeśli tekst jest za szeroki, np. przy fallbacku czcionki).
 */
async function renderPng(browser, { html, width, height, omitBackground = false, fit, fitWidth }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pg = await context.newPage();
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts.ready);
  if (fit) {
    await pg.evaluate(([sel, max]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      let size = parseFloat(getComputedStyle(el).fontSize);
      for (let i = 0; i < 40 && el.getBoundingClientRect().width > max && size > 10; i++) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
    }, [fit, fitWidth]);
  }
  const font = await pg.evaluate(() => {
    const el = document.querySelector('.wordmark') || document.body;
    const fam = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    return { family: fam, interLoaded: document.fonts.check('700 32px Inter') };
  });
  const buf = await pg.screenshot({ type: 'png', omitBackground, clip: { x: 0, y: 0, width, height } });
  await context.close();
  return { buf, font };
}

// ---------------------------------------------------------------------------
// ICO: 6-bajtowy nagłówek + 16-bajtowy wpis katalogu + bajty PNG
// ---------------------------------------------------------------------------

function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // zarezerwowane
  header.writeUInt16LE(1, 2); // typ: 1 = ikona
  header.writeUInt16LE(1, 4); // liczba obrazów

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // szerokość (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // wysokość
  entry.writeUInt8(0, 2);                       // paleta
  entry.writeUInt8(0, 3);                       // zarezerwowane
  entry.writeUInt16LE(1, 4);                    // płaszczyzny
  entry.writeUInt16LE(32, 6);                   // bity na piksel
  entry.writeUInt32LE(png.length, 8);           // rozmiar danych
  entry.writeUInt32LE(6 + 16, 12);              // offset danych

  return Buffer.concat([header, entry, png]);
}

// ---------------------------------------------------------------------------
// Weryfikacja PNG (IHDR)
// ---------------------------------------------------------------------------

function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('to nie jest PNG');
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('brak IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Główny przebieg
// ---------------------------------------------------------------------------

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await launchChromium(chromium);
  await mkdir(PUBLIC, { recursive: true });

  const jobs = [
    { file: 'logo.png', width: 800, height: 400, html: logoHtml(), fit: '#fit', fitWidth: 680 },
    { file: 'og-image.png', width: 1200, height: 630, html: ogHtml(), fit: '#fit', fitWidth: 1000 },
    { file: 'apple-touch-icon.png', width: 180, height: 180, html: iconHtml(180, monogramSquareSvg()) },
    { file: 'icon-192.png', width: 192, height: 192, html: iconHtml(192, monogramSquareSvg()) },
    { file: 'icon-512.png', width: 512, height: 512, html: iconHtml(512, monogramSquareSvg()) },
  ];

  const report = [];
  try {
    for (const job of jobs) {
      const { buf, font } = await renderPng(browser, job);
      const dims = pngSize(buf);
      if (dims.width !== job.width || dims.height !== job.height) {
        throw new Error(`${job.file}: oczekiwano ${job.width}×${job.height}, jest ${dims.width}×${dims.height}`);
      }
      await writeFile(join(PUBLIC, job.file), buf);
      report.push({ file: job.file, ...dims, bytes: buf.length, font: font.family, inter: font.interLoaded });
    }

    // favicon.ico — 32×32 PNG z zaokrąglonym tłem i przezroczystymi rogami
    const { buf: fav32 } = await renderPng(browser, {
      html: iconHtml(32, monogramRoundedSvg()),
      width: 32,
      height: 32,
      omitBackground: true,
    });
    const dims = pngSize(fav32);
    if (dims.width !== 32 || dims.height !== 32) throw new Error(`favicon: zły rozmiar ${dims.width}×${dims.height}`);
    const ico = pngToIco(fav32, 32);
    await writeFile(join(PUBLIC, 'favicon.ico'), ico);
    report.push({ file: 'favicon.ico', width: 32, height: 32, bytes: ico.length, font: '-', inter: '-' });
  } finally {
    await browser.close();
  }

  // Podsumowanie (+ pliki pisane ręcznie, jeśli są)
  for (const extra of ['favicon.svg', 'site.webmanifest']) {
    const p = join(PUBLIC, extra);
    if (existsSync(p)) report.push({ file: extra, width: '-', height: '-', bytes: (await stat(p)).size, font: '-', inter: '-' });
  }
  const total = report.reduce((s, r) => s + r.bytes, 0);
  console.table(report);
  console.log(`Razem: ${total} B (${(total / 1024).toFixed(1)} KB)`);
  const fallback = report.filter((r) => r.inter === false);
  if (fallback.length) {
    console.warn('[build-assets] UWAGA: Inter nie był dostępny, użyto czcionki zastępczej:', fallback.map((r) => r.file).join(', '));
  }
}

main().catch((err) => {
  console.error('[build-assets] błąd:', err);
  process.exit(1);
});
