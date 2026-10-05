// The satellites by country pages: a hub that ranks every owner, and one page for each owner in COUNTRY_PAGES. Pure: takes the counts from
// site/satcountry.mjs (and the positions and coastlines for the map) and returns page objects for renderPage. Every figure comes from the
// feed; the only typed text is method and caveats, which match docs/satcountry-sources.md and the code. Owners keep the catalogue's names.
import { esc, table, sources, SITE, urlPath, href } from "./layout.mjs";
import { ORBIT_ORDER, ORBIT_LABELS, ORBIT_CHART_LABELS, ORBIT_BOUNDS } from "./satcount.mjs";
import { COUNTRY_PAGES, HUB_FILE, NOT_RECORDED, MIN_ACTIVE_FOR_PAGE, countOwners, ownerPositions, pageGuard, busiestBand } from "./satcountry.mjs";
import { SATCOUNT_FILE, LIVE_FILES, sitemapLive, barChartSvg, columnChartSvg, num, pct, dateLong, timeUtc, CELESTRAK, SATCAT, STATUS } from "./pages-satcount.mjs";
import { worldMapSvg, uniqueDots } from "./svgmap.mjs";

export { HUB_FILE, LIVE_FILES, sitemapLive };
export const COUNTRY_FILES = COUNTRY_PAGES.map((p) => p.file);

