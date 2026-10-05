// The full list of pages for the content site. Pure: no file access, so tests can build it and inspect it.
import { moonPage, seasonsPage, eclipsesPage, planetsPage, showersPage } from "./pages-data.mjs";
import { cityPage, citiesIndex, constellationPage, constellationsIndex, starsIndex } from "./pages-places.mjs";
import { satelliteCountPage } from "./pages-satcount.mjs";
import { auroraGuide, stormGuide, quakeGuide, fireGuide, asteroidGuide, satelliteGuide, guidesIndex, methodsPage } from "./pages-guides.mjs";

// cities: [{ id, name, country, lat, lon, tz }], consIdx: indexConstellations(doc), starsDoc: public/starnames.json,
// checks: allChecks(cities), which may hold nulls when the comparison tables are absent
export function buildPages({ cities, consIdx, starsDoc, checks, details = null, satcount = null, updated = null }) {
  const guides = [auroraGuide(), stormGuide(), quakeGuide(), fireGuide(), asteroidGuide(), satelliteGuide()];
  return [
    moonPage(checks), seasonsPage(checks, cities), eclipsesPage(checks, cities), planetsPage(), showersPage(cities),
    citiesIndex(cities), ...cities.map((c) => cityPage(c, cities, consIdx, checks)),
    constellationsIndex(consIdx), ...consIdx.list.map((c) => constellationPage(c, consIdx, starsDoc, cities, details)),
    starsIndex(starsDoc, consIdx, details),
    guidesIndex(guides), ...guides, methodsPage(checks),
    ...(satcount ? [satelliteCountPage(satcount, { updated })] : []),
  ];
}
