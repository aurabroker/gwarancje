#!/usr/bin/env node
/**
 * build-assets.mjs — zasoby marki Gwarancje.PRO wyprowadzone z plików źródłowych logo.
 *
 * Źródła (public/brand/src/, wygenerowane w Artlist na bazie ikony grupowe.pro —
 * ten sam romb low-poly, napis "gwarancje.pro" w stylu grupowe.pro):
 *   icon.jpg          1:1   ikona: granatowy zaokrąglony kwadrat + romb (białe rogi poza kwadratem)
 *   lockup-white.jpg  16:9  logotyp poziomy na białym tle
 *   lockup-navy.jpg   16:9  logotyp poziomy na granatowym tle
 *
 * Wyjście:
 *   public/brand/icon.png              1024×1024 ikona (rogi wypełnione granatem)
 *   public/brand/logo-gwarancje.png    logotyp poziomy, białe tło (pełna rozdzielczość)
 *   public/brand/logo-gwarancje-dark.png logotyp poziomy, PRZEZROCZYSTE tło (pełna rozdzielczość)
 *   public/brand/logo-nav.png          logotyp poziomy, białe tło, wys. 80 px (2× do nagłówka 40 px)
 *   public/brand/logo-nav-dark.png     logotyp poziomy, przezroczyste tło, wys. 88 px (2× do stopki 44 px)
 *   public/logo.png                    800×400 logotyp na białym tle (Organization.logo w JSON-LD)
 *   public/og-image.png                1200×630 karta social (og:image / twitter:image)
 *   public/apple-touch-icon.png        180×180 (iOS sam zaokrągla rogi — tło granatowe)
 *   public/icon-192.png, icon-512.png  do site.webmanifest (tło granatowe)
 *   public/favicon.ico                 32×32 PNG w kontenerze ICO, przezroczyste rogi
 *   public/favicon.svg                 SVG z osadzoną 64-px wersją ikony
 *
 * Uruchomienie: node scripts/build-assets.mjs
 * Wymagania: Node ≥ 18, Playwright (chromium) — z globalnej instalacji albo z node_modules.
 * Rendering wyłącznie z inline CSS i zainstalowanych czcionek (Inter / system-ui). Żadnych CDN.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const SRC = join(PUBLIC, 'brand', 'src');
const BRAND_DIR = join(PUBLIC, 'brand');

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const TAGLINE = ['Broker gwarancji ubezpieczeniowych', 'dla firm budowlanych'];
const SUBLINE = 'Aura Consulting · Zezwolenie KNF 1972/13 · gwarancje.pro';

async function loadPlaywright() {
  try {
    return await import('/opt/node-tools/node_modules/playwright/index.mjs');
  } catch {
    return await import('playwright');
  }
}

const dataUri = async (file) => `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;

/** 32-px PNG → ICO (jeden wpis, PNG wewnątrz kontenera; obsługiwane przez wszystkie przeglądarki). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

const b64 = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;font-family:${FONT}}</style></head><body></body></html>`);

  const sources = {
    icon: await dataUri(join(SRC, 'icon.jpg')),
    white: await dataUri(join(SRC, 'lockup-white.jpg')),
    navy: await dataUri(join(SRC, 'lockup-navy.jpg')),
  };

  const out = await page.evaluate(
    async ({ sources, FONT, TAGLINE, SUBLINE }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const canvas = (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      };
      const draw = (img) => {
        const c = canvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
      };
      const pixel = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
      const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

      /** Obrys treści: tryb 'light' (tło białe) lub 'dark' (tło = próbka z narożnika). */
      const bbox = (c, mode) => {
        const { width, height } = c;
        const d = c.getContext('2d').getImageData(0, 0, width, height).data;
        const bg = mode === 'dark' ? pixel(c, 3, 3) : [255, 255, 255];
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
            const isContent = mode === 'dark' ? diff > 90 : diff > 60;
            if (isContent) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, bg: hex(bg) };
      };
      const roundRect = (ctx, x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      };

      // ── ikona ──────────────────────────────────────────────────────────────
      const iconImg = await load(sources.icon);
      const iconC = draw(iconImg);
      const ib = bbox(iconC, 'light'); // granatowy kwadrat (bez białych rogów)
      const side = Math.min(ib.w, ib.h);
      const navy = hex(pixel(iconC, ib.x + Math.round(side * 0.06), ib.y + Math.round(side * 0.5)));

      const renderIcon = (size, { fill, radiusRatio = 0.225 }) => {
        const c = canvas(size, size);
        const ctx = c.getContext('2d');
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, size, size);
        }
        ctx.save();
        roundRect(ctx, 0, 0, size, size, size * radiusRatio);
        ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(iconC, ib.x, ib.y, side, side, 0, 0, size, size);
        ctx.restore();
        return c.toDataURL('image/png');
      };

      // ── logotypy ───────────────────────────────────────────────────────────
      const whiteImg = await load(sources.white);
      const whiteC = draw(whiteImg);
      const wb = bbox(whiteC, 'light');
      const navyImg = await load(sources.navy);
      const navyC = draw(navyImg);
      const nb = bbox(navyC, 'dark');

      /** Wycinek z granatowego tła z usuniętym tłem (klucz koloru z miękkim progiem) —
          do stopek o innym odcieniu ciemnego tła. */
      const cropKeyed = (srcC, b, pad, bgHex) => {
        const c = canvas(b.w + pad * 2, b.h + pad * 2);
        const ctx = c.getContext('2d');
        // Margines też pobieramy ze źródła (tam jest granat, który zostanie wykluczony) —
        // pusty margines płótna miałby RGB 0,0,0 i wyszedłby jako nieprzezroczysta czarna ramka.
        const sx = Math.max(0, b.x - pad), sy = Math.max(0, b.y - pad);
        const sw = Math.min(srcC.width - sx, b.w + pad * 2), sh = Math.min(srcC.height - sy, b.h + pad * 2);
        ctx.drawImage(srcC, sx, sy, sw, sh, pad - (b.x - sx), pad - (b.y - sy), sw, sh);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        const bg = [parseInt(bgHex.slice(1, 3), 16), parseInt(bgHex.slice(3, 5), 16), parseInt(bgHex.slice(5, 7), 16)];
        const LO = 36, HI = 110; // suma różnic RGB: poniżej LO → tło, powyżej HI → treść
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue; // poza obrazem źródłowym — zostaje przezroczyste
          const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
          const a = diff <= LO ? 0 : diff >= HI ? 1 : (diff - LO) / (HI - LO);
          d[i + 3] = Math.round(255 * a);
        }
        ctx.putImageData(img, 0, 0);
        return { url: c.toDataURL('image/png'), w: c.width, h: c.height, c };
      };
      const cropWithPad = (srcC, b, pad, bgFill) => {
        const c = canvas(b.w + pad * 2, b.h + pad * 2);
        const ctx = c.getContext('2d');
        ctx.fillStyle = bgFill;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(srcC, b.x, b.y, b.w, b.h, pad, pad, b.w, b.h);
        return { url: c.toDataURL('image/png'), w: c.width, h: c.height, c };
      };
      const fitInto = (srcC, b, W, H, bgFill, innerW, innerH) => {
        const c = canvas(W, H);
        const ctx = c.getContext('2d');
        ctx.fillStyle = bgFill;
        ctx.fillRect(0, 0, W, H);
        const s = Math.min(innerW / b.w, innerH / b.h);
        const dw = Math.round(b.w * s), dh = Math.round(b.h * s);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(srcC, b.x, b.y, b.w, b.h, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
        return c.toDataURL('image/png');
      };

      // ── og-image 1200×630 ──────────────────────────────────────────────────
      const logoWhite = cropWithPad(whiteC, wb, 24, '#ffffff');
      const logoNavy = cropKeyed(navyC, nb, 24, nb.bg);

      /** Pomniejszona kopia logotypu (do nagłówka/stopki) — dwa kroki skalowania dla gładkich krawędzi. */
      const scaleToHeight = (src, h) => {
        const w = Math.round((src.w / src.h) * h);
        let cur = src.c;
        while (cur.height / 2 > h) {
          const half = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
          const hc = half.getContext('2d');
          hc.imageSmoothingQuality = 'high';
          hc.drawImage(cur, 0, 0, half.width, half.height);
          cur = half;
        }
        const c = canvas(w, h);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, w, h);
        return { url: c.toDataURL('image/png'), w, h };
      };


      const og = (() => {
        const W = 1200, H = 630;
        const c = canvas(W, H);
        const ctx = c.getContext('2d');
        ctx.fillStyle = nb.bg;
        ctx.fillRect(0, 0, W, H);
        const logoW = 700;
        const s = logoW / logoNavy.w;
        const dh = Math.round(logoNavy.h * s);
        ctx.imageSmoothingQuality = 'high';
        // logotyp z wykluczonym tłem — żadnego prostokąta przy minimalnej różnicy odcienia granatu
        ctx.drawImage(logoNavy.c, Math.round((W - logoW) / 2), 128, logoW, dh);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 46px ${FONT}`;
        let y = 128 + dh + 96;
        for (const line of TAGLINE) {
          ctx.fillText(line, W / 2, y);
          y += 58;
        }
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.font = `500 22px ${FONT}`;
        ctx.fillText(SUBLINE, W / 2, H - 56);
        return c.toDataURL('image/png');
      })();

      return {
        navy,
        iconBox: ib,
        whiteBox: wb,
        navyBox: nb,
        icon1024: renderIcon(1024, { fill: navy }),
        icon512: renderIcon(512, { fill: navy }),
        icon192: renderIcon(192, { fill: navy }),
        apple180: renderIcon(180, { fill: navy }),
        fav64: renderIcon(64, { fill: null }),
        fav32: renderIcon(32, { fill: null }),
        logoWhite: { url: logoWhite.url, w: logoWhite.w, h: logoWhite.h },
        logoNavy: { url: logoNavy.url, w: logoNavy.w, h: logoNavy.h },
        logoNav: scaleToHeight(logoWhite, 80),
        logoNavDark: scaleToHeight(logoNavy, 88),
        logo800: fitInto(whiteC, wb, 800, 400, '#ffffff', 740, 300),
        og,
      };
    },
    { sources, FONT, TAGLINE, SUBLINE },
  );
  await browser.close();

  await mkdir(BRAND_DIR, { recursive: true });
  const writes = [
    [join(BRAND_DIR, 'icon.png'), b64(out.icon1024)],
    [join(BRAND_DIR, 'logo-gwarancje.png'), b64(out.logoWhite.url)],
    [join(BRAND_DIR, 'logo-gwarancje-dark.png'), b64(out.logoNavy.url)],
    [join(BRAND_DIR, 'logo-nav.png'), b64(out.logoNav.url)],
    [join(BRAND_DIR, 'logo-nav-dark.png'), b64(out.logoNavDark.url)],
    [join(PUBLIC, 'logo.png'), b64(out.logo800)],
    [join(PUBLIC, 'og-image.png'), b64(out.og)],
    [join(PUBLIC, 'apple-touch-icon.png'), b64(out.apple180)],
    [join(PUBLIC, 'icon-192.png'), b64(out.icon192)],
    [join(PUBLIC, 'icon-512.png'), b64(out.icon512)],
    [join(PUBLIC, 'favicon.ico'), pngToIco(b64(out.fav32), 32)],
    [
      join(PUBLIC, 'favicon.svg'),
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Gwarancje.PRO"><image width="64" height="64" href="${out.fav64}" xlink:href="${out.fav64}"/></svg>\n`,
      ),
    ],
  ];
  for (const [file, buf] of writes) {
    await writeFile(file, buf);
    console.log(`zapisano ${file.replace(ROOT + '/', '')} (${buf.length} B)`);
  }
  console.log('granat tła ikony:', out.navy, '| ikona bbox:', JSON.stringify(out.iconBox));
  console.log('logo białe:', `${out.logoWhite.w}×${out.logoWhite.h}`, '| logo granatowe:', `${out.logoNavy.w}×${out.logoNavy.h}`, '| tło granatowe logotypu:', out.navyBox.bg);
  console.log('logo nav:', `${out.logoNav.w}×${out.logoNav.h}`, '| logo nav dark:', `${out.logoNavDark.w}×${out.logoNavDark.h}`);
}

main().catch((err) => {
  console.error('[build-assets] BŁĄD:', err);
  process.exit(1);
});
