// The small script on the satellites and debris pages (site/pages-objects.mjs), as progressive enhancement: every number and both static
// tables are in the HTML the server sends; the script adds a search box and sortable headers to the owner ranking, and on an owner page a
// "Show all" button that fetches the owner's detail file (the same version the page was built from) and shows it as a paged, filterable
// table. The functions below are pure (no DOM, no network) apart from objInit, so they are unit tested in node and copied into the page by
// their own source text: they must not use imports or anything outside their parameters except each other and OBJ_CONST.
import { ROW_FIELDS, TYPE_NAMES, STATUS_TEXT } from "./objects.mjs";

export const OBJ_PAGE_SIZE = 50;
// constants the script needs, written into it as JSON
export const OBJ_CONST = { fields: ROW_FIELDS, types: TYPE_NAMES, status: STATUS_TEXT, pageSize: OBJ_PAGE_SIZE };

// lower case without accents, so "turkiye" finds "Türkiye"
export function objNorm(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
// whether every word of the query is in the text
export function objMatch(text, query) {
  var t = objNorm(text), words = objNorm(query).split(" ").filter(Boolean);
  for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) < 0) return false;
  return true;
}
// a sort key for a table cell's text: a number when the column is numeric ("12,345" -> 12345, "-" or "" -> -1), otherwise the text
export function objKey(text, numeric) {
  if (!numeric) return objNorm(text);
  var n = parseFloat(String(text).replace(/,/g, ""));
  return isNaN(n) ? -1 : n;
}
export function objCompare(a, b, dir) {
  var r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en");
  return dir === "descending" ? -r : r;
}
// Checks a detail file against what the page was built from and returns its rows as objects. Throws an Error whose `reason` is "version"
// when the file belongs to another data version (the page is older or newer than the file), or "shape" when it is not a detail file.
export function objParse(doc, want, C) {
  var bad = function (reason, msg) { var e = new Error(msg); e.reason = reason; throw e; };
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.rows) || JSON.stringify(doc.fields) !== JSON.stringify(C.fields)) bad("shape", "not a detail file");
  if (doc.owner !== want.owner) bad("shape", "the file is for another owner");
  if (doc.sourceTime !== want.time) bad("version", "the file is from " + doc.sourceTime + ", the page from " + want.time);
  return doc.rows.map(function (r) { var o = {}; for (var i = 0; i < C.fields.length; i++) o[C.fields[i]] = r[i]; return o; });
}
// the rows that match the text and the kind ("" for every kind)
export function objFilter(rows, query, type) {
  return rows.filter(function (r) { return (!type || r.type === type) && objMatch(r.id + " " + r.name + " " + r.intl, query); });
}
// one page of a list: { rows, page (from 1, clamped), pages (at least 1) }
export function objPage(list, page, size) {
  var pages = Math.max(1, Math.ceil(list.length / size)), p = Math.min(Math.max(1, page), pages);
  return { rows: list.slice((p - 1) * size, p * size), page: p, pages: pages };
}
// the cells of one object, as the static tables print them
export function objCells(r, C) {
  var n = function (v, d) { return typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: d }) : "-"; };
  return [String(r.id), r.name || "-", r.intl || "-", C.types[r.type] || r.type, r.type === "P" ? (C.status[r.status] || r.status || "-") : "-", r.launch || "-",
    n(r.perigee, 0), n(r.apogee, 0), n(r.incl, 1), typeof r.rcs === "number" ? r.rcs.toLocaleString("en-GB", { maximumSignificantDigits: 3 }) : "-"];
}