const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`; };
const share = (part, whole) => (whole ? part / whole : 0);
// a share too small to show with one decimal is written as words, so a table never shows a misleading 0.0
const pctText = (x) => (x > 0 && x < 0.0005 ? "under 0.1" : pct(x));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// lower case orbit names for sentences, built from the same groups as ORBIT_LABELS
const ORBIT_PROSE = { low: "low Earth orbit", medium: "medium Earth orbit", geostationary: "the geostationary belt", highElliptical: "high elliptical orbits", beyond: "orbits beyond the geostationary belt" };
const bandLabel = (b) => {
  const part = (v) => (v === 0 ? "the equator" : `${Math.abs(v)} degrees ${v < 0 ? "south" : "north"}`);
  return b.from < 0 && b.to <= 0 ? `${part(b.to)} to ${part(b.from)}` : `${part(b.from)} to ${part(b.to)}`;
};
const ranked = (counts) => counts.owners.filter((o) => o.active > 0 && o.name !== NOT_RECORDED);
const yearRowsOf = (launchYears) => {
  const keep = launchYears.slice(-15), earlier = launchYears.slice(0, -15).reduce((s, y) => s + y.count, 0);
  return (earlier ? [{ label: "Earlier", value: earlier }] : []).concat(keep.map((y) => ({ label: String(y.year), value: y.count })));
};
const metaLine = (taken, upIso) => `Data as of <time datetime="${esc(taken)}">${esc(dateLong(taken))}, ${esc(timeUtc(taken))}</time>. Page updated <time datetime="${esc(upIso)}">${esc(dateLong(upIso))}, ${esc(timeUtc(upIso))}</time>. Satellite data from CelesTrak.`;
const webPage = (name, description, file, upIso) => ({ "@context": "https://schema.org", "@type": "WebPage", name, description, url: `${SITE.url}/${urlPath(file)}`, dateModified: upIso });

// The method list both kinds of page share. Each line is true of site/satcount.mjs and site/satcountry.mjs.
const methodItems = (from) => [
  `Source: CelesTrak's current orbital element sets for its active list, with each object's owner, launch date, type and status from CelesTrak's satellite catalogue. The data time above is when we last read them.`,
  "An active satellite is a catalogue satellite with a status of Operational, Partially operational, Backup or standby, Spare or Extended mission. This is our definition, not CelesTrak's.",
  `The owner is the catalogue's owner field, shown exactly as the catalogue records it. Each satellite has one owner, so it is counted once. A satellite with no owner recorded is counted as "${NOT_RECORDED}".`,
  "Starlink satellites are those whose catalogue name contains STARLINK.",
  `The orbit groups are our working definitions: eccentricity of ${ORBIT_BOUNDS.ellipticalAt} or more is high elliptical; otherwise mean altitude below ${num(ORBIT_BOUNDS.lowBelow)} km is low, from ${num(ORBIT_BOUNDS.lowBelow)} km up to ${num(ORBIT_BOUNDS.mediumBelow - 1)} km is medium, ${num(ORBIT_BOUNDS.mediumBelow)} to ${num(ORBIT_BOUNDS.geoUpTo)} km is the geostationary belt, and anything higher is beyond it.`,
  `The totals are the same ones the <a href="${href(from, SATCOUNT_FILE)}">satellite count page</a> shows, split by owner.`,
];

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
  // in a sentence, an owner with a page reads as its phrase ("The United States"); every other owner, and every table, keeps the catalogue's name
  const said = (o, start = true) => { const p = COUNTRY_PAGES.find((x) => x.owner === o.name); return esc(p ? (start ? cap(p.phrase) : p.phrase) : o.name); };
  const description = lead
    ? `${lead.name} has ${num(lead.active)} of the ${num(total)} active satellites in orbit on ${date}, ${leadShare} percent. Every owner in CelesTrak's catalogue ranked by active satellites.`
    : `No owner has an active satellite in the data of ${date}. Every owner in CelesTrak's catalogue ranked by active satellites.`;

  const ownerCell = (o) => (pageFor.has(o.name) ? `<a href="${href(file, pageFor.get(o.name).file)}">${esc(o.name)}</a>` : esc(o.name));
  const tableRows = rows.map((o, i) => [String(i + 1), ownerCell(o), num(o.active), pctText(share(o.active, total)), num(o.starlink)])
    .concat(notRecorded ? [["", "Owner not recorded", num(notRecorded.active), pctText(share(notRecorded.active, total)), num(notRecorded.starlink)]] : []);
  const cards = pages.map((p) => {
    const o = counts.owners.find((r) => r.name === p.owner);
    return `<li><a class="card" href="${href(file, p.file)}"><b>${esc(p.name)}</b><span>${o ? `${num(o.active)} active satellites, ${pct(share(o.active, total))} percent` : "Not in this data"}</span></a></li>`;
  }).join("");
  let starText = "";
  if (starOwners.length === 1 && lead) {
    const s = starOwners[0];
    starText = ` Every Starlink satellite in the data, ${num(s.starlink)} of them, is recorded under ${esc(s.name)}.`;
    if (s === lead && total > s.starlink) starText += ` Leaving Starlink out, ${said(s, false)} has ${num(s.active - s.starlink)} of the other ${num(total - s.starlink)} active satellites, ${pct(share(s.active - s.starlink, total - s.starlink))} percent.`;
  }

  const body = `
<ul class="grid">
<li><div class="card"><b>${num(rows.length)}</b><span>Owners with at least one active satellite</span></div></li>
<li><div class="card"><b>${leadShare} percent</b><span>Share of the top owner${lead ? `, ${esc(lead.name)}` : ""}</span></div></li>
<li><div class="card"><b>${pct(share(top(3), total))} percent</b><span>Share of the top three owners together</span></div></li>
</ul>

<h2 id="answer">Which country has the most satellites?</h2>
<p>${lead ? `${said(lead)} has the most, with ${num(lead.active)} of the ${num(total)} active satellites, ${leadShare} percent, as of ${esc(date)}.` : "No owner has an active satellite in this data."} Owners are shown as the catalogue records them, which mixes countries and organisations.</p>

<h2 id="pages">Owners with their own page</h2>
<p>These owners have a page with their satellites by orbit, purpose and launch year, and a map of where they are.</p>
<ul class="grid">${cards}</ul>

<h2 id="ranking">All owners ranked by active satellites</h2>
${barChartSvg({ id: "chart-owners", title: "Active satellites by owner", desc: `The ${Math.min(10, rows.length)} owners with the most active satellites.${lead ? ` ${lead.name} is highest with ${num(lead.active)}.` : ""}`, rows: rows.slice(0, 10).map((o) => ({ label: o.name, value: o.active })) })}
${table({ caption: "Every owner with an active satellite, ranked", head: ["Rank", "Owner, as recorded", "Active satellites", "Share of all active (percent)", "Starlink"], numeric: [0, 2, 3, 4], rows: tableRows })}

<h2 id="concentration">How concentrated is the fleet?</h2>
<p>${lead ? `${said(lead)} holds ${leadShare} percent of all active satellites. The top three owners together hold ${pct(share(top(3), total))} percent and the top ten ${pct(share(top(10), total))} percent. ${num(small)} of the ${num(rows.length)} owners have fewer than 10 active satellites each.` : ""}${starText}</p>

<h2 id="read">How to read this table</h2>
<ul>
<li>The owner is the catalogue's owner field, shown exactly as the catalogue records it. It mixes countries and organisations, so a satellite recorded under an organisation is counted under that organisation and not under any country.</li>
${cis ? `<li>The fleet the catalogue records as "${esc(cis.name)}" is shown under that name. We do not split it or rename it.</li>\n` : ""}${tbd ? `<li>"${esc(tbd.name)}" is an entry in the catalogue's owner list, not a place. We show it as recorded.</li>\n` : ""}${notRecorded ? `<li>"Owner not recorded" counts active satellites whose catalogue record names no owner. It is not ranked.</li>\n` : ""}<li>Share is the owner's active satellites as a percentage of all ${num(total)} active satellites.</li>
</ul>

