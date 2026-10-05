import test from "node:test";
import assert from "node:assert/strict";
import { countSatellites } from "../site/satcount.mjs";
import { satelliteCountPage, SATCOUNT_FILE, sitemapLive, barChartSvg, columnChartSvg } from "../site/pages-satcount.mjs";
import { renderPage, SITE } from "../site/layout.mjs";
import { buildFixture, STANDARD } from "./helpers/satfixture.mjs";

const counts = countSatellites(buildFixture(STANDARD, { newIdx: [1, 6, 8] }));
const updated = new Date("2026-10-05T09:00:00Z");
const page = satelliteCountPage(counts, { updated });
const html = renderPage(page, { noindex: false });
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

test("the page has its own address, one h1 written as the question, and sane title and description lengths", () => {
  assert.equal(SATCOUNT_FILE, "how-many-satellites-in-orbit/index.html");
  assert.equal(page.file, SATCOUNT_FILE);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(page.h1, "How many satellites are in orbit?");
  assert.equal(page.title, "How many satellites are in orbit? Live count, 5 October 2026");
  assert.ok(page.title.length >= 15 && page.title.length <= 85);
  assert.ok(page.description.length >= 60 && page.description.length <= 320, String(page.description.length));
});

test("the answer comes first, and the same number appears in the lead, description, FAQ and structured data", () => {
  assert.match(page.lead, /^As of 5 October 2026, 08:14 UTC, there are <strong>7 active satellites<\/strong> in orbit/);
  assert.match(page.description, /^7 active satellites/);
  const faq = html.slice(html.indexOf('id="faq"'));
  assert.match(faq, /How many satellites are in orbit right now\?[\s\S]*?7 active satellites/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  const webpage = ld.find((o) => o["@type"] === "WebPage");
  assert.ok(webpage && webpage.description.startsWith("7 active satellites"));
  assert.equal(webpage.url, `${SITE.url}/how-many-satellites-in-orbit/`);
});

test("the structured date is the visible page update time, not the data time", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  assert.equal(ld.find((o) => o["@type"] === "WebPage").dateModified, "2026-10-05T09:00:00.000Z");
  assert.ok(html.includes('<time datetime="2026-10-05T09:00:00.000Z">'));
  assert.ok(html.includes('<time datetime="2026-10-05T08:14:54Z">'), "the data time is shown separately");
});

test("every section a reader or an answer engine looks for is there, with question headings", () => {
  for (const id of ["answer", "active", "who", "orbits", "purpose", "growth", "not-counted", "how", "faq", "sources"]) assert.ok(html.includes(` id="${id}"`), id);
  assert.match(html, /<h2 id="not-counted">What this count does not include<\/h2>/);
  assert.match(html, /defunct satellites, rocket bodies/);
});

test("the tables add up to the headline number", () => {
  const rowsOf = (caption) => {
    const m = html.match(new RegExp(`aria-label="${caption}"[\\s\\S]*?</table>`));
    assert.ok(m, caption);
    return [...m[0].matchAll(/<td class="num">([\d,]+)<\/td>/g)].map((x) => Number(x[1].replace(/,/g, "")));
  };
  const sum = (a) => a.reduce((s, n) => s + n, 0);
  assert.equal(sum(rowsOf("Active satellites by owner")), 7);
  assert.equal(sum(rowsOf("Active satellites by orbit")), 7);
  assert.equal(sum(rowsOf("Active satellites by purpose")), 7);
});

test("every chart is an accessible image with a title and a description, and has a text table beside it", () => {
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
  assert.ok(svgs.length >= 4);
  for (const s of svgs) {
    assert.match(s, /role="img"/);
    assert.match(s, /aria-labelledby="([a-z0-9-]+)-t \1-d"/);
    assert.match(s, /<title id="[a-z0-9-]+-t">[^<]+<\/title>/);
    assert.match(s, /<desc id="[a-z0-9-]+-d">[^<]+<\/desc>/);
  }
});

test("names from the data are escaped, and long labels are shortened in the chart but not in the table", () => {
  const evil = { ...counts, owners: [{ name: "<b>X</b> & Co", count: 5 }, { name: "A".repeat(60), count: 2 }], ownersOther: 0, active: 7 };
  const h = renderPage(satelliteCountPage(evil, { updated }), { noindex: false });
  assert.ok(!h.includes("<b>X</b>"));
  assert.ok(h.includes("&lt;b&gt;X&lt;/b&gt; &amp; Co"));
  assert.ok(h.includes("A".repeat(33) + "..."), "chart label is shortened");
  assert.ok(h.includes("A".repeat(60)), "the table keeps the full name");
});

test("the page follows the house style, loads nothing from elsewhere and stays small", () => {
  const text = textOf(html);
  assert.ok(!/[\u2013\u2014]/.test(text), "no en or em dashes");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), "no emoji");
  assert.ok(!/<script[^>]+src=/.test(html) && !/<img /.test(html) && !/<link[^>]+stylesheet/.test(html));
  assert.ok(Buffer.byteLength(html) < 120 * 1024, String(Buffer.byteLength(html)));
  assert.ok(html.includes("CelesTrak"), "the source is credited");
});

test("the live sitemap names the page with an accurate last modified time", () => {
  const xml = sitemapLive("2026-10-05T09:00:00.000Z");
  assert.ok(xml.includes(`<loc>${SITE.url}/how-many-satellites-in-orbit/</loc>`));
  assert.ok(xml.includes("<lastmod>2026-10-05T09:00:00.000Z</lastmod>"));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
});

test("the chart helpers handle one row and a zero maximum", () => {
  assert.match(barChartSvg({ id: "c", title: "t", desc: "d", rows: [{ label: "a", value: 0 }] }), /<rect /);
  assert.match(columnChartSvg({ id: "c", title: "t", desc: "d", rows: [{ label: "2020", value: 3 }] }), /<rect /);
});
