// The satellites by country pages: a hub that ranks every owner, and one page for each owner in COUNTRY_PAGES. Pure: takes the counts from
// site/satcountry.mjs (and the positions and coastlines for the map) and returns page objects for renderPage. Every figure comes from the
// feed; the only typed text is method and caveats, which match docs/satcountry-sources.md and the code. Owners keep the catalogue's names.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";
import { ORBIT_ORDER, ORBIT_LABELS, ORBIT_CHART_LABELS, ORBIT_BOUNDS } from "./satcount.mjs";
import { COUNTRY_PAGES, HUB_FILE, NOT_RECORDED, MIN_ACTIVE_FOR_PAGE, NEAR_EQUATOR_DEG, countOwners, ownerPositions, pageGuard, latitudeSummary } from "./satcountry.mjs";
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
    starText = ` Every Starlink satellite in the data, ${num(s.starlink)} of them, is recorded under ${esc(s.name)}.`;
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

  // purposes: the top eight and the rest
  const topP = o.purposes.slice(0, 8), restP = o.purposes.slice(8).reduce((s, p) => s + p.count, 0);
  const unspecified = o.purposes.find((p) => p.name === "Unspecified");
  const firstP = o.purposes.find((p) => p.name !== "Unspecified");
  const purposeText = (unspecified && unspecified === o.purposes[0] ? `No grouping recorded for ${pct(share(unspecified.count, o.active))} percent. ` : "") +
    (firstP ? `Top recorded purpose: ${esc(firstP.name)}, ${pct(share(firstP.count, o.active))} percent.` : "No purpose grouping is recorded for any of them.");
  // launch years
  const yearRows = yearRowsOf(o.launchYears);
  const y = new Date(counts.taken).getUTCFullYear();
  const recent5 = o.launchYears.filter((r) => r.year >= y - 4).reduce((s, r) => s + r.count, 0);
  const peak = o.launchYears.reduce((a, r) => (!a || r.count > a.count ? r : a), null);
  const first = o.launchYears[0], newest = o.launchYears[o.launchYears.length - 1];

  const links = [`<a href="${href(file, HUB_FILE)}">all owners ranked</a>`]
    .concat(pages.filter((p) => p.slug !== page.slug).map((p) => `<a href="${href(file, p.file)}">${esc(p.name)}</a>`));

  const rankBits = [above ? `${esc(above.name)} is ahead with ${num(above.active)}` : "", below ? `${esc(below.name)} follows with ${num(below.active)}` : ""].filter(Boolean).join("; ");
  // Three or four questions, chosen and answered from this owner's own numbers, so no two pages carry the same set of answers.
  const faq = [
    [`Where does ${page.phrase} rank among satellite owners?`,
      `${rank === 1 ? "First" : cap(ordinal(rank))}${rankBits ? `. ${rankBits}` : ""}.`],
    o.starlink > 0
      ? ["How much of this fleet is Starlink?", `${pct(share(o.starlink, o.active))} percent. Starlink alone is ${pct(share(o.starlink, total))} percent of our whole count.`]
      : o.families.length ? [`Which ${page.name} satellite family is largest?`, `${esc(o.families[0].name)}, with ${num(o.families[0].count)}${o.families[1] ? `, ahead of ${esc(o.families[1].name)} with ${num(o.families[1].count)}` : ""}.`]
      : firstP ? [`What are most ${page.name} satellites for?`, `${esc(firstP.name)}, the largest recorded purpose (${num(firstP.count)})${unspecified ? `; ${num(unspecified.count)} have no grouping` : ""}.`] : null,
    o.last30 > 0
      ? ["How many were launched in the last 30 days?", `${num(o.last30)} of the ${num(counts.last30)} recent launches still active in our count.`]
      : [`Which orbit group stands out for ${page.phrase}?`, `${cap(ORBIT_PROSE[apart])}: ${pct(oShare(apart))} percent of this fleet, catalogue ${pct(wShare(apart))}.`],
  ].filter(Boolean);

  // orbit groups this owner uses, largest first, each against the catalogue's share
  const used = ORBIT_ORDER.filter((k) => o.orbits[k] > 0).sort((a, b) => o.orbits[b] - o.orbits[a] || ORBIT_ORDER.indexOf(a) - ORBIT_ORDER.indexOf(b));
  const answer = `Recorded as "${owner}", ${rank === 1 ? "the largest fleet" : `the ${ordinal(rank)} largest fleet`} among ${num(rows.length)} owners.` +
    (o.starlink > 0 ? ` Starlink makes up ${num(o.starlink)} of them; the other ${num(o.active - o.starlink)} are not Starlink.` : "");
  const yearDesc = yearRows.map((r) => `${r.label}: ${num(r.value)}`).join(", ");

  const body = `
<p>See also: ${links.join(", ")}.</p>

<h2 id="answer">What makes up this fleet</h2>
<p>${answer}${o.families.length ? ` Largest name families (first word of the catalogue name): ${o.families.slice(0, 3).map((f) => esc(f.name)).join(", ")}.` : ""}</p>
${o.families.length ? table({ caption: "Largest name families", head: ["Family", "Satellites", "Share (percent)"], numeric: [1, 2], rows: o.families.slice(0, 10).map((f) => [esc(f.name), num(f.count), pctText(share(f.count, o.active))]) }) : ""}
${o.recent.length ? `<p>Launched in the 30 days before ${esc(date)} and active: ${o.recent.slice(0, 12).map(esc).join(", ")}${o.recent.length > 12 ? ` and ${num(o.recent.length - 12)} more` : ""}.</p>
` : ""}
<h2 id="orbits">Orbit groups</h2>
<p>${overText}Groups as defined under <a href="${method}">how these numbers are made</a>.</p>
${table({ caption: "By orbit group, largest first", head: ["Orbit group", "Satellites", "Share (percent)", "Catalogue share (percent)"], numeric: [1, 2, 3],
    rows: used.map((k) => [esc(ORBIT_CHART_LABELS[k]), num(o.orbits[k]), pctText(oShare(k)), pctText(wShare(k))]) })}${used.length < ORBIT_ORDER.length ? `<p>None in ${ORBIT_ORDER.filter((k) => !used.includes(k)).map((k) => ORBIT_PROSE[k]).join(" or ")}.</p>` : ""}

<h2 id="map">Map at the data time</h2>
${map}
<p>At ${esc(time)}, approximate (<a href="${method}">how</a>). ${mapSummaryText(pts)}${dots < pts.length ? ` ${num(dots)} dots.` : ""}</p>

<h2 id="purpose">Purposes</h2>
<p>${purposeText}${topP.length > 1 ? ` Next: ${topP.filter((p) => p !== firstP && p !== unspecified).slice(0, 3).map((p) => `${esc(p.name)} ${num(p.count)}`).join(", ") || "none"}.` : ""}</p>
${table({ caption: "By purpose, largest first", head: ["Purpose", "Satellites"], numeric: [1], rows: topP.map((p) => [esc(p.name), num(p.count)]).concat(restP ? [["All other purposes", num(restP)]] : []) })}

<h2 id="growth">Launch years</h2>
${o.oldest && o.newest && o.oldest.name !== o.newest.name ? `<p>Oldest still active: ${esc(o.oldest.name)}, launched ${esc(dateLong(o.oldest.date))}. Newest: ${esc(o.newest.name)}, ${esc(dateLong(o.newest.date))}.</p>
` : ""}<p>${share(recent5, o.active) >= 0.5 ? `Mostly recent: ${pct(share(recent5, o.active))} percent went up in ${y - 4} or later.` : `Mostly older: only ${pct(share(recent5, o.active))} percent went up in ${y - 4} or later.`}${peak ? ` Peak ${peak.year} (${num(peak.count)})${o.oldest ? "" : `, oldest ${first.year}`}.` : ""}${o.unknownYear ? ` Undated: ${num(o.unknownYear)}.` : ""}</p>
${columnChartSvg({ id: "chart-years", title: `Active satellites of ${o.name} by launch year`, desc: yearDesc || "No launch dates recorded.", rows: yearRows })}

<h2 id="how">How this was counted</h2>
<p>${num(o.active)} of the ${num(total)} satellites on the <a href="${href(file, SATCOUNT_FILE)}">count page</a> carry the owner "${owner}".${o.starlink > 0 ? " Starlink here means a name containing STARLINK." : ""}${o.unknownYear ? ` ${num(o.unknownYear)} have no launch date and are left out of the chart.` : ""} Full method: <a href="${method}">how these numbers are made</a>.</p>

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
