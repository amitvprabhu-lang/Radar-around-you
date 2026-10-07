// Small shared parts for live pages that meet the Google readiness checklist (docs/superpowers/specs/2026-10-06-more-live-pages-design.md,
// section 7) without changing the shared page shell: the WebPage structured data with inLanguage, isPartOf and breadcrumb, figures with
// captions and the time element (tables get their header scopes from site/layout.mjs's table). A later pass can move them into
// site/layout.mjs for every page.
import { SITE, urlPath, esc, href } from "./layout.mjs";
import { LIVE_SCRIPT_FILE, LIVE_SCRIPT_VERSION } from "./live-pages-js.mjs";

// WebPage JSON-LD: name, description, url, inLanguage, dateModified (the data time), isPartOf the WebSite, and the same breadcrumb the
// page shows (Home, then the page), as renderPage writes it in its BreadcrumbList.
// crumbs: the pages between Home and this one, as renderPage's page.crumbs ([{ name, file }]), so both breadcrumbs say the same.
export function webPageLd({ file, title, description, dataTime, crumbTitle, crumbs = [] }) {
  const url = `${SITE.url}/${urlPath(file)}`;
  const middle = crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 2, name: c.name, item: `${SITE.url}/${urlPath(c.file)}` }));
  return {
    "@context": "https://schema.org", "@type": "WebPage", name: title, description, url, inLanguage: "en", ...(dataTime ? { dateModified: dataTime } : {}),
    isPartOf: { "@type": "WebSite", name: SITE.name, url: `${SITE.url}/` },
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${SITE.url}/` }, ...middle, { "@type": "ListItem", position: middle.length + 2, name: crumbTitle, item: url }] },
  };
}


// A chart or map in a figure with a one-sentence caption (what it shows and its data time); the SVG keeps its own title and desc.
export const figureHtml = (svg, caption) => `<figure style="margin:18px 0">${svg}<figcaption style="color:var(--muted);font-size:14px;margin-top:6px">${esc(caption)}</figcaption></figure>`;

// "<time datetime="2026-10-06T01:30:38Z">6 October 2026, 01:30 UTC</time>"
export const timeTagUtc = (iso, text) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

// The body attributes and script of the shared live-pages.js (site/live-pages-js.mjs): the version contract, the page's kind for the live
// refresh (or none), the address of the site's live data folder relative to the page, and the page's data time.
export function liveScriptParts(file, { page = null, dataTime }) {
  return {
    bodyAttrs: { "data-live-v": String(LIVE_SCRIPT_VERSION), ...(page ? { "data-live-page": page } : {}), "data-live-base": href(file, "live/"), "data-live-time": dataTime },
    scriptSrc: href(file, LIVE_SCRIPT_FILE),
  };
}
