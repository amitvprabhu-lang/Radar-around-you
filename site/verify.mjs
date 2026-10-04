// Compares what the site computes with the US Naval Observatory's published tables saved in test/fixtures/usno.
// The pages quote these results, so a page never claims a check that was not run. If the fixtures are absent the
// checks return null and the pages leave the claim out.
import fs from "node:fs";
import * as Astro from "astronomy-engine";
import { moonPhases, seasons, eclipses, sunDay } from "./data.mjs";

const dir = new URL("../test/fixtures/usno/", import.meta.url);
const read = (f) => { try { return JSON.parse(fs.readFileSync(new URL(f, dir), "utf8")); } catch { return null; } };
const usnoMs = (e) => Date.UTC(e.year, e.month - 1, e.day, ...e.time.split(":").map(Number));

export function checkPhases() {
  const tables = [read("phases-2026.json"), read("phases-2027.json")];
  if (tables.some((t) => !t)) return null;
  const names = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];
  const ours = moonPhases(2026, 2027);
  let n = 0, worst = 0;
  for (const t of tables) {
    for (const p of t.phasedata) {
      const q = names.indexOf(p.phase), want = usnoMs(p);
      const e = ours.find((x) => x.quarter === q && Math.abs(x.time - want) < 12 * 3600000);
      if (!e) return { n, matched: false };
      worst = Math.max(worst, Math.abs(e.time - want) / 1000);
      n++;
    }
  }
  return { n, total: ours.length, worstSeconds: Math.round(worst), matched: n === ours.length };
}

export function checkSeasons() {
  const tables = [read("seasons-2026.json"), read("seasons-2027.json")];
  if (tables.some((t) => !t)) return null;
  const ours = seasons(2026, 2027);
  let n = 0, worst = 0;
  for (const t of tables) {
    for (const s of t.data.filter((d) => d.phenom === "Equinox" || d.phenom === "Solstice")) {
      const want = usnoMs(s);
      const e = ours.find((x) => Math.abs(x.time - want) < 12 * 3600000);
      if (!e) return { n, matched: false };
      worst = Math.max(worst, Math.abs(e.time - want) / 1000);
      n++;
    }
  }
  return { n, worstSeconds: Math.round(worst), matched: n === ours.length };
}

export function checkSolarEclipses(places) {
  const tables = [read("solar-2026.json"), read("solar-2027.json")];
  if (tables.some((t) => !t)) return null;
  const want = tables.flatMap((t) => t.eclipses_in_year);
  const ours = eclipses(2026, 2027, places).filter((e) => e.body === "sun");
  const ok = want.every((w) => ours.some((e) => e.time.getUTCFullYear() === w.year && e.time.getUTCMonth() === w.month - 1 && e.time.getUTCDate() === w.day && e.kind === w.event.split(" ")[0].toLowerCase()));
  return { n: want.length, matched: ok && ours.length === want.length };
}

// Sunrise and sunset at the six places on both solstices against the USNO rise and set tables.
export function checkSunTimes(places) {
  let n = 0, worst = 0;
  for (const p of places) {
    for (const date of ["2026-06-21", "2026-12-21"]) {
      const t = read(`rstt-${p.id}-${date}.json`);
      if (!t) return null;
      const obs = new Astro.Observer(p.lat, p.lon, 0);
      const start = new Date(`${date}T00:00:00Z`);
      for (const e of t.properties.data.sundata.filter((x) => x.phen === "Rise" || x.phen === "Set")) {
        const ours = Astro.SearchRiseSet(Astro.Body.Sun, obs, e.phen === "Rise" ? +1 : -1, start, 1);
        const want = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), ...e.time.split(":").map(Number));
        if (!ours) return { n, matched: false };
        worst = Math.max(worst, Math.abs(ours.date - want) / 1000);
        n++;
      }
    }
  }
  return { n, worstSeconds: Math.round(worst), matched: worst <= 90 };
}

export function allChecks(places) {
  return { phases: checkPhases(), seasons: checkSeasons(), solarEclipses: checkSolarEclipses(places), sunTimes: checkSunTimes(places) };
}
