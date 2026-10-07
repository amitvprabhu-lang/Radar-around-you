// The satellites and debris by country pages: the ranking of every owner (/satellites-and-debris-by-country/), a page for each owner in
// OWNER_PAGES that has no country page, and the section the five country pages gain. Pure: takes the summary of site/objects.mjs and returns
// page objects for renderPage. Every figure comes from the feeds; the typed text is method and caveats that match
// docs/country-objects-sources.md. Owners keep the catalogue's names, and nothing here says who caused any debris.
import { esc, href, SITE, urlPath } from "./layout.mjs";
import { num, pct, dateLong, timeUtc, SATCOUNT_FILE } from "./pages-satcount.mjs";
import { ORBIT_LABELS, ORBIT_BOUNDS } from "./satcount.mjs";
import { HUB_FILE } from "./satcountry.mjs";
import { webPageLd, figureHtml, timeTagUtc } from "./liveseo.mjs";
import { RANKING_FILE, OWNER_PAGES, OBJECTS_MAX_AGE_HOURS, OWNER_SELECT_MIN, OWNER_PAGE_MIN, STATIC_ROWS, TYPE_NAMES, STATUS_TEXT, ORBIT_KEYS, ownerPage } from "./objects.mjs";
import { objectsScript, OBJECTS_CSS } from "./objects-js.mjs";

export const OBJ_SRC = {
  satcat: { title: "CelesTrak SATCAT", url: "https://celestrak.org/satcat/", note: "The whole satellite catalogue, read once a day as one CSV file (celestrak.org/pub/satcat.csv)" },
  format: { title: "CelesTrak SATCAT format", url: "https://celestrak.org/satcat/satcat-format.php", note: "What each field means: owner, object type, decay date, orbit centre, perigee, apogee, radar cross-section" },
  owners: { title: "CelesTrak SATCAT source codes", url: "https://celestrak.org/satcat/sources.php", note: "The owner name for each owner code" },
  status: { title: "CelesTrak SATCAT status codes", url: "https://celestrak.org/satcat/status.php", note: "Operational, partially operational and the other statuses" },
  gp: { title: "CelesTrak current GP data (the active list)", url: "https://celestrak.org/NORAD/elements/", note: "The orbit data behind the satellite count page, read about every 2 hours" },
  policy: { title: "CelesTrak usage policy", url: "https://celestrak.org/usage-policy.php", note: "Says the catalogue updates manually once or twice a day" },
  odpo: { title: "NASA Orbital Debris Program Office, frequently asked questions", url: "https://orbitaldebris.jsc.nasa.gov/faq/", note: "On which debris sizes are tracked" },
};
// NASA ODPO FAQ, read 2026-10-07 (docs/country-objects-sources.md): the one quotation on these pages
const ODPO_QUOTE = "Large orbital debris (> 10 cm) is tracked routinely by the U.S. Space Surveillance Network";

