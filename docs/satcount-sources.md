# Sources for the satellite count page

Everything here was read on 2026-10-05 from the place named. Anything marked NOT CONFIRMED could not be checked from a primary page. Re-read each page before relying on it.

## What the feed contains
- Read from the collector's code, `pipeline/feeds.py` (the satellites feed requests CelesTrak GP groups `active`, `stations` and `visual`) and `pipeline/catalogue.py` (SATCAT records for the purpose groups, plus four debris clouds: cosmos-1408, cosmos-2251, fengyun-1c and iridium-33). It is not the full catalogue.
- The bundled snapshot (`public/meta.json`, `details.bin`, `swarm.bin`, taken 2026-10-04) has 19,316 objects: 16,632 payloads, 4 rocket bodies, 2,677 debris and 3 unknown. Only 2 objects have the status "Not operational". So the feed gives a count of active satellites and cannot give counts of all satellites, rocket bodies or debris.

## What counts as active (OUR definition)
- The status codes are CelesTrak's, from https://celestrak.org/satcat/status.php as recorded in `docs/feature-sources.md`: + operational, - nonoperational, P partially operational, B backup, S spare, X extended mission, D decayed, ? unknown. The packed values are 1 operational, 2 partially, 3 backup, 4 spare, 5 extended, 6 not operational, 7 decayed, 0 not known.
- "Active satellite" = object type payload with status 1 to 5. This is our choice, not CelesTrak's, and the page says so.

## CelesTrak usage policy (https://celestrak.org/usage-policy.php)
- Read 2026-10-05. It covers how often data may be requested and caching ("Only download the data you need, when you are going to use it, and only download data once per update", with update frequencies listed; GP data every 2 hours).
- It does not address republishing, redistributing or building apps on the data, credit, commercial use, or statistics derived from the data. This is silence, not permission. NOT CONFIRMED whether publishing aggregate counts is acceptable. Mitigations: aggregate counts only, no per-satellite list, a visible credit and links to CelesTrak on the page. Consider asking CelesTrak directly.

## Orbit groups (OUR working definitions, NOT CONFIRMED against a cited standard)
- These are the numbers in `ORBIT_BOUNDS` in `site/satcount.mjs`; change them there first and then here.
- High elliptical: eccentricity 0.25 or more, checked first. Otherwise mean altitude (semi-major axis minus `SWARM_EARTH_RADIUS_KM`): low below 2,000 km, medium from 2,000 km up to 35,585 km, geostationary belt 35,586 to 35,986 km (the geostationary altitude is about 35,786 km, so this is plus or minus 200 km), beyond above 35,986 km.
- Before the page calls these standard terms, cite a source (for example ESA or NASA orbit class definitions) here, or keep the page's "our working definitions" wording.

## Competitor evidence (estimates)
- Ubersuggest exports supplied by the owner on 2026-10-05 for orbitalradar.com (estimated visits, a top 600 pages list and a top 2,000 keywords list). They are estimates, not measurements, and the lists are subsets. They showed one "how many satellites are in orbit" page holding about 77% of the estimated visits in the page list, and launch related keywords about 3% of the keyword traffic. See the design spec, section 1.

## Search and answer engines (read 2026-10-05, summarised)
- Google, AI features and your website: "no additional requirements" to appear in AI Overviews or AI Mode, no special markup or AI text files needed; pages must be indexed and eligible to be shown with a snippet. (https://developers.google.com/search/docs/appearance/ai-features)
- Google, sitemaps: a hint only; `lastmod` is used only if consistently and verifiably accurate; `priority` and `changefreq` are ignored. (https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- Google, publication dates: the structured date must describe the page's update, not the events on it. (https://developers.google.com/search/docs/appearance/publication-dates)
- Google, FAQPage structured data (https://developers.google.com/search/docs/appearance/structured-data/faqpage), read as a summary: the FAQ rich result is no longer shown in Search (announced May 2026; documentation removed June 2026), and was earlier limited to well-known government and health sites. So no FAQPage markup is added; the FAQ stays as visible text.
- Google, structured data general guidelines (https://developers.google.com/search/docs/appearance/structured-data/sd-policies): markup must match visible content, violations can bring a manual action, and Google does not guarantee rich results even for correct markup. The search gallery (https://developers.google.com/search/docs/appearance/structured-data/search-gallery) lists Article, Breadcrumb, Dataset, Event, Organization and Software app among others, and does not list FAQ or HowTo.
- OpenAI crawlers: OAI-SearchBot powers ChatGPT search results, GPTBot is model training only, ChatGPT-User acts for a user. (https://developers.openai.com/api/docs/bots)
- Anthropic crawlers: ClaudeBot (training), Claude-User (user questions), Claude-SearchBot (search quality). (https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- llms.txt (https://llmstxt.org/): a proposal; its page says thousands of sites publish one and AI labs publish them for developer docs, and does not claim search engines read it. Not used here.
- IndexNow (https://www.indexnow.org/documentation): pings participating engines; the page does not mention Google. Not used in this pilot.

## Cross-check against an independent count
- To be recorded in Task 9 of the implementation plan: the independent source, its figure, its date, and how our active count compares. Until then the page says "our count" and accuracy is NOT CONFIRMED.
