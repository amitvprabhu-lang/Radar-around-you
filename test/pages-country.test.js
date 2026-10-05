import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubPage, countryPage, countryPageSet, COUNTRY_FILES, HUB_FILE, LIVE_FILES, sitemapLive } from "../site/pages-country.mjs";
import { COUNTRY_PAGES, countOwners, ownerPositions, busiestBand } from "../site/satcountry.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";
import { ORBIT_ORDER } from "../site/satcount.mjs";
import { renderPage, SITE, NAV, urlPath } from "../site/layout.mjs";
import { decodeCoast } from "../src/data.js";
import { countryFixture } from "./helpers/satfixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const coastBuf = fs.readFileSync(path.join(root, "public/coast.bin"));
const coast = decodeCoast(coastBuf.buffer.slice(coastBuf.byteOffset, coastBuf.byteOffset + coastBuf.byteLength));
const updated = new Date("2026-10-05T09:00:00Z");
const fx = countryFixture();
const counts = countOwners(fx);
const set = countryPageSet(fx, { coast, updated });
const html = new Map(set.pages.map((p) => [p.file, renderPage(p, { noindex: false })]));
const hub = html.get(HUB_FILE);
const bySlug = (slug) => html.get(COUNTRY_PAGES.find((p) => p.slug === slug).file);
const owner = (name) => counts.owners.find((o) => o.name === name);
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
const num = (n) => n.toLocaleString("en-GB");
const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const tableNums = (h, caption, col = 1) => {
  const m = h.match(new RegExp(`aria-label="${caption.replace(/[()]/g, "\\$&")}"[\\s\\S]*?</table>`));
  assert.ok(m, caption);
  return [...m[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1])).map((cells) => cells[col]);
};
const sum = (a) => a.reduce((s, x) => s + Number(String(x).replace(/,/g, "")), 0);

test("the hub and the five country pages have fixed addresses, one h1 each and sane title and description lengths", () => {
  assert.deepEqual(COUNTRY_FILES, ["united-states", "china", "united-kingdom", "cis-former-ussr", "japan"].map((s) => `satellites-by-country/${s}/index.html`));
  assert.deepEqual(set.pages.map((p) => p.file), [HUB_FILE, ...COUNTRY_FILES]);
  assert.deepEqual(set.skipped, []);
  for (const [f, h] of html) {
    const p = set.pages.find((x) => x.file === f);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, f);
    assert.ok(p.title.length >= 15 && p.title.length <= 85, `${f}: ${p.title.length}`);
    assert.ok(p.description.length >= 60 && p.description.length <= 320, `${f}: ${p.description.length}`);
    assert.ok(h.includes(`<link rel="canonical" href="${SITE.url}/${urlPath(f)}">`), f);
  }
  // the longest month name still fits
  const long = countryPage({ ...counts, taken: "2026-09-30T23:59:00Z" }, COUNTRY_PAGES[3], { updated, coast, positions: [] });
  assert.ok(long.title.length <= 85, long.title);
  assert.equal(bySlug("china").match(/<h1>([^<]*)<\/h1>/)[1], "How many satellites does China have?");
  assert.match(hub, /<h1>Which countries have the most satellites\?<\/h1>/);
});

test("every country page has the sections a reader looks for, and the answer comes first", () => {
  for (const p of COUNTRY_PAGES) {
    const h = html.get(p.file), o = owner(p.owner);
    for (const id of ["answer", "orbits", "map", "purpose", "growth", "how", "faq", "sources"]) assert.ok(h.includes(` id="${id}"`), `${p.slug}: ${id}`);
    const lead = h.match(/<p class="lead">([\s\S]*?)<\/p>/)[1];
    assert.equal(textOf(lead), `As of 5 October 2026, 08:14 UTC, the catalogue records ${num(o.active)} active satellites for ${p.owner}, ${pct(o.active / counts.active)} percent of the world's active satellites.`);
    assert.match(h, /<p>More live counts: /);
  }
  for (const id of ["answer", "pages", "ranking", "concentration", "read", "how", "faq", "sources"]) assert.ok(hub.includes(` id="${id}"`), `hub: ${id}`);
});

