# How does the presence of a college affect housing prices in a college town?

<p class="lede">Explore California's large-college counties: zoom out to compare the statewide campus-county pattern, then click into a county for the same ZIP-level housing map used in San Luis Obispo, with major university anchors such as Cal Poly, UCLA, USC, UC Berkeley, and UC Davis.</p>

```js
import * as aq from "npm:arquero";
import * as d3 from "npm:d3";
import {html} from "npm:htl";
```

```js
function money(value, digits = 0) {
  return d3.format(`$,.${digits}f`)(value);
}

function compactMoney(value) {
  return d3.format("$.2s")(value).replace("G", "B");
}

function percent(value, digits = 0) {
  return d3.format(`.${digits}%`)(value);
}

function dateLabel(date) {
  const dateObject = date instanceof Date ? date : new Date(`${date}T00:00:00Z`);
  return d3.utcFormat("%b %Y")(dateObject);
}

function displayPlaceName(value) {
  const place = typeof value === "string" ? value : value?.city ?? value?.place ?? "";
  const match = place.match(/^(\d{5})\s+(.+)$/);
  if (match) return `${match[2]} ${match[1]}`;
  return place.replace(/^ZIP\s+/, "");
}

function mapPlaceLabel(value) {
  const place = typeof value === "string" ? value : value?.city ?? value?.place ?? "";
  const label = place.replace(/^\d{5}\s+/, "").replace(/^ZIP\s+/, "").trim();
  return /^\d{5}$/.test(label) ? "" : label;
}

function localMetricValue(row, metric) {
  return metric === "zori" ? row.blendedRent : row.zhvi;
}

function significantMetricCutoff(rows, metric) {
  const values = rows.map((row) => localMetricValue(row, metric)).filter((value) => value != null);
  const mean = d3.mean(values);
  const deviation = d3.deviation(values);
  return mean == null || deviation == null ? Infinity : mean + deviation * 2;
}

function highAboveMeanPlaces(rows, metric) {
  const cutoff = significantMetricCutoff(rows, metric);
  return new Set(rows.filter((row) => localMetricValue(row, metric) >= cutoff).map((row) => row.place));
}

function layoutMapLabels(anchors, selected, highlightedPlaces, metric) {
  const selectedPlace = selected?.place;
  const chosen = [];
  const usedLabels = new Set();
  const boxes = [];
  const offsets = [
    [12, -10],
    [12, 16],
    [-12, -10],
    [-12, 16],
    [0, -20],
    [0, 24],
    [18, 0],
    [-18, 0]
  ];
  const overlaps = (box) =>
    boxes.some((existing) =>
      box.x0 < existing.x1 && box.x1 > existing.x0 && box.y0 < existing.y1 && box.y1 > existing.y0
    );
  const add = (anchor, force = false) => {
    const label = mapPlaceLabel(anchor);
    if (!label || (usedLabels.has(label) && anchor.place !== selectedPlace)) return;
    let placed = null;
    for (const [dx, dy] of offsets) {
      const anchorEnd = dx < 0;
      const width = Math.max(28, label.length * 5.8);
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const box = anchorEnd
        ? {x0: x - width, x1: x, y0: y - 11, y1: y + 3}
        : {x0: x, x1: x + width, y0: y - 11, y1: y + 3};
      if (force || !overlaps(box)) {
        placed = {...anchor, label, labelX: x, labelY: y, labelAnchor: anchorEnd ? "end" : "start"};
        boxes.push(box);
        break;
      }
    }
    if (!placed) return;
    chosen.push(placed);
    usedLabels.add(label);
  };

  const selectedAnchor = anchors.find((anchor) => anchor.place === selectedPlace);
  if (selectedAnchor) add(selectedAnchor, true);

  const highlighted = anchors
    .filter((anchor) => highlightedPlaces.has(anchor.place) && anchor.place !== selectedPlace)
    .sort((a, b) => d3.descending(localMetricValue(a, metric), localMetricValue(b, metric)));

  for (const anchor of highlighted) {
    add(anchor);
  }

  return chosen;
}

function rangeControl([min, max], {label, step = 1, value = min, format = (d) => d}) {
  const input = html`<input type="range" min=${min} max=${max} step=${step} value=${value}>`;
  const output = html`<output>${format(value)}</output>`;
  const control = html`<label class="control">${label}${input}${output}</label>`;

  Object.defineProperty(control, "value", {
    get: () => input.valueAsNumber,
    set: (nextValue) => {
      input.value = nextValue;
      output.textContent = format(input.valueAsNumber);
    }
  });

  input.addEventListener("input", () => {
    output.textContent = format(input.valueAsNumber);
    control.dispatchEvent(new globalThis.Event("input", {bubbles: true}));
  });

  return control;
}

function radioControl(options, {label, value, format = (d) => d}) {
  const name = `radio-${Math.random().toString(36).slice(2)}`;
  const fields = options.map((option) => html`
    <label class="choice">
      <input type="radio" name=${name} value=${option} checked=${option === value}>
      <span>${format(option)}</span>
    </label>
  `);
  const control = html`<form class="control-group"><fieldset><legend>${label}</legend>${fields}</fieldset></form>`;

  Object.defineProperty(control, "value", {
    get: () => control.querySelector("input:checked")?.value,
    set: (nextValue) => {
      const input = control.querySelector(`input[value="${nextValue}"]`);
      if (input) input.checked = true;
    }
  });

  control.addEventListener("change", () => control.dispatchEvent(new globalThis.Event("input", {bubbles: true})));

  return control;
}

function selectControl(options, {label, value, format = (d) => d}) {
  const select = html`<select>${options.map((option) => html`<option value=${option} selected=${option === value}>${format(option)}</option>`)}</select>`;
  const control = html`<label class="control">${label}${select}</label>`;
  const notify = () => {
    globalThis.queueMicrotask(() => {
      control.dispatchEvent(new globalThis.Event("input", {bubbles: true}));
    });
  };

  Object.defineProperty(control, "value", {
    get: () => select.value,
    set: (nextValue) => {
      if (select.value !== nextValue) select.value = nextValue;
      notify();
    }
  });

  select.addEventListener("input", notify);
  select.addEventListener("change", notify);

  return control;
}

function mapControlStrip({countySelect, mapMetricInput, selectedPlaceInput, showCountyControls}) {
  const strip = html`<div class="control-strip">
    ${countySelect}
    ${showCountyControls ? mapMetricInput : ""}
    ${showCountyControls ? selectedPlaceInput : ""}
  </div>`;
  const notify = () => strip.dispatchEvent(new globalThis.Event("input", {bubbles: true}));

  if (showCountyControls) {
    mapMetricInput.addEventListener("input", notify);
    selectedPlaceInput.addEventListener("input", notify);
  }

  Object.defineProperty(strip, "value", {
    get: () => ({
      mapMetric: showCountyControls ? mapMetricInput.value : "zhvi",
      selectedPlace: showCountyControls ? selectedPlaceInput.value : selectedPlaceInput.value
    })
  });

  return strip;
}
```