<h2 id="how">How we count</h2>
<ul>${methodItems(file).map((t) => `<li>${t}</li>`).join("")}</ul>

<h2 id="faq">Frequently asked questions</h2>
<h3>Which country has the most satellites?</h3>
<p>${lead ? `${said(lead)}, with ${num(lead.active)} active satellites as of ${esc(date)}, as the catalogue records owners.` : "No owner has an active satellite in this data."}</p>
<h3>How many countries have satellites?</h3>
<p>${num(rows.length)} owners in the catalogue have at least one active satellite. That is not a count of countries, because the owner list mixes countries and organisations.</p>
<h3>Does this count every satellite a country uses?</h3>
<p>No. It counts active satellites by the owner the catalogue records. A satellite recorded under another owner, such as an organisation, is counted under that owner.</p>
<h3>How often is this updated?</h3>
<p>The page is rebuilt when a new version of the satellite data arrives. The time at the top says when the data was read.</p>
${sources([CELESTRAK, SATCAT, STATUS])}`;

  return {
    file, crumbTitle: "Satellites by country",
    title: `Satellites by country: live ranking of owners, ${date}`, description,
    h1: "Which countries have the most satellites?", kicker: "Live ranking",
    lead: lead
      ? `As of ${esc(date)}, ${esc(time)}, ${num(rows.length)} owners in the catalogue have at least one active satellite. ${said(lead)} has the most, <strong>${num(lead.active)} active satellites</strong>, ${leadShare} percent of all ${num(total)} active satellites.`
      : `As of ${esc(date)}, ${esc(time)}, no owner in the catalogue has an active satellite.`,
    meta: metaLine(counts.taken, upIso),
    cta: { label: "See them on the live globe", query: "" },
    body,
    jsonld: [webPage(`Satellites by country: live ranking of owners, ${date}`, description, file, upIso)],
  };
}

// page: an entry of COUNTRY_PAGES. positions: [lat, lon] of this owner's active satellites at the data time (ownerPositions).
// coast: decoded coastlines. pages: the country pages built in this run, for the link row.
export function countryPage(counts, page, { updated, positions, coast, pages = COUNTRY_PAGES }) {
  const o = counts.owners.find((r) => r.name === page.owner);
  if (!o || o.active === 0) throw new Error(`pages-country: ${page.owner} has no active satellites; check pageGuard first`);
  const upIso = updated.toISOString(), file = page.file, total = counts.active;
  const date = dateLong(counts.taken), time = timeUtc(counts.taken);
  const rows = ranked(counts), rank = rows.findIndex((r) => r.name === o.name) + 1;
  const ownerShare = pct(share(o.active, total));
  const owner = esc(o.name), phrase = esc(page.phrase), name = esc(page.name);
  const description = `${num(o.active)} active satellites are recorded for ${o.name} on ${date}, ${ownerShare} percent of all active satellites. By orbit, purpose and launch year, with a map of where they are.`;

  // orbits: this owner against the whole catalogue
  const oShare = (k) => share(o.orbits[k], o.active), wShare = (k) => share(counts.orbits[k], total);
  const biggest = ORBIT_ORDER.reduce((a, k) => (o.orbits[k] > o.orbits[a] ? k : a), ORBIT_ORDER[0]);
  const over = ORBIT_ORDER.filter((k) => k !== biggest && o.orbits[k] > 0 && oShare(k) > wShare(k)).sort((a, b) => (oShare(b) - wShare(b)) - (oShare(a) - wShare(a)))[0];
  const orbitText = `${oShare(biggest) > 0.5 ? "Most of them" : "The largest group"}, ${pct(oShare(biggest))} percent, are in ${ORBIT_PROSE[biggest]}, against ${pct(wShare(biggest))} percent of all active satellites.` +
    (over ? ` ${cap(phrase)}${oShare(biggest) > wShare(biggest) ? " also" : ""} has a larger share of its fleet in ${ORBIT_PROSE[over]} (${pct(oShare(over))} percent) than the catalogue as a whole (${pct(wShare(over))} percent).` : "");

  // the map and its text summary
  const pts = positions || [];
  const dots = uniqueDots(pts), band = busiestBand(pts);
  const north = pts.filter(([lat]) => lat >= 0).length;
  const mapDesc = `A world map with ${num(dots)} dots for ${num(pts.length)} satellites.${band ? ` The busiest 30 degree band of latitude was ${bandLabel(band)}, with ${pct(band.share)} percent of them.` : ""}`;
  const map = worldMapSvg({ coast, points: pts, id: "map", title: `Where the active satellites of ${o.name} were at ${time}, ${date}`, desc: mapDesc });

  // purposes: the top eight and the rest
  const topP = o.purposes.slice(0, 8), restP = o.purposes.slice(8).reduce((s, p) => s + p.count, 0);
  // the most common purpose the catalogue actually records; "Unspecified" is reported on its own
  const unspecified = o.purposes.find((p) => p.name === "Unspecified");
  const firstP = o.purposes.find((p) => p.name !== "Unspecified");
  const purposeText = (unspecified && unspecified === o.purposes[0] ? `${num(unspecified.count)} of them, ${pct(share(unspecified.count, o.active))} percent, have no purpose grouping in the catalogue. ` : "") +
    (firstP ? `The most common recorded purpose is ${esc(firstP.name)}, with ${num(firstP.count)} satellites, ${pct(share(firstP.count, o.active))} percent. ` : "");
  // launch years
  const yearRows = yearRowsOf(o.launchYears);
  const y = new Date(counts.taken).getUTCFullYear();
  const recent5 = o.launchYears.filter((r) => r.year >= y - 4).reduce((s, r) => s + r.count, 0);

  const links = [`<a href="${href(file, HUB_FILE)}">All owners ranked</a>`, `<a href="${href(file, SATCOUNT_FILE)}">How many satellites are in orbit?</a>`]
    .concat(pages.filter((p) => p.slug !== page.slug).map((p) => `<a href="${href(file, p.file)}">${esc(p.name)}</a>`));

  const body = `
