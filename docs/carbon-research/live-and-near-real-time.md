# Live and near-real-time carbon / greenhouse-gas data sources: licence and access audit

Prepared for: zeninnov8.com ("Radar Around You"), possible future ads, affiliate links, paid alerts.
Research date: 2026-10-06 (all "read" dates below are 2026-10-06 unless stated). Read-only research; nothing was published or signed up for.

How to read this report
- "Quoted" means copied from a page I fetched in this session. "NOT CONFIRMED" means I could not verify the point from a primary page (403, JS-only page that would not render, DNS failure, or only a search snippet). Nothing was filled from memory.
- Where a page blocked plain `curl` (Cloudflare or similar), I read it in a browser session after the site's own passive check completed. No CAPTCHA was solved and no consent banner was accepted.
- This is a licence-reading exercise, not legal advice. Where a licence is silent or ambiguous I say so and recommend asking the data owner in writing before monetising.
- "Monetisation" below means: a public page with display ads and affiliate links, and possibly a paid alert product built on the data.

---

## 1. Summary table

Commercial column key: YES = commercial use expressly allowed; YES+ATTR = allowed with required attribution; NO = expressly forbidden; CONDITIONAL = allowed with restrictions that matter to the plan; NOT STATED = terms silent; NOT CONFIRMED = could not read the terms.

