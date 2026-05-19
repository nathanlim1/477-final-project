# San Luis Obispo Housing Around Cal Poly

<p class="lede">A focused college-town map for San Luis Obispo: use the timeline to see how nearby housing markets changed around Cal Poly, with city and CDP boundaries replacing the earlier bubble-size encoding.</p>

```js
import * as aq from "npm:arquero";
import * as d3 from "npm:d3";
import {html} from "npm:htl";
import * as Inputs from "npm:@observablehq/inputs";
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
```

```js
const base = await FileAttachment("data/slo-bg.geojson").json();
const placeBoundaries = await FileAttachment("data/slo-places.geojson").json();
const housingRows = await FileAttachment("data/slo-housing.csv").csv({typed: true});
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
const dateIndex = view(Inputs.range([0, dates.length - 1], {
  label: "Timeline",
  step: 1,
  value: dates.length - 1,
  format: (i) => dateLabel(dates[i])
}));

const mapMetric = view(Inputs.radio(["zhvi", "change"], {
  label: "Map layer",
  value: "zhvi",
  format: (value) => metricOptions.get(value)
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
renderSummary(selectedRows, selectedDate)
```

</div>

<div class="map-frame">

```js
renderMap(selectedRows, mapMetric)
```

</div>

<div class="details-grid">

```js
renderTrend(selectedDate)
```

```js
renderComparisonTable(selectedRows)
```

</div>

<p class="source-note">Sources: Zillow Research city ZHVI and ZORI public CSVs through 2026-04-30; Census TIGERweb block group geometry for San Luis Obispo County; Census TIGERweb incorporated place and census-designated place boundaries; California State Auditor report 2024-111 for Cal Poly on-campus housing presence. The county-wide surface is an inverse-distance interpolation from the Zillow city/CDP points, while city/CDP outlines show the actual Census boundaries available for the local markets.</p>

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
    return d3.scaleSequential(extent, (t) => d3.interpolateRdYlBu(1 - t));
  }

  const extent = d3.extent(allMetrics, (d) => d.zhvi);
  return d3.scaleSequential(extent, d3.interpolateTurbo);
}

function estimateSurfaceValue(point, anchors, metric) {
  const power = 2.15;
  let weighted = 0;
  let totalWeight = 0;

  for (const anchor of anchors) {
    const dx = point[0] - anchor.x;
    const dy = point[1] - anchor.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 4) return metricValue(anchor, metric);

    const weight = 1 / Math.pow(distance, power);
    weighted += metricValue(anchor, metric) * weight;
    totalWeight += weight;
  }

  return weighted / totalWeight;
}

function renderSummary(rows, date) {
  const slo = rows.find((d) => d.place === "San Luis Obispo");
  const ranked = [...rows].sort((a, b) => b.zhvi - a.zhvi);
  const growthRanked = [...rows].sort((a, b) => b.change - a.change);
  const medianValue = d3.median(rows, (d) => d.zhvi);
  const latestRent = latestByPlace.get("San Luis Obispo")?.zori;
  const selectedRank = ranked.findIndex((d) => d.place === "San Luis Obispo") + 1;
  const topGrowth = growthRanked[0];

  return html`
    <div class="stat">
      <span>Selected month</span>
      <strong>${dateLabel(date)}</strong>
    </div>
    <div class="stat">
      <span>SLO home value</span>
      <strong>${money(slo.zhvi)}</strong>
      <em>${percent(slo.change)} since ${dateLabel(baselineDate)}</em>
    </div>
    <div class="stat">
      <span>SLO local rank</span>
      <strong>${selectedRank} of ${rows.length}</strong>
      <em>${money(slo.zhvi - medianValue)} vs local median</em>
    </div>
    <div class="stat">
      <span>Latest SLO rent index</span>
      <strong>${money(latestRent)} / mo</strong>
      <em>${d3.format(".1f")(latestByPlace.get("San Luis Obispo").valueRentRatio)}x value-to-annual-rent</em>
    </div>
    <div class="stat">
      <span>Fastest growth</span>
      <strong>${topGrowth.place}</strong>
      <em>${percent(topGrowth.change)} since ${dateLabel(baselineDate)}</em>
    </div>
  `;
}