```js
const caCounties = await FileAttachment("data/ca-counties.geojson").json();
const countyIndex = await FileAttachment("data/ca-county-index.json").json();
const countyHousingRows = await FileAttachment("data/ca-county-housing.csv").csv({typed: true});
const allCampuses = (await FileAttachment("data/ca-campuses.csv").csv({typed: true})).map((row) => ({
  ...row,
  county_fips: String(row.county_fips).padStart(5, "0"),
  housed_share: row.housed_share == null || row.housed_share === "" ? null : Number(row.housed_share)
}));
const countyByFips = new Map(countyIndex.counties.map((county) => [county.fips, county]));
const indexedCountyFips = new Set(countyIndex.counties.map((county) => county.fips));

function normalizeCountyFips(fips) {
  return String(fips ?? "").padStart(5, "0");
}

function readSearchParams() {
  const defaultCounty = countyIndex.defaultFips ?? "06079";
  if (typeof window === "undefined") {
    return {view: "county", county: defaultCounty};
  }

  const params = new URLSearchParams(window.location.search);
  const county = normalizeCountyFips(params.get("county") ?? defaultCounty);
  return {
    view: params.get("view") === "state" ? "state" : "county",
    county: indexedCountyFips.has(county) ? county : defaultCounty
  };
}

const mapScopeControl = html`<div style="display: none;"></div>`;
mapScopeControl.value = readSearchParams();

function updateMapScope(nextScope) {
  mapScopeControl.value = nextScope;
  mapScopeControl.dispatchEvent(new globalThis.Event("input", {bubbles: true}));
}

function navigateCountyScope({county, view}) {
  if (typeof window === "undefined") return;
  const nextScope = {
    county: normalizeCountyFips(county),
    view: view === "state" ? "state" : "county"
  };
  const url = new URL(window.location.href);
  url.searchParams.set("county", nextScope.county);
  if (view === "state") url.searchParams.set("view", "state");
  else url.searchParams.delete("view");
  const nextPath = `${url.pathname}${url.search}`;
  const animateChange = () => {
    updateMapScope(nextScope);
    window.history.pushState(nextScope, "", nextPath);
  };

  document.documentElement.dataset.mapTransition = view === "state" ? "zoom-out" : "zoom-in";
  if (document.startViewTransition) {
    const transition = document.startViewTransition(animateChange);
    transition.finished.finally(() => {
      delete document.documentElement.dataset.mapTransition;
    });
  } else {
    animateChange();
    delete document.documentElement.dataset.mapTransition;
  }
}

function openCounty(fips) {
  if (indexedCountyFips.has(fips)) navigateCountyScope({county: fips, view: "county"});
}

if (typeof window !== "undefined" && !window.__collegeHousingMapPopstate) {
  window.__collegeHousingMapPopstate = true;
  window.addEventListener("popstate", () => updateMapScope(readSearchParams()));
}

const mapScope = view(mapScopeControl);

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeHousingRows(rows) {
  return rows.map((row) => {
    const zori = optionalNumber(row.zori);
    const hudSafmr = optionalNumber(row.hudSafmr);
    const blendedRent = optionalNumber(row.blendedRent) ?? zori ?? hudSafmr;
    return {
      ...row,
      zhvi: optionalNumber(row.zhvi),
      zori,
      hudSafmr,
      blendedRent,
      hudFiscalYear: row.hudFiscalYear === "" ? null : row.hudFiscalYear,
      rentSource: row.rentSource || (zori != null ? "Zillow ZORI" : hudSafmr != null ? "HUD SAFMR" : "")
    };
  });
}

async function loadCountyBundleFromFetch(fips) {
  const basePath = `/_file/data/counties/${fips}`;
  const responses = await Promise.all([
    fetch(`${basePath}/bg.geojson`),
    fetch(`${basePath}/zctas.geojson`),
    fetch(`${basePath}/zip-housing.csv`),
    fetch(`${basePath}/meta.json`)
  ]);

  if (responses.some((response) => !response.ok)) {
    throw new Error(`County bundle for ${fips} is not available yet. Run npm run data:counties.`);
  }

  const [base, zctaBoundaries, housingCsv, meta] = await Promise.all(responses.map((response) => response.text()));
  return {
    base: JSON.parse(base),
    zctaBoundaries: JSON.parse(zctaBoundaries),
    housingRows: normalizeHousingRows(d3.csvParse(housingCsv)),
    meta: JSON.parse(meta),
    campuses: allCampuses.filter((campus) => campus.county_fips === fips)
  };
}

const countySelect = selectControl(
  countyIndex.counties.map((county) => county.fips),
  {
    label: "County",
    value: mapScope.county,
    format: (fips) => countyByFips.get(fips)?.shortName ?? fips
  }
);

countySelect.addEventListener("change", () => {
  navigateCountyScope({county: countySelect.value, view: "county"});
});
```

```js
const activeCountyFips = mapScope.county;
const activeCounty = countyByFips.get(activeCountyFips);

const sloBundle = {
  base: await FileAttachment("data/slo-bg.geojson").json(),
  zctaBoundaries: await FileAttachment("data/slo-zctas.geojson").json(),
  housingRows: normalizeHousingRows(await FileAttachment("data/slo-zip-housing.csv").csv({typed: true})),
  meta: {
    fips: "06079",
    name: "San Luis Obispo County",
    defaultPlace: "93401 San Luis Obispo"
  },
  campuses: allCampuses.filter((campus) => campus.county_fips === "06079")
};

let countyBundle = sloBundle;

if (activeCountyFips !== "06079") {
  try {
    countyBundle = await loadCountyBundleFromFetch(activeCountyFips);
  } catch (error) {
    console.error(`Failed to load county bundle for ${activeCountyFips}`, error);
    countyBundle = null;
  }
}

const base = countyBundle?.base ?? null;
const zctaBoundaries = countyBundle?.zctaBoundaries ?? null;
const housingRows = countyBundle?.housingRows ?? [];
const campuses = countyBundle?.campuses ?? [];
```

```js
const housingTable = housingRows.length
  ? aq
      .from(housingRows)
      .derive({
        valueRentRatio: (d) => d.blendedRent ? d.zhvi / (d.blendedRent * 12) : null
      })
      .orderby("place", "date")
  : aq
      .from([
        {
          place: "",
          date: "2016-04-30",
          zhvi: 0,
          blendedRent: null,
          zori: null,
          hudSafmr: null,
          rentSource: "",
          hudFiscalYear: null
        }
      ])
      .filter(() => false);

const housing = housingTable.objects().map((d) => ({
  ...d,
  date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date
}));
const dates = housing.length
  ? Array.from(new Set(housing.map((d) => d.date))).sort()
  : ["2016-04-30"];
const baselineDate = dates[0];
const latestDate = dates.at(-1);
const countyHousingByFips = d3.group(countyHousingRows, (d) => String(d.fips).padStart(5, "0"));

function countyMetricValue(county, metric, date = latestDate) {
  if (metric === "zori") return county.latestRent ?? null;
  const series = countyHousingByFips.get(county.fips) ?? [];
  const row = series.find((entry) => entry.date === date) ?? series.at(-1);
  return row?.zhvi ?? county.latestZhvi ?? null;
}

const baselineByPlace = new Map(
  housing.filter((d) => d.date === baselineDate).map((d) => [d.place, d])
);
const latestByPlace = new Map(
  housing.filter((d) => d.date === latestDate).map((d) => [d.place, d])
);

function annotateHousingRow(row) {
  const baseline = baselineByPlace.get(row.place);
  return {
    ...row,
    change: baseline ? row.zhvi / baseline.zhvi - 1 : 0,
    latestRent: latestByPlace.get(row.place)?.blendedRent ?? null,
    latestRentSource: latestByPlace.get(row.place)?.rentSource ?? null
  };
}

const allMetrics = housing.map((d) => annotateHousingRow(d));

const metricOptions = new Map([
  ["zhvi", "Home value index"],
  ["zori", "Blended rent index"]
]);
```