<ul class="grid">
<li><div class="card"><b>${num(o.active)}</b><span>Active satellites recorded for ${owner}</span></div></li>
<li><div class="card"><b>${ownerShare} percent</b><span>Share of all ${num(total)} active satellites</span></div></li>
<li><div class="card"><b>${ordinal(rank)} of ${num(rows.length)}</b><span>Rank among owners with an active satellite</span></div></li>
<li><div class="card"><b>${num(o.last30)}</b><span>Launched in the 30 days before the data time</span></div></li>
${o.starlink > 0 ? `<li><div class="card"><b>${num(o.starlink)}</b><span>Starlink satellites, ${pct(share(o.starlink, o.active))} percent of this owner's active satellites</span></div></li>\n` : ""}</ul>
<p>More live counts: ${links.join(", ")}.</p>

<h2 id="answer">How many satellites does ${phrase} have?</h2>
<p>${num(o.active)} active satellites as of ${esc(date)}, recorded in the catalogue under the owner "${owner}". That is ${ownerShare} percent of the ${num(total)} active satellites in the catalogue, and ${rank === 1 ? "the largest fleet" : `the ${ordinal(rank)} largest fleet`} of the ${num(rows.length)} owners with at least one active satellite.${o.starlink > 0 ? ` ${num(o.starlink)} of them are Starlink satellites, ${pct(share(o.starlink, o.active))} percent; the other ${num(o.active - o.starlink)} are not.` : ""}</p>

<h2 id="orbits">Which orbits are they in?</h2>
<p>${orbitText} The groups are our working definitions, explained below.</p>
${barChartSvg({ id: "chart-orbits", title: `Active satellites of ${o.name} by orbit`, desc: `${o.name}'s active satellites grouped into low, medium, geostationary, high elliptical and beyond-geostationary orbits.`, rows: ORBIT_ORDER.map((k) => ({ label: ORBIT_CHART_LABELS[k], value: o.orbits[k] })) })}
${table({ caption: `Active satellites of ${o.name} by orbit, against all active satellites`, head: ["Orbit", "Active satellites", `Share of this owner (percent)`, "Share of all active satellites (percent)"], numeric: [1, 2, 3],
    rows: ORBIT_ORDER.map((k) => [esc(ORBIT_LABELS[k]), num(o.orbits[k]), pctText(oShare(k)), pctText(wShare(k))]) })}

