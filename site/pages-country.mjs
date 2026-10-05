// The satellites by country pages: a hub that ranks every owner, and one page for each owner in COUNTRY_PAGES. Pure: takes the counts from
// site/satcountry.mjs (and the positions and coastlines for the map) and returns page objects for renderPage. Every figure comes from the
// feed; the only typed text is method and caveats, which match docs/satcountry-sources.md and the code. Owners keep the catalogue's names.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";
import { ORBIT_ORDER, ORBIT_LABELS, ORBIT_CHART_LABELS, ORBIT_BOUNDS } from "./satcount.mjs";
import { COUNTRY_PAGES, HUB_FILE, NOT_RECORDED, MIN_ACTIVE_FOR_PAGE, NEAR_EQUATOR_DEG, countOwners, ownerPositions, pageGuard, latitudeSummary, isDesignatorOnly, launchOf } from "./satcountry.mjs";
import { SATCOUNT_FILE, LIVE_FILES, sitemapLive, barChartSvg, columnChartSvg, num, pct, dateLong, timeUtc, CELESTRAK, SATCAT, STATUS } from "./pages-satcount.mjs";
import { worldMapSvg, uniqueDots } from "./svgmap.mjs";
import { decodeCoast } from "../src/data.js";

export { HUB_FILE, LIVE_FILES, sitemapLive };
// The table the collector reads to turn each catalogue owner code into a name (pipeline/feeds.py fetches this page).
const OWNERS = { title: "CelesTrak SATCAT source codes", url: "https://celestrak.org/satcat/sources.php", note: "The owner names, one for each owner code in the catalogue" };
export const COUNTRY_FILES = COUNTRY_PAGES.map((p) => p.file);

