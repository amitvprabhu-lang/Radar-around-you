import test from "node:test";
import assert from "node:assert/strict";
import { buildLlmsTxt } from "../site/llms.mjs";
import { SATCOUNT_FILE } from "../site/pages-satcount.mjs";

const mk = (file, crumbTitle, description) => ({ file, crumbTitle, h1: crumbTitle, description });
const pages = [
  mk("about/index.html", "About", "What the site is."),
  mk("methods/index.html", "How we know", "The checks.\nOn two lines."),
  mk("moon-phases/index.html", "Moon phases", "Exact dates."), mk("eclipses/index.html", "Eclipses", "Eclipse dates."),
  mk("meteor-showers/index.html", "Meteor showers", "Showers."), mk("planets/index.html", "Planets", "Planet events."),
  mk("seasons/index.html", "Equinoxes and solstices", "Seasons."), mk("constellations/index.html", "Constellations", "88."),
  mk("stars/index.html", "Stars", "Named stars."), mk("sky/index.html", "Sky by city", "Six cities."),
  mk("guides/aurora/index.html", "Aurora", "Aurora guide."), mk("guides/storms/index.html", "Storms", "Storm guide."),
  mk("guides/index.html", "Guides", "Index of guides."),
  mk(SATCOUNT_FILE, "Satellite count", "7 active satellites on 5 October 2026."),
];
const out = buildLlmsTxt({ pages, url: "https://example.org", name: "Radar Around You", summary: "A free live view." });

test("the file follows the llms.txt layout: a name, a summary line, then groups of linked notes", () => {
  const lines = out.split("\n");
  assert.equal(lines[0], "# Radar Around You");
  assert.equal(lines[2], "> A free live view.");
  assert.deepEqual(lines.filter((l) => l.startsWith("## ")), ["## Start here", "## Sky reference", "## Guides", "## Live data"]);
  for (const l of lines.filter((l) => l.startsWith("- "))) assert.match(l, /^- \[[^\]]+\]\(https:\/\/example\.org\/[^)]*\): .+$/, l);
  assert.ok(out.endsWith("\n"));
});

test("it links the app, the About page and the guides, but not the guides index", () => {
  assert.ok(out.includes("- [The live app](https://example.org/): A free live view."));
  assert.ok(out.includes("- [About](https://example.org/about/): What the site is."));
  assert.ok(out.includes("- [Aurora](https://example.org/guides/aurora/): Aurora guide."));
  assert.ok(!out.includes("https://example.org/guides/)"), "the guides index is not listed as a guide");
});

test("a note that spans lines is joined, and the live page's note carries no volatile number", () => {
  assert.ok(out.includes("- [How we know](https://example.org/methods/): The checks. On two lines."));
  assert.ok(out.includes("- [Satellite count](https://example.org/how-many-satellites-in-orbit/): A live count of active satellites in orbit, with breakdowns by owner, orbit, purpose and launch year."));
  assert.ok(!out.includes("7 active satellites"));
});

test("a missing page is an error, so a broken list can never ship quietly", () => {
  assert.throws(() => buildLlmsTxt({ pages: pages.filter((p) => p.file !== "about/index.html"), url: "https://example.org", name: "N", summary: "S" }), /no page about\/index\.html/);
});

test("the text has no en or em dashes", () => {
  assert.ok(!/[\u2013\u2014]/.test(out));
});