```js
const mapMetricInput = radioControl(["zhvi", "zori"], {
  label: "Map layer",
  value: "zori",
  format: (value) => metricOptions.get(value)
});
const selectedPlaceInput = selectControl(
  countyBundle?.meta?.places?.length
    ? countyBundle.meta.places
    : Array.from(new Set(housing.map((d) => d.place))).sort(d3.ascending),
  {
    label: "Compare ZIP market",
    value: countyBundle?.meta?.defaultPlace ?? "93401 San Luis Obispo",
    format: displayPlaceName
  }
);

if (mapScope.view === "county" && countyBundle?.meta?.defaultPlace) {
  selectedPlaceInput.value = countyBundle.meta.defaultPlace;
}

const controlValues = view(mapControlStrip({
  countySelect,
  mapMetricInput,
  selectedPlaceInput,
  showCountyControls: mapScope.view === "county"
}));
const mapMetric = controlValues.mapMetric;
const selectedPlace = mapScope.view === "county"
  ? controlValues.selectedPlace
  : (countyBundle?.meta?.defaultPlace ?? selectedPlaceInput.value);

const dateIndex = view(rangeControl([0, dates.length - 1], {
  label: "Timeline",
  step: 1,
  value: dates.length - 1,
  format: (i) => dateLabel(dates[i])
}));
```

```js
const selectedDate = dates[Number(dateIndex)];
const selectedRows = housing
  .filter((d) => d.date === selectedDate)
  .map((d) => annotateHousingRow(d));
```

<div class="summary-grid">

```js
mapScope.view === "county" && countyBundle
  ? renderSummary(selectedRows, selectedDate, selectedPlace, activeCounty, countyBundle.meta?.defaultPlace)
  : renderStateSummary(countyIndex, mapMetric, mapScope, selectedDate)
```

</div>

<div class="map-frame">

```js
renderMapFrame({
  mapScope,
  activeCountyFips,
  countySelect,
  selectedRows,
  mapMetric,
  selectedPlace,
  selectedPlaceInput,
  caCounties,
  countyIndex,
  allCampuses,
  activeCounty,
  countyBundle
})
```

</div>

<div class="details-grid">

```js
mapScope.view === "county" && countyBundle && selectedRows.length ? renderTrend(selectedDate, selectedPlace) : html`<section class="detail-panel"><h2>County timeline</h2><p>Select a county from the map to compare ZIP-level home values over time.</p></section>`
```

```js
mapScope.view === "county" && countyBundle && selectedRows.length ? renderComparisonTable(selectedRows, selectedPlace) : html`<section class="detail-panel"><h2>Community comparison</h2><p>Select a county from the map to compare ZIP markets within that county.</p></section>`
```

</div>

<section class="dataset-integrity">
  <h2>Dataset & Data Integrity</h2>

