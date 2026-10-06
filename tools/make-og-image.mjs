// Draws the site's one share image (Open Graph and Twitter card), 1200 by 630 pixels, to site/assets/og-image.png, using the same
// Chromium the tests use. Run it by hand after changing the drawing; the site build only copies the committed PNG (site/build.mjs).
// The picture is drawn here from shapes: a globe, a few orbit lines and dots, the site's name and its tagline, in the app's own colours
// (the CSS variables in template.html). No photo, no third-party artwork, no numbers and no claims.
// usage: node tools/make-og-image.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launch } from "../harness.mjs";
import { OG_IMAGE } from "../site/layout.mjs";

const out = fileURLToPath(new URL("../site/assets/og-image.png", import.meta.url));
const { width: W, height: H } = OG_IMAGE;
// The app's own fonts (template.html), both under the SIL Open Font License, which allows using them in images. A system font is not
// used because some (Apple's San Francisco, for one) are licensed only for the vendor's own platforms.
const FONTS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Hanken+Grotesk:wght@400&display=block";
// template.html :root
const C = { ink: "#04060c", ink2: "#0a0f1c", text: "#eaf0ff", muted: "#9aa7c7", ion: "#62e6c3", violet: "#a98cff", signal: "#ffd166", sky: "#6fb4ff" };

// an orbit: an ellipse around the globe's centre, tilted, with dots placed along it at the given fractions of a turn
const orbit = (cx, cy, rx, ry, deg, colour, dots) => {
  const rad = (deg * Math.PI) / 180;
  const at = (f) => { const a = f * 2 * Math.PI, x = rx * Math.cos(a), y = ry * Math.sin(a); return [cx + x * Math.cos(rad) - y * Math.sin(rad), cy + x * Math.sin(rad) + y * Math.cos(rad)]; };
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${deg} ${cx} ${cy})" fill="none" stroke="${colour}" stroke-opacity=".55" stroke-width="2"/>`
    + dots.map((f) => { const [x, y] = at(f); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${colour}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${colour}" fill-opacity=".18"/>`; }).join("");
};
// a few faint background stars at fixed places (a fixed list, so the image is the same on every run)
const STARS = [[60, 70], [140, 520], [250, 40], [420, 590], [530, 70], [610, 560], [700, 110], [1150, 60], [1170, 470], [1080, 600], [760, 590], [330, 300], [40, 330], [1130, 250]];

const gx = 905, gy = 315, r = 185;
const lines = [-60, -30, 0, 30, 60].map((lat) => { const y = gy - r * Math.sin((lat * Math.PI) / 180), rx = r * Math.cos((lat * Math.PI) / 180); return `<ellipse cx="${gx}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.18).toFixed(1)}" fill="none" stroke="${C.sky}" stroke-opacity=".28" stroke-width="1.5"/>`; }).join("")
  + [-60, -20, 20, 60].map((lon) => `<ellipse cx="${gx}" cy="${gy}" rx="${(r * Math.abs(Math.sin((lon * Math.PI) / 180))).toFixed(1)}" ry="${r}" fill="none" stroke="${C.sky}" stroke-opacity=".22" stroke-width="1.5"/>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="bg" cx="${gx}" cy="${gy}" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0a1530"/><stop offset="1" stop-color="${C.ink}"/></radialGradient>
<radialGradient id="globe" cx="34%" cy="30%" r="75%"><stop offset="0" stop-color="${C.sky}"/><stop offset=".38" stop-color="#1c4f9e"/><stop offset=".72" stop-color="#07142e"/></radialGradient>
<clipPath id="clip"><circle cx="${gx}" cy="${gy}" r="${r}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${STARS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.6 : 2.4}" fill="${C.text}" fill-opacity=".55"/>`).join("")}
<circle cx="${gx}" cy="${gy}" r="${r + 26}" fill="${C.sky}" fill-opacity=".07"/>
<circle cx="${gx}" cy="${gy}" r="${r}" fill="url(#globe)"/>
<g clip-path="url(#clip)">${lines}</g>
${orbit(gx, gy, 262, 88, -24, C.ion, [0.08, 0.55])}
${orbit(gx, gy, 245, 66, 32, C.violet, [0.3, 0.78])}
${orbit(gx, gy, 226, 226, 0, C.signal, [0.62]).replace('stroke-opacity=".55"', 'stroke-opacity=".3" stroke-dasharray="4 10"')}
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="${FONTS}" rel="stylesheet"><style>
html,body{margin:0;width:${W}px;height:${H}px;background:${C.ink};overflow:hidden}
.card{position:relative;width:${W}px;height:${H}px}
.card svg{position:absolute;inset:0}
.words{position:absolute;left:64px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:22px;font-family:"Hanken Grotesk",sans-serif}
.name{display:flex;align-items:center;gap:18px;font-family:"Bricolage Grotesque",sans-serif;color:${C.text};font-size:58px;font-weight:700;letter-spacing:-.02em;line-height:1.05;white-space:nowrap}
.name i{flex:none;width:22px;height:22px;border-radius:50%;background:${C.ion};box-shadow:0 0 24px ${C.ion}}
.tag{color:${C.muted};font-size:32px;line-height:1.3}
</style></head><body><div class="card">${svg}<div class="words"><div class="name"><i></i><span>Radar Around You</span></div><div class="tag">A free live feed of what is above, around and under you</div></div></div></body></html>`;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() => [document.fonts.check('700 58px "Bricolage Grotesque"'), document.fonts.check('400 32px "Hanken Grotesk"')]);
if (!fonts.every(Boolean)) { await browser.close(); throw new Error(`og-image: the fonts did not load (${fonts}); the image needs the app's own fonts from Google Fonts`); }
const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
fs.mkdirSync(fileURLToPath(new URL("../site/assets/", import.meta.url)), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`og-image: ${out} (${W}x${H}, ${buf.length} bytes)`);
