# Carbon and greenhouse gas emissions: sources by country, sector and gas

Prepared 2026-10-06 for zeninnov8.com (Radar Around You). Read-only web research. Theme: emissions by country, by industry (sector) and by type of gas, with per-capita and consumption-based views.

This is a research summary, not legal advice. Check each licence yourself before relying on it for ads, affiliate links or paid alerts.

## How this was researched, and what could not be read

- Every URL below was read on 2026-10-06 (the "date read" for every source).
- Live API calls were made without keys where the API allows it, so the facts about years, countries and sectors are observed, not assumed.
- Pages I could NOT read from the primary site (blocked by a bot check, which I did not try to bypass): unfccc.int and di.unfccc.int (Incapsula security check), iea.org (Cloudflare check), ember-energy.org website pages (Cloudflare check), energyinst.org (Cloudflare check). For those I say NOT CONFIRMED, or I quote a secondary source and label it as secondary.
- "NOT CONFIRMED" means I could not verify it from a primary page. "NOT STATED" means I read the primary page and it does not say.

## Headline findings for a commercial site

1. Climate TRACE is CC BY 4.0, commercial use and modification explicitly allowed, but a few subsectors reproduce EDGAR, FAOSTAT and CEDS data "directly from their source" and the user is told to check those terms themselves.
2. EDGAR is split: IEA-EDGAR CO2 (fossil CO2) is quoted as CC BY-NC-ND 4.0, which forbids commercial use and derivatives. EDGAR CH4, N2O and F-gases fall under the general "CC BY 4.0" statement for EU-owned material.
3. PRIMAP-hist is NOT commercially usable: since v2.7/v2.8 it is CC BY-NC-SA 4.0 and a commercial licence must be obtained from the authors. This matters because Climate Watch, FAOSTAT (non-agrifood rows), OWID's methane and nitrous oxide columns (via Jones et al.) and the World Bank all sit downstream of PRIMAP-hist or EDGAR in some way.
4. FAOSTAT is CC BY 4.0 but adds: "Datasets shall not be used for or in conjunction with the promotion of a commercial enterprise and/or its product(s) or services (s)". That is a risk for an ad or affiliate funded page.
5. IEA data are paid or restricted for commercial use (secondary evidence; primary page blocked). Climate Action Tracker says "must not be used for commercial purposes".
6. Global Carbon Project national data (including consumption-based CO2) is CC BY 4.0 on the ICOS portal. Ember is CC BY 4.0 (quoted from its API documentation). Eurostat reuse is authorised for commercial purposes with acknowledgement.

## Summary table

Confidence: High = licence and facts read on the owner's own page or API. Medium = licence read on a secondary or partner page, or some facts missing. Low = primary page unreadable.

| Source | Coverage | Sectors | Gases | Latest year | Access | Licence | Commercial use | Derivatives | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| Climate TRACE | 252 countries/territories in API list (2015 on, annual API; monthly in downloads) | 10 sectors, 68 subsectors | CO2, CH4, N2O, CO2e (AR6 100yr and 20yr), F-gas group, air pollutants | Monthly data through July 2026 (release 5.11.0, 24 Sep 2026) | Free REST API (beta, no key seen), CSV zips, BigQuery | CC BY 4.0, plus listed external datasets with own terms | Allowed (stated) | Allowed (stated) | High |
| Climate Watch (WRI) | 199 locations (CW series) | Energy (6 subsectors), Industrial Processes, Agriculture, Waste, LULUCF, Bunker Fuels | CO2, CH4, N2O, F-gas, All GHG | 2023 (CW series), 2024 (PIK, GCP series) | Public JSON API (no key seen), CSV from Data Explorer | CC BY 4.0 "except as noted", with FAO and IEA exceptions | Allowed (stated) with exceptions | Allowed (stated) with exceptions | High for text, Medium for what is safe inside |
| EDGAR (EU JRC): non-CO2 | About 210 countries and territories in report table | IPCC 1996/2006 sector codes, about 24 sector groups | CH4, N2O, F-gases (GWP AR5) | 2025 (EDGAR 2026 GHG, released 24 Sep 2026) | Direct zip/xlsx download (no key) | CC BY 4.0 (EU-owned material) | Allowed | Allowed | High |
| EDGAR: IEA-EDGAR CO2 | Same | Same | Fossil CO2 | 2025 | Direct zip/xlsx | CC BY-NC-ND 4.0 (quoted) | FORBIDDEN without IEA permission | FORBIDDEN | High |
| PRIMAP-hist v2.8 | Almost all UNFCCC states plus territories | M.0.EL total, Energy, IPPU, Agriculture (Livestock, other), Waste, Other, LULUCF (separate file) | CO2, CH4, N2O, F-gases (KYOTOGHG) | 2025 (published 29 Sep 2026) | Zenodo files (CSV, NetCDF) | CC BY-NC-SA 4.0, commercial licence on request | FORBIDDEN (commercial licence needed) | Only under same NC-SA terms | High |
| OWID CO2 and GHG dataset | 215 entities with co2 (ISO coded), 120 with consumption-based | By fuel (coal, oil, gas, cement, flaring, other industry), land-use change; no sector columns | CO2, CH4, N2O, total GHG | 2024 (consumption-based: 2023) | One CSV/JSON URL, no key; GitHub repo | CC BY 4.0 for OWID-produced data; third-party columns keep their licences | Allowed for OWID-produced; check each source | Allowed (CC BY) | High for text, Medium for CH4/N2O |
| OWID sector breakdown (grapher) | 205 entities | 11 sectors | Total GHG (and CO2, CH4, N2O charts) | 2023 | Chart Data API (CSV + JSON, no key) | CC BY, built on Climate Watch (2026) | Allowed per OWID; inherits Climate Watch exceptions | Allowed per OWID | Medium |
| Global Carbon Project / Budget | National fossil CO2, consumption-based and land use | Fuel: coal, oil, gas, cement, flaring, other | CO2 only | 2024 national (GCB 2025); consumption to 2023 per OWID | XLSX via ICOS Carbon Portal; no API | CC BY 4.0 (ICOS record) plus GCP fair use text | Allowed | Allowed | High |
| Jones et al. national contributions | About 199 countries (via OWID) | Fossil vs land use | CO2, CH4, N2O | 2024 | Zenodo CSV | CC BY 4.0 (Zenodo) but built on PRIMAP-hist | Allowed by its own licence; PRIMAP-hist input licence NOT CONFIRMED | Allowed by its own licence | Medium |
| UNFCCC inventories and GHG data interface | Annex I (45 in CW copy) and non-Annex I (148 in CW copy) | IPCC categories | All Kyoto gases | Annex I: latest 2026 submission (NOT CONFIRMED); Climate Watch copy ends 2021 | Primary pages blocked | NOT CONFIRMED (secondary snippet: public domain if unchanged) | NOT CONFIRMED | Possibly restricted (no change to content) | Low |
| FAOSTAT Emissions Totals | 281 areas (incl. aggregates) | Agrifood systems, Farm gate, Land-use change, Pre- and post-production, IPPU, Energy, Waste and others | CO2, CH4, N2O, F-gas, CO2eq (AR5) | 2023 (plus 2030, 2050 projections) | Bulk CSV zips; API needs authorization token | CC BY 4.0 plus extra terms | Conditional: no promotion of a commercial enterprise or its products | Allowed (adapt) subject to terms | High |
| World Bank WDI | 217 non-aggregate economies in country list | Power, Industrial combustion, Industrial processes, Transport, Building, Fugitive, Agriculture, Waste | CO2, CH4, N2O, F-gas, total | 2024 (2025 empty for USA) | Free REST API, no key | CC BY 4.0 (catalog page) | Allowed (stated) | Allowed (stated) | Medium (upstream EDGAR/IEA clash) |
| IEA | Global, fee-based | Fuel combustion by sector | CO2 | NOT CONFIRMED | Primary pages blocked | Non-CC terms (secondary) | Restricted (secondary) | Restricted (secondary) | Low |
| Ember | 214 countries/economies yearly; 98 areas monthly | Power sector only, by fuel | CO2 (power) | Yearly 2025; monthly 2026-06 | Free CSV, API with key | CC BY 4.0 (quoted from API docs) | Allowed (stated) | Allowed (no extra restrictions) | High |
| Energy Institute Statistical Review | Country energy and CO2 | Energy CO2 | CO2 | 2026 edition (30 Jun 2026) | Primary pages blocked | NOT CONFIRMED (conflicting snippets) | NOT CONFIRMED | NOT CONFIRMED | Low |
| CEDS | Country by sector by fuel | 20 aggregate sector codes | CO2, CH4, N2O, air pollutants | 2023 (v_2025_03_18) | Zenodo zips | CC BY 4.0 (Zenodo) | Allowed (Zenodo) | Allowed (Zenodo) | Medium |
| Carbon Monitor | 39 country/region series | 6 sectors | CO2 only | 2026-07-31 (daily) | Public CSV URL, no key | "fair use open data policy" (not a formal licence) | NOT STATED | NOT STATED | Medium |
| Climate Action Tracker | NOT CONFIRMED (explorer is script-driven) | Sector indicators | GHG | NOT CONFIRMED | Web and download button | "must not be used for commercial purposes" | FORBIDDEN | Reproduction only with credit | High |
| Eurostat air emissions accounts | 33 geo entities (EU27, EEA, CH, RS, TR) | 84 NACE industry and household codes | CO2, CH4, N2O, HFC, PFC, NF3+SF6, GHG | 2024 (2025 empty) | Free JSON API, no key | Reuse authorised incl. commercial with source acknowledgement; CC BY 4.0 | Allowed | Allowed | High |