// public/coast.bin (the app's coastlines) read with fs, as polylines of [lat, lon]. decodeCoast wants an ArrayBuffer, not a Node Buffer.
export const coastFromBuffer = (buf) => decodeCoast(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`; };
const share = (part, whole) => (whole ? part / whole : 0);
// a share too small to show with one decimal is written as words, so a table never shows a misleading 0.0
const pctText = (x) => (x > 0 && x < 0.0005 ? "under 0.1" : pct(x));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "a", "a and b", "a, b and c"
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
// at most n items, then "and N <rest>"
const capList = (list, n, rest) => (list.length > n ? `${list.slice(0, n).join(", ")} and ${list.length - n} ${rest}` : and(list));
// the singular or plural form for a count
const v = (n, one, many) => (n === 1 ? one : many);
const FAMILY_GROUP_MIN = 5;
const ORBIT_SHORT = { low: "Low", medium: "Medium", geostationary: "Geostationary", highElliptical: "High elliptical", beyond: "Beyond geostationary" };
// lower case orbit names for sentences, built from the same groups as ORBIT_LABELS
const ORBIT_PROSE = { low: "low Earth orbit", medium: "medium Earth orbit", geostationary: "the geostationary belt", highElliptical: "high elliptical orbits", beyond: "orbits beyond the geostationary belt" };
// "30 to 60 degrees north", "the equator to 30 degrees south"
export const bandLabel = (b) => {
  const south = b.to <= 0, near = south ? -b.to : b.from, far = south ? -b.from : b.to, side = south ? "south" : "north";
  return near === 0 ? `the equator to ${far} degrees ${side}` : `${near} to ${far} degrees ${side}`;
};
// in a sentence, an owner with a page reads as its phrase ("The United States"); every other owner, and every table, keeps the catalogue's name
const said = (o, start = true) => { const p = COUNTRY_PAGES.find((x) => x.owner === o.name); return esc(p ? (start ? cap(p.phrase) : p.phrase) : o.name); };
const ranked = (counts) => counts.owners.filter((o) => o.active > 0 && o.name !== NOT_RECORDED);
const yearRowsOf = (launchYears) => {
  const keep = launchYears.slice(-15), earlier = launchYears.slice(0, -15).reduce((s, y) => s + y.count, 0);
  return (earlier ? [{ label: "Earlier", value: earlier }] : []).concat(keep.map((y) => ({ label: String(y.year), value: y.count })));
};
const metaLine = (taken, upIso) => `Data as of <time datetime="${esc(taken)}">${esc(dateLong(taken))}, ${esc(timeUtc(taken))}</time>. Page updated <time datetime="${esc(upIso)}">${esc(dateLong(upIso))}, ${esc(timeUtc(upIso))}</time>. Satellite data from CelesTrak.`;
const webPage = (name, description, file, upIso) => ({ "@context": "https://schema.org", "@type": "WebPage", name, description, url: `${SITE.url}/${urlPath(file)}`, dateModified: upIso });

// "the CIS (former USSR)'s" reads badly, so sentences use "this fleet" or the phrase without a possessive.
const methodItems = (from) => [
  `Source: CelesTrak's current orbital element sets for its active list, with each object's owner, launch date, type and status from CelesTrak's satellite catalogue. The data time at the top of each page is when we last read them.`,
  "An active satellite is a catalogue satellite with a status of Operational, Partially operational, Backup or standby, Spare or Extended mission. This is our definition, not CelesTrak's, so every share on these pages is a share of our count.",
  `The owner is the catalogue's owner field, shown exactly as the catalogue records it. Each satellite has one owner, so it is counted once. A satellite with no owner recorded is counted as "${NOT_RECORDED}" and not ranked.`,
  "Starlink satellites are those whose catalogue name contains STARLINK.",
  `The orbit groups are our working definitions: eccentricity of ${ORBIT_BOUNDS.ellipticalAt} or more is high elliptical; otherwise mean altitude below ${num(ORBIT_BOUNDS.lowBelow)} km is low, from ${num(ORBIT_BOUNDS.lowBelow)} km up to ${num(ORBIT_BOUNDS.mediumBelow - 1)} km is medium, ${num(ORBIT_BOUNDS.mediumBelow)} to ${num(ORBIT_BOUNDS.geoUpTo)} km is the geostationary belt, and anything higher is beyond it.`,
  "Name families on the country pages are our own grouping by the run of letters at the start of each catalogue name (\"DMC3\" counts as DMC, \"SDA_1664\" as SDA). A name that is only a launch designator such as 2026-205A (an object not named yet), or that does not start with letters, has no family, and those satellites are counted separately. The catalogue uses more than one name prefix for some fleets, and we do not merge families.",
  "Purposes are CelesTrak's own groupings, a convenience and not a statement of a satellite's mission. \"Unspecified\" means the catalogue has no grouping for that satellite.",
  "Launch years count the satellites still active now by the year they were launched. They are not counts of launches in each year, because satellites launched earlier and since retired are not in them. \"Launched in the last 30 days\" means launched in the 30 days before the data time.",
  `The maps on the country pages show the point on the ground below each satellite at the data time, worked out from its orbital elements with the two-body orbit and main J2 drift the live globe uses for its swarm, not with SGP4. The positions are approximate, and a satellite within ${NEAR_EQUATOR_DEG} degree of the equator is not counted as north or south of it. Positions are rounded to 0.1 degree for drawing. A map does not move after its page is built; the coastlines are the live globe's own.`,
  `The totals are the same ones the <a href="${href(from, SATCOUNT_FILE)}">satellite count page</a> shows, split by owner. The pages are rebuilt when a new version of the satellite data arrives.`,
];
const METHOD_ID = "method";