This project combines housing, geography, and campus-housing context across California counties with large college anchors, with a detailed ZIP/ZCTA view available in each in-scope county that has local market data. Housing prices come from [Zillow Research's public housing data](https://www.zillow.com/research/data/), specifically ZIP-level Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI) CSV files through April 2026. Zillow defines ZHVI as a typical home-value measure and ZORI as a smoothed observed market rent measure, which makes the two series appropriate for comparing home values, rents, and price-to-rent relationships across local ZIP markets.

The map geometry comes from the U.S. Census Bureau's [2020 TIGER/Line files](https://www.census.gov/geographies/mapping-files/2020/geo/tiger-line-file.html) and TIGERweb geography services. The ZIP areas are Census ZIP Code Tabulation Areas (ZCTAs), which are generalized Census representations of ZIP Code service areas rather than exact USPS delivery boundaries. For integrity, the visualization keeps ZIP markets with missing rent data neutral instead of inventing values, compares each selected ZIP to the median of the available local markets for the same month, and labels the map as ZCTA-based so the geographic limitation is visible.

Campus context comes from the California State Auditor's [Report 2024-111 on California college housing needs](https://www.auditor.ca.gov/wp-content/uploads/2025/10/2024-111-Report.pdf), which reports that Cal Poly San Luis Obispo housed about 38 percent of enrolled students in academic year 2024-25. This figure is used as contextual evidence about on-campus housing pressure, not as proof that Cal Poly alone caused housing-price changes. Overall, the dataset is strong for showing local patterns and comparisons, but the project avoids making a direct causal claim because housing prices are also affected by income, supply, interest rates, commuting patterns, and broader market conditions.

</section>

<p class="source-note">Sources: Zillow Research ZIP-level ZHVI and ZORI public CSVs through 2026-04-30; HUD Small Area Fair Market Rent workbooks, FY2011-FY2026; Census TIGERweb 2020 ZIP Code Tabulation Area geometry; Census TIGERweb block group geometry for the San Luis Obispo County outline; California State Auditor report 2024-111 for Cal Poly on-campus housing presence. Rent uses the average of HUD 1BR, 2BR, 3BR, and 4BR SAFMR values by fiscal year, averaged with Zillow ZORI where ZIP-level ZORI is present. ZIP values are mapped to Census ZCTAs, which are generalized Census representations of USPS ZIP Code service areas.</p>

```js
function metricValue(row, metric) {
  if (!row) return null;
  return metric === "zori" ? row.blendedRent : row.zhvi;
}

function metricLabel(metric) {
  return metric === "zori" ? "blended rent index" : "home value index";
}

function metricFormat(metric) {
  return metric === "zori" ? (value) => `${compactMoney(value)} / mo` : compactMoney;
}

function rewindGeometry(geometry) {
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) => [...ring].reverse())
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => [...ring].reverse())
      )
    };
  }

  return geometry;
}

function rewindFeatureCollection(collection) {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: rewindGeometry(feature.geometry)
    }))
  };
}

function createColorScale(metrics, metric) {
  const fallback = () => "#dce9e7";
  if (metric === "zori") {
    const extent = d3.extent(metrics, (d) => d.blendedRent);
    if (extent.some((value) => value == null)) return fallback;
    return d3.scaleSequential(extent, d3.interpolateYlOrRd);
  }

  const extent = d3.extent(metrics, (d) => d.zhvi);
  if (extent.some((value) => value == null)) return fallback;
  return d3.scaleSequential(extent, d3.interpolateYlGnBu);
}

function renderMapFrame({
  mapScope,
  activeCountyFips,
  countySelect,
  selectedRows,
  mapMetric,
  selectedPlace,
  selectedPlaceInput,
  caCounties,
  countyIndex,
  allCampuses,
  activeCounty,
  countyBundle
}) {
  if (mapScope.view === "state") {
    return renderStateMap({
      activeCountyFips,
      countySelect,
      mapMetric,
      selectedDate,
      caCounties,
      countyIndex,
      allCampuses
    });
  }

  if (!countyBundle) {
    return html`<div class="map-empty">Loading county housing data…</div>`;
  }

  if (!selectedRows.length) {
    return html`<div class="map-empty">No ZIP housing rows are available for this county and month.</div>`;
  }

  return renderCountyMap({
    rows: selectedRows,
    metric: mapMetric,
    selectedPlace,
    selectedPlaceInput,
    activeCountyFips,
    county: activeCounty,
    campuses: countyBundle.campuses,
    allMetrics,
    defaultPlace: countyBundle.meta?.defaultPlace,
    base: countyBundle.base,
    zctaBoundaries: countyBundle.zctaBoundaries
  });
}

function renderStateMap({activeCountyFips, countySelect, mapMetric, selectedDate, caCounties, countyIndex, allCampuses}) {
  const width = 980;
  const height = 700;
  const counties = rewindFeatureCollection(caCounties);
  const indexByFips = new Map(countyIndex.counties.map((county) => [county.fips, county]));
  const activeCounties = {
    ...counties,
    features: counties.features.filter((feature) => indexByFips.has(feature.properties.GEOID))
  };
  const svg = d3
    .create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "California county map. Click a county to open its ZIP-level housing map.")
    .style("display", "block")
    .style("width", "100%")
    .style("height", "auto");

  svg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "var(--map-water)");

  const projection = d3.geoMercator().fitExtent([[48, 100], [width - 48, height - 106]], counties);
  const path = d3.geoPath(projection);
  const metricRows = countyIndex.counties
    .map((county) => ({...county, value: countyMetricValue(county, mapMetric, selectedDate)}))
    .filter((county) => county.value != null);
  const color = d3.scaleSequential(
    d3.extent(metricRows, (d) => d.value),
    mapMetric === "zori" ? d3.interpolateYlOrRd : d3.interpolateYlGnBu
  );

  svg
    .append("g")
    .attr("class", "state-county-outlines")
    .selectAll("path")
    .data(counties.features)
    .join("path")
    .attr("d", path)
    .attr("fill", "#edf4f3")
    .attr("stroke", "#c8d7d6")
    .attr("stroke-width", 0.72)
    .attr("stroke-linejoin", "round");

  svg
    .append("g")
    .attr("class", "state-counties")
    .selectAll("path")
    .data(activeCounties.features)
    .join("path")
    .attr("class", (feature) => feature.properties.GEOID === activeCountyFips ? "state-county is-current" : "state-county")
    .attr("d", path)
    .attr("fill", (feature) => {
      const county = indexByFips.get(feature.properties.GEOID);
      const value = county ? countyMetricValue(county, mapMetric, selectedDate) : null;
      return value == null ? "#8ca5a2" : color(value);
    })
    .attr("fill-opacity", 0.96)
    .attr("stroke", (feature) => feature.properties.GEOID === activeCountyFips ? "#10201f" : "#ffffff")
    .attr("stroke-width", (feature) => feature.properties.GEOID === activeCountyFips ? 1.7 : 0.85)
    .attr("stroke-linejoin", "round")
    .attr("cursor", "pointer")
    .attr("tabindex", 0)
    .attr("role", "button")
    .on("mouseenter", function () {
      d3.select(this).attr("fill-opacity", 1).attr("stroke", "#10201f").attr("stroke-width", 1.5);
    })
    .on("mouseleave", function (_event, feature) {
      d3.select(this)
        .attr("fill-opacity", 0.96)
        .attr("stroke", feature.properties.GEOID === activeCountyFips ? "#10201f" : "#ffffff")
        .attr("stroke-width", feature.properties.GEOID === activeCountyFips ? 1.7 : 0.85);
    })
    .on("click", function (_event, feature) {
      d3.select(this).attr("fill-opacity", 1).attr("stroke", "var(--selected)").attr("stroke-width", 2);
      openCounty(feature.properties.GEOID);
    })
    .on("keydown", (event, feature) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCounty(feature.properties.GEOID);
      }
    })
    .append("title")
    .text((feature) => {
      const county = indexByFips.get(feature.properties.GEOID);
      if (!county) return feature.properties.NAME;
      const value = countyMetricValue(county, mapMetric, selectedDate);
      const valueText = value == null ? "Not reported" : metricFormat(mapMetric)(value);
      const campusText = county.campusLabel ? `\nCampus anchors: ${county.campusLabel}` : "";
      return `${county.name}\n${metricOptions.get(mapMetric)}: ${valueText}\nZIP markets: ${county.zipCount}${campusText}\nClick to open county map`;
    });

  const campusPoints = allCampuses
    .map((campus) => {
      const point = projection([campus.longitude, campus.latitude]);
      return point ? {...campus, x: point[0], y: point[1]} : null;
    })
    .filter(Boolean);

  const campusLayer = svg.append("g").attr("class", "state-campuses");
  const campusMarker = campusLayer
    .selectAll("g")
    .data(campusPoints)
    .join("g")
    .attr("transform", (d) => `translate(${d.x},${d.y})`);

  campusMarker
    .append("path")
    .attr("class", "campus-icon")
    .attr("d", "M-7,-2 L0,-7 L7,-2 Z M-5,-1 H5 V6 H-5 Z M-2,6 V1 H2 V6")
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.2)
    .attr("stroke-linejoin", "round")
    .append("title")
    .text((d) => `${d.name}\n${d.note}`);

  drawStateLegend(svg, color, metricRows.map((d) => d.value), mapMetric, width, height);
  drawStateHeader(svg, width, height, activeCountyFips);
  return svg.node();
}

function drawStateHeader(svg, width, height, activeCountyFips) {
  svg
    .append("text")
    .attr("x", 32)
    .attr("y", 34)
    .attr("font-size", 18)
    .attr("font-weight", 780)
    .attr("fill", "#172026")
    .text("California campus counties");

  svg
    .append("text")
    .attr("x", 32)
    .attr("y", 56)
    .attr("font-size", 12)
    .attr("font-weight", 650)
    .attr("fill", "#4a5a61")
    .text("Click a county to open its ZIP-level housing map. Campus icons show major university anchors.");

  drawZoomButton(svg, {
    x: 384,
    y: height - 78,
    label: "Zoom in",
    ariaLabel: "Zoom in to the selected county",
    icon: "plus",
    onClick: () => navigateCountyScope({county: activeCountyFips, view: "county"})
  });
}

function drawStateLegend(svg, color, values, metric, width, height) {
  if (!values.length) return;
  const legendWidth = 260;
  const legendHeight = 10;
  const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(96, ${height - 68})`);
  const scale = d3.scaleLinear().domain(d3.extent(values)).range([0, legendWidth]);
  const axis = d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(metricFormat(metric));
  const gradientId = `state-gradient-${metric}`;
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.01, 0.1).forEach((t) => {
    gradient
      .append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", color(d3.quantile(values, t)));
  });

  legend
    .append("text")
    .attr("x", 0)
    .attr("y", -12)
    .attr("font-size", 12)
    .attr("font-weight", 750)
    .attr("fill", "#263238")
    .text("Latest county home value index");

  legend
    .append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("rx", 2)
    .attr("fill", `url(#${gradientId})`);

  legend
    .append("g")
    .attr("transform", `translate(0, ${legendHeight})`)
    .call(axis)
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll("line").attr("stroke", "#6a7478"))
    .call((g) => g.selectAll("text").attr("fill", "#394348").attr("font-size", 11));
}