test("the numbers on each country page match countOwners", () => {
  for (const p of COUNTRY_PAGES) {
    const h = html.get(p.file), o = owner(p.owner), t = textOf(h);
    const orbitCaption = `Active satellites of ${p.owner} by orbit, against all active satellites`;
    assert.deepEqual(tableNums(h, orbitCaption).map((x) => Number(x.replace(/,/g, ""))), ORBIT_ORDER.map((k) => o.orbits[k]), p.slug);
    assert.deepEqual(tableNums(h, orbitCaption, 3), ORBIT_ORDER.map((k) => { const x = counts.orbits[k] / counts.active; return x > 0 && x < 0.0005 ? "under 0.1" : pct(x); }), `${p.slug}: world shares`);
    assert.equal(sum(tableNums(h, `Active satellites of ${p.owner} by purpose`)), o.active, `${p.slug}: purposes`);
    assert.equal(sum(tableNums(h, `Active satellites of ${p.owner} by launch year`)), o.active, `${p.slug}: launch years`);
    assert.ok(t.includes(`${num(o.last30)} Launched in the 30 days before the data time`), `${p.slug}: last 30 days card`);
    const band = busiestBand(ownerPositions(fx, p.owner));
    assert.ok(t.includes(`with ${num(band.count)} of these satellites, ${pct(band.share)} percent`), `${p.slug}: busiest band sentence`);
    assert.match(h, /<svg [^>]*class="map" role="img"/, `${p.slug}: map`);
  }
  const us = textOf(bySlug("united-states"));
  assert.ok(us.includes("70 Starlink satellites, 53.8 percent of this owner's active satellites"), "Starlink card");
  assert.ok(us.includes("the largest fleet of the 6 owners with at least one active satellite"), "rank, with the unrecorded owner left out");
  assert.ok(!textOf(bySlug("china")).includes("Starlink satellites,"), "no Starlink card when there are none");
  assert.ok(textOf(bySlug("china")).includes("2nd of 6"));
});

test("the busiest band and orbit sentences are computed, not typed", () => {
  const cis = textOf(bySlug("cis-former-ussr")), o = owner("Commonwealth of Independent States (former USSR)");
  const share = (k) => pct(o.orbits[k] / o.active), world = (k) => pct(counts.orbits[k] / counts.active);
  assert.ok(cis.includes(`Most of them, ${share("medium")} percent, are in medium Earth orbit, against ${world("medium")} percent of all active satellites.`), "largest orbit group");
  assert.ok(cis.includes(`also has a larger share of its fleet in high elliptical orbits (${share("highElliptical")} percent) than the catalogue as a whole (${world("highElliptical")} percent)`));
  const t = (slug) => textOf(bySlug(slug));
  assert.ok(t("united-states").includes("The most common recorded purpose is Broadband internet, with 70 satellites, 53.8 percent."));
  const nr = owner("Not recorded");
  assert.equal(nr.purposes[0].name, "Unspecified");
  const jp = textOf(bySlug("japan"));
  assert.ok(jp.includes("The largest group, 50.0 percent, are in low Earth orbit"), "a tie keeps the first group and is not called most");
  assert.ok(jp.includes("the geostationary belt"));
});

test("an owner whose largest purpose is Unspecified, or whose largest orbit group is below the world's share, is described truthfully", () => {
  const jp = owner("Japan");
  const changed = { ...jp, purposes: [{ name: "Unspecified", count: 30 }, { name: "Communications", count: 22 }], orbits: { low: 30, medium: 22, geostationary: 0, highElliptical: 0, beyond: 0 } };
  const c2 = { ...counts, owners: counts.owners.map((o) => (o === jp ? changed : o)) };
  const t = textOf(renderPage(countryPage(c2, COUNTRY_PAGES[4], { updated, coast, positions: [] })));
  assert.ok(t.includes(`30 of them, ${pct(30 / 52)} percent, have no purpose grouping in the catalogue. The most common recorded purpose is Communications, with 22 satellites`));
  assert.ok(t.includes(`Most of them, ${pct(30 / 52)} percent, are in low Earth orbit, against ${pct(counts.orbits.low / counts.active)} percent`));
  assert.ok(t.includes("Japan has a larger share of its fleet in medium Earth orbit") && !t.includes("Japan also has"), "no 'also' when the largest group is below the world's share");
});

test("the hub ranks every owner with an active satellite, adds up and links to exactly the five country pages", () => {
  const ranks = tableNums(hub, "Every owner with an active satellite, ranked", 0);
  assert.deepEqual(ranks, ["1", "2", "3", "4", "5", "6", ""], "six ranked owners and the unrecorded row");
  assert.equal(sum(tableNums(hub, "Every owner with an active satellite, ranked", 2)), counts.active);
  assert.ok(!hub.includes("Empty Owner"), "an owner with no active satellite is not ranked");
  const targets = new Set([...hub.matchAll(/href="([^"#]*)"/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l)).map((l) => path.posix.normalize(path.posix.join("satellites-by-country", l)).replace(/\/$/, "")).filter((t) => t.startsWith("satellites-by-country/")));
  assert.deepEqual([...targets].sort(), COUNTRY_PAGES.map((p) => `satellites-by-country/${p.slug}`).sort());
  const t = textOf(hub);
  assert.ok(t.includes(`6 owners in the catalogue have at least one active satellite. The United States has the most, ${num(130)} active satellites, ${pct(130 / 402)} percent of all 402 active satellites.`));
  assert.ok(t.includes(`The top three owners together hold ${pct((130 + 90 + 66) / 402)} percent`));
  assert.ok(t.includes("Every Starlink satellite in the data, 70 of them, is recorded under United States."));
  assert.ok(t.includes(`Leaving Starlink out, the United States has 60 of the other 332 active satellites, ${pct(60 / 332)} percent.`));
});

test("internal links on every live page resolve to pages the site builds", () => {
  const known = new Set(["index.html", "methods/index.html", ...LIVE_FILES, ...NAV.map(([f]) => (f === "" ? "index.html" : f + "index.html"))]);
  for (const [f, h] of html) {
    for (const m of h.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/ href="([^"]*)"/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      const [p] = m[1].split("#");
      let target = p === "" ? f : path.posix.normalize(path.posix.join(path.posix.dirname(f), p));
      if (target === "." || target === "./") target = "index.html";
      if (target.endsWith("/")) target += "index.html";
      assert.ok(known.has(target), `${f}: ${m[1]} -> ${target}`);
    }
  }
});

test("the five pages differ in more than the owner name", () => {
  const strip = (p) => {
    let t = textOf(html.get(p.file));
    for (const q of COUNTRY_PAGES) for (const s of [q.owner, q.name, q.phrase, q.slug, q.phrase.charAt(0).toUpperCase() + q.phrase.slice(1)]) t = t.split(s).join("NAME");
    return t.replace(/\s+/g, " ");
  };
  const texts = COUNTRY_PAGES.map(strip);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) assert.notEqual(texts[i], texts[j], `${COUNTRY_PAGES[i].slug} and ${COUNTRY_PAGES[j].slug}`);
});

