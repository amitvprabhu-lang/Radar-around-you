// The "How many satellites are in orbit?" page. Pure: takes the counts from site/satcount.mjs and returns a page object for renderPage.
// Every figure on the page comes from the one `counts` value, so the lead, description, FAQ, tables and structured data cannot disagree.
import { esc, table, sources, SITE, urlPath } from "./layout.mjs";

export const SATCOUNT_FILE = "how-many-satellites-in-orbit/index.html";

const num = (n) => n.toLocaleString("en-GB");
const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateLong = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const timeUtc = (iso) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 3) + "..." : s);

// A sitemap with the one live page and an accurate last modified time (the time the page was last rebuilt, which only happens when the
// satellite data changes). Google uses lastmod only if it is consistently accurate.
export const sitemapLive = (lastmodIso) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(`${SITE.url}/${urlPath(SATCOUNT_FILE)}`)}</loc><lastmod>${esc(lastmodIso)}</lastmod></url>
</urlset>
`;

export function barChartSvg({ id, title, desc, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 28, labelW = 250, barMax = 340, w = labelW + barMax + 90, h = rows.length * rowH + 8;
  const body = rows.map((r, i) => {
    const y = 4 + i * rowH, bw = Math.max(2, Math.round((r.value / max) * barMax));
    return `<text x="${labelW - 8}" y="${y + 18}" text-anchor="end" fill="var(--text)" font-size="13">${esc(trunc(r.label, 36))}</text>` +
      `<rect x="${labelW}" y="${y + 4}" width="${bw}" height="16" rx="3" fill="var(--ion)"></rect>` +
      `<text x="${labelW + bw + 8}" y="${y + 18}" fill="var(--muted)" font-size="13">${num(r.value)}</text>`;
  }).join("");
  return `<svg class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${body}</svg>`;
}

export function columnChartSvg({ id, title, desc, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const colW = 38, plotH = 170, w = rows.length * colW + 20, h = plotH + 50;
  const body = rows.map((r, i) => {
    const bh = Math.max(2, Math.round((r.value / max) * plotH)), x = 10 + i * colW, y = 20 + plotH - bh;
    return `<rect x="${x + 4}" y="${y}" width="${colW - 10}" height="${bh}" rx="2" fill="var(--ion)"></rect>` +
      `<text x="${x + colW / 2 - 1}" y="${y - 4}" text-anchor="middle" fill="var(--muted)" font-size="10">${num(r.value)}</text>` +
      `<text x="${x + colW / 2 - 1}" y="${plotH + 36}" text-anchor="middle" fill="var(--text)" font-size="11">${esc(r.label)}</text>`;
  }).join("");
  return `<svg class="chart" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${body}</svg>`;
}

const CELESTRAK = { title: "CelesTrak current GP data (the active list)", url: "https://celestrak.org/NORAD/elements/", note: "Where the orbital element sets come from" };
const SATCAT = { title: "CelesTrak SATCAT format", url: "https://celestrak.org/satcat/satcat-format.php", note: "Owner, launch date, status and type for each object" };
const STATUS = { title: "CelesTrak SATCAT status codes", url: "https://celestrak.org/satcat/status.php", note: "What Operational, Partially operational and the other statuses mean" };

export function satelliteCountPage(c, { updated }) {
  const upIso = updated.toISOString();
  const active = num(c.active), date = dateLong(c.taken), time = timeUtc(c.taken);
  const top = c.owners[0];
  const share = pct(c.starlinkShare);
  const description = `${active} active satellites were in orbit on ${date}, ${share} percent of them Starlink. Counted from CelesTrak's active list, with breakdowns by owner, orbit, purpose and launch year.`;
  const url = `${SITE.url}/${urlPath(SATCOUNT_FILE)}`;

  const ownerRows = c.owners.map((o) => ({ label: o.name, value: o.count }));
  const orbitRows = c.orbits.map((o) => ({ label: o.label, value: o.count }));
  const purposeRows = c.purposes.slice(0, 10).map((p) => ({ label: p.name, value: p.count }));
  const keep = c.launchYears.slice(-15);
  const earlier = c.launchYears.slice(0, -15).reduce((s, y) => s + y.count, 0);
  const yearRows = (earlier ? [{ label: "Earlier", value: earlier }] : []).concat(keep.map((y) => ({ label: String(y.year), value: y.count })));

  const body = `
<ul class="grid">
<li><div class="card"><b>${active}</b><span>Active satellites</span></div></li>
<li><div class="card"><b>${num(c.starlink)}</b><span>Starlink satellites, ${share} percent of the active total</span></div></li>
<li><div class="card"><b>${num(c.last30)}</b><span>Active satellites launched in the 30 days before the data time</span></div></li>
</ul>

<h2 id="answer">How many satellites are in orbit?</h2>
<p>${active} satellites are active in orbit as of ${esc(date)}. That is the number of active satellites on CelesTrak's current list, using our definition of active (below). Of these, ${num(c.starlink)} belong to the Starlink network.</p>

<h2 id="active">What counts as an active satellite?</h2>
<p>We count objects the catalogue types as satellites (not rocket bodies or debris) whose recorded status is Operational, Partially operational, Backup or standby, Spare or Extended mission. This is our definition, not CelesTrak's. The table lists every status among the catalogue's satellites, so you can add them up your own way.</p>
${table({ caption: "Satellites in the feed by recorded status", head: ["Status", "Satellites"], numeric: [1], rows: c.statusRows.map((r) => [esc(r.name), num(r.count)]) })}

<h2 id="who">Which countries and operators have the most satellites?</h2>
<p>${top ? `${esc(top.name)} has the most, with ${num(top.count)} active satellites. ` : ""}Owners are shown as the catalogue records them, which mixes countries and organisations.</p>
${barChartSvg({ id: "chart-owners", title: "Active satellites by owner", desc: `The ${c.owners.length} owners with the most active satellites. ${top ? `${top.name} is highest with ${num(top.count)}.` : ""}`, rows: ownerRows })}
${table({ caption: "Active satellites by owner", head: ["Owner", "Active satellites"], numeric: [1], rows: c.owners.map((o) => [esc(o.name), num(o.count)]).concat(c.ownersOther ? [["All other owners", num(c.ownersOther)]] : []) })}

<h2 id="orbits">Where are the satellites?</h2>
<p>Most active satellites are in low Earth orbit, where the Starlink network lives. The table groups every active satellite by its orbit. These groupings are our working definitions, not a standard: a high elliptical orbit is one with an eccentricity of 0.25 or more, and the other groups use the satellite's mean altitude.</p>
${barChartSvg({ id: "chart-orbits", title: "Active satellites by orbit", desc: "Active satellites grouped into low, medium, geostationary, high elliptical and beyond-geostationary orbits.", rows: orbitRows })}
${table({ caption: "Active satellites by orbit", head: ["Orbit", "Active satellites"], numeric: [1], rows: c.orbits.map((o) => [esc(o.label), num(o.count)]) })}

<h2 id="purpose">What are the satellites for?</h2>
<p>Purposes are CelesTrak's own groupings, a convenience and not a statement of a satellite's mission. "Unspecified" means the catalogue has no grouping for that satellite.</p>
${barChartSvg({ id: "chart-purpose", title: "Active satellites by purpose", desc: "The ten most common purposes among active satellites.", rows: purposeRows })}
${table({ caption: "Active satellites by purpose", head: ["Purpose", "Active satellites"], numeric: [1], rows: c.purposes.map((p) => [esc(p.name), num(p.count)]) })}

<h2 id="growth">How fast is the number growing?</h2>
<p>The chart shows when today's active satellites were launched. It counts satellites still active now, grouped by launch year. It is not a count of launches in each year, because satellites launched earlier and since retired are not in it.</p>
${columnChartSvg({ id: "chart-years", title: "Active satellites by launch year", desc: "How many of today's active satellites were launched in each of the last fifteen years, with all earlier launches combined.", rows: yearRows })}
${table({ caption: "Active satellites by launch year", head: ["Launch year", "Active satellites"], numeric: [1], rows: yearRows.map((r) => [esc(r.label), num(r.value)]).concat(c.unknownYear ? [["Launch date not recorded", num(c.unknownYear)]] : []) })}

<h2 id="not-counted">What this count does not include</h2>
<p>This page counts active satellites only. It does not count defunct satellites, rocket bodies or most debris, because the data behind it is CelesTrak's list of active satellites. The feed also carries four named debris clouds, but those are not the total amount of debris in orbit and we do not present them as one. The count of everything tracked in orbit is much larger than the number of active satellites.</p>

<h2 id="how">How we count</h2>
<ul>
<li>Source: CelesTrak's current orbital element sets for its active list, with each object's owner, launch date, type and status from CelesTrak's satellite catalogue. The data time above is when we last read them.</li>
<li>An active satellite is a catalogue satellite with a status of Operational, Partially operational, Backup or standby, Spare or Extended mission.</li>
<li>Starlink satellites are those whose catalogue name contains STARLINK.</li>
<li>The orbit groups are our working definitions: eccentricity of 0.25 or more is high elliptical; otherwise mean altitude below 2,000 km is low, from 2,000 km up to 35,585 km is medium, 35,586 to 35,986 km is the geostationary belt, and anything higher is beyond it.</li>
<li>Other trackers use other definitions and other data, so their totals can differ from ours.</li>
</ul>

<h2 id="faq">Frequently asked questions</h2>
<h3>How many satellites are in orbit right now?</h3>
<p>As of ${esc(date)}, ${active} active satellites, on CelesTrak's active list and our definition of active.</p>
<h3>How many of them are Starlink?</h3>
<p>${num(c.starlink)}, which is ${share} percent of the active total.</p>
<h3>Which country has the most satellites?</h3>
<p>${top ? `${esc(top.name)}, with ${num(top.count)} active satellites, as the catalogue records owners.` : "The catalogue records no owners in this data."}</p>
<h3>How many satellites were launched recently?</h3>
<p>${num(c.last30)} of today's active satellites were launched in the 30 days before ${esc(date)}.</p>
<h3>Do you count space debris and rocket bodies?</h3>
<p>No. This page counts active satellites only.</p>
${sources([CELESTRAK, SATCAT, STATUS])}`;

  return {
    file: SATCOUNT_FILE, crumbTitle: "Satellite count",
    title: `How many satellites are in orbit? Live count, ${date}`, description,
    h1: "How many satellites are in orbit?", kicker: "Live count",
    lead: `As of ${esc(date)}, ${esc(time)}, there are <strong>${active} active satellites</strong> in orbit, by CelesTrak's active list and our definition of active (below). ${num(c.starlink)} of them, ${share} percent, are Starlink.`,
    meta: `Data as of <time datetime="${esc(c.taken)}">${esc(date)}, ${esc(time)}</time>. Page updated <time datetime="${esc(upIso)}">${esc(dateLong(upIso))}, ${esc(timeUtc(upIso))}</time>. Satellite data from CelesTrak.`,
    cta: { label: "See them on the live globe", query: "" },
    body,
    jsonld: [{ "@context": "https://schema.org", "@type": "WebPage", name: `How many satellites are in orbit? Live count, ${date}`, description, url, dateModified: upIso }],
  };
}