function renderStateSummary(countyIndex, metric, mapScope, date) {
  const ranked = [...countyIndex.counties]
    .filter((county) => countyMetricValue(county, metric, date) != null)
    .sort((a, b) => countyMetricValue(b, metric, date) - countyMetricValue(a, metric, date));
  const selected = countyByFips.get(mapScope.county) ?? ranked[0];
  const top = ranked[0];

  return html`
    <div class="stat">
      <span>View</span>
      <strong>Campus counties</strong>
      <em>Click a county to open its ZIP map</em>
    </div>
    <div class="stat">
      <span>Highest county home value</span>
      <strong>${top?.shortName ?? "—"}</strong>
      <em>${top ? metricFormat(metric)(countyMetricValue(top, metric, date)) : "Not reported"}</em>
    </div>
    <div class="stat">
      <span>Selected county</span>
      <strong>${selected?.shortName ?? "—"}</strong>
      <em>${selected?.campusLabel || "No mapped campus anchor"}</em>
    </div>
    <div class="stat">
      <span>Counties with ZIP detail</span>
      <strong>${countyIndex.counties.filter((county) => county.zipCount > 0).length}</strong>
      <em>large-college counties in scope</em>
    </div>
    <div class="stat">
      <span>Campus anchors mapped</span>
      <strong>${new Set(allCampuses.map((campus) => campus.county_fips)).size}</strong>
      <em>counties with a major university marker</em>
    </div>
  `;
}

function renderSummary(rows, date, selectedPlace, county, defaultPlace) {
  if (!rows.length) {
    return html`<div class="stat"><span>County</span><strong>${county?.shortName ?? "County"}</strong><em>Loading ZIP markets…</em></div>`;
  }

  const selected =
    rows.find((d) => d.place === selectedPlace) ??
    rows.find((d) => d.place === defaultPlace) ??
    rows[0];
  const ranked = [...rows].sort((a, b) => b.zhvi - a.zhvi);
  const growthRanked = [...rows].sort((a, b) => b.change - a.change);
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const latestRent = latestByPlace.get(selected.place)?.blendedRent;
  const selectedRank = ranked.findIndex((d) => d.place === selected.place) + 1;
  const selectedVsMedian = selected.zhvi - medianValue;
  const topGrowth = growthRanked[0];

  return html`
    <div class="stat">
      <span>County</span>
      <strong>${county?.shortName ?? "County"}</strong>
      <em>${county?.campusLabel || "ZIP-level Zillow markets"}</em>
    </div>
    <div class="stat">
      <span>Selected month</span>
      <strong>${dateLabel(date)}</strong>
    </div>
    <div class="stat">
      <span>${displayPlaceName(selected)} home value</span>
      <strong>${money(selected.zhvi)}</strong>
      <em>${percent(selected.change)} since ${dateLabel(baselineDate)}</em>
    </div>
    <div class="stat">
      <span>${displayPlaceName(selected)} local rank</span>
      <strong>${selectedRank} of ${rows.length}</strong>
      <em>${selectedVsMedian >= 0 ? "+" : ""}${money(selectedVsMedian)} vs local median</em>
    </div>
    <div class="stat">
      <span>Latest blended rent</span>
      <strong>${latestRent ? `${money(latestRent)} / mo` : "Not reported"}</strong>
      <em>${latestRent ? `${d3.format(".1f")(latestByPlace.get(selected.place).valueRentRatio)}x value-to-annual-rent` : "Rent index unavailable"}</em>
    </div>
    <div class="stat">
      <span>Fastest growth</span>
      <strong>${displayPlaceName(topGrowth)}</strong>
      <em>${percent(topGrowth.change)} since ${dateLabel(baselineDate)}</em>
    </div>
  `;
}

function setSelectedPlace(input, place) {
  const select = input.querySelector?.("select");
  const option = select && Array.from(select.options).find((option) => option.value === place);

  if (option) {
    select.value = option.value;
    select.dispatchEvent(new globalThis.Event("input", {bubbles: true}));
    select.dispatchEvent(new globalThis.Event("change", {bubbles: true}));
    return;
  }

  input.value = place;
  input.dispatchEvent(new globalThis.Event("input", {bubbles: true}));
  input.dispatchEvent(new globalThis.Event("change", {bubbles: true}));
}

function medianComparison(row, medianValue) {
  if (!row || medianValue == null) return "Median unavailable";
  const difference = row.zhvi - medianValue;
  return `${difference >= 0 ? "+" : ""}${money(difference)} vs local median`;
}

function drawZoomButton(svg, {x, y, label, ariaLabel, icon, onClick}) {
  const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");
  if (defs.select("#zoom-button-shadow").empty()) {
    defs
      .append("filter")
      .attr("id", "zoom-button-shadow")
      .attr("x", "-20%")
      .attr("y", "-30%")
      .attr("width", "140%")
      .attr("height", "180%")
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 2)
      .attr("stdDeviation", 2.2)
      .attr("flood-color", "#172026")
      .attr("flood-opacity", 0.16);
  }

  const button = svg
    .append("g")
    .attr("class", "map-zoom-control")
    .attr("transform", `translate(${x}, ${y})`)
    .attr("role", "button")
    .attr("tabindex", 0)
    .attr("aria-label", ariaLabel)
    .style("cursor", "pointer")
    .on("click", onClick)
    .on("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    });

  button
    .append("rect")
    .attr("width", 44)
    .attr("height", 44)
    .attr("rx", 10)
    .attr("fill", "rgba(255, 255, 255, 0.96)")
    .attr("stroke", "#9fb9b7")
    .attr("filter", "url(#zoom-button-shadow)");

  const iconGroup = button.append("g").attr("transform", "translate(22, 22)");

  if (icon === "california") {
    iconGroup
      .append("path")
      .attr("d", "M-8,-13 L2,-12 L5,-8 L3,-4 L8,1 L6,7 L10,13 L5,14 L0,8 L-4,5 L-5,0 L-10,-5 Z")
      .attr("fill", "none")
      .attr("stroke", "var(--campus)")
      .attr("stroke-width", 2)
      .attr("stroke-linejoin", "round");
  } else {
    iconGroup
      .append("line")
      .attr("x1", -9)
      .attr("y1", 0)
      .attr("x2", 9)
      .attr("y2", 0)
      .attr("stroke", "var(--campus)")
      .attr("stroke-width", 3)
      .attr("stroke-linecap", "round");
  }

  if (icon === "plus") {
    iconGroup
      .append("line")
      .attr("x1", 0)
      .attr("y1", -9)
      .attr("x2", 0)
      .attr("y2", 9)
      .attr("stroke", "var(--campus)")
      .attr("stroke-width", 3)
      .attr("stroke-linecap", "round");
  }

  button.append("title").text(label);
}

