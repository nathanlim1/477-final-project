# Housing Prices Around California Campuses

<p class="lede">We'll take a look at how housing prices in California counties differ around California colleges.</p>

```js
import * as d3 from "npm:d3";
import {html} from "npm:htl";
import {HousingStoryMap} from "./components/housingMap.js";
import {observeSteps} from "./components/scrolly.js";
```

```js
const caCounties = await FileAttachment("data/ca-counties.geojson").json();
const countyIndex = await FileAttachment("data/ca-county-index.json").json();
const countyHousingRows = await FileAttachment("data/ca-county-housing.csv").csv({typed: true});
const allCampuses = await FileAttachment("data/ca-campuses.csv").csv({typed: true});

async function loadCountyBundle(fips) {
  const basePath = `/_file/data/counties/${fips}`;
  const responses = await Promise.all([
    fetch(`${basePath}/bg.geojson`),
    fetch(`${basePath}/zctas.geojson`),
    fetch(`${basePath}/zip-housing.csv`),
    fetch(`${basePath}/meta.json`)
  ]);

  if (responses.some((response) => !response.ok)) {
    throw new Error(`County bundle for ${fips} is not available.`);
  }

  const [base, zctaBoundaries, housingCsv, meta] = await Promise.all(
    responses.map((response) => response.text())
  );

  return {
    base: JSON.parse(base),
    zctaBoundaries: JSON.parse(zctaBoundaries),
    housingRows: d3.csvParse(housingCsv),
    meta: JSON.parse(meta),
    campuses: allCampuses.filter((campus) => String(campus.county_fips).padStart(5, "0") === fips)
  };
}
```

```js
const storySteps = [
  {
    id: "overview",
    kicker: "Overview",
    title: "Housing Prices Around California Campuses",
    body: "We'll take a look at individual counties to try to find patterns. We'll start with the counties with these following campuses: St. Mary's, San Luis Obispo, Davis, and Berkeley.",
    keyMessage: "Scroll down to continue.",
    view: "state",
    controls: [],
    showHousingLayer: false,
    mapTitle: "California housing context",
    mapDetail: "No housing-price layer yet: the first view only locates the four campus-area anchors before introducing county values."
  },
  {
    id: "statewide-pattern",
    kicker: "Statewide Pattern",
    title: "Where do campus-area housing pressures appear?",
    body: "Let's briefly take a look at housing patterns across campus-anchor counties across the state. Only counties with campus anchors are shown with color.",
    keyMessage: "Scroll down to continue.",
    view: "state",
    controls: ["details"],
    mapTitle: "County-level home values",
    mapDetail: "Campus-anchor counties are active in this statewide map. The four story counties are outlined for orientation."
  },
  {
    id: "st-marys",
    kicker: "Example 1",
    title: "St. Mary's",
    body: "Saint Mary's College sits in Moraga within Contra Costa County, where the campus is part of a broader East Bay housing market with sharp ZIP-level differences.",
    keyMessage: "Scroll down to continue.",
    view: "county",
    countyFips: "06013",
    focusPlace: "94556 Moraga",
    metric: "zhvi",
    controls: ["controls", "details"],
    mapTitle: "St. Mary's",
    mapDetail: "Try hovering over different ZIPs to see details."
  },
  {
    id: "slo",
    kicker: "Example 2",
    title: "Cal Poly",
    body: "Overall San Luis Obispo’s rental prices have increased dramatically. There are some areas with higher housing prices but non-correlating rental prices. Around Cal Poly is the opposite, with higher housing prices but it is difficult to come to a strong conclusion because of the overall high housing prices in the whole region. ",
    keyMessage: "Scroll down to continue.",
    view: "county",
    countyFips: "06079",
    focusPlace: "93401 San Luis Obispo",
    metric: "zhvi",
    controls: ["controls", "timeline", "details"],
    mapTitle: "San Luis Obispo",
    mapDetail: "Try using the timeline to see how prices changed over time."
  },
  {
    id: "davis",
    kicker: "Example 3",
    title: "UC Davis",
    body: "Renting wasn't as popular in this region, but has a longer history around UC Davis. Only more recently has rent been much higher. This seems to correlate with our hypothesis that rent around college campuses doesn't fit the norm of housing patterns.",
    keyMessage: "Scroll down to continue.",
    view: "county",
    countyFips: "06113",
    focusPlace: "95616 Davis",
    metric: "zhvi",
    controls: ["controls", "place", "timeline", "details"],
    mapTitle: "Davis",
    mapDetail: "Individual ZIP selection is now enabled. Try clicking on different ZIPs to see how housing prices differ."
  },
  {
    id: "berkeley",
    kicker: "Example 4",
    title: "UC Berkeley",
    body: "There is a clear hotspot of housing prices and rental prices around Berkeley. It is hard to determine if these are correlated because of UC Berkeley or just the area. We would need more information on where students primarily live around the school because there are hotspots that don’t match the housing prices. ",
    keyMessage: "Scroll down to continue to the final exploration.",
    view: "county",
    countyFips: "06001",
    focusPlace: "94704 Berkeley",
    metric: "zori",
    controls: ["controls", "place", "timeline", "details"],
    mapTitle: "Berkeley",
    mapDetail: "The map layer is switched to blended monthly rent for 94704 Berkeley and nearby ZIP/ZCTA markets."
  }
];

const storyCountyFips = ["06013", "06079", "06113", "06001"];
```

