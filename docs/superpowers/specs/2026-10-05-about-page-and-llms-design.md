# Design: the About page, a richer home page and llms.txt

Status: design approved by the owner in conversation on 2026-10-05 ("Build and deploy"), written down for the record. Anything marked NOT CONFIRMED has not been checked.

## 1. Why

The site's 110 content pages are rich in readable text, but the home page is the 3D app: about 100 words of text outside scripts (the title, a description, structured data and a `<noscript>` paragraph with nine links). Nothing on it tells a search engine or an AI tool what the site does. The owner asked for the site text to be rich, fully indexable and easy for search engines and AI tools to understand. The test domain stays noindex for now; everything here must be ready for the day the flag is removed.

## 2. What is built

1. **An About page at `/about/`**, "What Radar Around You is and does". Visible to every visitor. No hidden or visually hidden text anywhere. About 800 to 1,200 words with headings written as questions: what it is, what you can do with it (grouped: above you, in tonight's sky, under your feet, around you, tools, each with links to the matching guide or reference page), where the data comes from (a table of named sources), how fresh it is, what it does not do, privacy, whether it is free, how it is checked, and a visible FAQ. Structured data: `AboutPage` (no `dateModified`, because the page is static and a date would be invented) plus the shell's breadcrumb. No FAQPage markup (Google reports the FAQ rich result is no longer shown).
2. **A richer home page.** The `<noscript>` block becomes a real description with a short feature list and the existing links (the About page is in the nav, so it is linked). The `WebApplication` structured data gains a `featureList` from the same list, and a `WebSite` block is added. The in-app About sheet gets two links through `src/guidelinks.js` (data only): the About page and the satellite count page.
3. **`/llms.txt`**, in the llmstxt.org format (a name, a summary, grouped links with one-line notes), generated from the site's own page titles and descriptions. It is written only when the site is indexable, like the sitemap, so it never contradicts a noindex build. Nothing read says search engines or assistants use it for ordinary sites, so it is an optional extra, not a ranking measure.

## 3. Truthfulness rules

- Every statement on the About page comes from `README.md`, `docs/feature-sources.md`, `docs/hazard-sources.md`, `docs/star-sources.md`, `docs/handoff.md` or the existing guides, and `docs/about-sources.md` maps each statement to its source. A statement that cannot be traced is left out.
- No volatile numbers (object counts, test counts). The one place numbers appear is the "about 15,000 people" size of towns that the place search covers, from the README.
- Three sentences are the author's own wording and are flagged for the owner's review in the handoff: the "not an emergency warning service" note, the "Sky Lens is new and has had limited testing on real phones" note (from the handoff, which says it has not been tried on a real phone), and "an independent, free project" (no personal name on the page).
- Data refresh intervals are not printed in the sources table, because they can drift; the page points to the app's Data status screen. The "within roughly 10 to 25 minutes" figure is our own estimate from the hosting notes and is worded as one.

## 4. Not in scope

Per-feature landing pages, translations, an Organization record, a social image, any change to the 3D app other than the two data links, and robots.txt changes (at launch the owner decides which crawlers to name; the default `Allow: /` admits all).

## 5. Tests

Unit tests for the page (length, required sections, named sources, privacy and limits sentences, structured data, no hidden-text markup, no volatile numbers, house style), for the home page changes (noscript content, `featureList`, `WebSite`), for `llms.txt` (format, links all point at built pages, absent in a noindex build), and the existing site tests updated for one more page and one more nav entry. Browser: `e2e:site` loads `/about/` raw and checks `llms.txt` against the noindex flag.

## 6. Risks

| Risk | Handling |
| --- | --- |
| A sentence on the page overstates what the app does | Every sentence is traced in `docs/about-sources.md`; the owner reviews the three author-worded sentences. |
| The page goes stale as features change | `docs/about-sources.md` lists the source of each statement, so a change to a feature points to the sentence to update. |
| llms.txt does nothing | Documented as optional and unproven; it costs one small generated file. |