function drawZoomOutButton(svg, activeCountyFips, height, x = 384) {
  drawZoomButton(svg, {
    x,
    y: height - 78,
    label: "California map",
    ariaLabel: "Return to the California map",
    icon: "california",
    onClick: () => navigateCountyScope({county: activeCountyFips, view: "state"})
  });
}

function drawCampusMarkers(root, projection, campuses) {
  const campusLayer = root.append("g").attr("class", "campus-markers");

  for (const campus of campuses) {
    const campusPoint = projection([campus.longitude, campus.latitude]);
    if (!campusPoint) continue;
    const campusGroup = campusLayer
      .append("g")
      .attr("class", "campus-marker")
      .attr("transform", `translate(${campusPoint})`);

    campusGroup
      .append("path")
      .attr("class", "campus-icon")
      .attr("d", "M-9,-2 L0,-8 L9,-2 Z M-7,-1 H7 V7 H-7 Z M-3,7 V1 H3 V7")
      .attr("fill", "var(--campus)")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.35)
      .attr("stroke-linejoin", "round")
      .append("title")
      .text(
        `${campus.name}\n${campus.housing_status}${
          campus.housed_share == null ? "" : `\nAbout ${percent(campus.housed_share)} of enrolled students housed on campus`
        }\n${campus.note}`
      );

    campusGroup
      .append("text")
      .attr("class", "campus-label")
      .attr("x", 12)
      .attr("y", -11)
      .text(campus.short_label);
  }
}

function installCountyMapZoom(svg, contentGroup, selectedAnchor, width, height) {
  const focus = selectedAnchor ?? {x: width / 2, y: height / 2};
  const zoomLevels = [1, 1.45, 1.9, 2.35];
  const zoomControlsX = 384;
  let zoomIndex = 0;
  let currentTransform = d3.zoomIdentity;

  function clampTransform(transform) {
    const k = transform.k;
    const extraX = width * 0.12;
    const extraY = height * 0.12;
    const minX = width - width * k - extraX;
    const maxX = extraX;
    const minY = height - height * k - extraY;
    const maxY = extraY;
    return d3.zoomIdentity
      .translate(Math.max(minX, Math.min(maxX, transform.x)), Math.max(minY, Math.min(maxY, transform.y)))
      .scale(k);
  }

  const zoom = d3
    .zoom()
    .scaleExtent([1, zoomLevels.at(-1)])
    .filter((event) => {
      const target = event.target;
      const isZoomControl = target?.closest && target.closest(".map-zoom-control");
      const isPanStart = event.type === "mousedown" || event.type === "touchstart";
      return event.type !== "wheel" && !isZoomControl && (!isPanStart || currentTransform.k > 1);
    })
    .on("zoom", (event) => {
      currentTransform = clampTransform(event.transform);
      contentGroup.attr("transform", currentTransform);
    });

  svg
    .classed("is-zoomable", true)
    .call(zoom)
    .on("dblclick.zoom", null)
    .on("wheel.map-pan", (event) => {
      if (currentTransform.k <= 1 || event.target?.closest?.(".map-zoom-control")) return;
      event.preventDefault();
      const dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      const dy = event.shiftKey ? 0 : event.deltaY;
      const next = clampTransform(
        d3.zoomIdentity
          .translate(currentTransform.x - dx, currentTransform.y - dy)
          .scale(currentTransform.k)
      );
      svg.call(zoom.transform, next);
    });

  function zoomToIndex(nextIndex) {
    zoomIndex = Math.max(0, Math.min(zoomLevels.length - 1, nextIndex));
    const scale = zoomLevels[zoomIndex];
    const next = clampTransform(
      scale === 1
        ? d3.zoomIdentity
        : d3.zoomIdentity.translate(width / 2 - focus.x * scale, height / 2 - focus.y * scale).scale(scale)
    );
    svg.transition().duration(320).ease(d3.easeCubicOut).call(zoom.transform, next);
  }

  drawZoomButton(svg, {
    x: zoomControlsX,
    y: height - 186,
    label: "Zoom in",
    ariaLabel: "Zoom in on ZIP areas",
    icon: "plus",
    onClick: () => zoomToIndex(zoomIndex + 1)
  });

  drawZoomButton(svg, {
    x: zoomControlsX,
    y: height - 132,
    label: "Zoom out",
    ariaLabel: "Zoom out from ZIP areas",
    icon: "minus",
    onClick: () => zoomToIndex(zoomIndex - 1)
  });
}

