# How does the presence of a college affect housing prices in a college town?

<p class="lede">Examining San Luis Obispo, we can we can see that Cal Poly's growth has led to the college town's disproportionate housing prices--especially when looking at rent prices.</p>

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
    control.dispatchEvent(new Event("input", {bubbles: true}));
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

  control.addEventListener("change", () => control.dispatchEvent(new Event("input", {bubbles: true})));

  return control;
}

function selectControl(options, {label, value}) {
  const select = html`<select>${options.map((option) => html`<option value=${option} selected=${option === value}>${option}</option>`)}</select>`;
  const control = html`<label class="control">${label}${select}</label>`;

  Object.defineProperty(control, "value", {
    get: () => select.value,
    set: (nextValue) => {
      select.value = nextValue;
    }
  });

  select.addEventListener("input", () => control.dispatchEvent(new Event("input", {bubbles: true})));
  select.addEventListener("change", () => control.dispatchEvent(new Event("input", {bubbles: true})));

  return control;
}
```

```js
const base = await FileAttachment("data/slo-bg.geojson").json();
const zctaBoundaries = await FileAttachment("data/slo-zctas.geojson").json();
const housingRows = await FileAttachment("data/slo-zip-housing.csv").csv({typed: true});
const campusRows = await FileAttachment("data/campus-housing.csv").csv({typed: true});
```

```js
const housingTable = aq
  .from(housingRows)
  .derive({
    valueRentRatio: (d) => d.zori ? d.zhvi / (d.zori * 12) : null
  })
  .orderby("place", "date");

const housing = housingTable.objects().map((d) => ({
  ...d,
  date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date
}));
const campus = campusRows[0];
const dates = Array.from(new Set(housing.map((d) => d.date))).sort();
const baselineDate = dates[0];
const latestDate = dates.at(-1);
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
    latestZori: latestByPlace.get(row.place)?.zori ?? null
  };
}

const allMetrics = housing.map((d) => annotateHousingRow(d));

const metricOptions = new Map([
  ["zhvi", "Home value index"],
  ["change", `Change since ${dateLabel(baselineDate)}`]
]);
```

```js
const dateIndex = view(rangeControl([0, dates.length - 1], {
  label: "Timeline",
  step: 1,
  value: dates.length - 1,
  format: (i) => dateLabel(dates[i])
}));

const mapMetric = view(radioControl(["zhvi", "change"], {
  label: "Map layer",
  value: "zhvi",
  format: (value) => metricOptions.get(value)
}));

const selectedPlaceInput = selectControl(
  Array.from(new Set(housing.map((d) => d.place))).sort(d3.ascending),
  {
    label: "Compare ZIP market",
    value: "93401 San Luis Obispo"
  }
);
const selectedPlace = view(selectedPlaceInput);
```

```js
const selectedDate = dates[Number(dateIndex)];
const selectedRows = housing
  .filter((d) => d.date === selectedDate)
  .map((d) => annotateHousingRow(d));
```

<div class="summary-grid">

```js
renderSummary(selectedRows, selectedDate, selectedPlace)
```

</div>

<div class="map-frame">

```js
renderMap(selectedRows, mapMetric, selectedPlace, selectedPlaceInput)
```

</div>

<div class="details-grid">

```js
renderTrend(selectedDate, selectedPlace)
```

```js
renderComparisonTable(selectedRows, selectedPlace)
```

</div>

<p class="source-note">Sources: Zillow Research ZIP-level ZHVI and ZORI public CSVs through 2026-04-30; Census TIGERweb 2020 ZIP Code Tabulation Area geometry; Census TIGERweb block group geometry for the San Luis Obispo County outline; California State Auditor report 2024-111 for Cal Poly on-campus housing presence. ZIP values are mapped to Census ZCTAs, which are generalized Census representations of USPS ZIP Code service areas.</p>

```js
function metricValue(row, metric) {
  return metric === "change" ? row.change : row.zhvi;
}

function metricLabel(metric) {
  return metric === "change" ? `change since ${dateLabel(baselineDate)}` : "home value index";
}