<h2 id="map">Where are they over the Earth?</h2>
${map}
<p>The map shows the point on the ground below each of these ${num(pts.length)} satellites at ${esc(time)} on ${esc(date)}, the time of the data. ${dots < pts.length ? `Positions are rounded to 0.1 degree and satellites that land on the same point share a dot, so there are ${num(dots)} dots. ` : ""}Positions are worked out from each satellite's orbital elements with the simple orbit model the live globe uses for its swarm, not with SGP4, so they are approximate.${band ? ` At that time the busiest 30 degree band of latitude was ${bandLabel(band)}, with ${num(band.count)} of these satellites, ${pct(band.share)} percent. ${pct(share(north, pts.length))} percent were north of the equator.` : ""}</p>

<h2 id="purpose">What are they for?</h2>
<p>${purposeText}Purposes are CelesTrak's own groupings, a convenience and not a statement of a satellite's mission. "Unspecified" means the catalogue has no grouping for that satellite.</p>
${barChartSvg({ id: "chart-purpose", title: `Active satellites of ${o.name} by purpose`, desc: `The ${topP.length} most common purposes among ${o.name}'s active satellites.`, rows: topP.map((p) => ({ label: p.name, value: p.count })) })}
${table({ caption: `Active satellites of ${o.name} by purpose`, head: ["Purpose", "Active satellites"], numeric: [1], rows: topP.map((p) => [esc(p.name), num(p.count)]).concat(restP ? [["All other purposes", num(restP)]] : []) })}

<h2 id="growth">When were they launched?</h2>
<p>${num(recent5)} of them, ${pct(share(recent5, o.active))} percent, were launched in ${y - 4} or later, and ${num(o.last30)} in the 30 days before ${esc(date)}. The chart counts satellites still active now, grouped by launch year. It is not a count of launches in each year, because satellites launched earlier and since retired are not in it.</p>
${columnChartSvg({ id: "chart-years", title: `Active satellites of ${o.name} by launch year`, desc: "How many of today's active satellites were launched in each of the latest fifteen launch years among them, with all earlier years combined.", rows: yearRows })}
${table({ caption: `Active satellites of ${o.name} by launch year`, head: ["Launch year", "Active satellites"], numeric: [1], rows: yearRows.map((r) => [esc(r.label), num(r.value)]).concat(o.unknownYear ? [["Launch date not recorded", num(o.unknownYear)]] : []) })}

<h2 id="how">How this was counted</h2>
<ul>${methodItems(file).map((t) => `<li>${t}</li>`).join("")}
<li>The map: each satellite's position is worked out for the data time from its orbital elements, with the two-body orbit and main J2 drift the live globe uses for its swarm. It does not move after the page is built. Coastlines are the live globe's own coastline data.</li>
</ul>

<h2 id="faq">Frequently asked questions</h2>
<h3>How many satellites does ${phrase} have?</h3>
<p>As of ${esc(date)}, ${num(o.active)} active satellites, as the catalogue records the owner "${owner}" and on our definition of active.</p>
<h3>What share of the world's satellites is that?</h3>
<p>${ownerShare} percent of the ${num(total)} active satellites in the catalogue, ${rank === 1 ? "the largest share of any owner" : `the ${ordinal(rank)} largest share of any owner`}.</p>
<h3>How many of them were launched in the last 30 days?</h3>
<p>${num(o.last30)} of the active satellites recorded for this owner were launched in the 30 days before ${esc(date)}.</p>
<h3>Is the map live?</h3>
<p>No. It shows where the satellites were at the data time, ${esc(time)} on ${esc(date)}, and it is redrawn when the page is rebuilt. The live globe shows them moving.</p>
<h3>Does this include every satellite ${phrase} uses?</h3>
<p>No. It counts satellites whose owner the catalogue records as "${owner}". A satellite recorded under another owner, such as an organisation, is counted under that owner instead.</p>
${o.name !== page.name ? `<h3>Why does this page say "${owner}"?</h3>\n<p>That is how the catalogue records the owner of these satellites. We show owners as the catalogue records them and do not split, merge or rename them.</p>\n` : ""}${sources([CELESTRAK, SATCAT, STATUS])}`;

  const title = `How many satellites does ${page.phrase} have? Live count, ${date}`;
  return {
    file, crumbTitle: page.name, crumbs: [{ name: "Satellites by country", file: HUB_FILE }],
    title, description,
    h1: `How many satellites does ${page.phrase} have?`, kicker: "Live count",
    lead: `As of ${esc(date)}, ${esc(time)}, the catalogue records <strong>${num(o.active)} active satellites</strong> for ${owner}, ${ownerShare} percent of the world's active satellites.`,
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