---

## 1. Climate TRACE

- Owner: Climate TRACE Coalition (WattTime is the secretariat; trademark notice on the terms page).
- URLs read (2026-10-06): https://climatetrace.org/terms ; https://climatetrace.org/data ; https://climatetrace.org/sectors ; https://climatetrace.org/faqs ; https://api.climatetrace.org/v6/swagger/index.html and its spec https://api.climatetrace.org/v6/swagger/openapi.json (API v6.8.2) ; live calls to /v6/definitions/* and /v6/country/emissions ; the Data Licensing, Schema, and Citation Guide PDF https://media.climatetrace.org/about_the_data_latest_b6e7b8d419.pdf (Inventory Sept 2026, Version 5.11.0).
- Quantity: emissions inventory of emitting sources (2,765,771 sources summarised from 744,678,997 assets per the site banner), country totals by sector and subsector.
- Geography: 252 countries and territories in /v6/definitions/countries (includes territories and Antarctica).
- Years: country-level API returns data from 2015 (queries for 2010 and 2014 returned empty arrays; 2015 returned values). Latest: monthly data through July 2026 (page: "September release 5.11.0 includes monthly emissions data through July 2026"; release dated Sep 24, 2026). Lag about 2 months.
- Update cadence: monthly releases (Aug 2026 release 5.10.0 covered through June 2026).
- Sectors (10, from /v6/definitions/sectors): fluorinated-gases, forestry-and-land-use, buildings, manufacturing, mineral-extraction, waste, fossil-fuel-operations, agriculture, transportation, power.
- Subsectors (68, from /v6/definitions/subsectors; grouping under sectors is by the names shown on the Sectors page): see section "Sector names by source".
- Gases: guide says CO2, CH4, N2O and all three combined as CO2e (100 year and 20 year, IPCC AR6 GWPs); air pollutants PM2.5, black carbon, organic carbon, SO2, VOCs, CO, NH3, NOx. The API gas list has 60+ codes (including individual HFCs, PFCs, SF6, NF3) but the country endpoint returned co2, ch4, n2o, co2e_100yr, co2e_20yr in my calls. F-gases appear only as CO2e (fluorinated-gases subsector world 2023: co2e_100yr 1,671.81 Mt, no co2/ch4/n2o).
- Which gas from which subsector (observed from /v6/country/emissions, world totals for 2023, units Mt): electricity-generation CO2 only (13,723 Mt); enteric-fermentation-cattle-operation CH4 only; synthetic-fertilizer-application N2O only; coal-mining CO2 453 plus CH4 67; oil-and-gas-production CO2 1,100 plus CH4 78; solid-waste-disposal CH4 only; rice-cultivation CH4 only; cement CO2 only; road-transportation CO2 plus tiny CH4 and N2O.
- Per capita and consumption-based: NOT provided (production-side inventory). Population must come from elsewhere.
- Access: REST API at https://api.climatetrace.org/v6 (Swagger/Scalar docs). No key was needed in my calls. Response header access-control-allow-origin: * (browser calls allowed). Rate limits: NOT STATED in the spec. The data page says: "As a beta release, we cannot guarantee availability of the Climate TRACE API; please keep volume low and use it with caution in production settings." Also CSV download packages (files per subsector: _country_emissions.csv, _emissions_sources.csv, ownership, confidence), BigQuery dataset trace-data-383422.climate_trace, geopackage for boundaries. The sector package links shown on the Sectors page (downloads.climatetrace.org/v02/sector_packages/<sector>.zip) returned HTTP 404 when tested, so the current package URL pattern is NOT CONFIRMED (the Data page download tool generates it). ers_plan_global.zip exists at https://downloads.climatetrace.org/latest/ers/ers_plan_global.zip (about 45 MB, last modified 24 Sep 2026).
- API quirk observed: the spec names the filter `sector`, but live calls only filtered with `sectors=` (and `subsectors=`). With no sector filter the total returned for the USA 2024 (6,613 Mt co2e_100yr) equals the sum of the nine non-forestry sectors; forestry-and-land-use is separate and negative for the USA (about -622 Mt). Sector split for USA 2024, Mt CO2e (100yr): power 1,564; transportation 1,974; agriculture 410; buildings 573; waste 159; manufacturing 651; fossil-fuel-operations 1,013; mineral-extraction 11; fluorinated-gases 257.
- Licence, quoted (terms page): "The emissions data and associated metadata has been made available via Climate TRACE under the Creative Commons Attribution 4.0 International License (CC BY 4.0), with the exception of external datasets listed below. In general, this means that anyone is free to copy, modify and distribute Climate TRACE data in any format for any purpose, including commercial use, as long as you attribute it to Climate TRACE and indicate if you have made any changes."
- External data exceptions, quoted from the guide: "The following datasets have been reproduced directly from their source. It is the sole responsibility of the data user to review the terms and conditions for all the above sources prior to using the data." Affected: country-level estimates for Other energy use, Railways, Other transportation, Other onsite fuel usage, Solid fuel transformation / Other solid fuels, Other fossil fuel operations, Other manufacturing, Solid waste disposal, Biological treatment of solid waste, Incineration and open burning of waste, Fluorinated gases, Cropland fires (source: EDGAR, and CEDS v_2024_07_08 as listed in the guide); Rice cultivation (some geographies), Other Agricultural Soil Emissions, Enteric Fermentation Other, Manure Management Other (source: FAOSTAT); some source-level rows from E-PRTR, US EPA FLIGHT, Israel PRTR, EPA LMOP, Canada GHGRP. The terms page adds: "The Climate TRACE Coalition makes no claims or warranties regarding the accuracy, completeness, or licensing terms for these datasets."
- Attribution: "Climate TRACE (2026), Climate TRACE Emissions Inventory v5.11.0, https://climatetrace.org [Date Accessed]" (guide).
- Commercial use: ALLOWED (stated). Derivative works: ALLOWED (stated, "copy, modify and distribute"). Redistribution: ALLOWED (stated). Caveat: the reproduced EDGAR rows may carry EDGAR's terms, and the IEA-EDGAR CO2 component is CC BY-NC-ND (see EDGAR). To stay safe, avoid the listed external subsectors or apply EDGAR's terms to them.

## 2. Climate Watch (WRI)