function metricFormat(metric) {
  return metric === "change" ? (value) => percent(value) : compactMoney;
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

function createColorScale(rows, metric) {
  if (metric === "change") {
    const extent = d3.extent(allMetrics, (d) => d.change);
    return d3.scaleSequential(extent, d3.interpolateYlOrRd);
  }

  const extent = d3.extent(allMetrics, (d) => d.zhvi);
  return d3.scaleSequential(extent, d3.interpolateYlGnBu);
}

function renderSummary(rows, date, selectedPlace) {
  const selected = rows.find((d) => d.place === selectedPlace) ?? rows.find((d) => d.place === "93401 San Luis Obispo");
  const ranked = [...rows].sort((a, b) => b.zhvi - a.zhvi);
  const growthRanked = [...rows].sort((a, b) => b.change - a.change);
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const latestRent = latestByPlace.get(selected.place)?.zori;
  const selectedRank = ranked.findIndex((d) => d.place === selected.place) + 1;
  const selectedVsMedian = selected.zhvi - medianValue;
  const topGrowth = growthRanked[0];

  return html`
    <div class="stat">
      <span>Selected month</span>
      <strong>${dateLabel(date)}</strong>
    </div>
    <div class="stat">
      <span>${selected.place} home value</span>
      <strong>${money(selected.zhvi)}</strong>
      <em>${percent(selected.change)} since ${dateLabel(baselineDate)}</em>
    </div>
    <div class="stat">
      <span>${selected.place} local rank</span>
      <strong>${selectedRank} of ${rows.length}</strong>
      <em>${selectedVsMedian >= 0 ? "+" : ""}${money(selectedVsMedian)} vs local median</em>
    </div>
    <div class="stat">
      <span>Latest rent index</span>
      <strong>${latestRent ? `${money(latestRent)} / mo` : "Not reported"}</strong>
      <em>${latestRent ? `${d3.format(".1f")(latestByPlace.get(selected.place).valueRentRatio)}x value-to-annual-rent` : "Zillow rent index unavailable"}</em>
    </div>
    <div class="stat">
      <span>Fastest growth</span>
      <strong>${topGrowth.place}</strong>
      <em>${percent(topGrowth.change)} since ${dateLabel(baselineDate)}</em>
    </div>
  `;
}

function setSelectedPlace(input, place) {
  const select = input.querySelector?.("select");
  const option = select && Array.from(select.options).find((option) => option.textContent === place);

  if (option) {
    select.value = option.value;
    select.dispatchEvent(new Event("input", {bubbles: true}));
    select.dispatchEvent(new Event("change", {bubbles: true}));
    return;
  }

  input.value = place;
  input.dispatchEvent(new Event("input", {bubbles: true}));
  input.dispatchEvent(new Event("change", {bubbles: true}));
}

function medianComparison(row, medianValue) {
  const difference = row.zhvi - medianValue;
  return `${difference >= 0 ? "+" : ""}${money(difference)} vs local median`;
}

function renderMap(rows, metric, selectedPlace, selectedPlaceInput) {
  const width = 980;
  const height = 700;
  const displayBase = rewindFeatureCollection(base);
  const displayZctas = rewindFeatureCollection(zctaBoundaries);
  const rowsByPlace = new Map(rows.map((d) => [d.place, d]));
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const selected = rowsByPlace.get(selectedPlace) ?? rows.find((d) => d.place === "93401 San Luis Obispo");
  const svg = d3
    .create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", `San Luis Obispo County ZCTA map showing ${metricLabel(metric)} around Cal Poly.`)
    .style("display", "block")
    .style("width", "100%")
    .style("height", "auto");

  svg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "var(--map-water)");

  const projection = d3.geoMercator().fitExtent([[22, 18], [width - 22, height - 74]], displayBase);
  const path = d3.geoPath(projection);
  const color = createColorScale(rows, metric);
  const anchors = rows.map((d) => {
    const [x, y] = projection([d.longitude, d.latitude]);
    return {...d, x, y};
  });
  const values = metric === "change"
    ? allMetrics.map((d) => d.change)
    : allMetrics.map((d) => d.zhvi);

  svg
    .append("path")
    .datum({type: "FeatureCollection", features: displayBase.features})
    .attr("d", path)
    .attr("fill", "#eef4f3")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.28)
    .attr("stroke-opacity", 0.58);

  svg
    .append("path")
    .datum({type: "FeatureCollection", features: displayBase.features})
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#516164")
    .attr("stroke-width", 1.1)
    .attr("stroke-opacity", 0.8);

  svg
    .append("g")
    .attr("class", "zcta-boundaries")
    .selectAll("path")
    .data(displayZctas.features)
    .join("path")
    .attr("d", path)
    .attr("fill", (feature) => color(metricValue(rowsByPlace.get(feature.properties.place), metric)))
    .attr("fill-opacity", 0.84)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.35)
    .attr("stroke-opacity", 0.96)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      return `Select ${row.place}; home value ${money(row.zhvi)}, ${medianComparison(row, medianValue)}.`;
    })
    .style("cursor", "pointer")
    .on("click", (event, feature) => setSelectedPlace(selectedPlaceInput, feature.properties.place))
    .on("keydown", (event, feature) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedPlace(selectedPlaceInput, feature.properties.place);
      }
    })
    .append("title")
    .text((feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      const rent = row.latestZori ? `\nLatest rent index: ${money(row.latestZori)} / mo` : "";
      return `${row.place}\n${metricLabel(metric)}: ${metricFormat(metric)(metricValue(row, metric))}\nHome value index: ${money(row.zhvi)}\n${medianComparison(row, medianValue)}\nChange since ${dateLabel(baselineDate)}: ${percent(row.change)}${rent}\n${row.note}`;
    });

  svg
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

  const anchorGroup = svg.append("g").attr("class", "place-anchors");

  anchorGroup
    .selectAll("circle")
    .data(anchors)
    .join("circle")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", 4.25)
    .attr("fill", "#172026")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.4)
    .append("title")
    .text((d) =>
      `${d.place}\nHome value index: ${money(d.zhvi)}\n${medianComparison(d, medianValue)}\nChange since ${dateLabel(baselineDate)}: ${percent(d.change)}`
    );

  anchorGroup
    .selectAll("text")
    .data(anchors)
    .join("text")
    .attr("class", "place-label")
    .attr("x", (d) => d.x + d.label_dx)
    .attr("y", (d) => d.y + d.label_dy)
    .attr("text-anchor", (d) => d.label_dx < 0 ? "end" : "start")
    .text((d) => d.place);

  const campusPoint = projection([campus.longitude, campus.latitude]);
  const campusGroup = svg.append("g").attr("class", "campus-marker").attr("transform", `translate(${campusPoint})`);

  campusGroup
    .append("circle")
    .attr("r", 22)
    .attr("fill", "var(--campus)")
    .attr("opacity", 0.12);

  campusGroup
    .append("path")
    .attr("d", "M0,-11 L10,8 L-10,8 Z")
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.8)
    .append("title")
    .text(`${campus.name}\n${campus.housing_status}\nAbout ${percent(campus.housed_share)} of enrolled students housed on campus\n${campus.note}`);

  campusGroup
    .append("text")
    .attr("class", "campus-label")
    .attr("x", 15)
    .attr("y", -16)
    .text("Cal Poly");

  drawLegend(svg, color, values, metric, width, height);
  drawMapNote(svg, metric, height);
  drawSelectionBadge(svg, selected, medianValue, width);

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
    .text(selected.place);

  badge
    .append("text")
    .attr("x", 14)
    .attr("y", 68)
    .attr("font-size", 12)
    .attr("font-weight", 680)
    .attr("fill", "#39464d")
    .text(medianComparison(selected, medianValue));
}

