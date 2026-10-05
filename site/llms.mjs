// llms.txt for the site, in the llmstxt.org layout: a name, a one line summary, then groups of links with a note each. It is built from the
// site's own page titles and descriptions, so it cannot drift from the pages. Written only when the site is indexable (see site/build.mjs).
// Nothing read says search engines or AI assistants use this file for ordinary sites; it is a small optional extra.
import { urlPath } from "./layout.mjs";
import { SATCOUNT_FILE } from "./pages-satcount.mjs";

const clean = (s) => String(s).replace(/\s+/g, " ").trim();
// OURS: the live satellite page's description holds today's numbers, so this file uses a fixed note instead.
const LIVE_NOTE = "A live count of active satellites in orbit, with breakdowns by owner, orbit, purpose and launch year.";
const REFERENCE = ["moon-phases/index.html", "eclipses/index.html", "meteor-showers/index.html", "planets/index.html", "seasons/index.html", "constellations/index.html", "stars/index.html", "sky/index.html"];

export function buildLlmsTxt({ pages, url, name, summary }) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const entry = (file, note) => {
    const p = byFile.get(file);
    if (!p) throw new Error(`llms: no page ${file}`);
    return `- [${clean(p.crumbTitle || p.h1)}](${url}/${urlPath(file)}): ${clean(note || p.description)}`;
  };
  const guides = pages.map((p) => p.file).filter((f) => /^guides\/[a-z0-9-]+\/index\.html$/.test(f));
  const lines = [
    `# ${name}`, "", `> ${clean(summary)}`, "",
    `${name} is a free project. The pages below are plain HTML that works without JavaScript; the live 3D app is at ${url}/.`, "",
    "## Start here",
    `- [The live app](${url}/): ${clean(summary)}`,
    entry("about/index.html"), entry("methods/index.html"), "",
    "## Sky reference", ...REFERENCE.map((f) => entry(f)), "",
    "## Guides", ...guides.map((f) => entry(f)), "",
    "## Live data", entry(SATCOUNT_FILE, LIVE_NOTE), "",
  ];
  return lines.join("\n");
}
