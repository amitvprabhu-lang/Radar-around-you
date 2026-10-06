# Carbon and greenhouse gas data: what exists and what may be used

Written 2026-10-06 from three research passes, one per question (live data, country and sector and gas inventories, company and facility data). The full reports, with the quotes, the URLs read and the dates read, are in `docs/carbon-research/`. Nothing here is legal advice. Each licence line was read from the source's own page unless the report says NOT CONFIRMED. The owner's plan may include display ads, affiliate links and paid alerts, so "commercial use" is the column that matters. Nothing has been built from this yet and no feed has been added to the collector.

## 1. Live and near-real-time (grid carbon intensity, atmosphere)

Good fit, commercial use allowed with credit (all keyless unless noted):
- NOAA GML Trends: CO2, CH4, N2O and SF6 at Mauna Loa and as global means; daily and weekly files refreshed daily; US government public domain with conditions (credit, no implied endorsement).
- Energinet Energi Data Service (Denmark): CO2 emission g/kWh, 5-minute; CC BY 4.0.
- RTE eco2mix via ODRE (France): generation mix and CO2 rate, 15-minute; Licence Ouverte 2.0; 50,000 calls per user per month.
- UK Carbon Intensity API (NESO): Great Britain and 14 regions, 30-minute slots; CC BY 4.0 plus Terms of Use that forbid selling or sublicensing access to the API or replacing NESO's own service.
- Elexon BMRS: Great Britain generation outturn by fuel; BMRS Data Licence (attribution).
- EIA Hourly Electric Grid Monitor: US Lower 48, free key, public domain; the page says yesterday's data by 11:00 ET, so it is not live.
- ENTSO-E Transparency Platform: EU generation by type, load, flows; token by email approval; CC BY 4.0 for a published list of data, Terms of Use for the rest.
- Copernicus CAMS (greenhouse gas forecasts, fire emissions): account and key needed, CC BY.

Not usable on a monetised site without a written licence: Electricity Maps free tier (non-commercial; paid from about EUR 6,000 a year per signal per country), Open Electricity (CC BY-NC 4.0), Open-Meteo free API (non-commercial), Grid-India (consent), Carbon Mapper, UNEP IMEO and Kayrros methane plumes (restricted or consent-gated). Carbon Monitor states no licence and its files end between April and July 2026, so its daily data is months behind. Energy-Charts has an API-versus-website licence conflict. WattTime, IESO, GOSAT and CarbonTracker terms are NOT CONFIRMED.

## 2. Emissions by country, industry and gas

Annual or monthly, never live. Best for a commercial page: Climate TRACE (sector and gas by country, monthly, keyless API, CC BY 4.0); Our World in Data CO2 dataset (only the CO2, per-capita, by-fuel and consumption-based columns); Global Carbon Project national files; EDGAR methane, nitrous oxide and F-gases (not its CO2 file); Ember (electricity, CC BY 4.0, monthly for 88 geographies); Eurostat air emissions accounts (Europe).

Do not use on a monetised page: PRIMAP-hist (CC BY-NC-SA), IEA-EDGAR CO2 (CC BY-NC-ND), Climate Action Tracker (commercial use forbidden), FAOSTAT (bars use "in conjunction with the promotion of a commercial enterprise"). UNFCCC, IEA and Energy Institute terms could not be read (bot checks): NOT CONFIRMED.

Sector names differ by source; the table of each source's exact sector names is in `docs/carbon-research/country-sector-gas.md`.

## 3. Companies and facilities

Best for a commercial page: Climate TRACE (owners and parents for about a third of global emissions; modelled, ownership partial); US EPA GHGRP through the Envirofacts API (reported, parent companies and ownership percentages, latest year 2023, commercial-use wording unclear); EU ETS Union Registry (installation level, CC BY 4.0); Canada GHGRP (Open Government Licence - Canada, commercial use explicitly allowed, 2024 data); Australia NGER (CC BY 4.0, company scope 1 and 2, 2024-25); EU Industrial Emissions Portal (CC BY 4.0, facility data to 2024, parent company field).

Forbidden or restricted for commercial use: Carbon Majors, CDP, SBTi, Transition Pathway Initiative, Urgewald's coal list, Carbon Mapper, Kayrros; the UK Pollution Inventory is restricted to a year of internal or personal use.

Warning found by the research: filtering Climate TRACE's API by owner returned the same whole-asset figure (27.6 Mt) for both Shell PLC and Equinor ASA, because the asset is co-owned. Summing by owner double counts, so a "top companies" page needs an equity-share method.

## 4. Cautions when naming companies

Say whether a number is reported or estimated, the year, the scope (1, 2, 3), equity share versus control, and the method; link the source; give a way to ask for a correction. The UK legal text (defamation, right of reply) could only be read through search summaries: NOT CONFIRMED. Take advice before publishing a ranking of named companies.

## 5. Candidate pages, in the order that fits the licences

1. CO2 and methane in the atmosphere (NOAA GML, public domain): the cleanest first page.
2. Grid carbon intensity now for Britain, Denmark and France (three keyless live feeds, attribution licences), with the generation mix.
3. Who emits what, by country, industry and gas (Climate TRACE, Our World in Data CO2 columns, EDGAR non-CO2), labelled annual or monthly with the latest year shown.
4. Biggest facilities in the US, Canada, the EU and Australia (reported data, named with the registry's own words).
5. Top emitting companies from Climate TRACE ownership, only after an equity-share method and a review of the naming cautions.

Each needs a collector feed (`pipeline/`), a source record, a staleness limit and a guard, like the existing live pages. Open questions for the owner: whether to write to Carbon Monitor and the non-commercial sources for permission; whether company rankings are wanted at all given the legal caution.
