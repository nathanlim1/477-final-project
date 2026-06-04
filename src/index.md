# California college-town housing stories

<p class="lede">A statewide housing map sets the context, then four college-town examples zoom into ZIP/ZCTA markets around major campuses. The patterns are descriptive: campuses are important anchors, but prices also reflect supply, incomes, commuting, rates, and broader regional demand.</p>

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
    title: "Where do California college-town housing pressures show up?",
    body: "Start with the whole state. County colors show the latest county-level Zillow home value index, while campus markers locate the four places used in the story.",
    keyMessage: "The map is a guide to where to look next, not evidence that a campus by itself caused a price pattern.",
    view: "state",
    controls: [],
    mapTitle: "California housing context",
    mapDetail: "County colors use Zillow home value index values. The highlighted anchors are the four college-town examples below."
  },
  {
    id: "statewide-pattern",
    kicker: "Statewide Pattern",
    title: "High values cluster along the coast and Bay Area, but college towns vary.",
    body: "San Luis Obispo, Davis, Berkeley, and Santa Cruz sit in very different regional housing markets. Seeing them together keeps the local stories in statewide context.",
    keyMessage: "The statewide layer is county-level only, so it stays light on initial load before ZIP geometry is needed.",
    view: "state",
    controls: ["details"],
    mapTitle: "County-level home values",
    mapDetail: "All 58 California counties are visible; the four story counties are outlined for orientation."
  },
  {
    id: "slo",
    kicker: "Example 1",
    title: "San Luis Obispo: Cal Poly sits inside a high-value Central Coast market.",
    body: "The story starts in San Luis Obispo County because the city ZIPs near Cal Poly are explicit focus markets rather than whatever county metadata happens to list first.",
    keyMessage: "Compare San Luis Obispo ZIPs with the rest of the county before drawing conclusions about campus proximity.",
    view: "county",
    countyFips: "06079",
    focusPlace: "93401 San Luis Obispo",
    metric: "zhvi",
    controls: ["details"],
    mapTitle: "San Luis Obispo County ZIP variation",
    mapDetail: "The selected focus is 93401 San Luis Obispo, near Cal Poly. ZCTA fills show ZIP-level home values."
  },
  {
    id: "davis",
    kicker: "Example 2",
    title: "Davis: timeline context matters in a smaller county market.",
    body: "Yolo County puts Davis next to Sacramento-region commute markets and agricultural communities. The timeline shows how the selected ZIP moves relative to the local median.",
    keyMessage: "Growth comparisons are within-county comparisons for the same month, not a causal estimate of UC Davis demand.",
    view: "county",
    countyFips: "06113",
    focusPlace: "95616 Davis",
    metric: "zhvi",
    controls: ["timeline", "details"],
    mapTitle: "Davis and Yolo County over time",
    mapDetail: "The timeline is introduced here so the selected Davis ZIP can be compared with the county's ZIP median."
  },
  {
    id: "berkeley",
    kicker: "Example 3",
    title: "Berkeley: ZIP selection reveals nearby market differences.",
    body: "Alameda County contains Berkeley, Oakland, Fremont, and other very different markets. Selecting a ZIP helps compare the campus area with other local places.",
    keyMessage: "A single county value hides the spread between Berkeley ZIPs and the broader East Bay.",
    view: "county",
    countyFips: "06001",
    focusPlace: "94704 Berkeley",
    metric: "zhvi",
    controls: ["place", "timeline", "details"],
    mapTitle: "Berkeley inside Alameda County",
    mapDetail: "ZIP selection is now enabled. The focus begins at 94704 Berkeley near UC Berkeley."
  },
  {
    id: "santa-cruz",
    kicker: "Example 4",
    title: "Santa Cruz: switch from home values to rents.",
    body: "Santa Cruz County is a coastal housing market with UC Santa Cruz as one anchor among many. Switching the layer to blended rents changes which places stand out.",
    keyMessage: "Rent and home-value layers answer related but different housing questions.",
    view: "county",
    countyFips: "06087",
    focusPlace: "95060 Santa Cruz",
    metric: "zori",
    controls: ["controls", "place", "timeline", "details"],
    mapTitle: "Santa Cruz rent and value contrast",
    mapDetail: "The map layer is switched to blended monthly rent for 95060 Santa Cruz and nearby ZIP/ZCTA markets."
  },
  {
    id: "explore",
    kicker: "Final View",
    title: "Open the full California explorer.",
    body: "The final mode exposes the full set of controls: county search, county clicks, ZIP selection, timeline, metric switching, tooltips, trend chart, and comparison table.",
    keyMessage: "County bundles are still loaded lazily, so the explorer can cover all 58 counties without fetching every ZIP geometry up front.",
    view: "state",
    controls: ["controls", "timeline", "search", "place", "details"],
    mapTitle: "Free exploration mode",
    mapDetail: "Search or click a county to load its ZIP-level bundle on demand. The larger explorer below keeps the same interactions available."
  }
];

const storyCountyFips = ["06079", "06113", "06001", "06087"];
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
  defaultCountyFips: "06079",
  loadCountyBundle
});

const stepById = new Map(storySteps.map((step) => [step.id, step]));

function updateStoryStep(stepId) {
  const step = stepById.get(stepId) || storySteps[0];
  scrolly.classList.toggle("is-final-step", step.id === "explore");
  storyMap.setStep(step);
}

const stopObserving = observeSteps(scrolly.querySelectorAll(".step"), updateStoryStep);
```

<section id="explore-all" class="explorer-section">
  <div class="section-heading">
    <p class="step-kicker">Explore</p>
    <h2>California housing explorer</h2>
    <p>Use the full map to move beyond the four examples. County clicks and search load one county bundle at a time, then the ZIP map, timeline, metric toggle, selected-ZIP trend, comparison table, and tooltips update together.</p>
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