function drawLegend(svg, color, values, metric, width, height) {
  const legendWidth = 260;
  const legendHeight = 10;
  const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(32, ${height - 42})`);
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
    .text(metric === "change" ? `Change since ${dateLabel(baselineDate)}` : "Zillow home value index");

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

  const key = svg.append("g").attr("class", "symbol-key").attr("transform", `translate(${width - 230}, ${height - 60})`);

  key.append("path")
    .attr("d", "M0,-9 L8,7 L-8,7 Z")
    .attr("transform", "translate(8, 12)")
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.8);

  key.append("text")
    .attr("x", 24)
    .attr("y", 17)
    .attr("fill", "#263238")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text("Cal Poly campus anchor");

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

function drawMapNote(svg, metric, height) {
  const note = metric === "change"
    ? "ZCTA fills use direct Zillow ZIP growth values; unreported county areas are left neutral."
    : "ZCTA fills use direct Zillow ZIP home values; unreported county areas are left neutral.";

  svg
    .append("text")
    .attr("class", "map-note")
    .attr("x", 32)
    .attr("y", height - 76)
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
      selected: rows.find((d) => d.place === selectedPlace)?.zhvi ?? rows.find((d) => d.place === "93401 San Luis Obispo").zhvi,
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
    .attr("aria-label", `Line chart comparing ${selectedPlace} home value index to the local median.`)
    .style("width", "100%")
    .style("height", "auto");

  svg.append("text")
    .attr("class", "panel-title")
    .attr("x", margin.left)
    .attr("y", 16)
    .text(`${selectedPlace} vs local median`);

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
    .text(selectedPlace);

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
      row.place,
      money(row.zhvi),
      medianComparison(row, medianValue),
      percent(row.change),
      row.latestZori ? `${money(row.latestZori)} / mo` : "Not reported"
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
