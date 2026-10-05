import test from "node:test";
import assert from "node:assert/strict";
import { aboutPage, ABOUT_FILE } from "../site/pages-about.mjs";
import { renderPage, SITE } from "../site/layout.mjs";

const page = aboutPage();
const html = renderPage(page, { noindex: false });
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const words = (text.match(/\b[\w'-]+\b/g) || []).length;

test("the page has its own address, one h1, and sane title and description lengths", () => {
  assert.equal(ABOUT_FILE, "about/index.html");
  assert.equal(page.file, ABOUT_FILE);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.equal(page.h1, "What is Radar Around You?");
  assert.ok(page.title.length >= 15 && page.title.length <= 85, String(page.title.length));
  assert.ok(page.description.length >= 60 && page.description.length <= 320, String(page.description.length));
});

test("it is rich in plain text and has every section", () => {
  assert.ok(words >= 700, `only ${words} words`);
  for (const id of ["what", "feeds", "features", "data", "fresh", "limits", "privacy", "free", "method", "faq", "sources"]) assert.ok(html.includes(` id="${id}"`), id);
  for (const q of ["Which live feeds does it show?", "What can you do with it?", "Where does the data come from?", "How fresh is the data?", "What does it not do?", "Does it know where I am?", "Is it free?"]) assert.ok(html.includes(`>${q}<`), q);
});

test("every data source is named, and the sources with a verified address are linked", () => {
  for (const name of ["U.S. Geological Survey", "GDACS", "NOAA National Hurricane Center", "NOAA Space Weather Prediction Center", "NASA FIRMS", "CelesTrak", "adsb.lol", "MET Norway", "The Space Devs", "NASA JPL", "IAU", "HYG", "NASA Exoplanet Archive", "GeoNames", "astronomy-engine"]) {
    assert.ok(text.includes(name), name);
  }
  for (const url of ["https://api.adsb.lol", "https://thespacedevs.com/llapi", "https://www.gdacs.org/About/overview.aspx", "https://codeberg.org/astronexus/hyg", "https://celestrak.org/"]) assert.ok(html.includes(`href="${url}"`), url);
});

test("the aircraft source is credited with its licence, and the data-terms sentence is present", () => {
  assert.match(text, /adsb\.lol/);
  assert.match(text, /ODbL 1\.0/);
  assert.match(text, /keeps the terms of its source/);
});

test("it links to the guides and reference pages that explain each feature", () => {
  for (const to of ["../guides/aurora/", "../guides/storms/", "../guides/earthquakes/", "../guides/fires/", "../guides/asteroids/", "../guides/satellites/", "../moon-phases/", "../eclipses/", "../planets/", "../meteor-showers/", "../constellations/", "../stars/", "../sky/", "../methods/", "../how-many-satellites-in-orbit/", "../"]) {
    assert.ok(html.includes(`href="${to}"`), to);
  }
});

test("the site is positioned as a live feed, and what the feeds do is stated", () => {
  assert.match(text, /live feed/);
  assert.match(text, /Reload prompt/);
  assert.match(page.title, /live feed/);
  assert.match(page.lead, /live feed/);
  assert.match(page.description, /live feed/);
  const feeds = html.slice(html.indexOf('id="feeds"'), html.indexOf('id="features"'));
  assert.ok(feeds.includes(">Which live feeds does it show?<"));
  assert.match(feeds, /without a reload/);
  assert.match(feeds, /clock chip shows SNAPSHOT instead of LIVE/);
  assert.ok(html.indexOf('id="what"') < html.indexOf('id="feeds"') && html.indexOf('id="feeds"') < html.indexOf('id="features"'), "feeds sits between what and features");
});

test("privacy, limits and the free licence are stated", () => {
  assert.match(text, /never leaves the device/);
  assert.match(text, /never recorded or sent/);
  assert.match(text, /not an emergency warning service/);
  assert.match(text, /Sky Lens is new and has not yet been tested on a real phone/);
  assert.match(text, /heat signal, not a confirmed wildfire/);
  assert.match(text, /MIT licence/);
  assert.match(text, /weather or hazard forecasts of its own/);
  assert.match(text, /launched in the last 30 days come from SGP4/);
  assert.match(text, /no more often than its published guidance allows/);
  assert.match(text, /Pune, New York, London, Troms\u00f8?[a-z]*, Tokyo and Sydney|Pune, New York, London, Tromso, Tokyo and Sydney/);
});

test("the structured data is an AboutPage with no invented date, and there is no FAQ markup", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<")));
  const about = ld.find((o) => o["@type"] === "AboutPage");
  assert.ok(about, "AboutPage present");
  assert.equal(about.url, `${SITE.url}/about/`);
  assert.equal(about.about["@type"], "WebApplication");
  assert.equal(about.dateModified, undefined);
  assert.ok(!ld.some((o) => o["@type"] === "FAQPage"));
});

test("there is no hidden text and no volatile number, and the house style holds", () => {
  assert.ok(!/\bhidden\b|display:\s*none|aria-hidden|sr-only|visually-hidden/i.test(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), "no hidden text markup");
  const bigNumbers = (text.match(/\b\d{1,3}(?:,\d{3})+\b/g) || []).filter((n) => n !== "15,000");
  assert.deepEqual(bigNumbers, [], "no comma-grouped counts other than 15,000");
  assert.ok(!/[\u2013\u2014]/.test(html), "no en or em dashes");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), "no emoji");
  assert.ok(!/<script[^>]+src=/.test(html) && !/<img /.test(html));
});

test("the FAQ is visible text with the questions as headings", () => {
  const faq = html.slice(html.indexOf('id="faq"'), html.indexOf('id="sources"'));
  const questions = [...faq.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(questions, ["What is Radar Around You?", "Is it free?", "Where does the data come from?", "Does it work for my town?", "Does it know where I am?", "Is it a forecast or a warning service?"]);
});