// The part that touches the page. doc: the document; C: OBJ_CONST.
export function objInit(doc, C) {
  var el = function (tag, attrs, text) { var e = doc.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  // sortable headers for a table whose header cells carry data-sort ("num" or "text"); rows: a function giving the rows to sort
  var sortable = function (table, onSort) {
    var ths = table.querySelectorAll("thead th[data-sort]");
    Array.prototype.forEach.call(ths, function (th, i) {
      var b = el("button", { type: "button", "class": "sortbtn" }, th.textContent);
      th.textContent = "";
      th.appendChild(b);
      b.addEventListener("click", function () {
        var dir = th.getAttribute("aria-sort") === "descending" ? "ascending" : "descending";
        Array.prototype.forEach.call(ths, function (o) { o.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", dir);
        onSort(Number(th.getAttribute("data-col")), th.getAttribute("data-sort") === "num", dir);
      });
    });
  };
  // the owner ranking: a search box and sortable columns
  var rank = doc.getElementById("owners-table");
  if (rank) {
    var body = rank.querySelector("tbody"), all = Array.prototype.slice.call(body.querySelectorAll("tr"));
    var box = el("div", { "class": "objsearch" });
    var label = el("label", { "for": "owner-search" }, "Search owners by name or code");
    var input = el("input", { id: "owner-search", type: "search", autocomplete: "off", spellcheck: "false" });
    var status = el("p", { id: "owner-count", "aria-live": "polite", "class": "meta" });
    box.appendChild(label); box.appendChild(input); box.appendChild(status);
    var wrap = rank.closest(".tablewrap") || rank;
    wrap.parentNode.insertBefore(box, wrap);
    var apply = function () {
      var q = input.value, shown = 0;
      all.forEach(function (tr) { var ok = objMatch(tr.getAttribute("data-search") || tr.textContent, q); tr.hidden = !ok; if (ok) shown++; });
      status.textContent = q.trim() ? (shown ? shown + " of " + all.length + " owners match." : "No owner matches. The catalogue records owners under its own names and codes, so try another spelling or the code.") : "";
    };
    input.addEventListener("input", apply);
    sortable(rank, function (col, numeric, dir) {
      all.sort(function (a, b) { return objCompare(objKey(a.cells[col].textContent, numeric), objKey(b.cells[col].textContent, numeric), dir); });
      all.forEach(function (tr) { body.appendChild(tr); });
    });
  }
  // an owner page: "Show all N objects"
  var box2 = doc.getElementById("all-objects");
  if (box2) {
    var src = box2.getAttribute("data-src"), want = { owner: box2.getAttribute("data-owner"), time: box2.getAttribute("data-time") };
    var btn = el("button", { type: "button", "class": "cta", id: "show-all" }, "Show all " + box2.getAttribute("data-count") + " objects");
    var msg = el("p", { "class": "meta", "aria-live": "polite" });
    box2.appendChild(btn); box2.appendChild(msg);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      msg.textContent = "Loading the full list...";
      fetch(src, { cache: "no-cache" }).then(function (r) {
        if (r.status === 404) { var e = new Error("missing"); e.reason = "version"; throw e; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (d) {
        var rows = objParse(d, want, C);
        msg.textContent = "";
        btn.remove();
        show(rows);
      }).catch(function (e) {
        btn.disabled = false;
        msg.textContent = e && e.reason === "version"
          ? "The full list has been updated since this page was built, so it no longer matches the numbers above. Reload the page to see the current page and list."
          : "The full list could not be loaded just now. Try again in a moment.";
      });
    });
    var show = function (rows) {
      var state = { q: "", type: "", page: 1, col: 0, numeric: true, dir: "ascending" };
      var form = el("div", { "class": "objsearch" });
      var l1 = el("label", { "for": "obj-search" }, "Filter by name, catalogue number or designator");
      var q = el("input", { id: "obj-search", type: "search", autocomplete: "off", spellcheck: "false" });
      var l2 = el("label", { "for": "obj-type" }, "Kind");
      var sel = el("select", { id: "obj-type" });
      [["", "All kinds"], ["P", "Satellites"], ["R", "Rocket bodies"], ["D", "Debris"], ["U", "Unknown"]].forEach(function (o) { sel.appendChild(el("option", { value: o[0] }, o[1])); });
      [[l1, q], [l2, sel]].forEach(function (pair) { var g = el("span", { "class": "objfield" }); g.appendChild(pair[0]); g.appendChild(pair[1]); form.appendChild(g); });
      var heads = ["Catalogue number", "Name", "International designator", "Kind", "Status", "Launch date", "Perigee (km)", "Apogee (km)", "Inclination (degrees)", "Radar cross-section (square metres)"];
      var numericCols = [0, 6, 7, 8, 9];
      var wrap = el("div", { "class": "tablewrap", role: "region", tabindex: "0", "aria-label": "Every object in Earth orbit" });
      var table = el("table", { id: "all-objects-table" });
      var cap = el("caption", null, "Every object in Earth orbit recorded for this owner");
      var thead = el("thead"), tr = el("tr");
      heads.forEach(function (h, i) { var th = el("th", { scope: "col", "data-col": String(i), "data-sort": numericCols.indexOf(i) >= 0 ? "num" : "text" }, h); if (numericCols.indexOf(i) >= 0) th.className = "num"; tr.appendChild(th); });
      thead.appendChild(tr);
      var tbody = el("tbody");
      table.appendChild(cap); table.appendChild(thead); table.appendChild(tbody); wrap.appendChild(table);
      var nav = el("div", { "class": "objpager" });
      var prev = el("button", { type: "button" }, "Previous page"), next = el("button", { type: "button" }, "Next page");
      var info = el("p", { "class": "meta", "aria-live": "polite", id: "obj-page" });
      nav.appendChild(prev); nav.appendChild(info); nav.appendChild(next);
      box2.appendChild(form); box2.appendChild(wrap); box2.appendChild(nav);
      var keyOf = function (r, col) { var c = objCells(r, C)[col]; return objKey(c, numericCols.indexOf(col) >= 0); };
      var draw = function () {
        var list = objFilter(rows, state.q, state.type).sort(function (a, b) { return objCompare(keyOf(a, state.col), keyOf(b, state.col), state.dir) || a.id - b.id; });
        var pg = objPage(list, state.page, C.pageSize);
        state.page = pg.page;
        tbody.textContent = "";
        pg.rows.forEach(function (r) {
          var row = el("tr");
          objCells(r, C).forEach(function (c, i) { var td = el("td", numericCols.indexOf(i) >= 0 ? { "class": "num" } : null, c); row.appendChild(td); });
          tbody.appendChild(row);
        });
        info.textContent = list.length ? "Page " + pg.page + " of " + pg.pages + ", " + list.length + " of " + rows.length + " objects" : "No object matches.";
        prev.disabled = pg.page <= 1; next.disabled = pg.page >= pg.pages;
      };
      q.addEventListener("input", function () { state.q = q.value; state.page = 1; draw(); });
      sel.addEventListener("change", function () { state.type = sel.value; state.page = 1; draw(); });
      prev.addEventListener("click", function () { state.page--; draw(); });
      next.addEventListener("click", function () { state.page++; draw(); });
      sortable(table, function (col, numeric, dir) { state.col = col; state.numeric = numeric; state.dir = dir; state.page = 1; draw(); });
      draw();
      q.focus();
    };
  }
}

const FUNCTIONS = [objNorm, objMatch, objKey, objCompare, objParse, objFilter, objPage, objCells, objInit];
// The inline script: the functions above by their source text, the constants as JSON, and one line that runs them.
export function objectsScript() {
  return `(function(){\n${FUNCTIONS.map((f) => f.toString().replace(/^export /, "")).join("\n")}\nobjInit(document, ${JSON.stringify(OBJ_CONST)});\n})();`;
}
// the styles the script's controls use (the page shell has none for inputs)
export const OBJECTS_CSS = ".objsearch{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:14px 0}.objsearch label{font-size:15px;color:var(--muted)}.objsearch input,.objsearch select{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;max-width:100%;min-width:0}.objsearch>input{flex:1 1 220px}.objfield{display:flex;flex-direction:column;gap:4px}.objfield:first-child{flex:1 1 240px}.objfield input,.objfield select{flex:none}#all-objects-table td,td time{white-space:nowrap}.sortbtn{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit;letter-spacing:inherit}.sortbtn:hover{color:var(--text)}th[aria-sort=ascending] .sortbtn::after{content:\" \\2191\"}th[aria-sort=descending] .sortbtn::after{content:\" \\2193\"}.objpager{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.objpager button{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer}.objpager button:disabled{opacity:.45;cursor:default}button.cta{border:0;cursor:pointer;font:inherit;font-weight:700}tr[hidden]{display:none}";