const share = (part, whole) => (whole ? part / whole : 0);
const pctText = (x) => (x > 0 && x < 0.0005 ? "under 0.1" : pct(x));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const v = (n, one, many) => (n === 1 ? one : many);
const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return `${n}th`; return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`; };
const when = (iso) => `${dateLong(iso)}, ${timeUtc(iso)}`;
const timeEl = (iso) => timeTagUtc(iso, when(iso));
const dayEl = (d) => (/^\d{4}-\d\d-\d\d$/.test(d || "") ? `<time datetime="${esc(d)}">${esc(dateLong(`${d}T00:00:00Z`))}</time>` : "Not recorded");
const METHOD = "method";
// "1 piece of debris", "2 pieces of debris": every count in a sentence goes through these
const cnt = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const KIND_WORDS = { act: ["active satellite", "active satellites"], inact: ["inactive satellite", "inactive satellites"], rb: ["rocket body", "rocket bodies"], deb: ["piece of debris", "pieces of debris"], unk: ["unknown object", "unknown objects"], obj: ["object", "objects"] };
export const kindCount = (k, n) => cnt(n, KIND_WORDS[k][0], KIND_WORDS[k][1]);
// "12 active satellites, 3 inactive satellites, 1 rocket body, 4 pieces of debris and 2 unknown objects"; strong: kinds to put in <strong>
export function kindList(o, { strong = [], unknownAlways = false } = {}) {
  const part = (k) => (strong.includes(k) ? `<strong>${kindCount(k, o[k])}</strong>` : kindCount(k, o[k]));
  const parts = ["act", "inact", "rb", "deb"].map(part);
  return o.unk || unknownAlways ? `${parts.join(", ")} and ${part("unk")}` : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
// What the catalogue's owner of a piece of debris is, measured in this data (pipeline/satcat.py, debrisOwnerCheck): the share of debris in
// Earth orbit whose owner is also the owner of a satellite from the same launch. Computed, never typed; "" when there is no check.
export function debrisOwnerSentence(s) {
  const c = s.debrisCheck;
  if (!c || !c.checked) return "";
  const not = c.checked - c.sameAsPayload, all = c.checked === s.totals.deb;
  return `${pct(share(c.sameAsPayload, c.checked))} percent of the ${kindCount("deb", c.checked)} in Earth orbit${all ? "" : " whose launch has a satellite in the catalogue"} carry the owner of a satellite from the same launch${not ? `; ${num(not)} ${not === 1 ? "does" : "do"} not` : ""}`;
}
// "7 Oct, 04:20 UTC"
const shortWhen = (iso) => `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))}, ${timeUtc(iso)}`;
// the lead's opening: the time the numbers last changed (the page's dateModified), then the time of each source
const changedLine = (s) => `Numbers last changed ${timeEl(s.dataTime)} (${s.fast ? `orbit data of ${timeTagUtc(s.satTime, shortWhen(s.satTime))}, ` : ""}catalogue of ${timeTagUtc(s.catTime, shortWhen(s.catTime))}).`;
const KIND_ROWS = [["act", "Active satellites"], ["inact", "Inactive satellites"], ["rb", "Rocket bodies"], ["deb", "Debris"], ["unk", "Unknown objects"]];
const ORBIT_ROW = { ...ORBIT_LABELS, none: "No heights in the catalogue" };
// lower case orbit names for sentences, from the same groups as ORBIT_LABELS
const ORBIT_PROSE = { low: "low Earth orbit", medium: "medium Earth orbit", geostationary: "the geostationary belt", highElliptical: "high elliptical orbits", beyond: "orbits beyond the geostationary belt" };
const COLS = [["sat", "Satellites"], ["rb", "Rocket bodies"], ["deb", "Debris"], ["unk", "Unknown"]];
// the owner as a sentence names it: an owner with a page reads as its phrase, every other owner as the catalogue records it
const said = (o, start = false) => { const p = ownerPage(o.code); const t = p ? p.phrase : o.name; return esc(start ? cap(t) : t); };
const ownerLink = (from, o, built, text = o.name) => (o.page && built.includes(o.page.file) ? `<a href="${href(from, o.page.file)}">${esc(text)}</a>` : esc(text));
// a plain, accessible table with a caption, header scopes, numeric columns and optional row header cells and footer
// sortedBy: [column, "ascending" | "descending"] for a sortable table already in that order (its header gets aria-sort)
function tbl({ caption, head, rows, numeric = [], id = null, foot = null, sort = false, rowHead = false, sortedBy = null }) {
  const th = (h, i) => `<th scope="col"${numeric.includes(i) ? ' class="num"' : ""}${sort ? ` data-col="${i}" data-sort="${numeric.includes(i) ? "num" : "text"}"` : ""}${sortedBy && sortedBy[0] === i ? ` aria-sort="${sortedBy[1]}"` : ""}>${esc(h)}</th>`;
  const td = (c, i) => (rowHead && i === 0 ? `<th scope="row">${c}</th>` : `<td${numeric.includes(i) ? ' class="num"' : ""}>${c}</td>`);
  const tr = (r) => `<tr${r.attrs || ""}>${(r.cells || r).map(td).join("")}</tr>`;
  return `<div class="tablewrap" role="region" tabindex="0" aria-label="${esc(caption)}"><table${id ? ` id="${id}"` : ""}><caption>${esc(caption)}</caption><thead><tr>${head.map(th).join("")}</tr></thead><tbody>${rows.map(tr).join("")}</tbody>${foot ? `<tfoot>${tr({ cells: foot })}</tfoot>` : ""}</table></div>`;
}
const cards = (list) => `<ul class="grid">${list.map(([b, t]) => `<li><div class="card"><b>${b}</b><span>${t}</span></div></li>`).join("")}</ul>`;
const timesMeta = (s) => [
  s.fast ? `Active satellites in the orbit data as of ${timeEl(s.satTime)} (CelesTrak's active list, read about every 2 hours).` : "",
  `Catalogue counts as of ${timeEl(s.catTime)}. CelesTrak updates its catalogue about once or twice a day, so these numbers move daily, not every few minutes.`,
].filter(Boolean).join(" ");
// how often each source updates, under the lead of an owner page (the lead holds the times; the ranking page explains the cadence in full)
const shortTimes = (s) => `CelesTrak updates the catalogue about once a day${s.fast ? " and the orbit data about every 2 hours" : ""}; the times are in the line above.`;
const staleNote = (s) => (s.stale ? `<p class="note warn">This copy was built from a catalogue more than ${OBJECTS_MAX_AGE_HOURS} hours old. A newer copy replaces it when fresh data arrives.</p>` : "");
const script = () => `<style>${OBJECTS_CSS}</style>\n<script>${objectsScript()}</script>`;

// The sentence that reconciles the catalogue's active count with the orbit data's, from the numbers (for one owner, or all of them).
function reconcile(s, act, fast, actNoElements, subject) {
  if (!s.fast) return "";
  const d = act - fast;
  if (d === 0) return `The orbit data of ${esc(when(s.satTime))} agrees: ${num(fast)} active satellites${subject}.`;
  if (d < 0) return `The orbit data of ${esc(when(s.satTime))} has ${num(-d)} more active ${v(-d, "satellite", "satellites")}${subject} (${num(fast)}) than the catalogue copy of ${esc(when(s.catTime))}${Date.parse(s.satTime) > Date.parse(s.catTime) ? ", which is the older of the two" : ""}.`;
  const rest = d - Math.min(d, actNoElements);
  return `The orbit data of ${esc(when(s.satTime))}, which the <a href="${"{{count}}"}">satellite count page</a> uses, has ${num(fast)} of them${subject}, ${num(d)} fewer. ` +
    (actNoElements ? `${num(Math.min(d, actNoElements))} of the ${num(d)} ${v(Math.min(d, actNoElements), "has", "have")} no public orbit data in the catalogue, so they cannot be in data made from orbits` : "") +
    (rest ? `${actNoElements ? "; " : ""}${actNoElements ? "the other " : ""}${num(rest)} ${v(rest, "is", "are")} missing from the orbit data or listed differently there (it uses CelesTrak's active list and a catalogue copy that can be a day older, and drops orbits older than 90 days)` : "") + ".";
}
// the short form for one owner: the two active counts and a link to the explanation on the ranking page
function reconcileShort(s, o, file) {
  if (!s.fast) return "";
  const d = o.act - (o.fast || 0);
  const why = `<a href="${href(file, RANKING_FILE)}#ranking">why they differ</a>`;
  return d === 0 ? `The 2-hourly orbit data agrees: ${num(o.fast)} active.` : `The 2-hourly orbit data of ${esc(when(s.satTime))} has ${num(o.fast || 0)} active (${d > 0 ? `${num(d)} fewer` : `${num(-d)} more`}; ${why}).`;
}
const fillCount = (html, file) => html.split('"{{count}}"').join(`"${href(file, SATCOUNT_FILE)}"`);