- Owner: World Resources Institute (managed with the NDC Partnership).
- URLs read (2026-10-06): https://www.climatewatchdata.org/about/permissions (rendered in a real browser); https://www.climatewatchdata.org/about/description ; https://www.wri.org/research/climate-watch-country-greenhouse-gas-emissions-data-and-methodology (technical note) ; https://www.wri.org/research/permissions-licensing ; live API https://www.climatewatchdata.org/api/v1/data/historical_emissions (and /data_sources, /sectors, /gases). The API has no documentation page I could find (the /api-docs URL returned an error page), so its terms and rate limits are NOT STATED.
- Quantity: country greenhouse gas emissions by sector and gas, several source series.
- Data sources in the API (observed): Climate Watch (id 274; 199 locations; sectors 14), PIK = PRIMAP-hist (275; 215 locations), UNFCCC Annex I (276; 45 locations), UNFCCC Non-Annex I (277; 148 locations), GCP (278; 196 locations), US State Inventory (279; 52 locations).
- Years observed for the USA: Climate Watch series 1990-2023 (a "three-year lag" per WRI's technical note: "The latest available data usually have a three-year lag; for example, in 2023, we reported emissions data from 2020."); PIK series 1850-2024 (per the CW copy of PRIMAP-hist v2.7); GCP series 1960-2024; UNFCCC Annex I series 1990-2021.
- Gases (API): All GHG, CH4, N2O, CO2, F-Gas, KYOTOGHG, Aggregate GHGs, Aggregate F-gases. WRI note: "193 countries plus the European Union starting in 1990" for the Climate Watch series.
- Update cadence: irregular, tied to underlying sources (annual).
- Per capita: WRI describes per-capita and per-GDP calculations in the site; the API returns absolute values (MtCO2e).
- Sectors: see sector table. The Climate Watch series splits Energy into Electricity/Heat, Manufacturing/Construction, Transportation, Building, Other Fuel Combustion and Fugitive Emissions.
- Licence, quoted (permissions page): "Climate Watch has an open data commitment and provides information free of constraints and restrictions on use." "Except as noted below, data and visualizations on this site carry a Creative Commons CC BY 4.0 license, which permits unrestricted reuse of Climate Watch content when proper attribution is provided (see below). This means you are able to download, share and adapt the data, maps, graphics, charts and other representations of the data for non-commercial or commercial uses." "Some data displayed on Climate Watch was developed by other organizations and may carry other open licenses or permissions." "You must not imply that Climate Watch, World Resources Institute, NDC Partnership or any other partner organizations endorse your use of the data."
- Exceptions, quoted: "for the Land Use, Land-Use Change and Forestry indicator in the Country GHG Emissions data collection, WRI has been granted a non-exclusive, non-transferrable right to publish these data by the Food and Agriculture Organization of the United Nations. Therefore, if users wish to republish this dataset in whole or in part, they should contact FAO directly at copyright@fao.org." Also: "Any use of the Land-Use Change and Forestry or Agriculture indicator should be cited as FAO 2025, FAOSTAT Emissions Database. Any use of emissions from fuel combustion data should be cited as GHG Emissions from Fuel Combustion, OECD/IEA, 2025". The PRIMAP-hist series is cited as PRIMAP-hist v2.7, which is itself CC BY-NC-SA (see PRIMAP-hist), so the PIK series is not safe for a commercial page. Climate Watch gives no statement reconciling its CC BY 4.0 with that.
- Attribution: "Climate Watch. 2026. Washington, DC: World Resources Institute. Available online at: https://www.climatewatchdata.org." and cite original sources.
- Commercial use: ALLOWED for Climate Watch-produced content (stated); NOT SAFE for LULUCF/Agriculture rows (FAO) and for the PIK series. Derivatives: ALLOWED (stated) with the same exceptions. Redistribution: LULUCF dataset needs FAO permission (stated).

## 3. EDGAR (European Commission, Joint Research Centre)

- Owner: EC JRC, with IEA for fossil CO2 combustion ("Community GHG database").
- URLs read (2026-10-06): https://edgar.jrc.ec.europa.eu/dataset_ghg2026 ; https://edgar.jrc.ec.europa.eu/report_2026 ; https://edgar.jrc.ec.europa.eu/terms ; https://edgar.jrc.ec.europa.eu/disclaimer ; https://edgar.jrc.ec.europa.eu/ (home).
- Quantity: national totals by sector and gas, plus gridmaps (0.1 degree) up to hourly in some products.
- Geography: "GHG emissions of all world countries"; the report table has about 210 country and territory rows (212 numeric rows including EU27 and GLOBAL TOTAL). Exact country count NOT CONFIRMED.
- Years: EDGAR_2026_GHG covers 1970-2025 (released 24 Sep 2026). F-gases from 1990. Monthly totals by sector and country (1970-2025) for CO2, CO2bio, CH4, N2O. Monthly gridmaps 2000-2025. Lag: under 1 year (2025 values use a "Fast Track" approach).
- Update cadence: annual (EDGAR 2025 GHG covered 1970-2024, released 1 Oct 2025).
- Gases: "the three main greenhouse gases (CO2, CH4, N2O) and fluorinated gases per sector and country"; CO2 split into fossil (IEA-EDGAR CO2) and bio (EDGAR CO2bio); CO2e uses IPCC AR5 GWPs. LULUCF and large-scale biomass burning are excluded from the main data (preliminary estimates in the report page).
- Which gas from which sector: the dataset page lists gas files per sector. Examples (exact from the page): Enteric fermentation: EDGAR CH4 only; Manure management: CH4 and N2O; Agricultural soils: CO2, CH4, N2O; Non-metallic minerals production: IEA-EDGAR CO2 only; Chemical processes: CO2, CH4, N2O; Iron and steel: CO2, CH4; Solid waste landfills: CH4, N2O; Waste water handling: CH4, N2O; Solvents and products use: CO2, N2O, F-gases; Power industry: CO2, CH4, N2O. This is the best gas-by-sector matrix of all sources.
- Sector granularity: IPCC 1996 and 2006 codes. See sector table.
- Report 2026 headline (quoted numbers from the report page): world GHG 2025 = 54.1 Gt CO2eq, up 0.7% on 2024; fossil CO2 73.8%, CH4 17.6%, N2O 5.3%, F-gases 3.3%. Country table values observed (Mt CO2eq, excl. LULUCF): United States 2024: 5,886.83, 2025: 6,018.30; India 2024: 4,514.80, 2025: 4,508.01; GLOBAL TOTAL 2024: 53,769.60.
- Access: no API. Direct downloads with no key, for example https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EDGAR/datasets/EDGAR_2026_GHG/EDGAR_AR5_GHG_1970_2025.zip (9.6 MB, HTTP 200, modified 2026-09-18) and .../IEA_EDGAR_CO2_1970_2025.zip (4.7 MB). Other files: EDGAR_CH4_1970_2025.zip, EDGAR_N2O_1970_2025.zip, EDGAR_F-gases_1990_2025.zip, monthly zips.
- Licence, quoted (conditions of use on the 2026 dataset page): "Unless otherwise noted, all material owned by the European Union is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence. This means that reuse is allowed, provided that appropriate credit is given and any changes are indicated. All emissions, except for CO2 emissions from fuel combustion, are from the EDGAR ... Community GHG database". And: "IEA-EDGAR CO2 (v5) data are based on data from IEA (2025) Greenhouse Gas Emissions from Energy, www.iea.org/data-and-statistics, as modified by the Joint Research Centre, licensed under CC BY-NC-ND 4.0. Users of the IEA-EDGAR CO2 data should contact the IEA at compliance@iea.org if they wish to use such data outside the terms of the CC-BY-NC-ND 4.0 licence."
- Activity data note: "primarily based on IEA data World Energy Balances (IEA, 2025a), all rights reserved, as modified by Joint Research Centre" for non-CO2 combustion sectors; that sentence sits beside the CC BY 4.0 statement, so whether any residual IEA restriction touches the CH4/N2O combustion rows is NOT CONFIRMED.
- Disclaimer (disclaimer page): provided "as-is and as-available".
- Attribution: "(c)European Union 2026, European Commission, Joint Research Centre (JRC), EDGAR (Emissions Database for Global Atmospheric Research) Community GHG database ... version EDGAR_2026_GHG (2026)" plus the report citation (Crippa et al., 2026, doi:10.2760/7717504).
- Commercial use: CH4, N2O, F-gases (and CO2bio): ALLOWED (CC BY 4.0). IEA-EDGAR CO2: FORBIDDEN without IEA agreement (NC). Derivatives: CH4/N2O/F-gases ALLOWED; IEA-EDGAR CO2 FORBIDDEN (ND). Redistribution: CH4/N2O/F-gases ALLOWED; IEA-EDGAR CO2 only unchanged and non-commercial.
- Risk to track: the World Bank and Climate TRACE both republish EDGAR-derived rows.

## 4. PRIMAP-hist (Potsdam / Johannes Gütschow)

- Owner: PRIMAP team (Gütschow, Pflüger), distributed on Zenodo.
- URLs read (2026-10-06): Zenodo API records 22876287 (v2.8, published 2026-09-29) and 17090760 (v2.7, published 2025-09-15), https://zenodo.org/records/22876287.
- Quantity: country historical emissions time series with two scenarios: HISTCR (country-reported data priority) and HISTTP (third-party priority).
- Geography: "almost all UNFCCC ... member states as well as most non-UNFCCC territories" plus country groups (EARTH, ANNEXI, NONANNEXI, AOSIS, BASIC, EU27BX, LDC, UMBRELLA).
- Years: 1750-2025 in v2.8. Latest year 2025 uses extrapolation: "For energy CO2 growth rates from the Energy Institute's Statistical Review of World Energy are used to extend the country reported data to 2025 ... For all other sectors and gases ... a linear extrapolation based on the last 5 years."
- Gases and sectors: CO2, CH4, N2O and F-gases; IPCC 2006 categories (see sector table). International aviation and shipping are not included. LULUCF is only in the no-rounding files.
- Access: Zenodo downloads (CSV 77 MB, NetCDF 32 MB, yaml). No API. Zenodo has a REST API for the record.
- Licence, quoted from the v2.8 record: "Since v2.8 PRIMAP-hist is published under a non-commercial license (CC BY-NC-SA). This means that commercial users can not use it freely and have to obtain a commercial license. The commercial license is only available for the country reported priority (CR) time-series as the third party priority (TP) time-series builds heavily on EDGAR and FAOSTAT data." The Zenodo metadata for the v2.8 record shows cc-by-nc-sa-4.0. The v2.7 record also shows cc-by-nc-sa-4.0 and its text says "Since v2.7 PRIMAP-hist is published under a non-commercial license". Licences of v2.6 and earlier: NOT CONFIRMED.
- Contacts quoted: commercial-support@johannes-guetschow.de (commercial licence), nc-support@johannes-guetschow.de.
- Attribution: cite the DOI of the exact version and Gütschow et al. (2016), ESSD 8, 571-603.
- Commercial use: FORBIDDEN without a paid licence. Derivatives: only under CC BY-NC-SA 4.0 (same terms). Redistribution: only non-commercially with attribution and share-alike.

## 5. Our World in Data: CO2 and greenhouse gas dataset (GitHub repo owid/co2-data)

- Owner: Our World in Data (Global Change Data Lab, UK charity).
- URLs read (2026-10-06): https://github.com/owid/co2-data (README, codebook CSV, API metadata); https://owid-public.owid.io/data/co2/owid-co2-data.csv (downloaded and inspected); https://ourworldindata.org/faqs ; https://ourworldindata.org/emissions-by-sector.
- Quantity: one row per entity and year; CO2 (production-based, per capita, cumulative, by fuel, consumption-based, trade), land-use change CO2, CH4, N2O, total GHG, temperature change contributions, energy and GDP ratios.
- Geography (observed in the CSV): 254 entities in the file; 215 ISO-coded entities have a non-empty `co2`; 120 ISO-coded entities have `consumption_co2`.
- Years (observed): co2 1750-2024 (215 entities); co2_including_luc 1850-2024; methane, nitrous_oxide, total_ghg 1850-2024 (about 199-201 entities); consumption_co2 1990-2023.
- Update cadence: irregular, after upstream releases. Repo changelog: 2026-06-01 (EIA energy update), 2025-12-04 (GHG from Jones et al. 2025), 2025-11-13 (Global Carbon Budget 2025). Last commit 2026-06-02.
- Sector granularity: no sector columns now. Fuel splits: coal_co2, oil_co2, gas_co2, cement_co2, flaring_co2, other_industry_co2 (plus per-capita and share columns), land_use_change_co2. Note the changelog (2023-11-08) says sector data from Climate Watch had been used earlier; the current codebook lists none.
- Per-capita and consumption-based: co2_per_capita, ghg_per_capita, methane_per_capita, consumption_co2, consumption_co2_per_capita, trade_co2.
- Sources behind columns (codebook): Global Carbon Budget (2025) for CO2 and fuel columns and trade; Jones et al. (2025) national contributions for methane, nitrous_oxide, total_ghg and temperature columns; OWID population and regions; EIA, Maddison for ratios.
- Observed values (CSV, Mt): United States co2 2023 4,918.4 and 2024 4,904.1; consumption_co2 2023 5,431.7; co2_per_capita 2024 14.2; India co2 2023 3,062.8 and 2024 3,193.5; consumption_co2 2023 2,543.2; World co2 2024 38,598.6.
- Data caution (observed arithmetic): World 2024 `total_ghg_excluding_lucf` is 43,714.8 Mt while co2 (38,598.6) + methane (9,498.9) + nitrous_oxide (2,935.8) = 51,033 Mt, so the total columns do not sum from the visible gas columns; the reason is NOT CONFIRMED. Also the totals contain no F-gases (India 2023 `total_ghg_excluding_lucf` 3,432.0 versus 4,125.2 in Climate Watch). Do not publish OWID total_ghg beside other sources without a note.
- Access: no key. CSV, XLSX and JSON URLs in the README, plus the Chart Data API for charts.
- Licence, quoted (README): "All visualizations, data, and code produced by Our World in Data are completely open access under the Creative Commons BY license. You have the permission to use, distribute, and reproduce these in any medium, provided the source and authors are credited. The data produced by third parties and made available by Our World in Data is subject to the license terms from the original third-party authors." FAQ: "Data produced by us falls under our permissive CC BY license; you have permission to use, reproduce, and distribute it, provided that you cite us." FAQ also: "Can I reuse or republish your data? It depends on the data source, which is always indicated along with the data."
- Attribution: cite OWID and the underlying data source(s). Commercial use: ALLOWED for OWID-produced data (CC BY). Derivatives: ALLOWED. Redistribution: ALLOWED. The Jones-based columns inherit the PRIMAP-hist question (see section 8). The GCP-based columns inherit GCP's CC BY 4.0.
- GitHub shows no separate LICENSE file in the repo (the LICENSE URL returned 404, GitHub API licence null); the licence statement is in the README.

## 6. Our World in Data: sector breakdown (by industry)

- URLs read (2026-10-06): https://ourworldindata.org/emissions-by-sector ; chart metadata https://ourworldindata.org/grapher/ghg-emissions-by-sector.metadata.json ; CSV https://ourworldindata.org/grapher/ghg-emissions-by-sector.csv?v=1&csvType=full (downloaded and inspected).
- Quantity: greenhouse gas emissions by sector, country and year. Source in metadata: "Climate Watch (2026) - with major processing by Our World in Data", column last updated 2026-02-10.
- Geography: 205 entities in the CSV (193 ISO-coded excluding OWID aggregates). Years 1990-2023.
- Sectors (11 columns): Agriculture; Land-use change and forestry; Waste; Buildings; Industry; Manufacturing and construction; Transport; Electricity and heat; Fugitive emissions; Other fuel combustion; Aviation and shipping.
- Gases: total GHG (CO2e); separate OWID charts exist for CO2, CH4 and N2O by sector (grapher slugs co2-emissions-by-sector, methane-emissions-by-sector, nitrous-oxide-emissions-by-sector, plus per-capita variants).
- Access: Chart Data API, no key: append .csv or .metadata.json to a grapher URL.
- Licence, quoted (page footer): "Our charts, articles, and data are licensed under CC BY, unless stated otherwise ... Third-party materials, including some charts and data, are subject to third-party licenses." OWID states it must be checked.
- Commercial use: ALLOWED by OWID's statement; however the underlying Climate Watch LULUCF/Agriculture rows come from FAO under a restricted republication grant and fuel combustion data cite IEA, and OWID gives no reconciliation, so this is the weakest link. Confidence Medium.

## 7. Global Carbon Project / Global Carbon Budget (national fossil CO2, consumption-based)

- Owner: Global Carbon Project; Global Carbon Budget Office led by Pierre Friedlingstein (University of Exeter). Data are archived on the ICOS Carbon Portal.
- URLs read (2026-10-06): https://globalcarbonbudget.org/ ; https://globalcarbonbudget.org/data-hub/the-latest-gcb-data-2025/ ; https://doi.org/10.18160/GCP-2025 (redirects to https://www.icos-cp.eu/impact/science/global-carbon-budget/2025) ; the ICOS object metadata (JSON) for National_Fossil_Carbon_Emissions_2025_v1.0.xlsx.
- Quantity: territorial fossil CO2 emissions (with cement and flaring) by country, consumption-based emissions, emissions transfers, regions, and national land-use change emissions (BLUE, OSCAR, LUCE).
- Years: national fossil file temporal coverage "1850-2024" (ICOS metadata). Consumption-based years not read in the xlsx; OWID shows consumption_co2 to 2023. Next release (GCB 2026) is not yet out as of 2026-10-06; the site still lists GCB 2025 as the latest (published 2025-11-13, data record updated 2026-01-15).
- Gases: CO2 only. Sectors: by fuel, not by industry (coal, oil, gas, cement, flaring, other). Total fossil file sheets: Summary, Territorial emissions, Consumption emissions, Emissions transfers, Regions.
- Access: XLSX download via ICOS licence acceptance page; no API. The page text also notes "New data is available on Global Carbon Budget Data Browser".
- Licence: ICOS metadata: "rightsList ... Creative Commons Attribution 4.0 International ... cc-by-4.0" and "licence name: ICOS CCBY4 Data Licence". GCP fair use text on the data hub (quoted): "The data and model output provided on this site are freely available and were furnished by individual scientists who encourage their use. Citation: Please cite the Global Carbon Budget 2025 (Friedlingstein et al., 2025, ESSD) for all data." The ICOS page also says: "The use of data is conditional on citing the original data sources."
- Attribution: "Global Carbon Project. (2026). Supplemental data of Global Carbon Budget 2025 (Version 1.0) [Data set]. Global Carbon Project. https://doi.org/10.18160/gcp-2025" and the ESSD paper.
- Commercial use: ALLOWED (CC BY 4.0). Derivatives: ALLOWED. Redistribution: ALLOWED with attribution.

## 8. Jones et al., National contributions to climate change (used by OWID for CH4, N2O, total GHG)

- URL read: Zenodo record 16640595 (version 2025.1, published 2025-11-13).
- Quantity: national annual emissions of CO2, CH4 and N2O (fossil and land-use) and temperature response, 1851-2024 (also 1830-2024 and 1971-2024 emissions files).
- Licence: Zenodo shows cc-by-4.0. Source statement (quoted): "National CO2 emissions data are collated from the Global Carbon Project ... National CH4 and N2O emissions data are collated from PRIMAP-hist (HISTTP) (Gütschow et al., 2024)."
- Risk: CH4 and N2O inputs come from PRIMAP-hist HISTTP. Which PRIMAP-hist licence applied to the 2024 version used is NOT CONFIRMED (v2.7 and v2.8 are NC-SA, and the PRIMAP-hist authors say there is no commercial licence for the TP time series). Treat OWID methane and nitrous_oxide columns as unsafe for commercial use until cleared.

## 9. UNFCCC national inventory submissions and the GHG data interface

- Owner: UNFCCC secretariat.
- Pages I could not read: https://unfccc.int/... and https://di.unfccc.int/ returned "Request unsuccessful. Incapsula incident" or a security check page. I did not try to bypass. All facts below that come from search snippets are labelled secondary.
- Secondary (search snippet of UNFCCC pages): the GHG data interface provides predefined tables with time series from the base year and "from 1990 to the latest available inventory year" for Annex I Parties; Annex I report annually by 15 April; non-Annex I data come in national communications, biennial update reports and (since 2024) biennial transparency reports. Another snippet says all official texts, data and documents "are in the public domain and may be freely downloaded, copied and printed provided no change to the content is introduced, and the source is duly acknowledged". The primary terms page was not read: NOT CONFIRMED.
- Primary-adjacent evidence: Climate Watch's API holds copies: UNFCCC Annex I (45 locations; USA series 1990-2021; sectors listed below) and UNFCCC Non-Annex I (148 locations).
- Licence, commercial, derivative: NOT CONFIRMED. If the "no change to the content" wording applies, derivatives would be restricted.

## 10. FAOSTAT: Climate Change, Agrifood systems emissions

- Owner: FAO Statistics Division.
- URLs read (2026-10-06): https://www.fao.org/contact-us/terms/db-terms-of-use/en/ ; https://www.fao.org/faostat/en/#data/GT/metadata (rendered in a browser) ; bulk file headers and the Normalized CSV (inspected).
- Quantity: "Emissions Totals" and related domains: CO2, CH4, N2O and F-gas emissions in kilotonnes, by country.
- Geography: metadata says "217 countries and territories according to the United Nations M-49 list"; the bulk CSV has 281 areas (including regional aggregates).
- Years: metadata (last updated 10/02/2025) says "1961-2023, 2030, 2050". The bulk file modified 2025-12-06 also ends at 2023 (plus 2030, 2050). Annual cadence.
- Sectors (item names in the bulk file): see sector table.
- Gases (element names): Emissions (CH4), (N2O), (CO2), CO2eq from CH4, N2O and F-gases (AR5), plus direct and indirect N2O.
- Access: bulk CSV zips, e.g. https://bulks-faostat.fao.org/production/Emissions_Totals_E_All_Data_(Normalized).zip (20.5 MB). The FAOSTAT API at faostatservices.fao.org returned "Missing Authorization Header" (HTTP 401), so it needs an authorization token. Rate limits NOT CONFIRMED.
- Licence, quoted: "Unless specified otherwise in their metadata or webpage, all datasets disseminated through FAO corporate statistical databases ... are licensed under the Creative Commons Attribution-4.0 International licence (CC BY 4.0)". Additional terms: "Datasets shall not be used for or in conjunction with the promotion of a commercial enterprise and/or its product(s) or services (s), and/or in any way that suggests that FAO endorses any specific company, products or services." Also: "You may access, download, create copies, adapt and re-disseminate datasets subject to these Database terms." Metadata adds: "For this particular data domain, data sourced from the PRIMAP-hist dataset and only marginally processed by FAO might be subject to additional restrictions." Citation format: "FAO. [YYYY]. [Name of database: Name of dataset]. [Accessed on DD Month YYYY]. [URL] Licence: CC-BY-4.0."
- Commercial use: CONDITIONAL. CC BY 4.0 allows it, but the extra clause about promotion of a commercial enterprise and its products or services is a concern for ad and affiliate pages. Derivatives: ALLOWED (adapt). Redistribution: ALLOWED subject to the terms.

## 11. World Bank (World Development Indicators)

- Owner: The World Bank.
- URLs read (2026-10-06): https://api.worldbank.org/v2/indicator?source=2 ; indicator endpoints; https://datacatalog.worldbank.org/search/dataset/0037712/World-Development-Indicators ; https://datacatalog.worldbank.org/public-licenses ; https://www.worldbank.org/ext/en/legal/terms-conditions ; https://datahelpdesk.worldbank.org/knowledgebase/articles/889386-developer-information-overview.
- Indicators (observed IDs, all in source 2 WDI): EN.GHG.CO2.MT.CE.AR5 (CO2 excl. LULUCF), EN.GHG.CO2.PC.CE.AR5 (CO2 per capita), EN.GHG.ALL.MT.CE.AR5 (total GHG excl. LULUCF), EN.GHG.ALL.PC.CE.AR5 (per capita), EN.GHG.ALL.LU.MT.CE.AR5 (incl. LULUCF), EN.GHG.CH4.MT.CE.AR5, EN.GHG.N2O.MT.CE.AR5, sector indicators EN.GHG.CO2.PI.MT.CE.AR5 (Power Industry), .IC. (Industrial Combustion), .IP. (Industrial Processes), .TR. (Transport), .BU. (Building), .FE. (Fugitive), .AG. (Agriculture), .WA. (Waste) with the same pattern for CH4 and N2O, EN.GHG.FGAS.IP.MT.CE.AR5 (F-gases from industrial processes), and LULUCF fluxes (deforestation, forest land, organic soil, other land) from a different source ("Carbon fluxes from land 2000-2020").
- Source note for the CO2 indicator (quoted): "EDGAR (Emissions Database for Global Atmospheric Research) Community GHG Database, Joint Research Centre (JRC) - European Commission ... International Energy Agency (IEA) ... date published: 2024". So these indicators are EDGAR 2024 edition, which includes IEA-EDGAR CO2.
- Years: WDI API lastupdated 2026-07-13 (catalog record updated Oct 2, 2026). For USA: values 2018-2024, 2025 empty. Example: USA EN.GHG.CO2.MT.CE.AR5 2023 = 4,618.27 Mt; EN.GHG.ALL.MT.CE.AR5 2023 = 5,890.99, 2024 = 5,912.62.
- Geography: country list holds 217 non-aggregate economies (indicator-level coverage NOT CONFIRMED).
- Access: free REST API, no key (https://api.worldbank.org/v2/country/USA/indicator/EN.GHG.CO2.MT.CE.AR5?format=json). Rate limits NOT STATED on the pages read.
- Licence, quoted (catalog): "License: Creative Commons Attribution 4.0". Public licences page: "The Creative Commons Attribution 4.0 International license allows users to copy, modify and distribute data in any format for any purpose, including commercial use. Users are only obligated to give appropriate credit (attribution) and indicate if they have made any changes ... CC-BY 4.0, with the additional terms below, is the default license for all Datasets produced by the World Bank itself". Additional terms are dispute resolution (mediation then UNCITRAL arbitration). The general terms page also says site materials are for "non-commercial purposes only, unless otherwise stated" and "For some of the Materials, such as the Datasets listed in The World Bank Data Catalog ... specific terms of use" apply.
- Commercial use: ALLOWED per the WDI catalog licence. Derivatives: ALLOWED. Redistribution: ALLOWED. Risk: the CO2 indicators republish IEA-EDGAR CO2 (CC BY-NC-ND at EDGAR) without a visible carve-out; whether the World Bank has cleared that with the IEA is NOT CONFIRMED.

## 12. IEA

- Owner: International Energy Agency.
- Pages I could not read: iea.org returned a Cloudflare security check (terms, data and statistics pages). Not bypassed.
- Secondary (search result summaries of IEA pages for "Greenhouse Gas Emissions from Energy"): the product is under "Terms of Use for Non-CC Material"; "If you are doing work for clients or third parties, you need to enter into a separate Agreement and pay a fee"; use "in any type of modelling for creating derived data or derived products" needs an agreement and a fee. Questions go to datasales@iea.org. This is NOT CONFIRMED from the primary page.
- Primary-adjacent: EDGAR (a partner) states IEA-EDGAR CO2 is "licensed under CC BY-NC-ND 4.0" and tells users to contact compliance@iea.org to go beyond it. CEDS says its system is open "with the exception of the IEA energy statistics which must be purchased from IEA".
- Which IEA data are free versus paid: NOT CONFIRMED. Practical position: treat IEA as paid for commercial use.

## 13. Ember (electricity)

- Owner: Ember (energy think tank).
- URLs read (2026-10-06): https://api.ember-energy.org/v1/openapi.json (the API documentation) ; https://api.ember-energy.org/v1/docs ; bulk CSVs https://files.ember-energy.org/public-downloads/yearly_full_release_long_format.csv and .../monthly_full_release_long_format.csv (downloaded and inspected). The ember-energy.org website pages (data page, "creative-commons" page, API page) were blocked by a bot check, so the licence page itself was NOT read; the licence text below is from Ember's own API documentation.
- Quantity: power sector emissions (mtCO2 and gCO2/kWh intensity) alongside generation, demand, capacity, imports.
- Years and geography (observed): yearly CSV 2000-2025, 214 countries/economies (plus regions); monthly CSV 1999-01 to 2026-06 with 98 areas. Monthly lag about 3 months.
- Sectors: power only; by fuel (Coal, Gas, Other Fossil, Bioenergy, Hydro, Nuclear, Solar, Wind, Other Renewables) and aggregates (Fossil, Clean, Renewables, Wind and Solar).
- Gases: CO2 (power).
- Access: CSVs at files.ember-energy.org need no key (HTTP 200). The REST API (api.ember-energy.org/v1) needs a key ("Register for API key ... https://ember-energy.org/data/api/"; without one the endpoints return {"detail":"No API key set"}). Whether the key is free is NOT CONFIRMED (the signup page was blocked). Rate limits quoted: "At present, there are no rate limiting restrictions for the API."
- Licence, quoted from the API docs: "Our data is published using the CC-BY-4.0 license. Anyone is able to use our data for any purpose (personal, commercial, etc.). The only requirements by this license are that: 1. Ember is cited as the data source. E.g. 'Monthly electricity generation data, Ember' 2. You may not add any additional legal/technological restrictions to the data." The OpenAPI info block also lists the licence as "CC-BY-4.0 (data)".
- Commercial use: ALLOWED. Derivatives: ALLOWED (no restriction other than not adding restrictions). Redistribution: ALLOWED.

## 14. Energy Institute Statistical Review of World Energy

- Owner: Energy Institute.
- Pages I could not read: energyinst.org returned a Cloudflare security check (including the PDF). Not bypassed.
- Secondary (OWID ETL snapshot file for the 2026 edition, https://github.com/owid/etl/blob/master/snapshots/energy_institute/2026-06-30/statistical_review_of_world_energy.csv.dvc): published 2026-06-30, licence recorded as "(c) Energy Institute 2026", url https://www.energyinst.org/terms. A search summary returned conflicting text: one says CC-BY-4.0, another says extensive reproduction needs permission and that S&P Global data may not be redistributed. Which text applies to the 2026 data download is NOT CONFIRMED.
- Latest edition: 2026 (30 June 2026). PRIMAP-hist v2.8 uses Statistical Review CO2 growth to extend 2025.
- Commercial use, derivatives, redistribution: NOT CONFIRMED.

## 15. CEDS (Community Emissions Data System, PNNL / JGCRI)

- URLs read (2026-10-06): https://github.com/JGCRI/CEDS (README and mappings) ; Zenodo records 12803197 (v_2024_07_08) and 15059443 (v_2025_03_18).
- Quantity: country by sector by fuel emissions. Latest data release v_2025_03_18 "Main time series estimates from 1750 - 2023 for all species except CH4 and N2O, which estimate trends starting at 1970".
- Gases: SO2, NOx, BC, OC, NH3, NMVOC, CO, CO2, CH4, N2O (the main data are air pollutants plus CO2; CH4 and N2O are also supplied).
- Sectors: aggregate sector codes listed in the sector table; figure sectors: Agriculture, Air, Energy Transf/Ext, Industry, RCO, Shipping, Solvents, Transportation, Waste.
- Access: Zenodo zips (aggregate, detailed, bunkers), gridded data on ESGF; R code on GitHub.
- Licence: Zenodo records both show cc-by-4.0. The software repository has its own BSD-style Battelle permission ("to redistribute and use the Software in source and binary forms, with or without modification ... sell copies"). README caveat quoted: "uses open-source data (with the exception of the IEA energy statistics which must be purchased from IEA)". Whether IEA inputs constrain the published outputs is NOT CONFIRMED.
- Commercial use: ALLOWED per Zenodo licence. Derivatives: ALLOWED. Redistribution: ALLOWED. Note that Climate TRACE reuses CEDS directly for some country rows.
- Latest data year 2023 means a 2-3 year lag.

## 16. Carbon Monitor

- Owner: Carbon Monitor initiative (Tsinghua University, LSCE and others).
- URLs read (2026-10-06): https://carbonmonitor.org/ ; data CSV https://datas.carbonmonitor.org/API/downloadFullDataset.php?source=carbon_global (found in the page source; downloaded and inspected, 34 MB).
- Quantity: daily CO2 emissions by country and sector (MtCO2/day per the page).
- Geography (observed): 39 country/region series. Years: 2019-01-01 to 2026-07-31 (lag about 2 months). Sectors (observed): Domestic Aviation, Ground Transport, Industry, International Aviation, Power, Residential. Gas: CO2 only.
- Access: public CSV URL, no key seen. Rate limits NOT STATED.
- Licence, quoted: "Carbon Monitor data are made freely available to the public with a fair use open data policy. We encourage users to cite the data by this paper." Also: "Carbon Monitor is a living dataset subject to updates and the values are expected to change". No licence name is given, so commercial use, derivatives and redistribution are NOT STATED. Contact: contact.carbonmonitor@gmail.com. A written confirmation would be needed before using it on a monetised page.

## 17. Climate Action Tracker (Climate Analytics and NewClimate Institute)

- URLs read (2026-10-06): https://climateactiontracker.org/about/legal/ ; https://climateactiontracker.org/cat-data-explorer/country-emissions/.
- Quantity: country emissions pathways, ratings, sector indicators. Data downloadable under the "Data Download" button on the explorer. Coverage years and countries on the explorer were not rendered (explorer content is script-driven): NOT CONFIRMED.
- Licence, quoted: "Copyright (c) 2009-2026 by Climate Analytics and NewClimate Institute. All rights reserved. ... You are authorised to view, download, print and distribute the copyrighted content from this website subject to the following condition: Any reproduction, in full or in part, must credit Climate Analytics and NewClimate Institute and must include a copyright notice and must not be used for commercial purposes. If you would like to use our material for commercial purposes, please contact us."
- Commercial use: FORBIDDEN (stated). Derivatives: NOT STATED beyond "reproduction ... in full or in part" with credit and no commercial use. Redistribution: allowed non-commercially with credit.

## 18. Eurostat air emissions accounts (by industry, EU and neighbours)

- Owner: Eurostat (European Commission).
- URLs read (2026-10-06): live API https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/env_ac_ainah_r2 ; https://ec.europa.eu/eurostat/web/main/help/copyright-notice.
- Quantity: "Air emissions accounts by NACE Rev. 2 activity": emissions by economic industry and by households. Dataset updated 2026-08-07.
- Geography: 33 geo entities (EU27, member states, Iceland, Norway, Switzerland, Serbia, Türkiye). Years 1995-2025 dimension; observed Germany CO2 (unit T): 2023 = 631,848,988.81 t; 2024 = 613,338,764.73 t; 2025 empty. So latest filled year 2024.
- Gases (24 codes): GHG, CO2, CH4, CH4_CO2E, N2O, N2O_CO2E, HFC_CO2E, PFC_CO2E, NF3_SF6_CO2E, CO2_BIO plus air pollutants.
- Industries: 84 NACE codes (see sector table).
- Access: JSON-stat API, no key; no rate limits stated on pages read (NOT STATED).
- Licence, quoted (copyright notice): "Creative Commons Attribution 4.0 International licence." and "Reuse of statistical data, metadata, publications, and other dissemination tools published on this website for commercial or non-commercial purposes is authorised provided the source is acknowledged." Commission Decision of 12 December 2011 applies, "These general principles can be subject to conditions which may be specified in individual copyright notices."
- Commercial use: ALLOWED. Derivatives: ALLOWED. Redistribution: ALLOWED with acknowledgement.
- Limitation: Europe only; the only source here with true industry (NACE) names.

---

## Numbers found on the sources' own pages that disagree

All values observed on 2026-10-06. These differ in system boundary, GWP version, vintage and included gases; the reasons below are noted only where the source itself says so.

| Item | Source and basis | Value |
|---|---|---|
| USA 2023 total GHG excl. LULUCF | Climate Watch API, Climate Watch series (All GHG) | 5,775.47 MtCO2e (CO2 4,470.86; CH4 888.37; N2O 244.39; F-gas 171.84) |
| | PRIMAP-hist via Climate Watch API (KYOTOGHG) | 6,200 MtCO2e (CO2 4,910; CH4 686.0; N2O 400.15; F-gas 205; rounded) |
| | World Bank WDI (EDGAR 2024 edition, AR5) | 5,890.99 MtCO2e (CO2 4,618.27) |
| | Climate TRACE API 2023, co2e_100yr (no forestry) | 6,553 Mt (CO2 5,254 Mt) |
| | OWID total_ghg_excluding_lucf (CO2+CH4+N2O, no F-gases) | 5,606.2 Mt |
| | EDGAR 2026 report table (only key years): 2024 / 2025 | 5,886.83 / 6,018.30 MtCO2eq |
| USA 2023 fossil CO2 | GCP via Climate Watch and OWID | 4,918.41 / 4,918.4 Mt |
| USA 2023 consumption-based CO2 | OWID (GCP) | 5,431.7 Mt versus 4,918.4 Mt territorial |
| India 2023 total GHG excl. LULUCF | Climate Watch series | 4,125.18 MtCO2e |
| | PRIMAP-hist (via CW) | 3,860 MtCO2e |
| | Climate TRACE co2e_100yr | 4,003 Mt |
| | OWID total_ghg_excluding_lucf | 3,432.0 Mt |
| India 2024 | EDGAR 2026 table / Climate TRACE co2e_100yr / PRIMAP (via CW) / OWID excl. LUCF | 4,514.80 / 4,165 / 3,990 / 3,571.0 |
| India 2023 fossil CO2 | GCP (via OWID) / Climate TRACE CO2 | 3,062.8 / 2,937 Mt |
| World 2024 total | EDGAR 2026 (AR5, excl. LULUCF) | 53,769.6 MtCO2eq |
| | Climate TRACE co2e_100yr (excludes the forestry sector) | 57,582 Mt |
| | OWID total_ghg_excluding_lucf | 43,714.8 Mt |
| World 2024 fossil CO2 | OWID (GCP) | 38,598.6 Mt |

Takeaway for the site: always show source, year and basis (gas set, LULUCF yes or no, GWP) on each number, and never mix sources in one ranking.

## Sector names by source

Exact names as each source uses them.

| Source | Sector names |
|---|---|
| Climate TRACE (10 sectors) | Agriculture; Buildings; Fluorinated gases; Forestry and land use; Fossil fuel operations; Manufacturing; Mineral extraction; Power; Transportation; Waste |
| Climate TRACE subsectors (68, API slugs; by sector as shown on its Sectors page) | Power: electricity-generation, heat-plants, other-energy-use. Transportation: road-transportation, railways, domestic-aviation, international-aviation, domestic-shipping, international-shipping, non-broadcasting-vessels, other-transport. Fossil fuel operations: coal-mining, oil-and-gas-production, oil-and-gas-refining, oil-and-gas-transport, other-solid-fuels. Manufacturing: aluminum, cement, chemicals, food-beverage-tobacco, glass, iron-and-steel, lime, other-chemicals, other-manufacturing, other-metals, petrochemical-steam-cracking, pulp-and-paper, textiles-leather-apparel, wood-and-wood-products. Mineral extraction: bauxite-mining, copper-mining, iron-mining, other-mining-quarrying, rock-quarrying, sand-quarrying. Buildings: residential-onsite-fuel-usage, non-residential-onsite-fuel-usage, other-onsite-fuel-usage. Agriculture: cropland-fires, crop-residues, enteric-fermentation-cattle-operation, enteric-fermentation-cattle-pasture, enteric-fermentation-other, manure-applied-to-soils, manure-left-on-pasture-cattle, manure-management-cattle-operation, manure-management-other, other-agricultural-soil-emissions, rice-cultivation, synthetic-fertilizer-application. Waste: biological-treatment-of-solid-waste-and-biogenic, domestic-wastewater-treatment-and-discharge, incineration-and-open-burning-of-waste, industrial-wastewater-treatment-and-discharge, solid-waste-disposal. Forestry and land use: forest-land-clearing, forest-land-degradation, forest-land-fires, net-forest-land, net-shrubgrass, net-soil-organic-carbon, net-wetland, removals, shrubgrass-fires, water-reservoirs, wetland-fires. Fluorinated gases: fluorinated-gases. (Grouping inferred from the sector names on the Sectors page and the guide; the API itself does not return a sector-to-subsector map.) |
| Climate Watch (Climate Watch series) | Total excluding LULUCF; Total including LULUCF; Energy (sub: Electricity/Heat; Manufacturing/Construction; Transportation; Building; Other Fuel Combustion; Fugitive Emissions); Industrial Processes; Agriculture; Waste; Land Use, Land-Use Change and Forestry; Bunker Fuels |
| Climate Watch (UNFCCC Annex I) | Total GHG emissions without LULUCF; Total GHG emissions with LULUCF; Energy; Industrial Processes and Product Use; Agriculture; Land Use, Land-Use Change and Forestry; Waste; Other |
| Climate Watch (UNFCCC Non-Annex I) | Total GHG emissions excluding/including LULUCF/LUCF; Energy; Industrial Processes; Solvent and Other Product Use; Agriculture; LULUCF; Land-Use Change and Forestry; Waste; Other |
| Climate Watch (GCP) | Total fossil fuels and cement; Cement; Gas; Oil; Coal; Gas flaring; Bunkers |
| Climate Watch (US State Inventory) | Total excluding/including LUCF; Energy (sub: Electricity/Heat; Commercial; Residential; Industry; Transportation; Fugitive Emissions); Industrial Processes; Agriculture; Waste; Land-Use Change and Forestry; Bunker Fuels |
| EDGAR 2026 (annual sector groups, IPCC 1996 / code) | Power industry (1A1a); Oil refineries and Transformation industry; Combustion for manufacturing (1A2); Aviation climbing and descent; Aviation cruise; Aviation landing and takeoff; Aviation supersonic; Road transportation (1A3b); Railways, pipelines, off-road transport; Shipping; Energy for buildings (1A4+1A5); Fuel exploitation; Non-metallic minerals production (2A); Chemical processes (2B); Iron and steel production; Non-ferrous metals production; Non energy use of fuels; Solvents and products use; Enteric fermentation (3A1); Manure management (3A2); Agricultural waste burning; Agricultural soils; Indirect N2O emissions from agriculture; Solid waste landfills; Solid waste incineration; Waste water handling; Indirect emissions from NOx and NH3 |
| EDGAR monthly gridmaps (8 sectors) | Power Industry; Industrial combustion; Buildings; Transport; Agriculture; Fuel exploitation; Processes; Waste |
| PRIMAP-hist v2.8 | M.0.EL National Total excluding LULUCF; 1 Energy (1.A Fuel Combustion Activities; 1.B Fugitive Emissions from Fuels with 1.B.1 Solid Fuels, 1.B.2 Oil and Natural Gas, 1.B.3 Other Emissions from Energy Production; 1.C Carbon Dioxide Transport and Storage); 2 Industrial Processes and Product Use (2.A Mineral Industry; 2.B Chemical Industry; 2.C Metal Industry; 2.D Non-Energy Products from Fuels and Solvent Use; 2.E Electronics Industry; 2.F Product Uses as Substitutes for Ozone Depleting Substances; 2.G Other Product Manufacture and Use; 2.H Other); 4 Waste; 5 Other; M.AG Agriculture (3.A Livestock; M.AG.ELV Agriculture excluding Livestock); with the no-rounding file: 0 National Total including LULUCF; 3 AFOLU; M.LULUCF |
| OWID sector breakdown | Agriculture; Land-use change and forestry; Waste; Buildings; Industry; Manufacturing and construction; Transport; Electricity and heat; Fugitive emissions; Other fuel combustion; Aviation and shipping |
| OWID CO2 dataset (fuel, not sector) | coal; oil; gas; cement; flaring; other industry; land-use change |
| Global Carbon Project | Coal; Oil; Gas; Cement; Flaring; Other (fuel based); plus Consumption (trade) |
| FAOSTAT Emissions Totals (item names) | Crop Residues; Rice Cultivation; Burning - Crop residues; Enteric Fermentation; Manure Management; Manure left on Pasture; Manure applied to Soils; Synthetic Fertilizers; Drained organic soils (and CO2, N2O variants); On-farm energy use; Forestland; Net Forest conversion; Savanna fires; Fires in organic soils; Forest fires; Fires in humid tropical forests; Agrifood Systems Waste Disposal; Fertilizers Manufacturing; Food Retail; Food Household Consumption; Food Transport; Energy; IPPU; Waste; Other; Agrifood systems; Farm gate; Land-use change; Pre- and post-production; Emissions on agricultural land; Emissions from crops; Emissions from livestock; IPCC Agriculture; Agricultural Soils; LULUCF; AFOLU; All sectors with LULUCF; All sectors without LULUCF; Pesticides Manufacturing; Food Processing; Food Packaging; International bunkers |
| World Bank WDI (gas by sector indicators) | Agriculture; Building (Energy); Fugitive Emissions (Energy); Industrial Combustion (Energy); Industrial Processes; Power Industry (Energy); Transport (Energy); Waste; LULUCF subtypes: Deforestation, Forest Land, Organic Soil, Other Land |
| CEDS aggregate sectors | 1A1_Energy-transformation; 1A1bc_Other-feedstocks; 1A2_Industry-combustion; 1A3_Aviation; 1A3_International-shipping; 1A3_Transportation; 1A4_Stationary_RCO; 1B_Fugitive; 2A_Minerals-production; 2B_Chemical-industry; 2C_Metals-industry; 2D_Solvents; 2H_Pulp-and-paper-food-beverage-wood; 2L_Other-process-emissions; 3_Agriculture_non-combustion; 5_Waste; 6A_Other-in-total; 6_Other-in-total; 7_Fossil-fuel-fires |
| Carbon Monitor | Domestic Aviation; Ground Transport; Industry; International Aviation; Power; Residential |
| Ember | Power sector only, by fuel: Coal; Gas; Other Fossil; Bioenergy; Hydro; Nuclear; Solar; Wind; Other Renewables |
| Eurostat (NACE Rev. 2, top level) | A Agriculture, forestry and fishing; B Mining and quarrying; C Manufacturing (C10-C12 food, beverages, tobacco ... C33 repair); D Electricity, gas, steam and air conditioning supply; E Water supply, sewerage, waste management; F Construction; G Wholesale and retail trade; H Transportation and storage (H49 land, H50 water, H51 air, H52 warehousing, H53 postal); I Accommodation and food service; J Information and communication; K Financial and insurance; L Real estate; M Professional, scientific and technical; N Administrative and support; O Public administration and defence; P Education; Q Human health and social work; R Arts, entertainment and recreation; S Other service activities; T Households as employers; U Extraterritorial organisations; plus Households (HH, HH_HEAT, HH_TRA, HH_OTH) and TOTAL / TOTAL_HH |

### Plain-language industry list the owner could use on the site

These map across sources (owner decision; mapping is a suggestion, not something a source states): Electricity and heat; Transport (road, rail, aviation, shipping); Manufacturing and construction (cement, steel, chemicals and others); Buildings (homes and commercial heating); Agriculture; Land use and forests; Waste; Fossil fuel production (fugitive methane, flaring); Fluorinated gases (cooling, industrial).

## Which source says which gas comes from which sector

1. EDGAR (best): each sector group on the dataset page lists the gas files that exist for it (see the EDGAR section).
2. Climate TRACE API: the /country/emissions endpoint returns co2, ch4, n2o and CO2e per subsector (matrix observed above, for example electricity CO2 only; solid waste CH4 only; synthetic fertiliser N2O only; coal mining CO2 plus CH4).
3. PRIMAP-hist: a table lists "Gases covered" per category (for example 2.A Mineral Industry: CO2; 3.A Livestock: CH4, N2O; 2.F: F-gases only at level 2).
4. World Bank WDI: indicator names combine gas and sector (EN.GHG.CH4.AG, EN.GHG.N2O.TR and so on).
5. Climate Watch API: gas and sector can be filtered together (gas ids 553-560).
6. OWID: the by-sector charts exist for total GHG, CO2, CH4 and N2O, but through the Climate Watch source.
7. Eurostat: gas by NACE industry (EU).

## Per-capita and consumption-based views

- Per capita ready-made: OWID (co2_per_capita, ghg_per_capita, methane_per_capita, consumption_co2_per_capita); World Bank (EN.GHG.CO2.PC.CE.AR5, EN.GHG.ALL.PC.CE.AR5); EDGAR report table (indicator selector "per capita"); Climate Watch UI.
- Consumption-based: Global Carbon Project (Consumption emissions and Emissions transfers sheets); OWID passes it through (consumption_co2 1990-2023, 120 entities; trade_co2).
- Climate TRACE, EDGAR files, Ember and Carbon Monitor are production-based. If the site computes per capita itself it needs an open population series (licence not researched here).

## Ranking: best 6 for an automated, commercially usable page

1. Climate TRACE: the only source with monthly resolution, 10 sectors and 68 subsectors, CO2, CH4, N2O and CO2e, 252 countries, about 2 months lag, keyless JSON API, explicit CC BY 4.0 wording that names commercial use and modification. Cautions: API is beta with no uptime promise; a few subsectors reproduce EDGAR/FAOSTAT/CEDS rows; use `sectors=` filter; forestry is negative.
2. Our World in Data CO2 dataset (CO2, per-capita, by-fuel and consumption columns only): one stable CSV/JSON URL, no key, CC BY, GCP CC BY inputs, 215 entities to 2024. Avoid the methane, nitrous oxide and total_ghg columns until the PRIMAP-hist question is cleared.
3. Global Carbon Project (GCB 2025 national files): CC BY 4.0 on the ICOS portal, territorial and consumption-based CO2 to 2024/2023; once a year (next release due around November 2026); files are XLSX so ingest once yearly.
4. EDGAR 2026 non-CO2 (CH4, N2O, F-gases) by sector and country: CC BY 4.0, 1970-2025, freshest annual data, best gas-by-sector detail, keyless direct downloads. Do NOT use IEA-EDGAR CO2 (CC BY-NC-ND).
5. Ember (power sector emissions, yearly and monthly): CC BY 4.0 with explicit commercial wording; yearly to 2025 and monthly to June 2026; bulk CSVs without a key. Power only.
6. Eurostat air emissions accounts: reuse for commercial purposes authorised with acknowledgement (CC BY 4.0); the only genuine by-industry (NACE) breakdown with gases; keyless JSON API; EU and neighbours only, latest year 2024.

Next in line (not in the six): Climate Watch API (good sector tables, but 3-year lag and FAO/IEA/PRIMAP restrictions inside), World Bank WDI (CC BY 4.0 at dataset level but its CO2 indicators carry IEA-EDGAR CO2), Carbon Monitor (daily, six sectors, but only a "fair use" policy; ask for written permission), CEDS (CC BY 4.0, but 2023 latest and mostly pollutant data).

Do not use on a monetised page without separate permission: PRIMAP-hist (NC-SA), IEA-EDGAR CO2 (NC-ND), IEA data (paid), Climate Action Tracker (no commercial use), FAOSTAT (promotion-of-commercial-enterprise clause; get a view from FAO), Energy Institute and UNFCCC (terms not confirmed).

## Open items to verify before launch

- UNFCCC and Energy Institute and IEA and Ember website terms pages: read them in a normal browser and record the licence text.
- Whether the World Bank has IEA permission for the IEA-EDGAR-based CO2 indicators.
- Climate TRACE CSV package URL pattern and a written rate-limit expectation for the beta API (email the contact page).
- PRIMAP-hist version used inside Jones et al. (2025), which feeds OWID's methane and nitrous oxide columns.
- Climate Watch API terms and rate limits (no documentation found).