function renderCountyMap({
  rows,
  metric,
  selectedPlace,
  selectedPlaceInput,
  activeCountyFips,
  county,
  campuses,
  allMetrics,
  defaultPlace,
  base: countyBase,
  zctaBoundaries: countyZctas
}) {
  const width = 980;
  const height = 700;
  const displayBase = rewindFeatureCollection(countyBase);
  const displayZctas = rewindFeatureCollection(countyZctas);
  const rowsByPlace = new Map(rows.map((d) => [d.place, d]));
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const selected =
    rowsByPlace.get(selectedPlace) ?? rows.find((d) => d.place === defaultPlace) ?? rows[0];
  const svg = d3
    .create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr(
      "aria-label",
      `${county?.name ?? "County"} ZCTA map showing ${metricLabel(metric)} with university anchors.`
    )
    .style("display", "block")
    .style("width", "100%")
    .style("height", "auto");

  svg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "var(--map-water)");

  const projection = d3.geoMercator().fitExtent([[28, 38], [width - 280, height - 124]], displayBase);
  const path = d3.geoPath(projection);
  const contentGroup = svg.append("g").attr("class", "county-map-content");
  const color = createColorScale(allMetrics, metric);
  const anchors = rows
    .map((d) => {
      const point = projection([d.longitude, d.latitude]);
      return point ? {...d, x: point[0], y: point[1]} : null;
    })
    .filter(Boolean);
  const values = allMetrics.map((d) => metricValue(d, metric)).filter((d) => d != null);
  const highlightedPlaces = highAboveMeanPlaces(rows, metric);
  const mapLabels = layoutMapLabels(anchors, selected, highlightedPlaces, metric);
  const labeledPlaces = new Set(mapLabels.map((label) => label.place));

  contentGroup
    .append("path")
    .datum({type: "FeatureCollection", features: displayBase.features})
    .attr("d", path)
    .attr("fill", "#eef4f3")
    .attr("stroke", "none");

  contentGroup
    .append("path")
    .datum({type: "FeatureCollection", features: displayBase.features})
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#516164")
    .attr("stroke-width", 1.1)
    .attr("stroke-opacity", 0.8);

  contentGroup
    .append("g")
    .attr("class", "zcta-boundaries")
    .selectAll("path")
    .data(displayZctas.features)
    .join("path")
    .attr("class", (feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      const classes = ["zcta-area"];
      if (row) classes.push("is-clickable");
      if (row?.place === selected.place) classes.push("is-selected");
      if (row && highlightedPlaces.has(row.place)) classes.push("is-high");
      return classes.join(" ");
    })
    .attr("d", path)
    .attr("fill", (feature) => {
      const value = metricValue(rowsByPlace.get(feature.properties.place), metric);
      return value == null ? "#f5f7f6" : color(value);
    })
    .attr("fill-opacity", (feature) => rowsByPlace.get(feature.properties.place)?.place === selected.place ? 0.98 : 0.84)
    .attr("stroke", (feature) => rowsByPlace.has(feature.properties.place) ? "rgba(255,255,255,0.9)" : "none")
    .attr("stroke-width", (feature) => rowsByPlace.has(feature.properties.place) ? 0.38 : 0)
    .attr("tabindex", (feature) => rowsByPlace.has(feature.properties.place) ? 0 : null)
    .attr("role", (feature) => rowsByPlace.has(feature.properties.place) ? "button" : null)
    .attr("aria-label", (feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      if (!row) return `${feature.properties.name ?? "ZCTA"}; housing data unavailable.`;
      return `Select ${row.place}; home value ${money(row.zhvi)}, ${medianComparison(row, medianValue)}.`;
    })
    .style("cursor", (feature) => rowsByPlace.has(feature.properties.place) ? "pointer" : "default")
    .on("mouseenter", function (_event, feature) {
      if (!rowsByPlace.has(feature.properties.place)) return;
      d3.select(this).attr("fill-opacity", 0.98).attr("stroke", "#172026").attr("stroke-width", 1.15);
    })
    .on("mouseleave", function (_event, feature) {
      const row = rowsByPlace.get(feature.properties.place);
      if (!row) return;
      d3.select(this)
        .attr("fill-opacity", row.place === selected.place ? 0.98 : 0.84)
        .attr("stroke", "rgba(255,255,255,0.9)")
        .attr("stroke-width", 0.38);
    })
    .on("click", (event, feature) => {
      if (rowsByPlace.has(feature.properties.place)) setSelectedPlace(selectedPlaceInput, feature.properties.place);
    })
    .on("keydown", (event, feature) => {
      if (rowsByPlace.has(feature.properties.place) && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setSelectedPlace(selectedPlaceInput, feature.properties.place);
      }
    })
    .append("title")
    .text((feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      if (!row) return `${feature.properties.name ?? "ZCTA"}\nHousing data unavailable.`;
      const rent = row.latestRent ? `\nLatest blended rent: ${money(row.latestRent)} / mo (${row.latestRentSource})` : "";
      const zori = row.zori ? `\nZillow ZORI: ${money(row.zori)} / mo` : "";
      const hud = row.hudSafmr ? `\nHUD SAFMR average: ${money(row.hudSafmr)} / mo, FY${row.hudFiscalYear}` : "";
      const selectedMetric = metricValue(row, metric);
      const selectedMetricText = selectedMetric == null ? "Not reported" : metricFormat(metric)(selectedMetric);
      return `${row.place}\n${metricLabel(metric)}: ${selectedMetricText}\nHome value index: ${money(row.zhvi)}\n${medianComparison(row, medianValue)}\nChange since ${dateLabel(baselineDate)}: ${percent(row.change)}${rent}${zori}${hud}\n${row.note}`;
    });

  contentGroup
    .append("g")
    .attr("class", "selected-boundary")
    .selectAll("path")
    .data(displayZctas.features.filter((feature) => feature.properties.place === selected.place))
    .join("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "var(--selected)")
    .attr("stroke-width", 1.7)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round")
    .attr("stroke-opacity", 0.94)
    .attr("pointer-events", "none");

  const anchorGroup = contentGroup.append("g").attr("class", "place-anchors");
  const selectedAnchor = anchors.find((d) => d.place === selected.place);

  if (selectedAnchor) {
    const ripple = contentGroup.append("g").attr("class", "selected-ripple");

    ripple
      .append("circle")
      .attr("cx", selectedAnchor.x)
      .attr("cy", selectedAnchor.y)
      .attr("r", 3)
      .attr("fill", "none")
      .attr("stroke", "var(--selected)")
      .attr("stroke-width", 1.4)
      .attr("stroke-opacity", 0.52)
      .call((circle) => {
        circle.append("animate")
          .attr("attributeName", "r")
          .attr("values", "3;18")
          .attr("dur", "1.05s")
          .attr("repeatCount", "2");
        circle.append("animate")
          .attr("attributeName", "stroke-opacity")
          .attr("values", "0.52;0")
          .attr("dur", "1.05s")
          .attr("repeatCount", "2");
      });
  }

  anchorGroup
    .selectAll("circle")
    .data(anchors.filter((d) => labeledPlaces.has(d.place)))
    .join("circle")
    .attr("class", (d) => {
      const classes = ["anchor-dot"];
      if (d.place === selected.place) classes.push("is-selected");
      if (highlightedPlaces.has(d.place)) classes.push("is-high");
      return classes.join(" ");
    })
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => d.place === selected.place ? 4.2 : highlightedPlaces.has(d.place) ? 3.5 : 3)
    .attr("fill", (d) => d.place === selected.place ? "var(--selected)" : "#0b3d3a")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.3)
    .append("title")
    .text((d) =>
      `${d.place}\nHome value index: ${money(d.zhvi)}\n${medianComparison(d, medianValue)}\nChange since ${dateLabel(baselineDate)}: ${percent(d.change)}`
    );

  anchorGroup
    .selectAll("text")
    .data(mapLabels)
    .join("text")
    .attr("class", (d) => d.place === selected.place ? "place-label is-selected" : "place-label")
    .attr("x", (d) => d.labelX)
    .attr("y", (d) => d.labelY)
    .attr("text-anchor", (d) => d.labelAnchor)
    .text((d) => d.label);

  if (campuses.length) drawCampusMarkers(contentGroup, projection, campuses);

  drawLegend(svg, color, values, metric, width, height, campuses);
  drawMapNote(svg, metric, height, county?.shortName ?? "this county");
  drawSelectionBadge(svg, selected, medianValue, width);
  installCountyMapZoom(svg, contentGroup, selectedAnchor, width, height);
  drawZoomOutButton(svg, activeCountyFips, height);

  return svg.node();
}

function drawSelectionBadge(svg, selected, medianValue, width) {
  const badge = svg.append("g").attr("class", "selection-badge").attr("transform", `translate(${width - 260}, 28)`);

  badge
    .append("rect")
    .attr("width", 228)
    .attr("height", 82)
    .attr("rx", 6)
    .attr("fill", "rgba(255, 255, 255, 0.92)")
    .attr("stroke", "var(--selected)")
    .attr("stroke-width", 1.5);

  badge
    .append("text")
    .attr("x", 14)
    .attr("y", 24)
    .attr("font-size", 12)
    .attr("font-weight", 760)
    .attr("fill", "var(--selected)")
    .text("Selected place");

  badge
    .append("text")
    .attr("x", 14)
    .attr("y", 47)
    .attr("font-size", 17)
    .attr("font-weight", 820)
    .attr("fill", "#172026")
    .text(displayPlaceName(selected));

  badge
    .append("text")
    .attr("x", 14)
    .attr("y", 68)
    .attr("font-size", 12)
    .attr("font-weight", 680)
    .attr("fill", "#39464d")
    .text(medianComparison(selected, medianValue));
}