// ---------------------------------------------------------------- the ranking of every owner
export function rankingPage(s, { built = [] } = {}) {
  const file = RANKING_FILE, T = s.totals;
  const ranked = s.owners.filter((o) => o.total > 0 || (o.fast || 0) > 0);
  const top = ranked[0], debTop = [...ranked].filter((o) => o.deb > 0).sort((a, b) => b.deb - a.deb || a.code.localeCompare(b.code, "en"));
  const top3 = ranked.slice(0, 3).reduce((x, o) => x + o.total, 0);
  const date = dateLong(s.catTime);
  const title = "Satellites and space debris by country: live count";
  const description = `${kindCount("obj", T.total)} in Earth orbit on ${date}: ${kindCount("act", T.act)} and ${kindCount("deb", T.deb)}, for every owner in CelesTrak's catalogue.`;
  const debrisLine = debrisOwnerSentence(s);
  const searchText = (o) => esc([o.name, o.code, o.page ? `${o.page.name} ${o.page.aliases}` : ""].join(" ").replace(/\s+/g, " ").trim());
  const rows = ranked.map((o) => ({ attrs: ` data-search="${searchText(o)}"`, cells: [ownerLink(file, o, built), esc(o.code), num(o.act), num(o.inact), num(o.rb), num(o.deb), num(o.unk), num(o.total)] }));
  const foot = ["All owners", "", num(T.act), num(T.inact), num(T.rb), num(T.deb), num(T.unk), num(T.total)];
  const withPage = ranked.filter((o) => o.page && built.includes(o.page.file));
  const dec = [...ranked].filter((o) => o.dec365 > 0).sort((a, b) => b.dec365 - a.dec365 || a.code.localeCompare(b.code, "en")).slice(0, 3);
  const fresh = [...ranked].filter((o) => o.new365 > 0).sort((a, b) => b.new365 - a.new365 || a.code.localeCompare(b.code, "en")).slice(0, 3);
  const awayOwners = ranked.filter((o) => Object.keys(o.away).length).length;
  const stackRows = ranked.slice(0, 10);
  const faq = [
    ["How many satellites are in orbit?", `CelesTrak's catalogue of ${esc(when(s.catTime))} lists ${cnt(T.act + T.inact, "satellite", "satellites")} in Earth orbit: ${num(T.act)} active and ${num(T.inact)} inactive.${s.fast ? ` The orbit data of ${esc(when(s.satTime))} has ${kindCount("act", s.fast.total)} with current orbits, the number on the satellite count page.` : ""}`],
    ["How much space debris is there?", `${num(T.deb)} catalogued ${T.deb === 1 ? "piece" : "pieces"} of debris in Earth orbit, plus ${cnt(T.rb, "spent rocket body", "spent rocket bodies")}, as of ${esc(when(s.catTime))}. Pieces too small to track are not in the catalogue, so the real number of fragments is far higher.`],
    ...(debTop.length ? [["Which country has the most space debris?", `${said(debTop[0], true)}, with ${num(debTop[0].deb)} catalogued ${debTop[0].deb === 1 ? "piece" : "pieces"} in Earth orbit (${pctText(share(debTop[0].deb, T.deb))} percent)${debTop[1] ? `, then ${said(debTop[1])} with ${num(debTop[1].deb)}` : ""}${debTop[2] ? ` and ${said(debTop[2])} with ${num(debTop[2].deb)}` : ""}, as the catalogue records owners.`]] : []),
    ["Does the owner of a piece of debris say who made it?", `No. The catalogue gives each piece an owner code and does not record how the piece came about.${debrisLine ? ` In this data, ${debrisLine}.` : ""}`],
  ];
  const lead = `${changedLine(s)} CelesTrak's catalogue lists <strong>${kindCount("obj", T.total)} in Earth orbit</strong>: ${kindList(T, { unknownAlways: true })}, recorded under ${cnt(s.owned, "owner", "owners")}.${top ? ` ${said(top, true)} has the most, ${num(top.total)}.` : ""}`;
  const body = `${staleNote(s)}
<h2 id="meaning">What this means</h2>
<p>Every object in the public catalogue carries an owner code, which CelesTrak's source table names as a country or an organisation. ${top ? `The three largest owners, ${and(ranked.slice(0, 3).map((o) => said(o)))}, hold ${pct(share(top3, T.total))} percent of everything in Earth orbit. ` : ""}Debris carries an owner code too.${debrisLine ? ` In this data, ${debrisLine}.` : ""} The catalogue does not record who or what broke a piece off, and these pages do not say.</p>
<p>The catalogue is not everything up there. NASA's Orbital Debris Program Office says "${esc(ODPO_QUOTE)}"; smaller fragments are estimated by sampling and are not listed one by one. ${num(T.noElements)} of the objects counted here ${v(T.noElements, "has", "have")} no public orbit data in the catalogue.</p>
${cards([[num(T.total), "Objects in Earth orbit"], [num(T.act), "Active satellites"], [num(T.deb), "Pieces of debris"], [num(s.owned), "Owners with an object in orbit"]])}
<p class="meta">${timesMeta(s)}</p>
${withPage.length ? `<p>Owners with their own page: ${withPage.map((o) => ownerLink(file, o, built, o.page.name)).join(", ")}. Active satellites by owner, with maps and purposes: <a href="${href(file, HUB_FILE)}">satellites by country</a>.</p>` : ""}

<h2 id="ranking">Every owner, ranked by objects in orbit</h2>
<p>${fillCount(reconcile(s, T.act, s.fast ? s.fast.total - s.fast.notRecorded : 0, T.actNoElements || 0, " with an owner recorded"), file)} The columns below are all from the catalogue copy, so each row adds up to its total.</p>
${tbl({ caption: `Objects in Earth orbit by owner, catalogue of ${date}`, head: ["Owner, as recorded", "Code", "Active satellites", "Inactive satellites", "Rocket bodies", "Debris", "Unknown", "In Earth orbit"], numeric: [2, 3, 4, 5, 6, 7], rows, foot, id: "owners-table", sort: true, sortedBy: [7, "descending"] })}
${figureHtml(stackedSvg(stackRows, date), `Objects in Earth orbit for the ${stackRows.length} largest owners by kind, catalogue of ${date}; the table above gives every number.`)}

<h2 id="debris">Who has the most debris?</h2>
${debTop.length ? `<p>${cap(and(debTop.slice(0, 3).map((o) => `${said(o)} with ${num(o.deb)} (${pctText(share(o.deb, T.deb))} percent)`)))} have the most catalogued debris in Earth orbit, together ${pct(share(debTop.slice(0, 3).reduce((x, o) => x + o.deb, 0), T.deb))} percent of all ${num(T.deb)} pieces. ${num(s.withDebris)} of the ${num(s.owned)} owners have any debris in orbit.</p>
${tbl({ caption: "The ten owners with the most debris in Earth orbit", head: ["Owner, as recorded", "Debris", "Share of all debris (percent)", "Rocket bodies"], numeric: [1, 2, 3], rows: debTop.slice(0, 10).map((o) => [ownerLink(file, o, built), num(o.deb), pctText(share(o.deb, T.deb)), num(o.rb)]) })}` : "<p>The catalogue lists no debris in Earth orbit.</p>"}

<h2 id="year">The last 12 months</h2>
<p>In the 365 days to ${esc(dateLong(s.catTime))}, ${cnt(T.dec365, "catalogued object", "catalogued objects")} re-entered the atmosphere${dec.length ? `, most of them recorded under ${and(dec.map((o) => `${said(o)} with ${num(o.dec365)}`))}` : ""}. ${cnt(T.new365, "object launched in those days is", "objects launched in those days are")} still in orbit${fresh.length ? `, most under ${and(fresh.map((o) => `${said(o)} with ${num(o.new365)}`))}` : ""}. ${num(T.decayed)} objects in the catalogue have re-entered since 1957.${T.away ? ` ${num(T.away)} objects of ${num(awayOwners)} owners are not counted here because the catalogue records them around the Moon, the Sun or another body.` : ""}</p>

<h2 id="${METHOD}">How these numbers are made</h2>
<ul>
<li>Source: CelesTrak's whole satellite catalogue (SATCAT), which our collector reads once a day as one file, and CelesTrak's active list of orbit data, read about every 2 hours for the satellite count page.</li>
<li>In Earth orbit: no decay date in the catalogue, and an orbit centre of Earth or a docking to another object (station modules and visiting craft). On ${esc(dateLong(s.catTime))} this gave ${num(T.total)} objects.</li>
<li>An active satellite is a payload with the status Operational, Partially operational, Backup, Spare or Extended mission; every other payload is inactive. This is our definition, the same as on the satellite count page.</li>
<li>Rocket bodies, debris and unknown objects are the catalogue's own object types. The owner is the catalogue's owner code, named with CelesTrak's source table and never renamed or merged; the list mixes countries and organisations, so an object recorded under an organisation is not counted under any country.</li>
<li>The orbit groups on the owner pages use the perigee and apogee in the catalogue: eccentricity ${ORBIT_BOUNDS.ellipticalAt} or more is high elliptical, otherwise the mean of the two heights sets the group (our working definitions, as on the satellite count page).</li>
<li>Owner pages exist for owners that had at least ${OWNER_SELECT_MIN} objects in Earth orbit when the pages were planned (not "To Be Determined"); a page is left as it is while its owner has fewer than ${OWNER_PAGE_MIN}.</li>
<li>The pages are rebuilt when either source has a new version. A copy whose catalogue is more than ${OBJECTS_MAX_AGE_HOURS} hours old is not rebuilt.</li>
</ul>

<h2 id="faq">Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}

<h2 id="sources">Sources</h2>
<ul class="sources">${[OBJ_SRC.satcat, OBJ_SRC.format, OBJ_SRC.owners, OBJ_SRC.status, OBJ_SRC.gp, OBJ_SRC.policy, OBJ_SRC.odpo].map((x) => `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>. ${esc(x.note)}</li>`).join("")}</ul>
${script()}`;
  return {
    file, crumbTitle: "Satellites and debris by country", title, description,
    h1: "Satellites and space debris by country", kicker: "Live ranking", lead, wide: true,
    meta: `Search the table below, or open an owner's page for the list of its objects. Our counts from <a href="${esc(OBJ_SRC.satcat.url)}" rel="noopener">CelesTrak</a>.`,
    body, dataTime: s.dataTime,
    jsonld: [webPageLd({ file, title, description, dataTime: s.dataTime, crumbTitle: "Satellites and debris by country" })],
  };
}