| # | Source | Quantity | Geography | Freshness (observed or stated) | Access | Licence (as stated) | Commercial use | Confidence |
|---|---|---|---|---|---|---|---|---|
| 1 | UK Carbon Intensity API (NESO) | gCO2/kWh actual+forecast, generation mix | Great Britain, 14 regions | 30-min slots; slot ending 02:00Z was served at 02:27Z | REST, no key | CC BY 4.0 plus Terms of Use | CONDITIONAL (cannot sell/sublicense access; cannot replace NESO UX) | High |
| 2 | Electricity Maps (free tier) | carbon intensity, mix, flows | Global zones | hourly (paid) | API key | Own ToS, free = non-commercial | NO on free tier; paid from EUR 6,000/yr per signal per country | High |
| 3 | ENTSO-E Transparency Platform | generation per type, load, flows, prices | EU/ENTSO-E area | stated H+1 after operating period | REST, token (email approval, ~3 working days), 400 req/min | CC BY 4.0 for a published list of data; Terms of Use | YES+ATTR for listed data; CONDITIONAL for rest | High |
| 4 | EIA Hourly Electric Grid Monitor (EIA-930) | hourly net generation by fuel, demand, estimated CO2 | US Lower 48 balancing authorities | stated: "yesterday" by 11:00 ET; CO2 by 16:00 ET | REST API v2, free key | US public domain | YES (acknowledge source) | High (freshness from page text only) |
| 5 | Open Grid Emissions (Singularity) | hourly emissions factors, GHG | US balancing authorities | annual release; not live | file download | CC BY 4.0 | YES+ATTR | High |
| 6 | Open Electricity (ex OpenNEM) | generation, price, emissions | Australia NEM + WEM | 5 min stated | REST, key | CC BY-NC 4.0 | NO (needs enterprise licence) | High |
| 7 | AEMO NEMWEB (raw feed behind #6) | 5-min dispatch SCADA | Australia NEM | files every 5 min, seen 12:50 AEST | public file directory | AEMO "any purpose" with attribution | YES+ATTR | High for permission; Medium for suitability |
| 8 | Energy-Charts API (Fraunhofer ISE) | generation by type, prices, CO2-relevant shares | Germany + many EU countries | 15-min, ~2 h behind | REST, no key, 2 req/min | API says CC BY 4.0; website says commercial use forbidden | CONFLICT (see section) | Medium |
| 9 | Elexon BMRS / Insights | generation outturn by fuel | Great Britain | near real time, worked keyless | REST, no key seen | BMRS Data Licence (attribution) | YES+ATTR | High |
| 10 | Energinet Energi Data Service | CO2 emission g/kWh, 5-min | Denmark DK1/DK2 | 5-min; 02:45Z row served ~02:50Z | REST, no key | CC BY 4.0 | YES+ATTR | High |
| 11 | RTE eco2mix via ODRE | generation mix, CO2 rate | France | 15-min; 02:30Z row served ~02:47Z | Opendatasoft REST, no key, 50,000 calls/user/month | Licence Ouverte v2.0 (Etalab) | YES+ATTR | High |
| 12 | ONS Brazil open data | hourly generation hydro/thermal/wind/solar, load | Brazil subsystems | file updated daily; last row 2026-10-03 23:00 | CKAN + S3 CSV/Parquet, no key | CC BY (CKAN licence_id) | YES+ATTR | High |
| 13 | Grid-India / MERIT India | all-India generation by source | India | live dashboard; daily reports | no API found | "copyrighted ... written consent" | NO without consent | Medium |
| 14 | TEPCO PG electricity forecast | demand only (no carbon) | Tokyo area | hourly | CSV | NOT STATED | NOT STATED | Low (no carbon data) |
| 15 | AESO (Alberta) | supply/demand | Alberta | live | API, free key (snippet only) | site: non-commercial, unmodified | NO (site terms); API terms NOT CONFIRMED | Medium |
| 16 | IESO (Ontario) | generation by fuel | Ontario | hourly | public reports | NOT CONFIRMED (host unreachable) | NOT CONFIRMED | Low |
| 17 | WattTime | marginal/average CO2 | 200+ regions (paid); CAISO_NORTH free | 5-min stated | API token | NOT CONFIRMED | NOT CONFIRMED | Low |
| 18 | Ember API | monthly/yearly generation, emissions, carbon intensity | 88 geographies monthly, 200+ yearly | monthly, not live | REST, free key | CC-BY-4.0 | YES+ATTR | High |
| 19 | NOAA GML Trends (CO2, CH4, N2O, SF6) | atmospheric mole fractions | Mauna Loa + global marine surface mean | daily/weekly files refreshed daily; global monthly ~1-4 months behind | static text/CSV URLs, no key, CORS open | US gov public domain with conditions | YES (credit NOAA/GML, no implied endorsement) | High |
| 20 | Scripps CO2 Program / Keeling Curve | Mauna Loa CO2 | Mauna Loa | archive files refreshed monthly | static CSV, no key | CC BY 4.0 | YES+ATTR | High |
| 21 | Copernicus CAMS global greenhouse gas forecasts (ADS) | CO2, CH4, CO 5-day forecast | Global 0.1 deg | new run daily, dataset updated 2026-10-06 | ADS account + CDS API key | CC-BY / Licence to Use Copernicus Products | YES+ATTR | High |
| 22 | Copernicus CAMS GFAS fire emissions (ADS) | fire emissions of 40 species incl. CO2, CH4 | Global 0.1 deg | hourly + daily, to 2026-10-05 | ADS account + key | CC-BY-4.0 | YES+ATTR | High |
| 23 | Copernicus C3S climate bulletin / Climate Pulse | temperature, sea ice, hydrology (no GHG on pages read) | Global/Europe | monthly | web | Copernicus licence | n/a for GHG | Medium |
| 24 | Open-Meteo air quality API (CAMS-derived CO2, CH4) | hourly CO2 ppm, CH4 | Global grid | hourly forecast | REST, no key (free) | CC-BY 4.0; free API non-commercial only | NO on free API (ads = commercial); paid plans allow | High |
| 25 | NASA OCO-2 / OCO-3 Lite XCO2 | column CO2 | Global satellite swaths | latest granules 2026-07-28 (OCO-2), 2026-08-31 (OCO-3) | GES DISC / CMR (login NOT CONFIRMED) | CC0 unless marked | YES | Medium |
| 26 | Sentinel-5P TROPOMI CH4 / CO (CDSE) | methane, CO columns | Global | NRT granules ~1 h after acquisition (example filenames) | CDSE account, OData/STAC, quotas | Sentinel Data Legal Notice: free, full and open | YES+ATTR | High |
| 27 | GOSAT (NIES/JAXA) | CO2, CH4 columns, monthly mean | Global | monthly mean to Aug 2026 | GDAS registration | NOT CONFIRMED | NOT CONFIRMED | Low |
| 28 | NOAA CarbonTracker / CT-NRT | CO2 fluxes and mole fractions | Global, N. America focus | CT-NRT.v2025-1 ends 31 Dec 2024 | file download | NOT CONFIRMED for product pages | NOT CONFIRMED (NOAA general terms apply) | Medium |
| 29 | Carbon Monitor | daily CO2 emissions by sector | 39 countries, US, EU, China, cities | files end 2026-04-02 (global) to 2026-07-31 (cities) | CSV endpoint, no key | "fair use open data policy" | NOT STATED | High on lag; Low on licence |
| 30 | Climate TRACE | GHG emissions by source, country, sector, monthly | Global | release 2026-09-24 covers through July 2026 | public API (beta), no key needed | CC BY 4.0 (with external-dataset exceptions) | YES+ATTR | High |
| 31 | GFED5.1 / GFED5.1NRT | fire emissions (CO2, CH4 etc.) | Global 0.25 deg | "updated daily" | SFTP with login | NOT STATED | NOT STATED | Medium |
| 32 | UNEP IMEO Eye on Methane / MARS | satellite methane plumes, top-50 emitters | Global | data posted 30 days after detection | web + CSV/XLS/JSON | CC BY-NC-SA 4.0 | NO | High |
| 33 | Carbon Mapper | methane + CO2 plumes | Global | scene dated 2026-09-06 seen on 2026-10-06 | public API (rate limited) + portal | Terms of Use: non-commercial only | NO (separate licence on request) | High |
| 34 | MethaneSAT | methane concentration and fluxes | Global target areas | satellite lost 2025-06-20 | access request form | Content Licence Terms | CONDITIONAL (derivatives yes, raw redistribution no) but mission ended | High |
| 35 | GHGSat | site-level methane | Global (commercial) | n/a | sales | NOT CONFIRMED | NOT CONFIRMED | Low |
| 36 | Kayrros Methane Watch | methane plumes | Global | n/a | free web access, REST API for customers | "internal research purposes" only | NO | High |
| 37 | US GHG Center STAC (incl. NASA EMIT methane plumes) | gridded GHG products, EMIT plumes | Global / US | EMIT v2 to 2026-05-10 | open STAC API, no key | CC0-1.0 on collections listed | YES | High for those collections |
| 38 | EU ETS allowance prices (EEX, ICE Endex) | EUA prices | EU | exchange feeds | paid vendor/display licences | Proprietary | Paid licence required | Medium |
| 39 | Voluntary credit prices | prices | Global | n/a | n/a | n/a | NOT CONFIRMED (search snippets only) | Low |

(39 rows. CAMS GFAS and the CAMS forecast are counted separately, as are the AEMO raw feed and Open Electricity, and the Open-Meteo reseller and the C3S bulletin are counted apart from CAMS.)

---

## 2. Per-source sections

### 2.1 UK Carbon Intensity API (NESO)
- Owner: National Energy System Operator (NESO), in partnership with Environmental Defense Fund Europe, University of Oxford Department of Computer Science and WWF (per the API home page).
- URLs read: https://carbonintensity.org.uk/ ; https://carbon-intensity.github.io/api-definitions/ ; https://github.com/carbon-intensity/terms ; live call https://api.carbonintensity.org.uk/intensity . https://carbonintensity.org.uk/terms-and-conditions returned HTTP 403 to curl (the GitHub terms repo is the version of record linked from the API docs).
- Quantity / geography / resolution: carbon intensity (gCO2/kWh) forecast and "actual", plus generation mix; Great Britain national plus 14 DNO regions; half-hour slots; forecast "96+ hours ahead". Quote: "The Carbon Intensity forecast includes CO2 emissions related to electricity generation only." Data downloadable from 2017-09-26 (CSV, 30 days per request).
- Cadence / lag: live call at 02:27 UTC returned slot 01:30Z to 02:00Z with forecast 186, actual 184, index "high". So roughly 30 minutes behind.
- Access: REST `https://api.carbonintensity.org.uk/intensity`, JSON, no key. Rate limit exists but number NOT CONFIRMED. Quote: "National Energy System Operator applies a rate limit and may block applications that make a large number of calls to the API."
- Licence quotes: API definitions page lists "License: CC BY 4.0". Terms repo: "License: CC BY 4.0". "You can use it anywhere in the world. Your use is non-exclusive, so others can use it too. Here are things you cannot do: Sell, lease, or sublicense the Carbon Intensity API or access to it. Use the Carbon Intensity API for any application that substantially replaces the core user experience of National Energy System Operator's websites, apps, or the Carbon Intensity API. Do anything that could mislead users into thinking you are offering a replacement for National Energy System Operator or that you or your product are endorsed or created by National Energy System Operator." Also: "Either party can end the license any time for any or no reason." and "We might update these terms from time to time without notice or reason." Trademark: "You agree to seek prior approval in writing from National Energy System Operator before any use of National Energy System Operator's logo or word mark."
- Commercial use: not expressly addressed. CC BY 4.0 permits it, but the ToU forbids selling or sublicensing "the API or access to it". An ad-supported display page is low risk. A paid alert product that is mainly a feed of this data is a grey area. Redistribution of the raw API: forbidden by the "sell, lease, or sublicense" clause as far as paid access goes; free republication of derived charts with credit appears fine.
- Risks: licence revocable at will; terms can change without notice; no SLA.
- Confidence: High.

### 2.2 Electricity Maps
- Owner: Electricity Maps (company name as shown on its help and pricing pages).
- URLs read: https://help.electricitymaps.com/en/articles/11750446-terms-of-service ("Last Updated: March 24, 2026"); https://help.electricitymaps.com/en/articles/13335550-how-can-i-access-the-electricity-maps-api-and-are-there-any-restrictions (dated July 10, 2026); https://www.electricitymaps.com/pricing ; https://github.com/electricitymaps/electricitymaps-contrib . The free-tier page https://www.electricitymaps.com/free-tier-api redirects (308) to a signup page which returned 403, so the free tier's zone and endpoint limits are NOT CONFIRMED from a primary page.
- Quantity: carbon intensity, carbon-free %, renewable %, generation mix, flows, load, prices; hourly granularity per pricing page ("All prices per country, per year at hourly granularity").
- Pricing quotes: "Carbon intensity gCO2eq/kWh, real-time ... EUR 6,000 / Year" (page shows the euro sign), "Electricity mix ... EUR 6,000 / Year", "All sustainability signals Bundle ... EUR 12,000 / Year". Per country.
- Access: API key. Quote: "Electricity Maps imposes a default rate limit of 150 API requests per minute."
- Licence quotes (ToS): "Free Use. Without a paid Subscription, the Client may use the Services and Data for: ... Personal and Academic Use: Personal or Academic Use projects, even if deployed live on a small scale (e.g., hobbyist websites or home assistant integrations), provided they are non-commercial and not relied upon by a business or other organization." "Evaluation Use must remain non-commercial, non-production, and may not be relied upon for business operations, compliance, or used in any externally available or revenue-generating product, service, or demonstration, including minimum-viable-products or pilots made available to customers or the public." "Commercial Use. Any Commercial Use of the Services or Data requires a paid Subscription or License Fee." "External Commercial Use: Use of the Services or Data, whether modified or unmodified, outside the Client's organization in any commercial product, service, solution, advisory project, or other external-facing context." Attribution: "you must include a clear attribution, such as 'Source: ElectricityMaps.com' or our logo." Third-party restriction: day-ahead prices from Nord Pool/EPEX "may not [be] disclose[d], display[ed], redistribute[d] ... externally (including through graphs, dashboards, or reports)". Account/API token sharing is prohibited.
- Commercial use: NO on the free tier once the site carries ads, affiliate links or paid alerts (the site would become revenue-generating and externally available). Redistribution of derived pages: only under a paid External Commercial licence.
- Repo note: the open-source parsers are AGPL-3.0 (earlier commits MIT), "licensed under GNU-AGPLv3 since v1.5.0". That covers code, not the Electricity Maps computed dataset.
- Confidence: High.

### 2.3 ENTSO-E Transparency Platform
- Owner: ENTSO-E.
- URLs read: https://transparencyplatform.zendesk.com/hc/en-us/articles/40921911218961-Legal-Terms-and-Conditions ; Terms of Use PDF (230329_ENTSOE_Transparency_Terms_Conditions_MC_APPROVED.pdf, version 29/03/2023); https://transparencyplatform.zendesk.com/hc/en-us/articles/12783148966036-API-Rate-Limit-Part-1 ; https://transparencyplatform.zendesk.com/hc/en-us/articles/12845911031188-How-to-get-security-token ; https://transparencyplatform.zendesk.com/hc/en-us/articles/16648290299284-Actual-Generation-per-Production-Type-16-1-B-C ; https://web-api.tp.entsoe.eu/api (returned 401 without a token, confirming a token is needed). The main site https://transparency.entsoe.eu/ rendered an empty page in the browser session; not needed for the above.
- Quantity: actual generation per production type [16.1.B&C], load, cross-border flows, prices, etc. for ENTSO-E member areas. (No CO2 intensity figures were seen in the pages read; carbon would have to be computed with your own emission factors.)
- Cadence: "Publication deadline for ENTSO-E: H+1 following the concerned MTU", "The information shall be published no later than one hour after the operational period", "Updates: Usually no update" for generation per type; per-country notes say some countries publish partly estimated values later updated.
- Access: free registration then email transparency@entsoe.eu with "RESTful API access" subject; "You will be granted within 3 working days"; generate token under My Account. Rate: "Primary Limit: 400 requests per minute per user account (API token)"; temporary ban about 10 minutes; "ENTSO-E reserves the right to revoke the token."
- Licence quotes: Terms of Use 2.5: "ENTSO-E currently publishes a subset of the Transparency Platform data available under an open source license (CC-BY 4.0) for the free use of Data Users". Legal page: "Pursuant to clause 2.5 of the Terms of Use, ENTSO-E publishes the list of data which is open for free re-use with no need to seek the prior agreement of the respective Primary Owner of Data." 3.1: the user shall "mention the ENTSO-E Transparency Platform as the source of publication of the data" and must not use the ENTSO-E name "in any manner that is likely to cause confusion regarding the possible existence of any kind of sponsorship or of endorsement"; "The Data User has responsibility to check this list before each re-use of the Transparency Platform Data." 5.1: "Transparency Platform Data may be subject to copyright owned by the Primary Owner of Data." 3.3: "The web graphical user interface of the Transparency Platform is primarily designed for human access and not for robots access" (use the API, not scraping). Rights are "not sub-licensable or transferrable."
- Commercial use: CC BY 4.0 covers commercial use for data on the open-reuse list; data not on the list needs the primary owner's agreement. I did not read the current list PDF (231018_List_of_Data_available_for_reuse.pdf and later versions are attachments); you must read it per dataset before use. Redistribution: allowed for listed data with attribution; "not sub-licensable" applies to the platform rights.
- Risks: token tied to one account, revocable; must check the reuse list; some countries' data are estimated.
- Confidence: High.

### 2.4 EIA Hourly Electric Grid Monitor (Form EIA-930) and Open Data API
- Owner: US Energy Information Administration.
- URLs read: https://www.eia.gov/electricity/gridmonitor/about ; https://www.eia.gov/about/copyrights_reuse.php ; https://www.eia.gov/opendata/ ; https://www.eia.gov/opendata/documentation.php ; https://www.eia.gov/opendata/register.php (API Terms of Service text) ; https://www.eia.gov/opendata/faqs.php .
- Quantity: hourly demand, forecast, net generation by energy source (battery storage added Jan 2025), interchange, and "Estimated total CO2 emissions", "Estimated CO2 emissions by fuel type", "Estimated CO2 emissions for electricity imports or exports" (all "beginning July 1, 2018"). Geography: Lower 48 balancing authorities. CO2 method quote: "We use average annual CO2 emissions factors ... to estimate CO2 emissions for each BA." Intensity of load uses a multiregional input-output model.
- Cadence (as stated on page): "Net generation, net generation by energy source, and total interchange for each hour of yesterday ... are typically available by 11:00 a.m. eastern time today." "Total CO2 emissions by energy source for each hour of yesterday are typically available by 4:00 p.m. eastern time today." "Demand by subregion, where available, is available on a lag of 1-30 days." So this is a next-day feed as documented. I could not test the API (key needed), so whether fresher data exist is NOT CONFIRMED.
- Access: "To call our API, you must use the unique API key assigned to you ... register for this free key." JSON returns max 5000 rows. FAQ: "if you keep your sustained rate less than ~9,000 per hour and your burst rate beneath 5 per second, your key won't be throttled or temporarily disabled." Embed feature "now requires the use of an API key".
- Licence quotes: "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products ... However, if you use or reproduce any of our information products, you should use an acknowledgment, which includes the publication date, such as: 'Source: U.S. Energy Information Administration (Oct 2008).'" API ToS: "You may use the EIA API to develop a service to search, display, analyze, retrieve, view and otherwise 'get' information from EIA data." "You may not modify or falsely represent content accessed through the API and still claim the source is the EIA." "You may not use the EIA names, or the like to imply endorsement or approval of any product, service, or entity, not-for-profit, commercial or otherwise." Logo: "may not be used without the expressed consent". Third-party protected material exists on the site (photos).
- Commercial use: YES (public domain). Redistribution: YES with acknowledgment, no endorsement implied, no altered data presented as EIA's.
- Risks: next-day cadence; BA-level not state-level; terms of API can be changed.
- Confidence: High.

### 2.5 Open Grid Emissions (Singularity Energy)
- URLs read: https://singularity.energy/open-grid-emissions ; https://github.com/singularity-energy/open-grid-emissions .
- Quantity: hourly (2019 onward), monthly and annual (2005-2025) generation-based and consumption-based emission factors, CO2, CH4, N2O, CO2e, for US balancing authorities.
- Cadence: not live. Quote: "Data published annually in the fall. Expected 2025 data release: October 2026. 2025 early release data: published August 2026. 2024 data released: December 2025."
- Licence: "This data is made available under the Creative Commons Attribution 4.0 International license (CC-BY-4.0)." Code is MIT (GitHub).
- Commercial: YES with attribution. Redistribution: yes under CC BY.
- Use case: reference emission factors for the US, not a live feed. Confidence: High.

### 2.6 Open Electricity (formerly OpenNEM), Australia
- Owner: The Superpower Institute.
- URLs read: https://docs.openelectricity.org.au/introduction ; https://docs.openelectricity.org.au/api-reference/overview ; https://platform.openelectricity.org.au/license (page says "Last updated: February 2026"); https://platform.openelectricity.org.au/ ; https://platform.openelectricity.org.au/terms (stub page, almost no text).
- Quantity: generation by fuel tech, demand, price, emissions for NEM and WEM; platform page: "Updated every 5 minutes from AEMO dispatch intervals".
- Access: "All API endpoints require authentication using an API key", base `https://api.openelectricity.org.au/v4`, Authorization: Bearer. Rate limits NOT CONFIRMED.
- Licence quotes: "Data published through the Open Electricity API and platform is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) licence." "Data sourced from Open Electricity (Superpower Institute), licensed under CC BY-NC 4.0." "Commercial use of this data requires a separate licence agreement. Please contact us about an Enterprise plan for commercial licensing options." Code/SDKs are MIT.
- Commercial: NO. Redistribution of data: only non-commercially with attribution.
- Alternative: see 2.7.
- Confidence: High.

### 2.7 AEMO NEMWEB (Australia raw dispatch files)
- Owner: Australian Energy Market Operator.
- URLs read: https://www.aemo.com.au/privacy-and-legal-notices/copyright-permissions ; https://www.nemweb.com.au/Reports/Current/Dispatch_SCADA/ (directory listing).
- Evidence of cadence: the directory listing showed `PUBLIC_DISPATCHSCADA_202610061250_...zip` stamped "Tuesday, October 6, 2026 12:49 PM" (AEST), files every 5 minutes.
- Licence quote: "In addition to the uses permitted under copyright laws, AEMO confirms its general permission for anyone to use AEMO Material for any purpose, but only with accurate and appropriate attribution of the relevant AEMO Material and AEMO as its author. You do not need to obtain specific permission to use AEMO Material in this way." Excludes confidential or third-party-commissioned documents. Whether every NEMWEB data file counts as "AEMO Material" is NOT CONFIRMED from that page.
- Practical note: raw SCADA is per generating unit (DUID); you would need to map units to fuel types and emission factors yourself (Open Electricity does this but under CC BY-NC).
- Confidence: High on the permission text; Medium on suitability.

### 2.8 Energy-Charts API (Fraunhofer ISE)
- URLs read: https://api.energy-charts.info/openapi.json (v2.0, release 2026-07-20) ; https://energy-charts.info/publishing-notes.html?l=en .
- Quantity: public net electricity production per production type (`/public_power`), installed power, day-ahead prices, cross-border flows, renewable share, "signal" traffic light; Germany and many European countries.
- Cadence: live test `public_power?country=de` returned 15-minute data ending 2026-10-06 00:45 UTC when read around 02:50 UTC, so about 2 hours behind.
- Access: no key. Quote: "Requests are limited per client IP and per endpoint ... The default is 2 requests per minute with a burst of 4; /signal allows 20 per minute (burst 40), /price 2 per minute (burst 2)." "For higher limits (commercial access) please contact leonhard.gandhi@ise.fraunhofer.de."
- Licence quotes, API spec: "Unless stated otherwise, the data provided by the Energy-Charts API is licensed under the CC BY 4.0 license. Proper attribution to Energy-Charts.info as the source is required." Price data: "The data for the following bidding zones is licensed as CC BY 4.0 from Bundesnetzagentur | SMARD.de ... The data for the other bidding zones is for private and internal use only. The utilization of any data whether in its raw or derived form, for external or commercial purposes is expressly prohibited."
- CONFLICT: the API's own "license" link points to the Publishing Notes page, which says: "All copyright for this Web site are owned in full by the Fraunhofer-Gesellschaft. Permission is granted to download or print material published on this site for personal use only. Its use for any other purpose, and in particular its commercial use or distribution, are strictly forbidden in the absence of prior written approval." These two statements are not reconciled on the pages I read.
- Commercial use: UNCLEAR. Treat as not safe for monetisation until Fraunhofer ISE confirms in writing. Rate limit of 2 requests per minute is very tight for live pages without server-side caching.
- Confidence: Medium.

### 2.9 Elexon BMRS / Insights (Great Britain)
- URLs read: https://bmrs.elexon.co.uk/api-documentation/introduction ; https://www.elexon.co.uk/bsc/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/ ; live call `https://data.elexon.co.uk/bmrs/api/v1/generation/outturn/current?format=json` (returned current MW and percentage by fuel, no key).
- Quantity: instantaneous generation outturn by fuel type (CCGT, nuclear, wind, biomass etc.), demand, system data. No CO2 values; combine with emission factors or use NESO (2.1).
- Cadence: the "current" outturn endpoint served live values; exact update interval NOT CONFIRMED. Rate limit NOT CONFIRMED.
- Licence quotes: "Elexon Limited hereby grants You a worldwide, royalty-free, perpetual, non-exclusive licence to Use the BMRS Data subject to the conditions below." Use includes "exploit the BMRS Data, including commercially, or by including it in your own product or application". Attribution: "When You Use BMRS Data, You must always use the following attribution statement to acknowledge the source of the information: Contains BMRS data (c) Elexon Limited copyright and database right [year]. Where possible You must also contain a link to this licence." Licence applies "if you are not a BSC Party". Excludes some material ("This licence does not cover the use of:" list, not read in full).
- Commercial: YES+ATTR. Sub-licences must carry the same attribution.
- Confidence: High.

### 2.10 Energinet Energi Data Service (Denmark)
- URLs read: https://www.energidataservice.dk/terms-and-conditions ; live call `https://api.energidataservice.dk/dataset/CO2Emis?limit=2&sort=Minutes5UTC%20desc`.
- Quantity: CO2 emission intensity of electricity consumption, g/kWh, 5-minute, price areas DK1 and DK2 (live rows: DK1 75, DK2 44 at 02:45 UTC, served about 02:50 UTC).
- Access: no key. Rate limit NOT CONFIRMED. Quote: "Energinet stores the used IP address for 3 months from each API call."
- Licence quotes: "Data published on Energi Data Service is subject to the conditions of Creative Commons CC-BY 4.0. Users may copy, change and distribute data freely, even for commercial purposes. Source: Energinet (www.energidataservice.dk)."
- Commercial: YES+ATTR. Redistribution: YES.
- Confidence: High. Limited to Denmark.

### 2.11 RTE eco2mix via ODRE (France)
- URLs read: https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr (metadata and records) ; Licence Ouverte v2.0 PDF https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf .
- Quantity: national real-time consumption, production by fuel, exchanges, and "Une estimation des émissions de carbone" (field `taux_co2`), 15-minute. Source note: "Elles proviennent des télémesures des ouvrages, complétées par des forfaits et estimations."
- Cadence: "mis à jour automatiquement une fois toutes les 15 minutes". Latest record with `taux_co2` non-null at read time: 2026-10-06T02:30Z (value 39 g/kWh, read about 02:47Z).
- Access: Opendatasoft API v2.1, no key. Quote: "un quota de 50000 appels API par utilisateur et par mois a été mis en place."
- Licence: dataset metadata says "Licence Ouverte v2.0 (Etalab)". LO 2.0 text (French): grants a free non-exclusive right of reuse "à des fins commerciales ou non, dans le monde entier et pour une durée illimitée", including to "l'exploiter à titre commercial, par exemple en la combinant avec d'autres informations, ou en l'incluant dans son propre produit ou application", subject to "mentionner la paternité de l'Information : sa source (au moins le nom du Concédant) et la date de dernière mise à jour".
- Commercial: YES+ATTR; redistribution allowed.
- Confidence: High. France only.

### 2.12 ONS Brazil (Operador Nacional do Sistema Elétrico)
- URLs read: https://dados.ons.org.br/api/3/action/package_search and package_show (CKAN API) ; S3 file https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_2026.csv .
- Quantity: hourly "Balanço de Energia nos Subsistemas": hydro, thermal, wind, solar generation, load and interchange (MWmed) for N, NE, S, SE/CO and SIN. Plant-level hourly generation also available (`geracao-usina-2`). I found no CO2 or emission-factor dataset on the portal in the searches run (NOT CONFIRMED that none exists).
- Cadence: file Last-Modified Mon 05 Oct 2026 22:00 GMT; last row 2026-10-03 23:00, so about 2.5 days behind the time of reading. Notes: "Os dados disponibilizados fazem parte de um processo de consistência recorrente e, portanto, podem ser atualizados após a sua publicação."
- Access: no key; CSV, XLSX, Parquet, JSON dictionary.
- Licence: CKAN `license_id: cc-by`, "Creative Commons Atribuição", link http://www.opendefinition.org/licenses/cc-by. CC BY deed (read): "Share ... for any purpose, even commercially. Adapt ... for any purpose, even commercially" with attribution.
- Commercial: YES+ATTR. Confidence: High on licence metadata; I did not read ONS's separate website terms.

### 2.13 Grid-India / MERIT India (India)
- URLs read: https://grid-india.in/ (and /hi/ mirror); https://grid-india.in/en/pages/website-policies ; https://meritindia.in/ .
- Quantity: Grid-India daily PSP, VRE, frequency reports (PDF/Excel links) and MERIT live "All India power position": demand met, thermal, gas, nuclear, hydro, renewable, storage, other, trans-national exchange (values shown "CURRENT"). No carbon intensity and no public API found.
- Licence quote (Grid-India website policies): "The Material contained in the Website is copyrighted and must not be distributed, modified, reproduced in whole or in part without the written consent of Grid-India prior to usage." MERIT: "All information in MERIT app is provided for information purposes only"; no reuse licence found.
- Commercial: NO without written consent. Scraping a dashboard is not an API. Confidence: Medium.

### 2.14 TEPCO PG electricity forecast (Japan)
- URL read: https://www.tepco.co.jp/en/forecast/html/download-e.html (via browser; curl got 403).
- Content: hourly demand records and forecasts for the Tokyo area as CSV; no generation mix or carbon. "Demand results may be revised in retrospect of past data". Licence NOT STATED on the page. Not suitable as a carbon source; included only to close the Japan question. OCCTO (https://www.occto.or.jp/en/index.html) fetched but no carbon or licence data extracted: NOT CONFIRMED.

### 2.15 AESO (Alberta, Canada)
- URLs read: https://www.aeso.ca/legal/ ; https://www.aeso.ca/market/market-and-system-reporting/aeso-application-programming-interface-api/ .
- API page lists APIs via an Azure API Management gateway but gave no key, rate-limit or licence text. A search snippet said keys are free and self-serve; NOT CONFIRMED on a primary page.
- Licence quote (site terms): "All material on this Web site is protected by copyright. The material may be used and copied for non-commercial, personal or educational purposes, provided that the material is not modified and that copyright notices are not deleted. Any other use of this material without the AESO's written permission is prohibited."
- Commercial: NO under the site terms; API-specific terms NOT CONFIRMED. No CO2 data confirmed.

### 2.16 IESO (Ontario, Canada)
- NOT CONFIRMED. www.ieso.ca and reports-public.ieso.ca did not resolve from this environment (curl exit 000; "getaddrinfo ENOTFOUND www.ieso.ca" in the fetch tool; browser ERR_NAME_NOT_RESOLVED). A search snippet describes anonymous hourly "Generator Output by Fuel Type" reports with no licence acceptance, but I could not read any terms. Do not rely on it.

### 2.17 WattTime
- URL read: https://watttime.org/docs-dev/data-plans/ .
- Quote: "Basic (free) ... All signals & endpoints for one region: CAISO_NORTH ... CO2 percentile, all regions". Higher plans: "Regions: Choose from global coverage of 200+ countries and territories". Forecast "72-hour rolling, updated every 5 minutes".
- Terms of use page not found (several URLs 404). Commercial rights of the free plan: NOT CONFIRMED.

### 2.18 Ember API and data
- URLs read: https://ember-energy.org/data/api/ ; https://api.ember-energy.org/openapi.json ; https://ember-energy.org/data/ .
- Quantity: "yearly and monthly electricity generation, demand, power sector emissions and carbon intensity"; monthly data for 88 geographies, yearly for over 200. Not live (monthly). The carbon price tracker URL I tried now returns 404 and the data index no longer lists it.
- Access: signup for an API key (emails hashed). Rate limit NOT CONFIRMED.
- Licence quotes: page footer "All content is released under a Creative Commons Attribution Licence (CC-BY-4.0)." API spec: "License: CC-BY-4.0".
- Commercial: YES+ATTR. Useful for context charts (monthly carbon intensity by country), not for live pages. Confidence: High.

### 2.19 NOAA GML: CO2, CH4, N2O, SF6 trends
- Owner: NOAA Global Monitoring Laboratory.
- URLs read: https://gml.noaa.gov/ccgg/trends/ ; https://gml.noaa.gov/ccgg/trends/data.html ; https://gml.noaa.gov/ccgg/trends_ch4/ ; https://gml.noaa.gov/ccgg/trends_n2o/ ; https://gml.noaa.gov/ccgg/trends_sf6/ ; https://gml.noaa.gov/about/disclaimer.html ; direct file headers under https://gml.noaa.gov/webdata/ccgg/trends/ .
- Files (stable URLs, all HTTP 200, `Access-Control-Allow-Origin: *`, plain text):
  - co2/co2_daily_mlo.txt : Last-Modified Mon, 05 Oct 2026 11:01 GMT; last row 2026-10-04, 425.89 ppm.
  - co2/co2_weekly_mlo.txt : last row 2026-09-27, 425.68 ppm; same Last-Modified.
  - co2/co2_mm_mlo.txt : Aug 2026, 427.55 ppm; file dated 8 Sep 2026. Page: "Monthly Average Mauna Loa CO2 August 2026: 427.55 ppm ... Last updated: Sep 05, 2026".
  - co2/co2_mm_gl.txt : global monthly, last row June 2026 (427.62 ppm).
  - co2/co2_trend_gl.txt : global daily trend, last row 2026-10-04 (425.45, 427.99).
  - ch4/ch4_mm_gl.txt : global monthly CH4, last row May 2026 (1939.44 ppb).
  - n2o/n2o_mm_gl.txt : last row May 2026 (339.82 ppb). sf6/sf6_mm_gl.txt : last row May 2026 (12.70 ppt).
  - (ch4_weekly_gl.txt returned 404, so no weekly CH4 file at that path.)
- Cadence: daily and weekly Mauna Loa files and the global CO2 trend file carried Last-Modified Mon 05 Oct 2026 when read on Tue 06 Oct (so refreshed at least every few days; the exact schedule is NOT CONFIRMED); global monthly CO2 is about 3 to 4 months behind, CH4/N2O/SF6 about 4 to 5 months behind (as seen). Quote on revisions: "These values are subject to change depending on quality control checks of the measured data, but any revisions are expected to be small."
- Licence quotes: file header: "USE OF NOAA GML DATA. These data are made freely available to the public and the scientific community in the belief that their wide dissemination will lead to greater understanding and new scientific insights. To ensure that GML receives fair credit for their work please include relevant citation text in publications." Disclaimer page: "The information on government servers are in the public domain, unless specifically annotated otherwise, and may be used freely by the public so long as you do not 1) claim it is your own ... 2) use it in a manner that implies an endorsement or affiliation with NOAA, or 3) modify it in content and then present it as official government material." Acknowledgement text: "Data/Image provided by NOAA Global Monitoring Laboratory, Boulder, Colorado, USA (https://gml.noaa.gov)". Also: "Data need to have a separate citation from any of GML's images." The trends page says how to reference: "Dr. Xin Lan, NOAA/GML (gml.noaa.gov/ccgg/trends/) and Dr. Ralph Keeling, Scripps Institution of Oceanography (scrippsco2.ucsd.edu/)".
- Commercial: YES (public domain) with credit and no implied endorsement. Redistribution: YES.
- Rate limit: none documented (static files); be polite and cache.
- Confidence: High. Best fit for an automated "CO2 today" page.

### 2.20 Scripps CO2 Program / Keeling Curve
- URLs read: https://keelingcurve.ucsd.edu/ ; https://keelingcurve.ucsd.edu/permissions-and-data-sources/ ; https://scrippsco2.ucsd.edu/data/primary-mauna-loa-co2-record/ ; https://scrippsco2.ucsd.edu/data/atmospheric-co2-data/sampling-station-records/mauna-loa-observatory/ ; files at https://keelinglabsites.ucsd.edu/websitedataco2/ .
- Quantity: Mauna Loa CO2 weekly, monthly, daily (daily_in_situ_co2_mlo.csv, weekly_in_situ_co2_mlo.csv, monthly_in_situ_co2_mlo.csv), 1958 to present.
- Cadence: "The datasets are archived once a month on the scrippsco2.ucsd.edu website". Files had Last-Modified Mon, 21 Sep 2026; weekly file ends 2026-09-12; daily file ends 2026-09-30 with NaN values. "*Mauna Loa Observatory data from the most recent month is preliminary."
- Licence quotes: "Scripps CO2 program data and graphics on scrippsco2.ucsd.edu are licensed under a CC BY license, Creative Commons Attribution 4.0 International License ..., which clarifies appropriate uses and requirements, including that credit be given to the Scripps Institution of Oceanography at UC San Diego." Keeling Curve graphics: "licensed under a CC BY license ... The graphics must be credited to the Scripps Institution of Oceanography at UC San Diego."
- Commercial: YES+ATTR. Note: the site also asks that "ethical usage may also require disclosing intentions at early stages" for peer-reviewed science. Confidence: High. Less fresh than NOAA's file; use NOAA for live and credit Scripps as co-originator of the Mauna Loa record.

### 2.21 Copernicus CAMS global greenhouse gas forecasts (Atmosphere Data Store)
- Owner: ECMWF for the European Commission (Copernicus).
- URLs read: https://ads.atmosphere.copernicus.eu/api/catalogue/v1/collections/cams-global-greenhouse-gas-forecasts (JSON metadata) ; https://ads.atmosphere.copernicus.eu/datasets/cams-global-greenhouse-gas-forecasts ; https://ads.atmosphere.copernicus.eu/how-to-api ; Licence to Use Copernicus Products PDF (https://object-store.os-api.cci2.ecmwf.int/cci2-prod-catalogue/licences/licence-to-use-copernicus-products/...pdf).
- Quantity: "5-day high-resolution forecasts of carbon dioxide (CO2) and methane (CH4). Additionally, carbon monoxide (CO) and meteorological parameters". Global grid 0.1 x 0.1 degrees, 3-hourly, March 2024 to present.
- Cadence: "New forecast based on the 00UTC analysis added each day"; dataset "Update date 2026-10-06"; catalogue temporal extent ends 2026-10-05. Text: "the high-resolution forecast with a resolution of approximately 9km is run a few hours behind real time"; "because some meteorological fields in the forecast do not fall within the general CAMS data licence, they are only available with a delay of 5 days."
- Access: ADS account, personal CDS API key in `$HOME/.cdsapirc` (`url: https://ads.atmosphere.copernicus.eu/api`), accept the dataset licence, GRIB or netCDF. Queue-based retrieval, so best used with a scheduled server job, not a live per-visitor call. Quota values NOT CONFIRMED.
- Licence: dataset page "Licence CC-BY licence"; API metadata `license: CC-BY-4.0`. Licence to Use Copernicus Products quotes: "Access to Copernicus Products is given for any purpose in so far as it is lawful, whereas use may include, but is not limited to: reproduction; distribution; communication to the public; adaptation, modification and combination with other data and information". Attribution: "'Generated using Copernicus Atmosphere Monitoring Service information [Year]'"; for modified data "'Contains modified Copernicus Atmosphere Monitoring Service information [Year]'", and the publication "shall state that neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains." IP clause: "All Intellectual Property Rights in the Copernicus Products belong ... to the European Union" but "All other new Intellectual Property Rights created as a result of modifying or adapting the Copernicus information will be owned by the creator" (outside the portal toolbox).
- Commercial: YES+ATTR. Confidence: High. Related dataset in the same catalogue: cams-global-atmospheric-composition-forecasts (twice daily, 5 days, includes carbon monoxide; CO2 and CH4 not confirmed in that one).

### 2.22 Copernicus CAMS GFAS fire emissions
- URL read: https://ads.atmosphere.copernicus.eu/api/catalogue/v1/collections/cams-global-fire-emissions-gfas and the dataset page.
- Quote: "The CAMS Global Fire Assimilation System (GFAS) utilises satellite observations of fire radiative power (FRP) to provide near-real-time information on the location, relative intensity and estimated emissions from biomass burning and vegetation fires. ... Emissions estimates for 40 pyrogenic species ... including aerosols, reactive gases and greenhouse gases". "GFAS version 1.4.2 provides hourly estimates and daily averaged data ... It is provided for 1 January 2026 to present." Resolution 0.1 x 0.1 degrees; catalogue extent ends 2026-10-05.
- Access and licence as 2.21 (account, key, CC-BY-4.0). Commercial: YES+ATTR. Confidence: High. Complements the NASA FIRMS pages already on the site.

### 2.23 Copernicus C3S climate bulletins and Climate Pulse
- URLs read: https://climate.copernicus.eu/climate-bulletins ; https://pulse.climate.copernicus.eu/ .
- The monthly bulletin (latest posted "10 September 2026", covering August 2026) is about temperature, sea ice and hydrology: "This series of monthly maps and charts, generated from ERA5 data, covers global and European surface air temperatures." Climate Pulse shows air and sea temperature. Neither page listed CO2 or CH4 concentrations. A separate "Climate Indicators" page exists but I did not read it: whether it carries GHG concentrations is NOT CONFIRMED. Licence of these pages: Copernicus licence (as 2.21), not separately verified for these pages.

### 2.24 Open-Meteo Air Quality API (CAMS-based CO2 and CH4)
- URLs read: https://open-meteo.com/en/docs/air-quality-api ; https://open-meteo.com/en/terms ; live call returned `carbon_dioxide` in ppm and `methane` in ug/m3 hourly.
- Quotes: "You may only use the free API services for non-commercial purposes. You accept to the CC-BY 4.0 licence". "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute." Commercial examples: "Operating websites or apps that have subscriptions or display advertisements." Non-commercial examples: "private or non-profit websites or apps that do not have subscriptions or advertising." Pricing table: "Commercial use" is not allowed on Free, allowed on Standard/Professional/Enterprise (Standard 1M calls/month).
- Commercial: NO on the free API once ads or subscriptions are added; paid Standard plan required. Useful as a convenience wrapper; the underlying CAMS data can be had directly under CC-BY (2.21).
- Confidence: High.

### 2.25 NASA OCO-2 and OCO-3 (XCO2)
- Owner: NASA / JPL / GES DISC.
- URLs read: NASA CMR collection and granule queries (https://cmr.earthdata.nasa.gov/search/...) ; https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance ; GES DISC pages did not render (JS) beyond a stub.
- Findings: OCO-2 Lite FP v11.3r is "the current version"; its newest granule at read time was dated 2026-07-28 (processed 2026-08-25). OCO-3 Lite FP v11r newest granule 2026-08-31 (processed 2026-09-28). So about 1 to 2 months behind, retrospective processing. A near-real-time OCO product was not found in CMR searches: NOT CONFIRMED that one exists or is public. Download login requirements: NOT CONFIRMED from a primary page this session.
- Licence quote: "Unless the content is marked with a use restriction or license, data provided from a NASA-led mission are licensed as Creative Commons Zero (CC0). While there are no restrictions on the use of these data, data users are very strongly urged to cite the data used in their work products." Also "NASA ESDIS content used in a factual manner that does not suggest or imply endorsement may be used without explicit permission. NASA should be acknowledged as the source."
- Commercial: YES. Practical value for live pages: low (swath data, lag, heavy processing).

### 2.26 Sentinel-5P TROPOMI methane and CO
- URLs read: https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel5P.html ; https://www.tropomi.eu/data-products/methane ; https://documentation.dataspace.copernicus.eu/Quotas.html ; Sentinel Data Legal Notice PDF (https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice).
- Findings: CDSE offers "Near Real Time (NRT) ... Last one month" and "Non Time Critical (NTC) ... Apr 2018 - Present" for both Level 2 CH4 and CO. Example filenames on the TROPOMI page: NRT `S5P_NRTI_L2__CH4____20260201T234313_...` produced 2026-02-02T00:53, i.e. about one hour after acquisition (my reading of the filename; a stated latency was NOT CONFIRMED). NRTI granules are "5-minute chunks of orbits".
- Access: CDSE account; quotas page lists per-user monthly and per-minute limits and "Number of concurrent connections limit (IAD) 4"; "Monthly transfer limit (TB) (IAD) 12". These are raw swath products, not a ready-to-plot feed.
- Licence quotes: "the law provides that users shall have a free, full and open access to Copernicus Sentinel Data and Service Information without any express or implied warranty". Permitted use includes "(a) reproduction; (b) distribution; (c) communication to the public; (d) adaptation, modification and combination with other data and information". Attribution: "Where the user communicates to the public or distributes Copernicus Sentinel Data and Service Information, he/she shall inform the recipients of the source of that Data and Information".
- Commercial: YES+ATTR. Practical value: needs a processing pipeline; only worth it for a methane map feature. Confidence: High.

### 2.27 GOSAT (NIES / JAXA / MOE Japan)
- URLs read: https://www.gosat.nies.go.jp/en/recent-global-co2.html ; https://www.gosat.nies.go.jp/en/about_4_data.html .
- Findings: the page shows "Whole-atmosphere monthly mean CO2 concentration" with "Monthly mean CO2 August 2026 424.4 ppm", "CO2 trend ... 426.2 ppm", growth "2.1 ppm/yr". Products are distributed via GDAS: "Prior user registration is required for accessing the data products". The GDAS data policy page did not render (JS stub): licence and commercial use NOT CONFIRMED. Monthly cadence, about one month behind.

### 2.28 NOAA CarbonTracker and CT-NRT
- URLs read: https://gml.noaa.gov/ccgg/carbontracker/ ; https://gml.noaa.gov/ccgg/carbontracker/CT-NRT/ ; https://gml.noaa.gov/ccgg/carbontracker-ch4/ (fetched, not studied).
- Findings: "The current release of CarbonTracker, CT2026, provides global estimates of surface-atmosphere fluxes of CO2 from January 2000 through December 2025." CT-NRT page: "CT-NRT.v2025-1 is the current release. It provides results from 01 Jan 2021 to 31 December 2024." Download: https://gml.noaa.gov/aftp/products/carbontracker/co2/CT-NRT.v2025-1/ . So it is not live (about 21 months behind) despite the "near-real-time" name. Licence for the product files: NOT CONFIRMED (the GML disclaimer in 2.19 is the general NOAA statement).

### 2.29 Carbon Monitor
- Owner: academic consortium (home page team list: Tsinghua University, LSCE, Stanford and others; the footer also links WeDoData).
- URLs read: https://carbonmonitor.org/ (via browser, page is a SPA) ; download endpoint https://datas.carbonmonitor.org/API/downloadFullDataset.php?source=carbon_global (and the same pattern with other `source=` values).
- Quantity: daily CO2 emissions from fossil fuel and cement by sector (power, industry, ground transport, residential, domestic and international aviation) for countries, plus US states, China provinces and cities.
- Real lag measured from files downloaded 2026-10-06 (file named carbonmonitor-global_datas_2026-10-06.csv): carbon_global ends 2026-04-02 (39 countries/regions, 619,811 lines), about 6 months behind; carbon_china ends 2026-06-30; carbon_cities ends 2026-07-31; carbon_us ends 2021-12-31 and carbon_eu ends 2021-08-07 (these two look stale or superseded; only `carbon_global` is linked from the home page, the other `source=` names were tried by pattern and are not documented on a page I read). `carbon_power` and similar returned a PHP warning, not data.
- Access: plain CSV download, no key, `Access-Control-Allow-Origin: *`. No documented API or rate limit found: NOT CONFIRMED.
- Licence quote (homepage disclaimer): "Carbon Monitor data are made freely available to the public with a fair use open data policy. We encourage users to cite the data by this paper. Carbon Monitor is a living dataset subject to updates and the values are expected to change ... All information displayed and provided can be used at the own responsibility of users." No SPDX licence stated.
- Commercial: NOT STATED. Redistribution: NOT STATED. Treat as unsafe for monetisation until the team confirms in writing (contact.carbonmonitor@gmail.com is listed on the page). It is not "near real time" as of today, only roughly 3 to 6 months delayed.
- Confidence: High on the lag and the missing licence.

### 2.30 Climate TRACE
- URLs read: https://climatetrace.org/data ; https://climatetrace.org/terms ; https://api.climatetrace.org/ (Scalar docs) and https://api.climatetrace.org/v7/docs/openapi.json (v7.2.0) ; test call https://api.climatetrace.org/v7/rankings/countries?since=2025&to=2026 returned JSON without a key.
- Quantity: GHG emissions (CO2, CH4, N2O, CO2e) by country, sector, subsector and individual source; monthly series. Quote from OpenAPI: "Monthly data is available for January 2015 through the current year."
- Cadence: "Latest Data Release Sep 24, 2026 ... September release 5.11.0 includes monthly emissions data through July 2026." So about 2 months behind, monthly releases. The page also says the API is "now available in beta".
- Access: public REST API, endpoints include /v7/sources, /v7/sources/emissions, /v7/rankings/countries, /v7/definitions/*. No key was needed. Rate limit NOT CONFIRMED.
- Licence quotes: "The emissions data and associated metadata has been made available via Climate TRACE under the Creative Commons Attribution 4.0 International License (CC BY 4.0), with the exception of external datasets listed below. In general, this means that anyone is free to copy, modify and distribute Climate TRACE data in any format for any purpose, including commercial use, as long as you attribute it to Climate TRACE and indicate if you have made any changes." External datasets with their own terms: EDGAR, FAOSTAT, EU E-PRTR, US EPA FLIGHT, Israel PRTR, US EPA LMOP, Canada GHGRP (listed sectors). "the sole responsibility of the user to review the terms and conditions for all the above sources".
- Commercial: YES+ATTR (excluding the external-dataset sectors, which need checking). Confidence: High.

### 2.31 GFED5.1 and GFED5.1NRT
- URLs read: https://www.globalfiredata.org/ ; /data.html ; /faq.html ; /current.html.
- Findings: "GFED5.1NRT near-real-time data for 2023 onward"; "The data are updated daily and can also be used to assess the current fire situation"; files via SFTP ("Login details are available here (note that the port number is 1022)"). Species include CO2, CO, CH4, N2O.
- Licence: NOT STATED. FAQ: "GFED data are freely available and proper citation is sufficient." For media: "Media reports should acknowledge the Global Fire Emissions Database (GFED) and include a link to the GFED website". No commercial wording. Redistribution: NOT STATED. Use CAMS GFAS (2.22) instead for a clearly licensed fire-emissions feed.

### 2.32 UNEP IMEO Eye on Methane / Methane Alert and Response System (MARS)
- URLs read (via browser; curl got 403): https://methanedata.unep.org/ ; https://methanedata.unep.org/methane-alert-response-system ; https://methanedata.unep.org/download-dataset .
- Findings: "IMEO makes satellite data and metadata available to the public on Eye on Methane 30 days after an emission event is detected." The top-50 emitter list is "updated monthly". Downloads in "CSV, XLS or JSON". Not real time by design.
- Licence quote: "The data may not be used commercially and is shared under a Creative Commons BY-NC-SA 4.0 license. Please review the Eye on Methane terms of use before downloading and using the data." (Terms link: https://www.unep.org/terms-use, not read.)
- Commercial: NO. Share-alike plus non-commercial means any derived data would also have to be non-commercial. Confidence: High.

### 2.33 Carbon Mapper
- URLs read: https://carbonmapper.org/terms/ ("Effective / Last Updated: January 13, 2026") ; https://data.carbonmapper.org/ ; API https://api.carbonmapper.org/api/v1/openapi.json ; test call https://api.carbonmapper.org/api/v1/catalog/plumes/annotated?limit=1 returned data without a key.
- Quantity: methane and CO2 plumes and sources (portal showed "44863 Plumes, 13542 Sources"), emission rate estimates, imagery. Latest record seen: scene 2026-09-06T01:43Z (Tanager), published 2026-10-06; so roughly one month behind the scene date for that record (was not verified as the globally newest scene). API text: "Caution: API results may contain uncalibrated Tanager first light data."
- Access: public API; "we implement restrictions designed to prevent excessive resource use, such as rate limiting" (numbers NOT CONFIRMED).
- Licence quotes: "The license set forth in these Terms may be exercised by you on a (a) Non-Commercial basis only ... Unless otherwise separately agreed by Carbon Mapper, you may not use Carbon Mapper's Data Product(s) for any commercial purpose." Non-Commercial means uses "from which you will not derive profits (or other consideration) or otherwise obtain a financial advantage by charging a third party in exchange for redistributing products or services that involve your use of the Data Product(s)". Attribution required; "Any redistributions by You ... must be made available under the same non-commercial terms and attribution requirements". "Carbon Mapper may terminate or suspend your license ... at any time, with or without cause, with or without notice." Alternative: "Carbon Mapper may negotiate separate license agreements for certain Data Product(s) for commercial use ... contact Carbon Mapper at data@carbonmapper.org."
- Commercial: NO. An ad-supported page is a risk because the definition of non-commercial turns on deriving "profits (or other consideration) or ... a financial advantage". Confidence: High.

### 2.34 MethaneSAT (Environmental Defense Fund)
- URLs read: https://www.methanesat.org/ ; https://www.methanesat.org/data ; https://www.methanesat.org/project-updates/results-anomaly-investigation-loss-communication-methanesat ; Content Licence Terms of Use PDF (revised 2-12-2025).
- Status quote: "On 20 June 2025, MethaneSAT experienced an on-orbit anomaly resulting in loss of communication with the spacecraft." Published 2025-11-06. No new data is being collected.
- Data access: web portal, Google Earth Engine, Google Cloud. Licence terms: "you must complete the following form ... MethaneSAT may (in its sole discretion) grant you access to the Data". Allowed: "(ii) commercial applications, such as developing and selling derivative products and services". Restricted: "you may not distribute, publish, sublicense, sell, or otherwise provide L3 Data or L4 Data in its raw form to any third parties" and the data may not be shared on any other platform. Attribution: "Data from MethaneSAT" and "Download the most current dataset at Google Earth Engine and/or Google Cloud".
- Commercial: derivative products yes, raw redistribution no, access is gated and revocable. Not live. Confidence: High.

### 2.35 GHGSat and 2.36 Kayrros
- GHGSat (https://www.ghgsat.com/en/ read): a commercial site-level methane service ("Request a Demo"); no public API or open-data licence found on the page; terms NOT CONFIRMED.
- Kayrros Methane Watch (https://methanewatch.kayrros.org/ and /terms-of-service): "Kayrros provides access to its data via REST or Python APIs" (customers). Free web licence quote: "Kayrros grants to USER a free, non-exclusive, non-transferable, worldwide license to access and use the DATA solely for internal research purposes. The license does not include the right of USER to sublicense the DATA or any part thereof, to resell the DATA to any third party or to use the DATA for commercial purposes. USER shall not publish the DATA without Kayrros' prior written authorization." Commercial: NO. Publishing: NO without authorisation.

### 2.37 US Greenhouse Gas Center STAC (NASA, includes EMIT methane plumes)
- URLs read: https://earth.gov/ghgcenter/api/stac/ and /collections (10 collections).
- Findings: open STAC API with no key. Collections and listed licences: emit-ch4plume-v2 `CC0-1.0`, extent 2022-08-09 to 2026-05-10 (about 5 months behind), emit-ch4plume-v1 `CC-BY-1.0`, ct-ch4-monthgrid-v2025 `CC0-1.0` (ends 2023-12), plus CC0 and CC-BY-4.0 research products; none are live. Geographic coverage of EMIT plumes was not stated on a page I read: NOT CONFIRMED.
- Commercial: YES for the CC0 collections listed (CC-BY-1.0 for v1 requires attribution). Confidence: High for those collections.

### 2.38 EU ETS allowance (EUA) price feeds
- URLs read: https://www.eex.com/en/market-data/licensing-policies ; ICE Endex Market Data Policy v5 (Jan 2026) and ICE Futures Europe Market Data Policy v4 (Jan 2026).
- EEX quotes: "Media Usage ... A Media Usage licence allows our customers to disseminate the EEX Market Data publicly in raw form only. Usual use cases are price tickers on a public website or a promotional document." "Commercial Usage ... onward dissemination to a third party, in raw or in derived form, for their exclusive Internal Usage". Fees not read. A search snippet said insubstantial, infrequent display of data may be allowed without a licence: NOT CONFIRMED on the page I read.
- ICE Endex Market Data Policy v5 (January 2026): "The Exchange offers a separate license for users who wish to publicly display the Exchange's delayed data. Public display is defined as an Internet website, web page, electronic media or printed material that is not security restricted and/or pay-per-view." Table: "Public Display $2,500" per year (Redistribution License Fee $10,000). "EU Emissions Futures / Options" appears in the policy's product list. ICE Futures Europe policy (UKA etc.) lists Public Display at $3,000 in one column.
- Conclusion: there is no confirmed free, commercially usable live EUA price feed. Showing a live EU carbon price on an ad-supported page would, per these policies, normally need a paid display licence. Ember no longer lists a carbon price tracker (404 on the old URL).
- Confidence: Medium (fees read, EUA applicability of the $2,500 not stated explicitly).

### 2.39 Voluntary carbon credit prices
- Only search snippets (Carbon Pulse VCM portal, S&P Platts, OPIS, Berkeley VROD, CarbonPlan OffsetsDB). NOT CONFIRMED: I read no primary page with a free live price feed or licence. Registry issuance data (Berkeley VROD, CC BY 4.0 per snippet) is not price data and is not live.

---

## 3. Cross-cutting findings that matter for monetisation

1. Cleanly commercial-friendly and key-free or easy-key: NOAA GML files, Energinet (CC BY 4.0, "even for commercial purposes"), RTE eco2mix (Licence Ouverte 2.0), Elexon BMRS, Climate TRACE, EIA, ENTSO-E (listed data), Copernicus CAMS, Ember, Scripps, ONS Brazil, US GHG Center CC0 collections.
2. Non-commercial or consent-needed: Electricity Maps free tier, Open Electricity (CC BY-NC), Open-Meteo free API, Carbon Mapper, UNEP IMEO (CC BY-NC-SA), Kayrros, AESO site terms, Grid-India. If ads, affiliate links or paid alerts are added, do not build pages on these without a commercial licence.
3. Ambiguous (get written clarification before monetising): UK Carbon Intensity (CC BY 4.0 but "sell ... access" and "substantially replaces" clauses matter for a paid-alert product), Energy-Charts (API CC BY 4.0 versus website "commercial use ... strictly forbidden"), Carbon Monitor (no licence stated), GFED (no licence stated), GOSAT, WattTime free plan, IESO.
4. "Near real time" in the name does not mean live: Carbon Monitor global CSV is about 6 months behind; CarbonTracker CT-NRT ends Dec 2024; IMEO publishes plumes 30 days after detection; OCO-2/3 are 1 to 2 months behind; NOAA global CH4/N2O/SF6 monthly are about 4 to 5 months behind; Carbon Mapper recent record about 1 month behind; EMIT about 5 months behind.
5. Truly live (minutes to hours) and open: UK Carbon Intensity (30 min), Energinet (5 min), RTE eco2mix (15 min), Elexon (live outturn), Energy-Charts (about 2 h, licence conflict), ENTSO-E (H+1), AEMO NEMWEB (5 min), NOAA daily CO2 (daily), CAMS forecasts (daily run), CAMS GFAS (daily/hourly), Sentinel-5P NRT (about 1 h after acquisition, heavy to process).
6. Attribution strings to keep ready: NOAA ("Data/Image provided by NOAA Global Monitoring Laboratory, Boulder, Colorado, USA (https://gml.noaa.gov)"); Copernicus ("Generated using Copernicus Atmosphere Monitoring Service information [Year]" and the no-liability statement); Elexon ("Contains BMRS data (c) Elexon Limited copyright and database right [year]"); Energinet ("Source: Energinet (www.energidataservice.dk)"); EIA ("Source: U.S. Energy Information Administration" with publication date); ENTSO-E (name the Transparency Platform as source, no implied endorsement); RTE/ODRE (Licence Ouverte: source and last-update date); Climate TRACE, Scripps, Ember, ONS (CC BY credit with link).

---

## 4. Ranking: 8 best sources for automated live pages (licence-first)

1. NOAA GML Trends (CO2, CH4, N2O, SF6). Static text files at stable URLs, no key, CORS open, daily-refreshed Mauna Loa and global CO2 trend files (last row 2026-10-04 when read), public-domain with credit. The simplest, safest "CO2 right now" page; note global monthly CH4/N2O/SF6 lag about 4 to 5 months.
2. Energinet Energi Data Service (Denmark CO2Emis). 5-minute CO2 intensity, no key, explicit "even for commercial purposes" under CC BY 4.0. Best live carbon-intensity feed from a licensing viewpoint, but Denmark only.
3. RTE eco2mix via ODRE (France). 15-minute generation mix with a CO2 estimate, Licence Ouverte 2.0 with explicit commercial reuse, no key (50,000 calls per user per month, so cache server-side).
4. UK Carbon Intensity API (NESO). Best national and regional carbon-intensity data with forecasts, no key, CC BY 4.0. Ranked below the three above only because of the "sell ... access" and "substantially replaces" clauses; fine for an ad-supported page, check with NESO before a paid alert.
5. EIA Hourly Electric Grid Monitor (US). Public domain, hourly net generation by fuel and estimated CO2 for US balancing authorities. Free key; documented as next-day (11:00 ET for generation, 16:00 ET for CO2), so "yesterday" pages rather than live.
6. ENTSO-E Transparency Platform (EU). Generation per type published within an hour (H+1), CC BY 4.0 for the open-reuse list; needs a token (3 working days), 400 requests per minute, and you must check the reuse list per dataset. Carbon intensity must be computed with your own emission factors.
7. Climate TRACE. Monthly (not live) source-level and country GHG data, public API with no key, CC BY 4.0 with explicit commercial permission; ideal for "where emissions come from" pages with a 2-month lag.
8. Elexon BMRS (Great Britain generation outturn). Commercial use expressly allowed with a fixed attribution line, no key needed for current outturn; pairs with the UK Carbon Intensity API for a GB mix page.

Honourable mentions: Copernicus CAMS greenhouse-gas forecasts and GFAS fire emissions (CC BY, global, needs account and a scheduled job); ONS Brazil (CC BY hourly generation, 2 to 3 days behind); AEMO NEMWEB (any purpose with attribution, but raw unit-level data); Ember (CC BY monthly country carbon intensity for context charts); US GHG Center CC0 collections.
Avoid for a monetised site without a licence: Electricity Maps free tier, Open Electricity, Carbon Mapper, UNEP IMEO, Kayrros, Open-Meteo free API, Energy-Charts (until clarified), Carbon Monitor and GFED (licence not stated).

---

## 5. Items still open (NOT CONFIRMED)
- Electricity Maps free-tier zone and endpoint limits (signup page blocked).
- Rate limits for UK Carbon Intensity, Elexon, Energinet, Open Electricity, Climate TRACE, Ember, Carbon Mapper.
- Exact EIA API freshness (needs a key to test).
- ENTSO-E current open-reuse list contents per dataset.
- IESO, AESO API terms, WattTime free-plan terms, GOSAT and GDAS data policy, OCO login requirements, any NRT OCO product, CarbonTracker product licence, GHGSat terms, UNEP general terms (https://www.unep.org/terms-use), Carbon Mapper and Carbon Monitor commercial permission by negotiation, Energy-Charts licence conflict, GFED licence, voluntary credit price feeds.