function drawLegend(svg, color, values, metric, width, height, campuses = []) {
  if (!values.length) return;
  const legendWidth = 260;
  const legendHeight = 10;
  const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(96, ${height - 68})`);
  const scale = d3.scaleLinear().domain(d3.extent(values)).range([0, legendWidth]);
  const axis = d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(metricFormat(metric));
  const gradientId = `housing-gradient-${metric}`;
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.01, 0.1).forEach((t) => {
    gradient
      .append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", color(d3.quantile(values, t)));
  });

  legend
    .append("text")
    .attr("x", 0)
    .attr("y", -12)
    .attr("font-size", 12)
    .attr("font-weight", 750)
    .attr("fill", "#263238")
    .text(metric === "zori" ? "Blended monthly rent" : "Zillow home value index");

  legend
    .append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("rx", 2)
    .attr("fill", `url(#${gradientId})`);

  legend
    .append("g")
    .attr("transform", `translate(0, ${legendHeight})`)
    .call(axis)
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll("line").attr("stroke", "#6a7478"))
    .call((g) => g.selectAll("text").attr("fill", "#394348").attr("font-size", 11));

  const key = svg.append("g").attr("class", "symbol-key").attr("transform", `translate(${width - 230}, ${height - 72})`);

  key.append("path")
    .attr("class", "campus-icon")
    .attr("d", "M-7,-2 L0,-7 L7,-2 Z M-5,-1 H5 V6 H-5 Z M-2,6 V1 H2 V6")
    .attr("transform", "translate(8, 12)")
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.25)
    .attr("stroke-linejoin", "round");

  key.append("text")
    .attr("x", 24)
    .attr("y", 17)
    .attr("fill", "#263238")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text(campuses.length > 1 ? "University campus anchors" : "University campus anchor");

  key.append("circle")
    .attr("cx", 8)
    .attr("cy", 40)
    .attr("r", 4.25)
    .attr("fill", "#172026")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.4);

  key.append("text")
    .attr("x", 24)
    .attr("y", 44)
    .attr("fill", "#263238")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text("Zillow ZIP centroid");
}

function drawMapNote(svg, metric, height, countyName = "this county") {
  const note = metric === "zori"
    ? `ZCTA fills in ${countyName} use blended ZIP rent: HUD 1-4BR SAFMR average, averaged with Zillow ZORI where present.`
    : `ZCTA fills in ${countyName} use direct Zillow ZIP home values; unreported areas are left neutral.`;

  svg
    .append("text")
    .attr("class", "map-note")
    .attr("x", 32)
    .attr("y", height - 102)
    .text(note);
}

function renderTrend(date, selectedPlace) {
  const width = 520;
  const height = 260;
  const margin = {top: 24, right: 18, bottom: 34, left: 56};
  const series = d3.rollups(
    housing,
    (rows) => ({
      date: rows[0].date,
      dateObject: new Date(`${rows[0].date}T00:00:00Z`),
      selected:
        rows.find((d) => d.place === selectedPlace)?.zhvi ??
        rows.find((d) => d.place === countyBundle?.meta?.defaultPlace)?.zhvi ??
        rows[0]?.zhvi,
      median: d3.median(rows, (d) => d.zhvi)
    }),
    (d) => d.date
  ).map(([, value]) => value);
  const selected = series.find((d) => d.date === date);
  const x = d3.scaleUtc(d3.extent(series, (d) => d.dateObject), [margin.left, width - margin.right]);
  const y = d3.scaleLinear(
    [d3.min(series, (d) => Math.min(d.selected, d.median)) * 0.96, d3.max(series, (d) => Math.max(d.selected, d.median)) * 1.02],
    [height - margin.bottom, margin.top]
  );
  const line = d3.line()
    .x((d) => x(d.dateObject))
    .y((d) => y(d.value));
  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", `Line chart comparing ${displayPlaceName(selectedPlace)} home value index to the local median.`)
    .style("width", "100%")
    .style("height", "auto");

  svg.append("text")
    .attr("class", "panel-title")
    .attr("x", margin.left)
    .attr("y", 16)
    .text(`${displayPlaceName(selectedPlace)} vs local median`);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "#9aa4a8"))
    .call((g) => g.selectAll("line").attr("stroke", "#9aa4a8"))
    .call((g) => g.selectAll("text").attr("fill", "#4a555a").attr("font-size", 11));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(compactMoney))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll("line").attr("stroke", "#9aa4a8"))
    .call((g) => g.selectAll("text").attr("fill", "#4a555a").attr("font-size", 11));

  svg.append("g")
    .attr("stroke", "#e2e6e8")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));

  svg.append("path")
    .datum(series.map((d) => ({dateObject: d.dateObject, value: d.median})))
    .attr("fill", "none")
    .attr("stroke", "#718096")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "5 4")
    .attr("d", line);

  svg.append("path")
    .datum(series.map((d) => ({dateObject: d.dateObject, value: d.selected})))
    .attr("fill", "none")
    .attr("stroke", "var(--campus)")
    .attr("stroke-width", 2.8)
    .attr("d", line);

  svg.append("line")
    .attr("x1", x(selected.dateObject))
    .attr("x2", x(selected.dateObject))
    .attr("y1", margin.top)
    .attr("y2", height - margin.bottom)
    .attr("stroke", "#1f2937")
    .attr("stroke-width", 1.1)
    .attr("stroke-opacity", 0.72);

  svg.append("circle")
    .attr("cx", x(selected.dateObject))
    .attr("cy", y(selected.selected))
    .attr("r", 4.5)
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.6);

  svg.append("text")
    .attr("x", width - margin.right - 116)
    .attr("y", margin.top + 8)
    .attr("fill", "var(--campus)")
    .attr("font-weight", 750)
    .attr("font-size", 12)
    .text(displayPlaceName(selectedPlace));

  svg.append("text")
    .attr("x", width - margin.right - 116)
    .attr("y", margin.top + 28)
    .attr("fill", "#53616a")
    .attr("font-weight", 750)
    .attr("font-size", 12)
    .text("Local median");

  return html`<section class="detail-panel">${svg.node()}</section>`;
}

function renderComparisonTable(rows, selectedPlace) {
  const sorted = [...rows].sort((a, b) => b.zhvi - a.zhvi);
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const section = html`
    <section class="detail-panel">
      <h2>Community comparison</h2>
      <table class="comparison-table">
        <colgroup>
          <col class="place-column">
          <col class="value-column">
          <col class="median-column">
          <col class="change-column">
          <col class="rent-column">
        </colgroup>
        <thead>
          <tr>
            <th>Place</th>
            <th>ZHVI</th>
            <th>Vs median</th>
            <th>Change</th>
            <th>Latest rent</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>
  `;
  const tbody = section.querySelector("tbody");

  for (const row of sorted) {
    const tr = document.createElement("tr");
    if (row.place === selectedPlace) tr.className = "is-selected";

    [
      displayPlaceName(row),
      money(row.zhvi),
      medianComparison(row, medianValue),
      percent(row.change),
      row.latestRent ? `${money(row.latestRent)} / mo` : "Not reported"
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });

    tbody.append(tr);
  }

  return section;
}
```