// A stacked bar per owner: active, inactive, rocket bodies, debris, unknown, with a legend. Colours from the page's own palette.
const STACK = [["act", "Active satellites", "var(--ion)"], ["inact", "Inactive satellites", "var(--sky)"], ["rb", "Rocket bodies", "var(--violet)"], ["deb", "Debris", "var(--signal)"], ["unk", "Unknown", "var(--muted)"]];
export function stackedSvg(rows, date) {
  const max = Math.max(1, ...rows.map((o) => o.total));
  const rowH = 26, labelW = 180, barMax = 360, top = 30, w = labelW + barMax + 80, h = top + rows.length * rowH + 6;
  const legend = STACK.map(([, name, colour], i) => `<rect x="${i * 128}" y="4" width="12" height="12" rx="2" fill="${colour}"></rect><text x="${i * 128 + 17}" y="14" fill="var(--muted)" font-size="12">${esc(name)}</text>`).join("");
  const bars = rows.map((o, i) => {
    const y = top + i * rowH;
    let x = labelW;
    const parts = STACK.map(([k, , colour]) => { const bw = (o[k] / max) * barMax; const r = bw > 0 ? `<rect x="${x.toFixed(1)}" y="${y + 4}" width="${Math.max(0.5, bw).toFixed(1)}" height="16" fill="${colour}"></rect>` : ""; x += bw; return r; }).join("");
    const label = o.page ? o.page.name : o.name.length > 26 ? `${o.code}` : o.name;
    return `<text x="${labelW - 8}" y="${y + 17}" text-anchor="end" fill="var(--text)" font-size="13">${esc(label)}</text>${parts}<text x="${(x + 6).toFixed(1)}" y="${y + 17}" fill="var(--muted)" font-size="12">${num(o.total)}</text>`;
  }).join("");
  const title = `Objects in Earth orbit by owner and kind, ${date}`;
  const desc = rows.map((o) => `${o.name}: ${num(o.total)}, of which ${num(o.deb)} debris`).join("; ");
  return `<svg class="chart" role="img" aria-labelledby="chart-owners-t chart-owners-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto"><title id="chart-owners-t">${esc(title)}</title><desc id="chart-owners-d">${esc(desc)}</desc>${legend}${bars}</svg>`;
}