// pages: the country pages built in this run, so the hub never links to a page that was skipped.
export function hubPage(counts, { updated, pages = COUNTRY_PAGES }) {
  const upIso = updated.toISOString(), file = HUB_FILE;
  const date = dateLong(counts.taken), time = timeUtc(counts.taken);
  const rows = ranked(counts), lead = rows[0];
  const total = counts.active;
  const top = (n) => rows.slice(0, n).reduce((s, o) => s + o.active, 0);
  const small = rows.filter((o) => o.active < 10).length;
  const notRecorded = counts.owners.find((o) => o.name === NOT_RECORDED && o.active > 0);
  const pageFor = new Map(pages.map((p) => [p.owner, p]));
  const starOwners = rows.filter((o) => o.starlink > 0);
  const tbd = rows.find((o) => o.name === "To Be Determined");
  const cis = rows.find((o) => o.name === "Commonwealth of Independent States (former USSR)");
  const leadShare = pct(share(lead ? lead.active : 0, total));
  const title = `Satellites by country: live ranking, ${date}`;
  const description = lead
    ? `${said(lead)} has ${num(lead.active)} of the ${num(total)} active satellites in our count on ${date} (${leadShare} percent). Every owner in CelesTrak's catalogue, ranked.`
    : `No owner has an active satellite in the data of ${date}. Every owner in CelesTrak's satellite catalogue, ranked by active satellites.`;

  const ownerCell = (o) => (pageFor.has(o.name) ? `<a href="${href(file, pageFor.get(o.name).file)}">${esc(o.name)}</a>` : esc(o.name));
  const tableRows = rows.map((o, i) => [String(i + 1), ownerCell(o), num(o.active), pctText(share(o.active, total)), num(o.starlink)])
    .concat(notRecorded ? [["", "Owner not recorded", num(notRecorded.active), pctText(share(notRecorded.active, total)), num(notRecorded.starlink)]] : []);
  const withPage = pages.map((p) => ({ p, o: counts.owners.find((r) => r.name === p.owner) })).filter((x) => x.o);
  const cards = withPage.map(({ p, o }) => `<li><a class="card" href="${href(file, p.file)}"><b>${esc(p.name)}</b><span>${num(o.active)} active satellites, ${pct(share(o.active, total))} percent</span></a></li>`).join("");
  let starText = "";
  if (starOwners.length === 1 && lead) {
    const s = starOwners[0];
    starText = ` Every Starlink satellite in the data, ${num(s.starlink)} of them, is recorded under ${said(s, false)}.`;
    if (s === lead && total > s.starlink) starText += ` Leaving Starlink out, ${said(s, false)} has ${num(s.active - s.starlink)} of the other ${num(total - s.starlink)} active satellites, ${pct(share(s.active - s.starlink, total - s.starlink))} percent.`;
  }
  // the orbit groups of the owners with a page against all active satellites, so the method's orbit definitions describe something shown here
  const orbitRows = withPage.map(({ p, o }) => [`<a href="${href(file, p.file)}">${esc(p.name)}</a>`, ...ORBIT_ORDER.map((k) => num(o.orbits[k]))])
    .concat([["All active satellites", ...ORBIT_ORDER.map((k) => num(counts.orbits[k]))]]);

  const body = lead ? `
<ul class="grid">
<li><div class="card"><b>${num(rows.length)}</b><span>Owners with at least one active satellite</span></div></li>
<li><div class="card"><b>${leadShare} percent</b><span>Share of the top owner, ${esc(lead.name)}</span></div></li>
<li><div class="card"><b>${pct(share(top(3), total))} percent</b><span>Share of the top three owners together</span></div></li>
</ul>

<h2 id="answer">The largest satellite owners</h2>
<p>${said(lead)} has the most, with ${num(lead.active)} of the ${num(total)} active satellites in our count, ${leadShare} percent, as of ${esc(date)}. Owners are shown as the catalogue records them, which mixes countries and organisations.</p>
${withPage.length ? `
<h2 id="pages">Owners with their own page</h2>
<p>These owners have a page with their satellites by orbit, purpose and launch year, and a map of where they are.</p>
<ul class="grid">${cards}</ul>
` : ""}
<h2 id="ranking">All owners ranked by active satellites</h2>
${barChartSvg({ id: "chart-owners", title: "Active satellites by owner", desc: `The ${Math.min(10, rows.length)} owners with the most active satellites. ${lead.name} is highest with ${num(lead.active)}.`, rows: rows.slice(0, 10).map((o) => ({ label: o.name, value: o.active })) })}
${table({ caption: "Every owner with an active satellite, ranked", head: ["Rank", "Owner, as recorded", "Active satellites", "Share of all active (percent)", "Starlink"], numeric: [0, 2, 3, 4], rows: tableRows })}

<h2 id="concentration">How concentrated is the fleet?</h2>
<p>${said(lead)} holds ${leadShare} percent of all active satellites in our count. The top three owners together hold ${pct(share(top(3), total))} percent and the top ten ${pct(share(top(10), total))} percent. ${num(small)} of the ${num(rows.length)} owners have fewer than 10 active satellites each.${starText}</p>

<h2 id="orbits">Orbit groups</h2>
<p>Where the satellites of the owners with their own page are, against all active satellites, using the orbit groups defined below.</p>
${table({ caption: "Active satellites by orbit group", head: ["Owner", ...ORBIT_ORDER.map((k) => ORBIT_CHART_LABELS[k])], numeric: [1, 2, 3, 4, 5], rows: orbitRows })}

<h2 id="read">How to read this table</h2>
<ul>
<li>The owner is the catalogue's owner field, shown exactly as the catalogue records it. It mixes countries and organisations, so a satellite recorded under an organisation is counted under that organisation and not under any country.</li>
${cis ? `<li>The fleet the catalogue records as "${esc(cis.name)}" is shown under that name. We do not split it or rename it.</li>\n` : ""}${tbd ? `<li>"${esc(tbd.name)}" is an entry in the catalogue's owner list, not a place. We show it as recorded.</li>\n` : ""}${notRecorded ? `<li>"Owner not recorded" counts active satellites whose catalogue record names no owner. It is not ranked.</li>\n` : ""}<li>Share is the owner's active satellites as a percentage of all ${num(total)} active satellites in our count.</li>
</ul>
` : `
<h2 id="answer">No owner to rank</h2>
<p>The satellite data of ${esc(date)} has no active satellite with an owner, so there is nothing to rank. The next version of the data will be counted when it arrives.</p>
`;
  const tail = `
<h2 id="${METHOD_ID}">How these numbers are made</h2>
<p>This is the method for this page and for every country page linked from it.</p>
<ul>${methodItems(file).map((t) => `<li>${t}</li>`).join("")}</ul>

<h2 id="faq">Frequently asked questions</h2>
<h3>Which country has the most satellites?</h3>
<p>${lead ? `${said(lead)}, with ${num(lead.active)} active satellites as of ${esc(date)}, as the catalogue records owners.` : "No owner has an active satellite in this data."}</p>
<h3>How many countries have satellites?</h3>
<p>${num(rows.length)} owners in the catalogue have at least one active satellite. That is not a count of countries, because the owner list mixes countries and organisations.</p>
<h3>Does this count every satellite a country uses?</h3>
<p>No. It counts active satellites by the owner the catalogue records. A satellite recorded under another owner, such as an organisation, is counted under that owner.</p>
<h3>Are the maps on the country pages live?</h3>
<p>No. Each shows where the satellites were at the data time and is redrawn when the page is rebuilt. The live globe shows them moving.</p>
${sources([CELESTRAK, SATCAT, OWNERS, STATUS])}`;

  return {
    file, crumbTitle: "Satellites by country",
    title, description,
    h1: "Which countries have the most satellites?", kicker: "Live ranking",
    lead: lead
      ? `As of ${esc(date)}, ${esc(time)}, ${num(rows.length)} owners in the catalogue have at least one active satellite. ${said(lead)} has the most, <strong>${num(lead.active)} active satellites</strong>, ${leadShare} percent of all ${num(total)} active satellites in our count.`
      : `As of ${esc(date)}, ${esc(time)}, no owner in the catalogue has an active satellite.`,
    meta: metaLine(counts.taken, upIso),
    cta: { label: "See them on the live globe", query: "" },
    body: body + tail,
    jsonld: [webPage(title, description, file, upIso)],
  };
}

// The map's text about latitude, from latitudeSummary. Points within NEAR_EQUATOR_DEG of the equator are reported, not placed north or south.
export function mapSummaryText(points) {
  const s = latitudeSummary(points);
  if (!s.total) return "";
  const geo = s.nearGeo ? ` (${s.nearGeo === s.near ? "all" : num(s.nearGeo)} geostationary)` : "";
  const nearText = s.near ? `${s.considered ? "" : "All "}${num(s.near)} within ${NEAR_EQUATOR_DEG} degree of the equator${geo} are not placed north or south.` : "";
  if (!s.considered) return nearText;
  return `${nearText ? nearText + " " : ""}Busiest band${s.near ? " of the rest" : ""}: ${bandLabel(s.band)}, ${pct(s.band.share)} percent; ${pct(share(s.north, s.considered))} percent north of the equator.`;
}

// page: an entry of COUNTRY_PAGES. positions: [lat, lon, orbit] of this owner's active satellites at the data time (ownerPositions).
// coast: decoded coastlines. pages: the country pages built in this run, for the link row.
export function countryPage(counts, page, { updated, positions, coast, pages = COUNTRY_PAGES }) {
  const o = counts.owners.find((r) => r.name === page.owner);
  if (!o || o.active === 0) throw new Error(`pages-country: ${page.owner} has no active satellites; check pageGuard first`);
  const upIso = updated.toISOString(), file = page.file, total = counts.active;
  const date = dateLong(counts.taken), time = timeUtc(counts.taken);
  const rows = ranked(counts), idx = rows.findIndex((r) => r.name === o.name), rank = idx + 1;
  const above = idx > 0 ? rows[idx - 1] : null, below = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  const ownerShare = pct(share(o.active, total));
  const owner = esc(o.name), phrase = esc(page.phrase), Phrase = esc(cap(page.phrase));
  const method = `${href(file, HUB_FILE)}#${METHOD_ID}`;
  const title = `${page.name} satellites: live count, ${date}`;
  const description = `${cap(page.phrase)}: ${num(o.active)} active satellites on ${date}, ${ownerShare} percent of the catalogue's. Orbits, purposes, launch years and a map.`;

  // orbits: this owner against the whole catalogue
  const oShare = (k) => share(o.orbits[k], o.active), wShare = (k) => share(counts.orbits[k], total);
  const over = ORBIT_ORDER.filter((k) => o.orbits[k] > 0 && oShare(k) > wShare(k)).sort((a, b) => (oShare(b) - wShare(b)) - (oShare(a) - wShare(a)))[0];
  // the group where this fleet is most over-represented against the catalogue, if any
  const overText = over ? `${Phrase} leans towards ${ORBIT_PROSE[over]}: ${pct(oShare(over))} percent of its fleet against ${pct(wShare(over))} percent of the catalogue. ` : "";
  const apart = ORBIT_ORDER.reduce((a, k) => (Math.abs(oShare(k) - wShare(k)) > Math.abs(oShare(a) - wShare(a)) ? k : a), ORBIT_ORDER[0]);

  // the map and its text summary
  const pts = positions || [];
  const dots = uniqueDots(pts), lat = latitudeSummary(pts);
  const mapDesc = `${num(dots)} dots for ${num(pts.length)} satellites.${lat.band ? ` Busiest band: ${bandLabel(lat.band)}.` : ""}`;
  const map = worldMapSvg({ coast, points: pts, id: "map", title: `${o.name}: satellite positions, ${time}, ${date}`, desc: mapDesc });

  // purposes: the top eight and the rest; ties for the top recorded purpose are all named
  const topP = o.purposes.slice(0, 8), restP = o.purposes.slice(8).reduce((s, p) => s + p.count, 0);
  const unspecified = o.purposes.find((p) => p.name === "Unspecified");
  const recorded = o.purposes.filter((p) => p.name !== "Unspecified");
  const topRec = recorded.length ? recorded.filter((p) => p.count === recorded[0].count) : [];
  const nextRec = recorded.slice(topRec.length, topRec.length + 3);
  const purposeText = (unspecified && unspecified === o.purposes[0] ? `The catalogue records no purpose grouping for ${pct(share(unspecified.count, o.active))} percent of them. ` : "") +
    (topRec.length ? `The most common recorded purpose ${topRec.length > 1 ? `is shared by ${and(topRec.map((p) => esc(p.name)))}, with ${num(topRec[0].count)} satellites each` : `is ${esc(topRec[0].name)}, with ${num(topRec[0].count)} satellites`}, ${pct(share(topRec[0].count, o.active))} percent${topRec.length > 1 ? " each" : ""}.` : "No purpose grouping is recorded for any of them.") +
    (nextRec.length ? ` After ${topRec.length > 1 ? "them" : "it"} come ${and(nextRec.map((p) => `${esc(p.name)} (${num(p.count)})`))}.` : "");
  // launch years
  const yearRows = yearRowsOf(o.launchYears);
  const y = new Date(counts.taken).getUTCFullYear();
  const recent5 = o.launchYears.filter((r) => r.year >= y - 4).reduce((s, r) => s + r.count, 0);
  const peakN = Math.max(0, ...o.launchYears.map((r) => r.count)), peaks = o.launchYears.filter((r) => r.count === peakN);
  // name families (only when the feed has names): the unnamed are counted, ties are never ranked
  const fams = o.families, top = fams[0], tiedFirst = top ? fams.filter((f) => f.count === top.count) : [];
  const second = fams[tiedFirst.length], tiedSecond = second ? fams.filter((f) => f.count === second.count) : [];
  const familyFaqOk = top && tiedFirst.length === 1 && o.noFamily < top.count - (second ? second.count : 0);
  // OURS: a family's most common CelesTrak group is shown only from 5 satellites up, so one satellite never prints a label for its family
  const famRow = (f) => [esc(f.name), num(f.count), pctText(share(f.count, o.active)), and(f.orbits.map((k) => ORBIT_SHORT[k])),
    f.count < FAMILY_GROUP_MIN ? "Fewer than 5 satellites" : f.purposes.length ? and(f.purposes.map(esc)) : "None recorded"];
  const examples = o.noFamilyExamples.length ? `, such as ${and(o.noFamilyExamples.map(esc))}` : "";
  const noFamilyText = !o.noFamily ? "Every one of these satellites has a name family." : `${num(o.noFamily)} of these satellites (${pct(share(o.noFamily, o.active))} percent) ${v(o.noFamily, "has", "have")} no name family: ` +
    (!o.noFamilyOther ? `${v(o.noFamily, "it has", "they have")} only a launch designator so far.`
      : !o.noFamilyDesignator ? `${v(o.noFamily, "its name does", "their names do")} not start with two or more letters${examples}.`
      : `${num(o.noFamilyDesignator)} ${v(o.noFamilyDesignator, "has", "have")} only a launch designator so far; ${num(o.noFamilyOther)} ${v(o.noFamilyOther, "has a name that does", "have names that do")} not start with two or more letters${examples}.`);
  const otherFams = fams.slice(10).reduce((s2, f) => s2 + f.count, 0);
  // recent launches grouped by launch date; names first, launch designators counted
  const desig = o.recent.filter((r) => isDesignatorOnly(r.name)), named = o.recent.filter((r) => !isDesignatorOnly(r.name));
  const byDate = new Map();
  for (const r of o.recent) { const k = r.date || ""; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(r); }
  const recentRows = [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([d, list]) => {
    const nm = list.filter((r) => !isDesignatorOnly(r.name)).map((r) => r.name), ds = list.filter((r) => isDesignatorOnly(r.name)).map((r) => r.name);
    const launches = [...new Set(ds.map(launchOf))].sort();
    return [d ? esc(dateLong(d)) : "Date not recorded", num(list.length), nm.length ? esc(capList(nm, 3, "more")) : "None",
      ds.length ? `${num(ds.length)} (${esc(launches.join(", "))})` : "None"];
  });
  const n30 = o.recent.length;
  const recentText = !n30 ? "" : desig.length === 0 ? `${n30 === 1 ? "It has" : n30 === 2 ? "Both have" : `All ${num(n30)} have`} a name in the catalogue.`
    : named.length === 0 ? `${n30 === 1 ? "It has" : n30 === 2 ? "Both have" : `All ${num(n30)} have`} only a launch designator so far, for example ${esc(desig[0].name)}, so ${v(n30, "it is", "they are")} not named in the catalogue yet.`
    : `${num(named.length)} ${v(named.length, "has", "have")} a name in the catalogue and ${num(desig.length)} ${v(desig.length, "has", "have")} only a launch designator so far, for example ${esc(desig[0].name)}.`;

  const links = [`<a href="${href(file, HUB_FILE)}">all owners ranked</a>`]
    .concat(pages.filter((p) => p.slug !== page.slug).map((p) => `<a href="${href(file, p.file)}">${esc(p.name)}</a>`));

  const rankBits = [above ? `${said(above)} is ahead with ${num(above.active)}` : "", below ? `${said(below, !above)} follows with ${num(below.active)}` : ""].filter(Boolean).join("; ");
  // Three questions, chosen and answered from this owner's own numbers, so no two pages carry the same set of answers.
  const faq = [
    [`Where does ${page.phrase} rank among satellite owners?`, `${rank === 1 ? "First" : cap(ordinal(rank))}${rankBits ? `. ${rankBits}` : ""}.`],
    o.starlink > 0
      ? ["How much of this fleet is Starlink?", `${pct(share(o.starlink, o.active))} percent. Starlink alone is ${pct(share(o.starlink, total))} percent of our whole count.`]
      : familyFaqOk ? [`Which name family is largest among satellites the catalogue records for ${page.phrase}?`, `${esc(top.name)}, with ${num(top.count)}${second ? `, ahead of ${and(tiedSecond.map((f) => esc(f.name)))} with ${num(second.count)}${tiedSecond.length > 1 ? " each" : ""}` : ""}${o.noFamily ? `; ${num(o.noFamily)} ${v(o.noFamily, "has", "have")} no name family, too few to change that order` : ""}.`]
      : unspecified && (!topRec.length || unspecified.count > topRec[0].count)
        ? [`How many satellites the catalogue records for ${page.phrase} have a purpose group?`, `${num(o.active - unspecified.count)} of the ${num(o.active)}. The other ${num(unspecified.count)} have no recorded group, more than any single group has, so the catalogue cannot say what most of them are for.`]
      : topRec.length ? [`What are most satellites the catalogue records for ${page.phrase} used for?`, `${and(topRec.map((p) => esc(p.name)))}, the largest recorded purpose${topRec.length > 1 ? "s, tied" : ""} (${num(topRec[0].count)}${topRec.length > 1 ? " each" : ""})${unspecified ? `; ${num(unspecified.count)} ${v(unspecified.count, "has", "have")} no grouping` : ""}.`] : null,
    o.last30 > 0
      ? ["How many were launched in the last 30 days?", `${num(o.last30)} of the ${num(counts.last30)} active satellites launched in the 30 days before the data time.`]
      : [`Which orbit group stands out for ${page.phrase}?`, `${cap(ORBIT_PROSE[apart])}: ${pct(oShare(apart))} percent of this fleet, catalogue ${pct(wShare(apart))}.`],
  ].filter(Boolean);

  // orbit groups this owner uses, largest first, each against the catalogue's share
  const used = ORBIT_ORDER.filter((k) => o.orbits[k] > 0).sort((a, b) => o.orbits[b] - o.orbits[a] || ORBIT_ORDER.indexOf(a) - ORBIT_ORDER.indexOf(b));
  const answer = `Recorded as "${owner}", ${rank === 1 ? "the largest fleet" : `the ${ordinal(rank)} largest fleet`} among ${num(rows.length)} owners.` +
    (o.starlink > 0 ? ` Starlink makes up ${num(o.starlink)} of them; the other ${num(o.active - o.starlink)} are not Starlink.` : "");

  const body = `
<p>See also: ${links.join(", ")}.</p>

<h2 id="answer">What makes up this fleet</h2>
<p>${answer}</p>
${counts.named && fams.length + o.noFamily > 0 ? `
<h2 id="names">Name families</h2>
<p>Our own grouping by the run of two or more letters that starts each catalogue name ("DMC3" counts as DMC); where the catalogue uses more than one prefix for a fleet, we do not merge them. ${noFamilyText}</p>
${table({ caption: "Largest name families", head: ["Family", "Satellites", "Share (percent)", "Main orbit group", "Most common CelesTrak group"], numeric: [1, 2],
    rows: fams.slice(0, 10).map(famRow).concat(otherFams ? [[`${num(fams.length - 10)} other families`, num(otherFams), pctText(share(otherFams, o.active)), "", ""]] : []).concat(o.noFamily ? [["No name family", num(o.noFamily), pctText(share(o.noFamily, o.active)), "", ""]] : []) })}
<p>The group is the CelesTrak list a satellite is in, as the collector maps those lists to purposes; a satellite in several lists gets only one of them, so a family's group need not describe its mission.</p>
` : ""}${counts.named && o.recent.length ? `
<h2 id="recent">Launched in the last 30 days</h2>
<p>${num(o.recent.length)} of these satellites ${v(o.recent.length, "was", "were")} launched in the 30 days before the data time. ${recentText}</p>
${table({ caption: "Recent launches by launch date (two launches on one day share a row)", head: ["Launch date", "Satellites", "Named", "Only a launch designator"], numeric: [1], rows: recentRows })}
` : ""}
<h2 id="orbits">Orbit groups</h2>
<p>${overText}Groups as defined under <a href="${method}">how these numbers are made</a>.</p>
${table({ caption: "By orbit group, largest first", head: ["Orbit group", "Satellites", "Share (percent)", "Catalogue share (percent)"], numeric: [1, 2, 3],
    rows: used.map((k) => [esc(ORBIT_CHART_LABELS[k]), num(o.orbits[k]), pctText(oShare(k)), pctText(wShare(k))]) })}${used.length < ORBIT_ORDER.length ? `<p>None of them is in ${ORBIT_ORDER.filter((k) => !used.includes(k)).map((k) => ORBIT_PROSE[k]).join(" or ")}.</p>` : ""}

<h2 id="map">Map at the data time</h2>
${map}
<p>Positions at ${esc(time)} are approximate (<a href="${method}">how</a>). ${mapSummaryText(pts)}${dots < pts.length ? ` Satellites closer than 0.1 degree share a dot, so the map has ${num(dots)} dots.` : ""}</p>

<h2 id="purpose">Purposes</h2>
<p>${purposeText}</p>
${table({ caption: "By purpose, largest first", head: ["Purpose", "Satellites"], numeric: [1], rows: topP.map((p) => [esc(p.name), num(p.count)]).concat(restP ? [["All other purposes", num(restP)]] : []) })}

<h2 id="growth">Launch years</h2>
<p>${share(recent5, o.active) >= 0.5 ? `Most of them, ${pct(share(recent5, o.active))} percent, were launched in ${y - 4} or later.` : `Only ${pct(share(recent5, o.active))} percent of them were launched in ${y - 4} or later.`}${peaks.length ? ` The launch year with the most of them is ${and(peaks.map((r) => String(r.year)))}, with ${num(peakN)}${peaks.length > 1 ? " each" : ""}.` : ""}${o.unknownYear ? ` ${num(o.unknownYear)} ${v(o.unknownYear, "has", "have")} no launch date in the catalogue.` : ""}</p>
${columnChartSvg({ id: "chart-years", title: `Active satellites of ${o.name} by launch year`, desc: `Today's active satellites by launch year, with all years before the latest fifteen combined as Earlier. The table below gives the numbers.`, rows: yearRows })}
${table({ caption: "By launch year", head: ["Launch year", "Satellites"], numeric: [1], rows: yearRows.map((r) => [esc(r.label), num(r.value)]).concat(o.unknownYear ? [["No launch date", num(o.unknownYear)]] : []) })}
${counts.named && o.earliest.length ? `<p>Earliest launches among satellites the catalogue lists as active:</p>
${table({ caption: "Earliest launches still listed as active", head: ["Launch date", "Satellites"], rows: o.earliest.map((e) => [esc(dateLong(e.date)), esc(capList(e.names, 3, "more launched the same day"))]) })}` : ""}

<h2 id="how">How this was counted</h2>
<p>${num(o.active)} of the ${num(total)} satellites on the <a href="${href(file, SATCOUNT_FILE)}">count page</a> carry the owner "${owner}".${o.starlink > 0 ? " Starlink here means a name containing STARLINK." : ""}${o.unknownYear ? ` ${num(o.unknownYear)} ${v(o.unknownYear, "has no launch date and is", "have no launch date and are")} left out of the chart.` : ""} Full method: <a href="${method}">how these numbers are made</a>.</p>

<h2 id="faq">Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}