```js
const scrolly = html`<section class="scrolly">
  <div class="graphic" aria-label="Sticky California housing map">
    <div data-map class="story-map"></div>
  </div>
  <div class="steps">
    ${storySteps.map((step, index) => html`<section class="step" data-step=${step.id}>
      <p class="step-kicker">${step.kicker}</p>
      <h2>${step.title}</h2>
      <p>${step.body}</p>
      <p class="key-message">${step.keyMessage}</p>
      ${index === storySteps.length - 1 ? html`<a class="jump-link" href="#explore-all">Go to full explorer</a>` : ""}
    </section>`)}
  </div>
</section>`;

display(scrolly);
```

```js
const storyMap = new HousingStoryMap(scrolly.querySelector("[data-map]"), {
  mode: "story",
  counties: caCounties,
  countyIndex,
  countyHousingRows,
  campuses: allCampuses,
  storyCountyFips,
  defaultCountyFips: "06013",
  loadCountyBundle
});

const stepById = new Map(storySteps.map((step) => [step.id, step]));

function updateStoryStep(stepId) {
  const step = stepById.get(stepId) || storySteps[0];
  storyMap.setStep(step);
}

const stopObserving = observeSteps(scrolly.querySelectorAll(".step"), updateStoryStep);
```

<section id="explore-all" class="explorer-section">
  <div class="section-heading">
    <p class="step-kicker">Explore</p>
    <h2>Campus-county housing explorer</h2>
    <p>Use the map to move beyond the four examples. County clicks and search load one campus-county bundle at a time, then the ZIP map, timeline, metric toggle, selected-ZIP trend, comparison table, and tooltips update together.</p>
  </div>
  <div data-explorer class="explorer-map"></div>
</section>

```js
const explorerMap = new HousingStoryMap(document.querySelector("[data-explorer]"), {
  mode: "explore",
  counties: caCounties,
  countyIndex,
  countyHousingRows,
  campuses: allCampuses,
  storyCountyFips,
  defaultCountyFips: "06079",
  loadCountyBundle
});

invalidation.then(() => {
  stopObserving();
  storyMap.destroy();
  explorerMap.destroy();
});
```

<section class="dataset-integrity">
  <h2>Data notes</h2>

Housing values come from Zillow Research public ZIP-level and county-level ZHVI data through April 2026. Rent uses Zillow ZORI where available and HUD Small Area Fair Market Rent averages where ZIP-level ZORI is missing, so rent coverage is broader but should be read as an index for comparison rather than an exact lease quote.

Geography uses U.S. Census TIGER/Line county boundaries and Census ZIP Code Tabulation Areas. ZCTAs approximate ZIP service areas and do not perfectly match USPS delivery boundaries. Campus markers come from the project campus context file and are used as anchors for interpretation, not as proof of causation.
</section>

<p class="source-note">Sources: Zillow Research ZHVI and ZORI public CSVs; HUD Small Area Fair Market Rents; U.S. Census TIGER/Line county and ZCTA geometry; project campus context data.</p>