// ---------------------------------------------------------------- one owner's objects (owner pages and the country pages' new section)
// d: ownerDetail(); o: the owner's row of the summary. h: the heading level of the parts ("h2" on an owner page, "h3" in a country page).
// path: the live folder path of the owner's detail file; base: the address of the live folder from the page.
function objectBlocks(s, o, d, { file, h = "h2", base }) {
  const H = (id, text) => `<${h} id="${id}">${esc(text)}</${h}>`;
  const kindRows = KIND_ROWS.filter(([k]) => o[k] > 0 || k !== "unk").map(([k, name]) => [name, num(o[k]), pctText(share(o[k], o.total)), pctText(share(o[k], s.totals[k]))]);
  const usedOrbits = ORBIT_KEYS.filter((k) => COLS.some(([c]) => d.orbits[k][c] > 0));
  const orbitTotal = (k) => COLS.reduce((x, [c]) => x + d.orbits[k][c], 0);
  const mainOrbit = usedOrbits.filter((k) => k !== "none").sort((a, b) => orbitTotal(b) - orbitTotal(a))[0];
  const debOrbit = usedOrbits.filter((k) => k !== "none" && d.orbits[k].deb > 0).sort((a, b) => d.orbits[b].deb - d.orbits[a].deb)[0];
  const peak = d.decades.reduce((a, b) => (b.sat + b.other > (a ? a.sat + a.other : -1) ? b : a), null);
  const n = d.notable;
  const objLine = (r) => `${esc(r.name)} (catalogue number ${r.id}, ${esc(r.intl)}, ${esc(TYPE_NAMES[r.type].toLowerCase())})`;
  const notable = [
    n.oldest && `<li>Oldest still in orbit: ${objLine(n.oldest)}, launched ${dayEl(n.oldest.launch)}.</li>`,
    n.newest && n.newest !== n.oldest && `<li>Most recent launch: ${objLine(n.newest)}, launched ${dayEl(n.newest.launch)}.</li>`,
    n.largest && `<li>Largest radar cross-section: ${objLine(n.largest)}, ${esc(rcsText(n.largest.rcs))} square metres.</li>`,
    n.highest && `<li>Highest apogee: ${objLine(n.highest)}, ${num(n.highest.apogee)} km at its highest point.</li>`,
  ].filter(Boolean);
  // kind: also print the kind (the full list); status: print the satellite status
  const head = (status, kind = false) => ["Catalogue number", "Name", "International designator", ...(kind ? ["Kind"] : []), ...(status ? ["Status"] : []), "Launch date", "Perigee (km)", "Apogee (km)", "Inclination (degrees)", "Radar cross-section (square metres)"];
  const row = (status, kind = false) => (r) => [String(r.id), esc(r.name), esc(r.intl), ...(kind ? [esc(TYPE_NAMES[r.type])] : []), ...(status ? [r.type === "P" ? esc(STATUS_TEXT[r.status] || r.status || "None recorded") : "-"] : []), dayEl(r.launch), r.perigee == null ? "-" : num(r.perigee), r.apogee == null ? "-" : num(r.apogee), r.incl == null ? "-" : esc(r.incl.toLocaleString("en-GB", { maximumFractionDigits: 1 })), r.rcs == null ? "-" : esc(rcsText(r.rcs))];
  const second = d.second;
  const groups = d.debrisGroups.slice(0, 5);
  const staticShown = d.all ? d.all.length : d.recentSats.length + (second ? second.rows.length : 0);
  const blocks = [];
  blocks.push(`${H("kinds", "By kind")}
${tbl({ caption: `Objects in Earth orbit by kind, catalogue of ${dateLong(s.catTime)}`, head: ["Kind", "Objects", "Share of this owner (percent)", "Share of every owner's (percent)"], numeric: [1, 2, 3], rowHead: true, rows: kindRows, foot: ["In Earth orbit", num(o.total), "100.0", pctText(share(o.total, s.totals.total))] })}`);
  blocks.push(`${H("orbits", "Orbits")}
<p>${mainOrbit ? `The largest group of these objects is in ${ORBIT_PROSE[mainOrbit]} (${num(orbitTotal(mainOrbit))}).` : ""}${debOrbit && debOrbit !== mainOrbit ? ` The largest group of the debris is in ${ORBIT_PROSE[debOrbit]} (${cnt(d.orbits[debOrbit].deb, "piece", "pieces")}).` : ""}${d.noHeights ? ` ${num(d.noHeights)} ${v(d.noHeights, "has", "have")} no heights in the catalogue.` : ""} (<a href="${href(file, RANKING_FILE)}#${METHOD}">groups</a> from perigee and apogee.)</p>
${tbl({ caption: "Objects in Earth orbit by orbit group and kind", head: ["Orbit group", ...COLS.map(([, t]) => t)], numeric: [1, 2, 3, 4], rowHead: true, rows: usedOrbits.map((k) => [esc(ORBIT_ROW[k]), ...COLS.map(([c]) => num(d.orbits[k][c]))]) })}`);
  if (d.decades.length) blocks.push(`${H("launched", "When they were launched")}
<p>${peak ? `More of these objects were launched in the ${peak.decade}s than in any other decade (${num(peak.sat + peak.other)}, ${num(peak.sat)} of them satellites).` : ""} ${num(d.thisYear)} ${v(d.thisYear, "was", "were")} launched in ${esc(s.catTime.slice(0, 4))}.${d.undated ? ` ${num(d.undated)} ${v(d.undated, "has", "have")} no launch date.` : ""}${d.oldestYear ? ` The oldest dates from ${d.oldestYear}.` : ""}</p>
${tbl({ caption: "Objects still in Earth orbit by launch decade", head: ["Launch decade", "Satellites", "Rocket bodies, debris and unknown"], numeric: [1, 2], rowHead: true, rows: d.decades.map((x) => [`${x.decade}s`, num(x.sat), num(x.other)]) })}`);
  if (groups.length) blocks.push(`${H("debris-groups", "Largest debris groups")}
<p>${groups[0].count > 1 ? `The largest group, from launch ${esc(groups[0].launch)}, has ${cnt(groups[0].count, "piece", "pieces")} in orbit, ${pct(share(groups[0].count, o.deb))} percent of this owner's debris.` : "No launch has more than one piece in orbit."}</p>
${tbl({ caption: "Debris in Earth orbit by launch, largest groups", head: ["Launch", "Launch date", "Pieces in orbit", "Most common name", "Satellites of that launch in orbit, same owner"], numeric: [2], rowHead: true, rows: groups.map((g) => [esc(g.launch), dayEl(g.date), num(g.count), esc(g.name), g.payloads.length ? esc(g.payloads.slice(0, 3).join(", ") + (g.payloads.length > 3 ? ` and ${g.payloads.length - 3} more` : "")) : "None"]) })}`);
  if (notable.length) blocks.push(`${H("notable", "Notable objects")}
<ul>${notable.join("")}</ul>`);
  blocks.push(`${H("details", "Object details")}
${d.all ? (() => { const mixed = new Set(d.all.map((r) => r.type)).size > 1, sat = d.all.some((r) => r.type === "P"); return tbl({ caption: `Every object in Earth orbit, newest launch first (${num(d.all.length)})`, head: head(sat, mixed), numeric: [0, ...[5, 6, 7, 8].map((i) => i + (mixed ? 1 : 0) + (sat ? 1 : 0) - 1)], rows: d.all.map(row(sat, mixed)) }); })() : `${d.recentSats.length ? tbl({ caption: `The ${num(d.recentSats.length)} most recently launched satellites still in orbit`, head: head(true), numeric: [0, 5, 6, 7, 8], rows: d.recentSats.map(row(true)) }) : "<p>No satellite of this owner is in Earth orbit.</p>"}
${second ? tbl({ caption: second.kind === "debris" ? `The ${num(second.rows.length)} largest pieces of debris by radar cross-section` : `The ${num(second.rows.length)} largest rocket bodies by radar cross-section`, head: head(false), numeric: [0, 4, 5, 6, 7], rows: second.rows.map(row(false)) }) : ""}`}
<p>${d.all ? `That is all ${num(o.total)} of them.` : `These tables show ${num(staticShown)} of the ${num(o.total)} objects${d.noRcs ? `; ${num(d.noRcs)} ${v(d.noRcs, "has", "have")} no radar cross-section and come last in the size order` : ""}.`} A dash: no value in the catalogue.${!d.all && o.path ? " The button below (it needs JavaScript) loads the full list of this data version as a table to filter and page through." : ""}</p>
${!d.all && o.path ? `<div id="all-objects" data-src="${esc(base + o.path)}" data-owner="${esc(o.code)}" data-time="${esc(s.catTime)}" data-count="${num(o.total)}"></div>` : ""}`);
  return blocks.join("\n\n");
}
// radar cross-section in square metres, three significant figures
const rcsText = (x) => x.toLocaleString("en-GB", { maximumSignificantDigits: 3 });

// The questions on an owner page, chosen and answered from its own numbers.
function ownerFaq(s, o, d, p) {
  const T = s.totals, ph = p.phrase;
  const q = [];
  q.push([`How many satellites does ${ph} have in orbit?`, `${cnt(o.act + o.inact, "satellite", "satellites")} in Earth orbit as of ${esc(when(s.catTime))}: ${num(o.act)} active and ${num(o.inact)} inactive, as the catalogue records the owner "${esc(o.name)}".`]);
  q.push([`How much space debris does ${ph} have?`, o.deb ? `${num(o.deb)} catalogued ${v(o.deb, "piece", "pieces")} of debris in Earth orbit, ${pctText(share(o.deb, T.deb))} percent of all ${num(T.deb)}, ${o.debRank === 1 ? "the most of any owner" : `the ${ordinal(o.debRank)} most of any owner`}${o.rb ? `, plus ${kindCount("rb", o.rb)}` : ""}. Pieces too small to track are not counted.` : `None in the catalogue: no piece of debris in Earth orbit is recorded under "${esc(o.name)}"${o.rb ? `, though ${num(o.rb)} rocket ${v(o.rb, "body is", "bodies are")}` : ""}.`]);
  if (o.dec365) q.push([`How many objects of ${ph} re-entered in the last year?`, `${num(o.dec365)} in the 365 days to ${esc(dateLong(s.catTime))}, of ${num(o.decayed)} that ${v(o.decayed, "has", "have")} re-entered since the first launch. ${num(o.new365)} launched in those 365 days ${v(o.new365, "is", "are")} still in orbit.`]);
  else if (d.notable.oldest) q.push([`What is the oldest object of ${ph} still in orbit?`, `${esc(d.notable.oldest.name)}, catalogue number ${d.notable.oldest.id}, launched ${dayEl(d.notable.oldest.launch)}.`]);
  return q;
}

function ownerIntro(s, o, d, p, file, built) {
  const T = s.totals, ranked = s.owners.filter((x) => x.total > 0);
  const i = ranked.indexOf(o), above = i > 0 ? ranked[i - 1] : null, below = i >= 0 && i < ranked.length - 1 ? ranked[i + 1] : null;
  const rankText = `${o.rank === 1 ? "That is the most of any owner" : `That ranks ${ordinal(o.rank)} of ${num(ranked.length)} owners`}${above ? `, after ${ownerLink(file, above, built, above.page ? above.page.name : above.name)} (${num(above.total)})` : ""}${below ? `${above ? " and" : ","} ahead of ${ownerLink(file, below, built, below.page ? below.page.name : below.name)} (${num(below.total)})` : ""}.`;
  const debText = o.deb ? `Its ${num(o.deb)} ${v(o.deb, "piece", "pieces")} of debris ${v(o.deb, "is", "are")} ${pctText(share(o.deb, T.deb))} percent of all catalogued debris in Earth orbit${d.debrisGroups[0] && d.debrisGroups[0].count > 1 ? `; ${num(d.debrisGroups[0].count)} of ${v(o.deb, "it", "them")} are catalogued under one launch, ${esc(d.debrisGroups[0].launch)}` : ""}.` : "No debris in Earth orbit is recorded under this owner.";
  const away = Object.entries(o.away);
  const awayN = away.reduce((x, [, c]) => x + c, 0);
  const awayText = away.length ? ` ${cnt(awayN, "more object that has not re-entered is", "more objects that have not re-entered are")} recorded around other bodies (orbit centre ${esc(away.map(([c, k]) => `${c} ${k}`).join(", "))}) and are not counted here.` : "";
  return `<p>The catalogue records these objects under the owner "${esc(o.name)}" (code ${esc(o.code)}). ${rankText} ${debText}${awayText}</p>
<p>${reconcileShort(s, o, file)}${o.deb && debrisOwnerSentence(s) ? ` Across the catalogue, ${debrisOwnerSentence(s)}; the owner does not say who or what broke a piece off (<a href="${href(file, RANKING_FILE)}#meaning">what the owner of debris means</a>).` : ""}</p>`;
}

// page: the OWNER_PAGES entry; built: the live files that exist after this run (links go only to those)
export function ownerObjectsPage(s, page, { built = [] } = {}) {
  const o = s.owners.find((x) => x.code === page.code);
  if (!o || !s.detail) throw new Error(`pages-objects: no summary or detail for ${page.code}`);
  const d = s.detail, file = page.file, T = s.totals, base = href(file, "live/");
  const title = `${page.name} satellites and space debris: live count`;
  const date = dateLong(s.catTime);
  const descFull = `${cap(page.phrase)}: ${kindCount("act", o.act)} and ${kindCount("deb", o.deb)} among ${kindCount("obj", o.total)} in Earth orbit on ${date}. With details.`;
  const description = descFull.length < 160 ? descFull : `${page.name}: ${kindCount("act", o.act)}, ${num(o.deb)} debris, ${kindCount("obj", o.total)} in orbit on ${date}.`;
  const lead = `${changedLine(s)} CelesTrak's catalogue records <strong>${kindCount("obj", o.total)} in Earth orbit</strong> for ${esc(page.phrase)}: ${kindList(o, { strong: ["deb"] })}.`;
  const faq = ownerFaq(s, o, d, page);
  // the owner pages ranked nearest this one (two above, two below, among owners whose page exists), for the links at the end
  const withPages = s.owners.filter((x) => x.total > 0 && x.page && built.includes(x.page.file));
  const at = withPages.findIndex((x) => x.code === page.code);
  const near = withPages.slice(Math.max(0, at - 2), at).concat(withPages.slice(at + 1, at + 3));
  const body = `${staleNote(s)}
<h2 id="meaning">What this means</h2>
${ownerIntro(s, o, d, page, file, built)}

${objectBlocks(s, o, d, { file, h: "h2", base })}

<h2 id="faq">Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}

<h2 id="more">More owners</h2>
<p>${near.length ? `Nearest in the ranking: ${near.map((x) => `<a href="${href(file, x.page.file)}">${esc(x.page.name)}</a> (${num(x.total)})`).join(", ")}. ` : ""}<a href="${href(file, RANKING_FILE)}">Every owner, searchable</a>; active satellites only: <a href="${href(file, HUB_FILE)}">satellites by country</a> and <a href="${href(file, SATCOUNT_FILE)}">the satellite count</a>.</p>

<h2 id="sources">Sources</h2>
<p>${[OBJ_SRC.satcat, OBJ_SRC.format, OBJ_SRC.owners, OBJ_SRC.status, OBJ_SRC.gp, OBJ_SRC.odpo].map((x) => `<a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>`).join(", ")}.</p>
${script()}`;
  return {
    file, crumbTitle: page.name, crumbs: [{ name: "Satellites and debris by country", file: RANKING_FILE }],
    title, description, h1: `How many satellites and how much debris does ${page.phrase} have in orbit?`, kicker: "Live count", lead, wide: true,
    meta: shortTimes(s),
    body, dataTime: s.dataTime,
    jsonld: [webPageLd({ file, title, description, dataTime: s.dataTime, crumbTitle: page.name, crumbs: [{ name: "Satellites and debris by country", file: RANKING_FILE }] })],
  };
}

// The section a country page gains (site/pages-country.mjs): the same parts as an owner page, under one h2, with h3 headings.
// Returns { html, title, description, leadTail } or null when the owner is not in the summary.
export function countrySection(s, code, file) {
  const o = s && s.owners.find((x) => x.code === code);
  const p = ownerPage(code);
  if (!o || !s.detail || !p) return null;
  const d = s.detail, base = href(file, "live/");
  const html = `
<h2 id="objects">Satellites, rocket bodies and debris in orbit</h2>
<p>${esc(cap(p.phrase))} has <strong>${kindCount("obj", o.total)} in Earth orbit</strong> in CelesTrak's whole catalogue of ${timeEl(s.catTime)}: ${kindList(o)}. ${o.deb ? `That debris is ${pctText(share(o.deb, s.totals.deb))} percent of all catalogued debris in Earth orbit, ${o.debRank === 1 ? "the most of any owner" : `the ${ordinal(o.debRank)} most of any owner`}.` : "No debris in Earth orbit is recorded under this owner."} ${reconcileShort(s, o, file)} The catalogue updates about daily; compare every owner on <a href="${href(file, RANKING_FILE)}">satellites and debris by country</a>.</p>
${objectBlocks(s, o, d, { file, h: "h3", base })}
${script()}`;
  return {
    html, title: `${p.name} satellites and space debris: live count`,
    descTail: ` ${kindCount("deb", o.deb)} among ${kindCount("obj", o.total)} in orbit.`,
    leadTail: ` The whole catalogue lists <strong>${kindCount("obj", o.total)} in Earth orbit</strong> for ${esc(p.phrase)}, ${num(o.deb)} of them debris.`,
  };
}

// The row of the /right-now/ hub for the ranking page; links: every owner page (every live page is linked from the hub).
export function objectsHubRow(s, { missing = {} } = {}) {
  const dayHour = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));
  return {
    key: "objects", file: RANKING_FILE, label: "Satellites and debris by country", short: "objects in Earth orbit",
    value: s ? `${kindCount("obj", s.totals.total)} in Earth orbit, ${num(s.totals.deb)} of them debris` : null,
    said: s ? `${kindCount("obj", s.totals.total)} in Earth orbit in CelesTrak's catalogue, ${num(s.totals.deb)} of them debris` : null,
    dataTime: s ? s.catTime : null, guide: null, stale: !!(s && s.stale), reason: s ? null : missing.objects || "not available in this build",
    timeText: s ? `${dayHour(s.catTime)} (CelesTrak's catalogue)` : "", limit: `the catalogue ${OBJECTS_MAX_AGE_HOURS} hours`,
    timeNote: "For the catalogue counts, the time is when CelesTrak last updated the catalogue file.", source: OBJ_SRC.satcat, notableRule: null, notable: null,
    linksLabel: "Satellites and debris of one owner", links: OWNER_PAGES.map((p) => ({ file: p.file, label: p.name })),
  };
}