test("the CIS page keeps the catalogue's name and never says Russia", () => {
  const h = bySlug("cis-former-ussr");
  assert.ok(!/russia/i.test(h));
  assert.ok(textOf(h).includes('Why does this page say "Commonwealth of Independent States (former USSR)"?'));
  assert.ok(!textOf(bySlug("united-states")).includes("Why does this page say"), "only where the short name differs from the catalogue's");
});

test("house style: no dashes, no emoji, no hidden text, no FAQ markup, nothing loaded from elsewhere, a dated WebPage", () => {
  for (const [f, h] of html) {
    const t = textOf(h);
    assert.ok(!/[–—]/.test(h), `${f}: en or em dash`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), `${f}: emoji`);
    assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), `${f}: hidden text`);
    assert.ok(!/<script[^>]+src=/.test(h) && !/<img /.test(h) && !/<link[^>]+stylesheet/.test(h), f);
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
    assert.ok(!ld.some((o) => o["@type"] === "FAQPage" || o["@type"] === "Dataset"), f);
    assert.equal(ld.find((o) => o["@type"] === "WebPage").dateModified, "2026-10-05T09:00:00.000Z", f);
    assert.ok(t.includes("CelesTrak"), `${f}: credit`);
  }
});

test("each page stays under 400 KB, also with the bundled snapshot's full fleets", () => {
  for (const [f, h] of html) assert.ok(Buffer.byteLength(h) < 400 * 1024, `${f}: ${Buffer.byteLength(h)}`);
  const real = { meta: JSON.parse(fs.readFileSync(path.join(root, "public/meta.json"), "utf8")), details: fs.readFileSync(path.join(root, "public/details.bin")), swarm: fs.readFileSync(path.join(root, "public/swarm.bin")) };
  const r = countryPageSet(real, { coast, updated });
  assert.equal(r.pages.length, 6);
  for (const p of r.pages) {
    const h = renderPage(p, { noindex: false });
    assert.ok(Buffer.byteLength(h) < 400 * 1024, `${p.file}: ${Buffer.byteLength(h)}`);
    assert.ok(!/[–—]/.test(h), p.file);
  }
  assert.ok(!/russia/i.test(renderPage(r.pages.find((p) => p.file.includes("cis-former-ussr")))));
});

test("a page that trips the guard is skipped with its reason, and no other page links to it", () => {
  const r = countryPageSet(fx, { coast, updated, min: 53 });
  assert.deepEqual(r.skipped.map((s) => s.slug), ["japan"]);
  assert.match(r.skipped[0].reason, /Japan has 52 active satellites, under 53/);
  for (const p of r.pages) assert.ok(!renderPage(p).includes('japan/"'), `${p.file} links to the skipped page`);
  assert.equal(r.pages.length, 5);
});

test("a country page for an owner with no active satellite is refused", () => {
  assert.throws(() => countryPage(counts, { ...COUNTRY_PAGES[0], owner: "Empty Owner" }, { updated, coast, positions: [] }), /no active satellites/);
  assert.doesNotThrow(() => hubPage({ ...counts, owners: [], active: 0 }, { updated, pages: [] }));
});

test("the live sitemap lists every live page by default, or the pages given", () => {
  assert.deepEqual(LIVE_FILES, [SATCOUNT_FILE, HUB_FILE, ...COUNTRY_FILES]);
  const xml = sitemapLive("2026-10-05T09:00:00.000Z");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, LIVE_FILES.map((f) => `${SITE.url}/${urlPath(f)}`));
  assert.equal((xml.match(/<lastmod>2026-10-05T09:00:00.000Z<\/lastmod>/g) || []).length, 7);
  assert.equal([...sitemapLive("x", [SATCOUNT_FILE]).matchAll(/<loc>/g)].length, 1);
});