function renderMap(rows, metric) {
  const width = 980;
  const height = 700;
  const displayBase = rewindFeatureCollection(base);
  const displayPlaces = rewindFeatureCollection(placeBoundaries);
  const rowsByPlace = new Map(rows.map((d) => [d.place, d]));
  const svg = d3
    .create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr(
      "aria-label",
      `San Luis Obispo County map showing ${metricLabel(metric)} around Cal Poly.`
    )
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
    .append("g")
    .attr("class", "county-surface")
    .selectAll("path")
    .data(displayBase.features)
    .join("path")
    .attr("d", path)
    .attr("fill", (feature) => {
      const point = path.centroid(feature);
      return color(estimateSurfaceValue(point, anchors, metric));
    })
    .attr("fill-opacity", 0.52)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.32)
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
    .attr("class", "place-boundaries")
    .selectAll("path")
    .data(displayPlaces.features)
    .join("path")
    .attr("d", path)
    .attr("fill", (feature) => color(metricValue(rowsByPlace.get(feature.properties.place), metric)))
    .attr("fill-opacity", 0.84)
    .attr("stroke", (feature) => feature.properties.place === "San Luis Obispo" ? "#111827" : "#ffffff")
    .attr("stroke-width", (feature) => feature.properties.place === "San Luis Obispo" ? 2.3 : 1.35)
    .attr("stroke-opacity", 0.96)
    .append("title")
    .text((feature) => {
      const row = rowsByPlace.get(feature.properties.place);
      const rent = row.latestZori ? `\nLatest rent index: ${money(row.latestZori)} / mo` : "";
      return `${row.place}\n${metricLabel(metric)}: ${metricFormat(metric)(metricValue(row, metric))}\nHome value index: ${money(row.zhvi)}\nChange since ${dateLabel(baselineDate)}: ${percent(row.change)}${rent}\n${row.note}`;
    });

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
      `${d.place}\nHome value index: ${money(d.zhvi)}\nChange since ${dateLabel(baselineDate)}: ${percent(d.change)}`
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
    .attr("r", 34)
    .attr("fill", "var(--campus)")
    .attr("opacity", 0.14);

  campusGroup
    .append("path")
    .attr("d", "M0,-13 L12,9 L-12,9 Z")
    .attr("fill", "var(--campus)")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2.2)
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

  return svg.node();
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
    .text("City/CDP Zillow point");
}

function drawMapNote(svg, metric, height) {
  const note = metric === "change"
    ? "Boundary fill is exact by city/CDP; county surface estimates growth between markets."
    : "Boundary fill is exact by city/CDP; county surface estimates home values between markets.";

  svg
    .append("text")
    .attr("class", "map-note")
    .attr("x", 32)
    .attr("y", height - 76)
    .text(note);
}

function renderTrend(date) {
  const width = 520;
  const height = 260;
  const margin = {top: 24, right: 18, bottom: 34, left: 56};
  const series = d3.rollups(
    housing,
    (rows) => ({
      date: rows[0].date,
      dateObject: new Date(`${rows[0].date}T00:00:00Z`),
      slo: rows.find((d) => d.place === "San Luis Obispo").zhvi,
      median: d3.median(rows, (d) => d.zhvi)
    }),
    (d) => d.date
  ).map(([, value]) => value);
  const selected = series.find((d) => d.date === date);
  const x = d3.scaleUtc(d3.extent(series, (d) => d.dateObject), [margin.left, width - margin.right]);
  const y = d3.scaleLinear(
    [d3.min(series, (d) => Math.min(d.slo, d.median)) * 0.96, d3.max(series, (d) => Math.max(d.slo, d.median)) * 1.02],
    [height - margin.bottom, margin.top]
  );
  const line = d3.line()
    .x((d) => x(d.dateObject))
    .y((d) => y(d.value));
  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "Line chart comparing San Luis Obispo home value index to the local median.")
    .style("width", "100%")
    .style("height", "auto");

  svg.append("text")
    .attr("class", "panel-title")
    .attr("x", margin.left)
    .attr("y", 16)
    .text("SLO vs local median");

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
    .datum(series.map((d) => ({dateObject: d.dateObject, value: d.slo})))
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
    .attr("cy", y(selected.slo))
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
    .text("San Luis Obispo");

  svg.append("text")
    .attr("x", width - margin.right - 116)
    .attr("y", margin.top + 28)
    .attr("fill", "#53616a")
    .attr("font-weight", 750)
    .attr("font-size", 12)
    .text("Local median");

  return html`<section class="detail-panel">${svg.node()}</section>`;
}

function renderComparisonTable(rows) {
  const sorted = [...rows].sort((a, b) => b.zhvi - a.zhvi);

  return html`
    <section class="detail-panel">
      <h2>Community comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Place</th>
            <th>ZHVI</th>
            <th>Change</th>
            <th>Latest rent</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => html`
            <tr class=${row.place === "San Luis Obispo" ? "is-slo" : ""}>
              <td>${row.place}</td>
              <td>${money(row.zhvi)}</td>
              <td>${percent(row.change)}</td>
              <td>${row.latestZori ? `${money(row.latestZori)} / mo` : "Not reported"}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </section>
  `;
}
```