<h2 id="sources">Sources</h2>
<p>CelesTrak: ${[[CELESTRAK, "active list"], [SATCAT, "SATCAT"], [OWNERS, "owner codes"], [STATUS, "status codes"]].map(([x, t]) => `<a href="${esc(x.url)}" rel="noopener">${t}</a>`).join(", ")}.</p>`;

  return {
    file, crumbTitle: page.name, crumbs: [{ name: "Satellites by country", file: HUB_FILE }],
    title, description,
    h1: `How many satellites does ${page.phrase} have?`, kicker: "Live count",
    lead: `As of ${esc(date)}, ${esc(time)}, the catalogue records <strong>${num(o.active)} active satellites</strong> for ${phrase}, ${ownerShare} percent of the catalogue's active satellites.`,
    meta: metaLine(counts.taken, upIso),
    cta: { label: "See them on the live globe", query: "" },
    body,
    jsonld: [webPage(title, description, file, upIso)],
  };
}

// The hub and every country page that passes the guard, built from one feed. Nothing is written here; the callers write the pages only
// after every page is built. skipped lists each page left out and why. The map time is the data time.
export function countryPageSet(satellites, { coast, updated, min = MIN_ACTIVE_FOR_PAGE }) {
  const counts = countOwners(satellites);
  const skipped = [], built = [];
  for (const p of COUNTRY_PAGES) {
    const why = pageGuard(counts, p, { min });
    if (why) skipped.push({ slug: p.slug, file: p.file, reason: why }); else built.push(p);
  }
  const pages = [hubPage(counts, { updated, pages: built })]
    .concat(built.map((p) => countryPage(counts, p, { updated, coast, pages: built, positions: ownerPositions(satellites, p.owner) })));
  return { counts, pages, skipped };
}
