import * as d3 from "d3";
import {createCountySearch} from "./countySearch.js";
import {createTimelineSlider} from "./timelineSlider.js";
import {createCaliforniaProjection, featureCollection, fitProjectionState} from "./projection.js";

const metricOptions = new Map([
  ["zhvi", "Home values"],
  ["zori", "Rents"]
]);

export class HousingStoryMap {
  constructor(container, options) {
    this.container = container;
    this.mode = options.mode || "story";
    this.loadCountyBundle = options.loadCountyBundle;
    this.storyCountyFips = new Set(options.storyCountyFips || []);
    this.counties = rewindFeatureCollection(options.counties);
    this.countyFeaturesByFips = new Map(
      this.counties.features.map((feature) => [feature.properties.GEOID, feature])
    );
    this.campuses = normalizeCampuses(options.campuses || []);
    this.countyHousingRows = normalizeCountyHousingRows(options.countyHousingRows || [], this.counties);
    this.countyHousingByFips = d3.group(this.countyHousingRows, (row) => row.fips);
    this.stateDates = Array.from(new Set(this.countyHousingRows.map((row) => row.date))).sort();
    this.stateDate = this.stateDates.at(-1) || null;
    this.campusCountyFips = new Set(this.campuses.map((campus) => campus.county_fips));
    this.countyIndex = normalizeCountyIndex({
      index: options.countyIndex,
      counties: this.counties,
      campuses: this.campuses,
      countyHousingByFips: this.countyHousingByFips,
      includedFips: this.campusCountyFips
    });
    this.countyByFips = new Map(this.countyIndex.counties.map((county) => [county.fips, county]));
    this.activeCountyFips = new Set(this.countyIndex.counties.map((county) => county.fips));
    this.activeCountyFeatures = this.counties.features.filter((feature) =>
      this.activeCountyFips.has(feature.properties.GEOID)
    );
    this.bundleCache = new Map();
    this.bundle = null;
    this.bundleRequestId = 0;
    this.activeStep = null;
    this.ui = new Set(this.mode === "explore" ? ["controls", "timeline", "search", "place", "details"] : []);
    const requestedDefault = options.defaultCountyFips || this.countyIndex.defaultFips || "06079";
    const defaultCountyFips = this.countyByFips.has(requestedDefault)
      ? requestedDefault
      : this.countyIndex.counties[0]?.fips || "06079";
    this.state = {
      view: "state",
      countyFips: defaultCountyFips,
      metric: "zhvi",
      selectedDate: this.stateDate,
      selectedPlace: null
    };
    this.width = 0;
    this.height = 0;
    this.isTransitioning = false;
    this.transitionId = 0;
    this.loadingMessage = "";
    this.resizeTimer = null;
    this.zoomBehavior = null;
    this.zoomTransform = d3.zoomIdentity;
    this.explorerInterfaceVisible = true;

    this.handleResize = () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.resize(), 80);
    };

    this.createDom();
    this.setupZoom();
    this.projection = createCaliforniaProjection(this.counties, 640, 720, 42);
    this.path = d3.geoPath(this.projection);

    this.resizeObserver = "ResizeObserver" in window
      ? new ResizeObserver(this.handleResize)
      : null;
    this.resizeObserver?.observe(this.stage);

    this.resize();
    this.setStateView({transition: false});
  }

  destroy() {
    d3.select(this.container).interrupt("projection");
    this.svg?.interrupt("zoom-control");
    this.svg?.on(".zoom", null);
    this.resizeObserver?.disconnect();
    window.clearTimeout(this.resizeTimer);
    this.timeline?.destroy();
    this.search?.destroy();
    this.container.innerHTML = "";
  }

  resize() {
    const bounds = this.stage.getBoundingClientRect();
    this.width = Math.max(320, Math.round(bounds.width || 640));
    this.height = Math.max(420, Math.round(bounds.height || 720));

    this.svg
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `0 0 ${this.width} ${this.height}`);

    this.background
      .attr("width", this.width)
      .attr("height", this.height);

    this.updateZoomExtent();

    const feature = this.getProjectionFeature();
    const fitted = fitProjectionState(feature, this.width, this.height, this.getPadding());
    this.projection.scale(fitted.scale).translate(fitted.translate);
    this.render();
  }

  setStep(step) {
    this.activeStep = step;
    this.ui = new Set(step.controls || []);
    this.container.dataset.step = step.id;
    this.container.classList.toggle("is-story-final", step.id === "explore");

    if (this.mode === "explore") {
      this.ui = new Set(["controls", "timeline", "search", "place", "details"]);
    }

    if (step.view === "county") {
      this.focusCounty(step.countyFips, {
        metric: step.metric || "zhvi",
        place: step.focusPlace,
        date: step.date || "latest",
        transition: true,
        source: "story"
      });
      return;
    }

    this.setStateView({
      metric: "zhvi",
      countyFips: step.countyFips || this.state.countyFips,
      transition: true
    });
  }

  setStateView(options = {}) {
    this.bundleRequestId += 1;
    this.state.view = "state";
    this.state.metric = "zhvi";
    const countyFips = options.countyFips || this.state.countyFips;
    this.state.countyFips = this.countyByFips.has(countyFips)
      ? countyFips
      : this.countyIndex.counties[0]?.fips || this.state.countyFips;
    this.state.selectedDate = this.stateDate;
    this.state.selectedPlace = null;
    this.bundle = null;
    this.loadingMessage = "";
    this.search?.clear({notify: false});
    this.resetZoom({duration: options.transition === false ? 0 : 180});
    this.syncControls();

    if (options.transition === false) {
      const fitted = fitProjectionState(this.counties, this.width, this.height, this.getPadding());
      this.projection.scale(fitted.scale).translate(fitted.translate);
      this.render();
    } else {
      this.transitionProjection(this.counties, 700);
    }
  }

  async focusCounty(fips, options = {}) {
    const countyFips = normalizeFips(fips);
    if (!this.countyByFips.has(countyFips)) return;

    const requestId = this.bundleRequestId + 1;
    this.bundleRequestId = requestId;
    const isSameCounty = this.bundle?.meta?.fips === countyFips;

    this.state.view = "county";
    this.state.countyFips = countyFips;
    this.state.metric = options.metric || this.state.metric || "zhvi";
    this.loadingMessage = isSameCounty ? "" : `Loading ${this.countyByFips.get(countyFips)?.shortName || "county"} ZIP data...`;
    this.resetZoom({duration: options.transition === false ? 0 : 180});

    if (!isSameCounty) {
      this.bundle = null;
      this.render();
    }

    try {
      const bundle = await this.getCountyBundle(countyFips);
      if (requestId !== this.bundleRequestId) return;

      this.bundle = bundle;
      const date = chooseDate(bundle.dates, options.date || this.state.selectedDate);
      const place = choosePlace(bundle, options.place || this.state.selectedPlace);
      this.state.selectedDate = date;
      this.state.selectedPlace = place;
      this.loadingMessage = "";
      this.syncControls();
      this.transitionProjection(this.getProjectionFeature(), options.transition === false ? 0 : 700);
    } catch (error) {
      console.error(`Failed to load county bundle for ${countyFips}`, error);
      if (requestId !== this.bundleRequestId) return;
      this.loadingMessage = `ZIP data for ${this.countyByFips.get(countyFips)?.shortName || countyFips} is not available.`;
      this.bundle = null;
      this.render();
    }
  }

  setMetric(metric) {
    if (!metricOptions.has(metric)) return;
    this.state.metric = metric;
    this.syncControls();
    this.render();
  }

  setPlace(place) {
    if (!this.bundle || !place) return;
    this.state.selectedPlace = choosePlace(this.bundle, place);
    this.syncControls();
    this.render();
  }

  setDate(date) {
    if (!this.bundle) return;
    this.state.selectedDate = chooseDate(this.bundle.dates, date);
    this.syncControls();
    this.render();
  }

  async getCountyBundle(fips) {
    const countyFips = normalizeFips(fips);
    if (!this.bundleCache.has(countyFips)) {
      this.bundleCache.set(
        countyFips,
        this.loadCountyBundle(countyFips).then((bundle) => normalizeBundle(bundle, countyFips))
      );
    }
    return this.bundleCache.get(countyFips);
  }

  createDom() {
    this.container.classList.add("housing-map", `is-${this.mode}`);
    this.container.innerHTML = "";

    this.stage = document.createElement("div");
    this.stage.className = "housing-map-stage";

    this.svg = d3.select(this.stage)
      .append("svg")
      .attr("class", "housing-map-svg")
      .attr("role", "img")
      .attr("aria-label", "California housing map around college-town counties");

    this.background = this.svg.append("rect").attr("class", "map-background");
    this.mapLayer = this.svg.append("g").attr("class", "map-layer");
    this.baseLayer = this.mapLayer.append("g").attr("class", "base-layer");
    this.countyLayer = this.mapLayer.append("g").attr("class", "county-layer");
    this.zctaLayer = this.mapLayer.append("g").attr("class", "zcta-layer");
    this.highlightLayer = this.mapLayer.append("g").attr("class", "highlight-layer");
    this.campusLayer = this.mapLayer.append("g").attr("class", "campus-layer");
    this.labelLayer = this.mapLayer.append("g").attr("class", "label-layer");
    this.legendLayer = this.svg.append("g").attr("class", "legend-layer");

    this.tooltip = document.createElement("div");
    this.tooltip.className = "housing-tooltip";
    this.tooltip.setAttribute("role", "status");
    this.tooltip.setAttribute("aria-live", "polite");

    this.status = document.createElement("div");
    this.status.className = "housing-map-status";

    this.controls = this.createControls();
    this.zoomControls = this.mode === "explore" ? this.createZoomControls() : null;
    this.visibilityToggle = this.mode === "explore" ? this.createVisibilityToggle() : null;

    this.timelineShell = document.createElement("div");
    this.timelineShell.className = "timeline-shell";
    this.timeline = createTimelineSlider(this.timelineShell, {
      dates: [],
      onChange: (date) => this.setDate(date)
    });

    this.searchShell = document.createElement("div");
    this.searchShell.className = "search-shell";
    this.search = createCountySearch(this.searchShell, {
      counties: this.counties,
      countyIndex: this.countyIndex,
      onSelect: (result) => this.focusCounty(result.fips, {transition: true, source: "search"}),
      onClear: () => this.setStateView({transition: true})
    });

    this.detailStrip = document.createElement("div");
    this.detailStrip.className = "housing-detail-strip";
    this.summaryPanel = document.createElement("div");
    this.summaryPanel.className = "summary-grid";
    this.trendPanel = document.createElement("section");
    this.trendPanel.className = "detail-panel trend-panel";
    this.tablePanel = document.createElement("section");
    this.tablePanel.className = "detail-panel table-panel";
    this.detailStrip.append(this.summaryPanel, this.trendPanel, this.tablePanel);

    this.stage.append(
      this.tooltip,
      this.status,
      this.controls,
      this.timelineShell,
      this.searchShell
    );
    if (this.zoomControls) this.stage.append(this.zoomControls);
    if (this.visibilityToggle) this.stage.append(this.visibilityToggle);
    this.container.append(this.stage, this.detailStrip);
  }

  createControls() {
    const controls = document.createElement("div");
    controls.className = "housing-controls";

    const metricGroup = document.createElement("div");
    metricGroup.className = "segmented-control";
    metricGroup.setAttribute("aria-label", "Map metric");

    this.metricButtons = new Map();
    for (const [metric, label] of metricOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.metric = metric;
      button.textContent = label;
      button.addEventListener("click", () => this.setMetric(metric));
      metricGroup.append(button);
      this.metricButtons.set(metric, button);
    }

    this.stateResetButton = document.createElement("button");
    this.stateResetButton.type = "button";
    this.stateResetButton.className = "state-reset-button";
    this.stateResetButton.textContent = "Statewide map";
    this.stateResetButton.addEventListener("click", () => this.setStateView({transition: true}));

    this.countySelect = document.createElement("select");
    this.countySelect.setAttribute("aria-label", "County");
    for (const county of this.countyIndex.counties) {
      const option = document.createElement("option");
      option.value = county.fips;
      option.textContent = county.shortName;
      this.countySelect.append(option);
    }
    this.countySelect.addEventListener("change", () => {
      this.focusCounty(this.countySelect.value, {transition: true, source: "select"});
    });

    this.placeSelect = document.createElement("select");
    this.placeSelect.setAttribute("aria-label", "ZIP market");
    this.placeSelect.addEventListener("change", () => this.setPlace(this.placeSelect.value));

    const countyLabel = document.createElement("label");
    countyLabel.className = "select-control county-control";
    countyLabel.innerHTML = "<span>County</span>";
    countyLabel.append(this.countySelect);

    const placeLabel = document.createElement("label");
    placeLabel.className = "select-control place-control";
    placeLabel.innerHTML = "<span>ZIP market</span>";
    placeLabel.append(this.placeSelect);

    controls.append(this.stateResetButton, metricGroup, countyLabel, placeLabel);
    return controls;
  }

  createZoomControls() {
    const controls = document.createElement("div");
    controls.className = "zoom-controls";
    controls.setAttribute("aria-label", "Map zoom controls");

    this.zoomInButton = document.createElement("button");
    this.zoomInButton.type = "button";
    this.zoomInButton.textContent = "+";
    this.zoomInButton.setAttribute("aria-label", "Zoom in");
    this.zoomInButton.title = "Zoom in";
    this.zoomInButton.addEventListener("click", () => this.zoomBy(1.35));

    this.zoomOutButton = document.createElement("button");
    this.zoomOutButton.type = "button";
    this.zoomOutButton.textContent = "-";
    this.zoomOutButton.setAttribute("aria-label", "Zoom out");
    this.zoomOutButton.title = "Zoom out";
    this.zoomOutButton.addEventListener("click", () => this.zoomBy(1 / 1.35));

    this.zoomResetButton = document.createElement("button");
    this.zoomResetButton.type = "button";
    this.zoomResetButton.className = "zoom-reset";
    this.zoomResetButton.textContent = "Reset";
    this.zoomResetButton.setAttribute("aria-label", "Reset map zoom and pan");
    this.zoomResetButton.title = "Reset map zoom and pan";
    this.zoomResetButton.addEventListener("click", () => this.resetZoom({duration: 220}));

    controls.append(this.zoomInButton, this.zoomOutButton, this.zoomResetButton);
    return controls;
  }

  createVisibilityToggle() {
    const label = document.createElement("label");
    label.className = "explorer-visibility-toggle";

    this.visibilityCheckbox = document.createElement("input");
    this.visibilityCheckbox.type = "checkbox";
    this.visibilityCheckbox.checked = this.explorerInterfaceVisible;
    this.visibilityCheckbox.addEventListener("change", () => {
      this.explorerInterfaceVisible = this.visibilityCheckbox.checked;
      if (!this.explorerInterfaceVisible) this.hideTooltip();
      this.syncControls();
    });

    const text = document.createElement("span");
    text.textContent = "Show map overlays";

    label.append(this.visibilityCheckbox, text);
    return label;
  }

  setupZoom() {
    if (this.mode !== "explore") return;

    this.zoomBehavior = d3.zoom()
      .scaleExtent([1, 8])
      .filter((event) => {
        if (event.button && event.button !== 0) return false;
        if (event.target.closest?.(".legend-layer")) return false;
        return true;
      })
      .on("start", () => {
        this.hideTooltip();
        this.container.classList.add("is-panning");
      })
      .on("zoom", (event) => {
        this.zoomTransform = event.transform;
        this.applyZoomTransform();
      })
      .on("end", () => {
        this.container.classList.remove("is-panning");
      });

    this.svg.call(this.zoomBehavior);
    this.svg.on("dblclick.zoom", null);
    this.updateZoomExtent();
    this.applyZoomTransform();
  }

  updateZoomExtent() {
    if (!this.zoomBehavior) return;

    this.zoomBehavior
      .extent([[0, 0], [this.width, this.height]])
      .translateExtent([
        [-this.width * 2, -this.height * 2],
        [this.width * 3, this.height * 3]
      ]);
  }

  zoomBy(factor) {
    if (!this.zoomBehavior) return;
    this.hideTooltip();
    this.svg
      .interrupt("zoom-control")
      .transition("zoom-control")
      .duration(180)
      .ease(d3.easeCubicOut)
      .call(this.zoomBehavior.scaleBy, factor);
  }

  resetZoom({duration = 0} = {}) {
    this.zoomTransform = d3.zoomIdentity;
    if (!this.zoomBehavior) {
      this.applyZoomTransform();
      return;
    }

    this.hideTooltip();
    this.svg.interrupt("zoom-control");
    if (!duration) {
      this.svg.call(this.zoomBehavior.transform, d3.zoomIdentity);
      return;
    }

    this.svg
      .transition("zoom-control")
      .duration(duration)
      .ease(d3.easeCubicOut)
      .call(this.zoomBehavior.transform, d3.zoomIdentity);
  }

  applyZoomTransform() {
    this.mapLayer?.attr("transform", this.zoomTransform);
    this.syncZoomControls();
  }

  syncZoomControls() {
    if (!this.zoomControls) return;

    const isZoomed = Math.abs(this.zoomTransform.k - 1) > 0.001
      || Math.abs(this.zoomTransform.x) > 0.5
      || Math.abs(this.zoomTransform.y) > 0.5;

    this.zoomControls.classList.toggle("is-zoomed", isZoomed);
    this.zoomOutButton.disabled = this.zoomTransform.k <= 1.001;
    this.zoomResetButton.disabled = !isZoomed;
  }

  syncControls() {
    this.container.classList.toggle("is-state-view", this.state.view === "state");
    this.container.classList.toggle("is-county-view", this.state.view === "county");
    this.container.classList.toggle("is-map-only", this.mode === "explore" && !this.explorerInterfaceVisible);
    this.container.classList.toggle("is-controls-visible", this.mode === "explore" || this.ui.has("controls"));
    this.container.classList.toggle("is-timeline-visible", this.mode === "explore" || this.ui.has("timeline"));
    this.container.classList.toggle("is-search-visible", this.mode === "explore" || this.ui.has("search"));
    this.container.classList.toggle("is-place-visible", this.mode === "explore" || this.ui.has("place"));
    this.container.classList.toggle("is-details-visible", this.mode === "explore" || this.ui.has("details"));

    if (this.visibilityCheckbox) {
      this.visibilityCheckbox.checked = this.explorerInterfaceVisible;
    }

    for (const [metric, button] of this.metricButtons) {
      button.classList.toggle("is-active", metric === this.state.metric);
      button.disabled = this.state.view === "state" && metric === "zori";
    }

    if (this.stateResetButton) {
      this.stateResetButton.hidden = !(this.mode === "explore" && this.state.view === "county");
    }

    this.countySelect.value = this.state.countyFips;

    const places = this.bundle?.meta?.places || [];
    const previousOptions = Array.from(this.placeSelect.options).map((option) => option.value).join("|");
    const nextOptions = places.join("|");
    if (previousOptions !== nextOptions) {
      this.placeSelect.innerHTML = "";
      for (const place of places) {
        const option = document.createElement("option");
        option.value = place;
        option.textContent = displayPlaceName(place);
        this.placeSelect.append(option);
      }
    }
    if (this.state.selectedPlace) this.placeSelect.value = this.state.selectedPlace;

    if (this.bundle) {
      this.timeline.setDates(this.bundle.dates, this.state.selectedDate, {notify: false});
    } else {
      this.timeline.setDates([], null, {notify: false});
    }
  }

  getProjectionFeature() {
    if (this.state.view === "county" && this.bundle) {
      return this.bundle.base;
    }

    const feature = this.countyFeaturesByFips.get(this.state.countyFips);
    if (this.state.view === "county" && feature) {
      return featureCollection([feature]);
    }

    return this.counties;
  }

  getPadding() {
    if (this.mode === "explore") {
      return this.state.view === "state"
        ? Math.min(this.width, this.height) * 0.08
        : Math.min(this.width, this.height) * 0.13;
    }

    if (this.state.view === "state") {
      return Math.min(this.width, this.height) * 0.1;
    }

    return Math.min(this.width, this.height) * 0.16;
  }

  transitionProjection(feature, duration = 700) {
    const transitionId = this.transitionId + 1;
    this.transitionId = transitionId;

    d3.select(this.container).interrupt("projection");

    const target = fitProjectionState(feature, this.width, this.height, this.getPadding());
    const startScale = this.projection.scale();
    const startTranslate = this.projection.translate();
    const scale = d3.interpolateNumber(startScale, target.scale);
    const translate = d3.interpolateArray(startTranslate, target.translate);

    if (!duration) {
      this.projection.scale(target.scale).translate(target.translate);
      this.render();
      return;
    }

    this.isTransitioning = true;
    this.hideTooltip();

    d3.select(this.container)
      .transition("projection")
      .duration(duration)
      .ease(d3.easeCubicOut)
      .tween("projection", () => {
        return (t) => {
          this.projection.scale(scale(t)).translate(translate(t));
          this.render();
        };
      })
      .on("end", () => {
        if (transitionId !== this.transitionId) return;
        this.isTransitioning = false;
        this.render();
      })
      .on("interrupt", () => {
        if (transitionId !== this.transitionId) return;
        this.isTransitioning = false;
        this.render();
      });
  }

  render() {
    this.syncControls();
    this.path.projection(this.projection);

    if (this.state.view === "county" && this.bundle) {
      this.renderCountyMap();
    } else {
      this.renderStateMap();
    }

    this.renderStatus();
    this.renderDetails();
  }

  renderStateMap() {
    const showHousingLayer = this.shouldShowStateHousingLayer();
    const metricRows = showHousingLayer
      ? this.countyIndex.counties
        .map((county) => ({...county, value: this.countyMetricValue(county.fips)}))
        .filter((county) => county.value != null)
      : [];
    const values = metricRows.map((county) => county.value);
    const color = values.length
      ? d3.scaleSequential(d3.extent(values), d3.interpolateYlGnBu)
      : () => "#d9e6e3";

    this.baseLayer
      .selectAll("path")
      .data(this.counties.features, (feature) => feature.properties.GEOID)
      .join(
        (enter) => enter.append("path").attr("class", "state-county-context"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", this.path)
      .attr("fill", showHousingLayer ? "#edf2f0" : "transparent")
      .attr("stroke", showHousingLayer ? "#d4dfdc" : "#a8bbb6")
      .attr("stroke-width", showHousingLayer ? 0.42 : 0.68)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("pointer-events", "none");
    this.zctaLayer.selectAll("*").remove();
    this.highlightLayer.selectAll("*").remove();
    this.labelLayer.selectAll("*").remove();
    this.campusLayer.selectAll("*").remove();

    this.countyLayer
      .selectAll("path")
      .data(showHousingLayer ? this.activeCountyFeatures : [], (feature) => feature.properties.GEOID)
      .join(
        (enter) => enter.append("path").attr("class", "state-county"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", this.path)
      .attr("data-fips", (feature) => feature.properties.GEOID)
      .attr("fill", (feature) => {
        const value = this.countyMetricValue(feature.properties.GEOID);
        return value == null ? "#edf2f0" : color(value);
      })
      .attr("fill-opacity", (feature) => this.storyCountyFips.has(feature.properties.GEOID) ? 0.98 : 0.78)
      .attr("stroke", (feature) => {
        if (feature.properties.GEOID === this.state.countyFips) return "#172026";
        if (this.storyCountyFips.has(feature.properties.GEOID)) return "#6f4e1f";
        return "#ffffff";
      })
      .attr("stroke-width", (feature) => {
        if (feature.properties.GEOID === this.state.countyFips) return 1.8;
        if (this.storyCountyFips.has(feature.properties.GEOID)) return 1.35;
        return 0.55;
      })
      .attr("vector-effect", "non-scaling-stroke")
      .attr("tabindex", this.isInteractive() ? 0 : null)
      .attr("role", this.isInteractive() ? "button" : null)
      .style("cursor", this.isInteractive() ? "pointer" : "default")
      .on("pointermove", (event, feature) => this.showCountyTooltip(event, feature))
      .on("pointerleave", () => this.hideTooltip())
      .on("click", (_event, feature) => {
        if (this.isInteractive()) {
          this.focusCounty(feature.properties.GEOID, {transition: true, source: "map"});
        }
      })
      .on("keydown", (event, feature) => {
        if (!this.isInteractive()) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.focusCounty(feature.properties.GEOID, {transition: true, source: "keyboard"});
        }
      });

    const campuses = this.visibleCampusesForState();
    const campusPoints = campuses
      .map((campus) => {
        const point = this.projection([campus.longitude, campus.latitude]);
        return point ? {...campus, x: point[0], y: point[1]} : null;
      })
      .filter(Boolean);
    const campusLabels = layoutCampusLabels(campusPoints, {view: "state"});

    const campusGroups = this.campusLayer
      .selectAll("g")
      .data(campusLabels, (campus) => `${campus.county_fips}-${campus.short_label}`)
      .join(
        (enter) => {
          const group = enter.append("g").attr("class", "campus-marker");
          group.append("path").attr("d", "M0,-8 L8,7 L-8,7 Z");
          group.append("text").attr("class", "campus-label");
          return group;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("transform", (campus) => `translate(${campus.x},${campus.y})`)
      .classed("is-story-campus", (campus) => this.storyCountyFips.has(campus.county_fips));

    campusGroups
      .select("path")
      .attr("fill", "var(--campus)")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.4);

    campusGroups
      .select("text")
      .attr("x", (campus) => campus.labelDx)
      .attr("y", (campus) => campus.labelDy)
      .attr("text-anchor", (campus) => campus.labelAnchor)
      .text((campus) => this.storyCountyFips.has(campus.county_fips) ? campus.short_label : "");

    this.drawStateLegend(color, showHousingLayer ? values : []);
  }

  renderCountyMap() {
    const rows = this.currentRows();
    const rowsByPlace = new Map(rows.map((row) => [row.place, row]));
    const selected = rowsByPlace.get(this.state.selectedPlace) || rows[0];
    const values = this.bundle.allMetrics
      .map((row) => metricValue(row, this.state.metric))
      .filter((value) => value != null);
    const color = createColorScale(values, this.state.metric);
    const medianValue = d3.median(rows, (row) => row.zhvi);

    this.countyLayer.selectAll("*").remove();
    this.campusLayer.selectAll("*").remove();

    this.baseLayer
      .selectAll("path")
      .data(this.bundle.base.features, (_feature, index) => index)
      .join(
        (enter) => enter.append("path").attr("class", "county-background"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", this.path)
      .attr("fill", "#edf4f1")
      .attr("stroke", "#c5d3cf")
      .attr("stroke-width", 0.38)
      .attr("vector-effect", "non-scaling-stroke");

    this.zctaLayer
      .selectAll("path")
      .data(this.bundle.zctaBoundaries.features, (feature) => feature.properties.place || feature.properties.GEOID)
      .join(
        (enter) => enter.append("path").attr("class", "zcta-area"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", this.path)
      .attr("data-place", (feature) => feature.properties.place || "")
      .attr("fill", (feature) => {
        const value = metricValue(rowsByPlace.get(feature.properties.place), this.state.metric);
        return value == null ? "#f6f7f5" : color(value);
      })
      .attr("fill-opacity", (feature) => feature.properties.place === selected?.place ? 0.98 : 0.84)
      .attr("stroke", (feature) => {
        if (feature.properties.place === selected?.place) return "#172026";
        return rowsByPlace.has(feature.properties.place) ? "rgba(255,255,255,0.92)" : "transparent";
      })
      .attr("stroke-width", (feature) => feature.properties.place === selected?.place ? 1.55 : 0.42)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("tabindex", (feature) => rowsByPlace.has(feature.properties.place) && this.canSelectPlace() ? 0 : null)
      .attr("role", (feature) => rowsByPlace.has(feature.properties.place) && this.canSelectPlace() ? "button" : null)
      .style("cursor", (feature) => rowsByPlace.has(feature.properties.place) && this.canSelectPlace() ? "pointer" : "default")
      .on("pointermove", (event, feature) => this.showZipTooltip(event, feature, rowsByPlace, medianValue))
      .on("pointerleave", () => this.hideTooltip())
      .on("click", (_event, feature) => {
        if (rowsByPlace.has(feature.properties.place) && this.canSelectPlace()) {
          this.setPlace(feature.properties.place);
        }
      })
      .on("keydown", (event, feature) => {
        if (!rowsByPlace.has(feature.properties.place) || !this.canSelectPlace()) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.setPlace(feature.properties.place);
        }
      });

    const outlineFeature = this.countyFeaturesByFips.get(this.state.countyFips);
    this.highlightLayer
      .selectAll("path.county-outline")
      .data(outlineFeature ? [outlineFeature] : [])
      .join(
        (enter) => enter.append("path").attr("class", "county-outline"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", this.path)
      .attr("fill", "none")
      .attr("stroke", "#172026")
      .attr("stroke-width", 1.4)
      .attr("vector-effect", "non-scaling-stroke");

    this.renderCountyLabels(rows, selected);
    this.renderCountyCampuses();
    this.drawCountyLegend(color, values);
  }

  renderCountyLabels(rows, selected) {
    const anchors = rows
      .map((row) => {
        const point = this.projection([row.longitude, row.latitude]);
        return point ? {...row, x: point[0], y: point[1]} : null;
      })
      .filter(Boolean);
    const highlighted = highAboveMeanPlaces(rows, this.state.metric);
    const suppressedPlaces = campusAdjacentSelectedPlaces(anchors, selected, this.countyCampusesForCurrentView());
    const labels = layoutMapLabels(anchors, selected, highlighted, {suppressedPlaces});
    const labeledPlaces = new Set(labels.map((label) => label.place));
    if (selected?.place) labeledPlaces.add(selected.place);

    this.labelLayer
      .selectAll("circle")
      .data(anchors.filter((anchor) => labeledPlaces.has(anchor.place)), (anchor) => anchor.place)
      .join(
        (enter) => enter.append("circle").attr("class", "anchor-dot"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("cx", (anchor) => anchor.x)
      .attr("cy", (anchor) => anchor.y)
      .attr("r", (anchor) => anchor.place === selected?.place ? 4.6 : 3.4)
      .attr("fill", (anchor) => anchor.place === selected?.place ? "#172026" : "#2f5f58")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.3);

    this.labelLayer
      .selectAll("text.place-label")
      .data(labels, (label) => label.place)
      .join(
        (enter) => enter.append("text").attr("class", "place-label"),
        (update) => update,
        (exit) => exit.remove()
      )
      .classed("is-selected", (label) => label.place === selected?.place)
      .attr("x", (label) => label.labelX)
      .attr("y", (label) => label.labelY)
      .attr("text-anchor", (label) => label.labelAnchor)
      .text((label) => label.label);
  }

  renderCountyCampuses() {
    const campuses = this.countyCampusesForCurrentView();
    const campusPoints = campuses
      .map((campus) => {
        const point = this.projection([campus.longitude, campus.latitude]);
        return point ? {...campus, x: point[0], y: point[1]} : null;
      })
      .filter(Boolean);
    const campusLabels = layoutCampusLabels(campusPoints, {view: "county", countyFips: this.state.countyFips});

    const campusGroups = this.campusLayer
      .selectAll("g")
      .data(campusLabels, (campus) => `${campus.county_fips}-${campus.short_label}`)
      .join(
        (enter) => {
          const group = enter.append("g").attr("class", "campus-marker is-story-campus");
          group.append("circle").attr("class", "campus-halo");
          group.append("path").attr("d", "M0,-11 L10,8 L-10,8 Z");
          group.append("text").attr("class", "campus-label");
          return group;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("transform", (campus) => `translate(${campus.x},${campus.y})`);

    campusGroups
      .select("circle")
      .attr("r", 22)
      .attr("fill", "var(--campus)")
      .attr("opacity", 0.13);

    campusGroups
      .select("path")
      .attr("fill", "var(--campus)")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.8);

    campusGroups
      .select("text")
      .attr("x", (campus) => campus.labelDx)
      .attr("y", (campus) => campus.labelDy)
      .attr("text-anchor", (campus) => campus.labelAnchor)
      .text((campus) => campus.short_label);
  }

  renderStatus() {
    const county = this.countyByFips.get(this.state.countyFips);
    const step = this.activeStep;
    const title = step?.mapTitle || (this.state.view === "state" ? "California housing context" : county?.name || "County ZIP map");
    const detail = this.loadingMessage || step?.mapDetail || this.defaultStatusDetail();

    this.status.innerHTML = `
      <p class="map-kicker">${escapeHtml(step?.kicker || (this.state.view === "state" ? "Statewide" : "County detail"))}</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    `;
  }

  renderDetails() {
    if (this.state.view === "county" && this.bundle) {
      const rows = this.currentRows();
      this.renderCountySummary(rows);
      this.renderTrend(rows);
      this.renderComparisonTable(rows);
      return;
    }

    this.renderStateSummary();
    this.trendPanel.innerHTML = `
      <h2>County timeline</h2>
      <p>Select a county in the final map to load ZIP-level timelines without preloading every ZIP geometry.</p>
    `;
    this.tablePanel.innerHTML = `
      <h2>ZIP comparison</h2>
      <p>The comparison table appears after a county is selected.</p>
    `;
  }

  renderStateSummary() {
    const ranked = this.countyIndex.counties
      .map((county) => ({...county, value: this.countyMetricValue(county.fips)}))
      .filter((county) => county.value != null)
      .sort((a, b) => d3.descending(a.value, b.value));
    const storyCounties = Array.from(this.storyCountyFips)
      .map((fips) => this.countyByFips.get(fips))
      .filter(Boolean);
    const top = ranked[0];

    this.summaryPanel.innerHTML = `
      <div class="stat">
        <span>Statewide layer</span>
        <strong>${ranked.length} counties</strong>
        <em>County ZHVI through ${escapeHtml(dateLabel(this.stateDate))}</em>
      </div>
      <div class="stat">
        <span>Highest county value</span>
        <strong>${escapeHtml(top?.shortName || "-")}</strong>
        <em>${top ? escapeHtml(compactMoney(top.value)) : "Not reported"}</em>
      </div>
      <div class="stat">
        <span>Story examples</span>
        <strong>${storyCounties.length}</strong>
        <em>${escapeHtml(storyCounties.map((county) => county.shortName).join(", "))}</em>
      </div>
    `;
  }

  renderCountySummary(rows) {
    const county = this.countyByFips.get(this.state.countyFips);
    const selected = rows.find((row) => row.place === this.state.selectedPlace) || rows[0];
    const ranked = [...rows].sort((a, b) => d3.descending(a.zhvi, b.zhvi));
    const growthRanked = [...rows].sort((a, b) => d3.descending(a.change, b.change));
    const medianValue = d3.median(rows, (row) => row.zhvi);
    const selectedRank = ranked.findIndex((row) => row.place === selected?.place) + 1;
    const latestRent = selected?.latestRent ?? null;
    const topGrowth = growthRanked[0];

    this.summaryPanel.innerHTML = `
      <div class="stat">
        <span>County</span>
        <strong>${escapeHtml(county?.shortName || "County")}</strong>
        <em>${escapeHtml(county?.campusLabel || "ZIP-level housing markets")}</em>
      </div>
      <div class="stat">
        <span>Selected month</span>
        <strong>${escapeHtml(dateLabel(this.state.selectedDate))}</strong>
        <em>${rows.length} ZIP/ZCTA markets with values</em>
      </div>
      <div class="stat">
        <span>${escapeHtml(displayPlaceName(selected?.place))}</span>
        <strong>${selected ? escapeHtml(money(selected.zhvi)) : "-"}</strong>
        <em>${selected ? escapeHtml(`${signedMoney(selected.zhvi - medianValue)} vs local median`) : ""}</em>
      </div>
      <div class="stat">
        <span>Local rank</span>
        <strong>${selectedRank || "-"} of ${rows.length}</strong>
        <em>${selected ? escapeHtml(`${percent(selected.change)} since ${dateLabel(this.bundle.baselineDate)}`) : ""}</em>
      </div>
      <div class="stat">
        <span>Latest blended rent</span>
        <strong>${latestRent ? `${escapeHtml(money(latestRent))} / mo` : "Not reported"}</strong>
        <em>${selected?.latestRentSource ? escapeHtml(selected.latestRentSource) : "Rent source unavailable"}</em>
      </div>
      <div class="stat">
        <span>Fastest growth</span>
        <strong>${escapeHtml(displayPlaceName(topGrowth?.place))}</strong>
        <em>${topGrowth ? escapeHtml(`${percent(topGrowth.change)} since ${dateLabel(this.bundle.baselineDate)}`) : ""}</em>
      </div>
    `;
  }

  renderTrend(rows) {
    if (!this.bundle || !rows.length) {
      this.trendPanel.innerHTML = "<h2>Timeline</h2><p>No housing series is available for this county.</p>";
      return;
    }

    const width = 520;
    const height = 260;
    const margin = {top: 24, right: 20, bottom: 34, left: 58};
    const selectedPlace = this.state.selectedPlace;
    const series = this.bundle.dates.map((date) => {
      const dateRows = this.bundle.rowsByDate.get(date) || [];
      const selected = dateRows.find((row) => row.place === selectedPlace) || dateRows[0];
      return {
        date,
        dateObject: new Date(`${date}T00:00:00Z`),
        selected: selected?.zhvi ?? null,
        median: d3.median(dateRows, (row) => row.zhvi)
      };
    }).filter((row) => row.selected != null && row.median != null);
    const selectedPoint = series.find((row) => row.date === this.state.selectedDate) || series.at(-1);

    const x = d3.scaleUtc(d3.extent(series, (row) => row.dateObject), [margin.left, width - margin.right]);
    const y = d3.scaleLinear(
      [
        d3.min(series, (row) => Math.min(row.selected, row.median)) * 0.96,
        d3.max(series, (row) => Math.max(row.selected, row.median)) * 1.02
      ],
      [height - margin.bottom, margin.top]
    );
    const line = d3.line()
      .defined((row) => row.value != null)
      .x((row) => x(row.dateObject))
      .y((row) => y(row.value));
    const svg = d3.create("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("role", "img")
      .attr("aria-label", `${displayPlaceName(selectedPlace)} home value compared with the local median`);

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
      .attr("y1", (value) => y(value))
      .attr("y2", (value) => y(value));

    svg.append("path")
      .datum(series.map((row) => ({dateObject: row.dateObject, value: row.median})))
      .attr("fill", "none")
      .attr("stroke", "#718096")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5 4")
      .attr("d", line);

    svg.append("path")
      .datum(series.map((row) => ({dateObject: row.dateObject, value: row.selected})))
      .attr("fill", "none")
      .attr("stroke", "var(--campus)")
      .attr("stroke-width", 2.8)
      .attr("d", line);

    if (selectedPoint) {
      svg.append("line")
        .attr("x1", x(selectedPoint.dateObject))
        .attr("x2", x(selectedPoint.dateObject))
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom)
        .attr("stroke", "#1f2937")
        .attr("stroke-width", 1.1)
        .attr("stroke-opacity", 0.72);

      svg.append("circle")
        .attr("cx", x(selectedPoint.dateObject))
        .attr("cy", y(selectedPoint.selected))
        .attr("r", 4.5)
        .attr("fill", "var(--campus)")
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.6);
    }

    this.trendPanel.innerHTML = "";
    this.trendPanel.append(svg.node());
  }

  renderComparisonTable(rows) {
    if (!rows.length) {
      this.tablePanel.innerHTML = "<h2>ZIP comparison</h2><p>No ZIP rows are available for this month.</p>";
      return;
    }

    const medianValue = d3.median(rows, (row) => row.zhvi);
    const sorted = [...rows].sort((a, b) => d3.descending(a.zhvi, b.zhvi));
    const table = document.createElement("table");
    table.className = "comparison-table";
    table.innerHTML = `
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
    `;
    const tbody = table.querySelector("tbody");

    for (const row of sorted) {
      const tr = document.createElement("tr");
      if (row.place === this.state.selectedPlace) tr.className = "is-selected";

      [
        displayPlaceName(row.place),
        money(row.zhvi),
        `${signedMoney(row.zhvi - medianValue)} vs median`,
        percent(row.change),
        row.latestRent ? `${money(row.latestRent)} / mo` : "Not reported"
      ].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      });

      tbody.append(tr);
    }

    this.tablePanel.innerHTML = "<h2>ZIP comparison</h2>";
    this.tablePanel.append(table);
  }

  drawStateLegend(color, values) {
    this.legendLayer.selectAll("*").remove();
    if (!values.length) return;

    const legendWidth = Math.min(260, this.width - 72);
    const legendHeight = 10;
    const x = 28;
    const y = this.height - 54;
    const scale = d3.scaleLinear(d3.extent(values), [0, legendWidth]);
    const gradientId = `state-gradient-${this.mode}`;
    const defs = this.svg.select("defs").empty() ? this.svg.append("defs") : this.svg.select("defs");
    defs.select(`#${gradientId}`).remove();
    const gradient = defs.append("linearGradient").attr("id", gradientId).attr("x1", "0%").attr("x2", "100%");

    d3.range(0, 1.01, 0.1).forEach((t) => {
      gradient
        .append("stop")
        .attr("offset", `${t * 100}%`)
        .attr("stop-color", color(d3.quantile(values, t)));
    });

    const legend = this.legendLayer.append("g").attr("transform", `translate(${x},${y})`);
    legend.append("text")
      .attr("x", 0)
      .attr("y", -12)
      .attr("font-size", 12)
      .attr("font-weight", 760)
      .attr("fill", "#263238")
      .text("County Zillow home value index");

    legend.append("rect")
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .attr("rx", 2)
      .attr("fill", `url(#${gradientId})`);

    legend.append("g")
      .attr("transform", `translate(0,${legendHeight})`)
      .call(d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(compactMoney))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll("line").attr("stroke", "#6a7478"))
      .call((g) => g.selectAll("text").attr("fill", "#394348").attr("font-size", 11));
  }

  drawCountyLegend(color, values) {
    this.legendLayer.selectAll("*").remove();
    if (!values.length) return;

    const legendWidth = Math.min(260, this.width - 72);
    const legendHeight = 10;
    const x = 28;
    const y = this.height - 54;
    const scale = d3.scaleLinear(d3.extent(values), [0, legendWidth]);
    const gradientId = `county-gradient-${this.mode}-${this.state.metric}`;
    const defs = this.svg.select("defs").empty() ? this.svg.append("defs") : this.svg.select("defs");
    defs.select(`#${gradientId}`).remove();
    const gradient = defs.append("linearGradient").attr("id", gradientId).attr("x1", "0%").attr("x2", "100%");

    d3.range(0, 1.01, 0.1).forEach((t) => {
      gradient
        .append("stop")
        .attr("offset", `${t * 100}%`)
        .attr("stop-color", color(d3.quantile(values, t)));
    });

    const legend = this.legendLayer.append("g").attr("transform", `translate(${x},${y})`);
    legend.append("text")
      .attr("x", 0)
      .attr("y", -12)
      .attr("font-size", 12)
      .attr("font-weight", 760)
      .attr("fill", "#263238")
      .text(this.state.metric === "zori" ? "Blended monthly rent" : "Zillow home value index");

    legend.append("rect")
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .attr("rx", 2)
      .attr("fill", `url(#${gradientId})`);

    legend.append("g")
      .attr("transform", `translate(0,${legendHeight})`)
      .call(d3.axisBottom(scale).ticks(4).tickSize(4).tickFormat(metricFormat(this.state.metric)))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll("line").attr("stroke", "#6a7478"))
      .call((g) => g.selectAll("text").attr("fill", "#394348").attr("font-size", 11));
  }

  showCountyTooltip(event, feature) {
    const fips = feature.properties.GEOID;
    const county = this.countyByFips.get(fips);
    const value = this.countyMetricValue(fips);
    const campusText = county?.campusLabel ? `<p>${escapeHtml(county.campusLabel)}</p>` : "";
    const content = `
      <p class="tooltip-kicker">County</p>
      <h3>${escapeHtml(county?.name || feature.properties.NAME)}</h3>
      <dl>
        <dt>ZHVI</dt><dd>${value == null ? "Not reported" : escapeHtml(compactMoney(value))}</dd>
        <dt>ZIP markets</dt><dd>${county?.zipCount ?? 0}</dd>
      </dl>
      ${campusText}
    `;
    this.showTooltip(content, event);
  }

  showZipTooltip(event, feature, rowsByPlace, medianValue) {
    const row = rowsByPlace.get(feature.properties.place);
    if (!row) {
      this.showTooltip(`
        <p class="tooltip-kicker">ZCTA</p>
        <h3>${escapeHtml(feature.properties.name || feature.properties.GEOID)}</h3>
        <p>Housing data unavailable.</p>
      `, event);
      return;
    }

    const selectedMetric = metricValue(row, this.state.metric);
    const content = `
      <p class="tooltip-kicker">ZIP market</p>
      <h3>${escapeHtml(displayPlaceName(row.place))}</h3>
      <dl>
        <dt>${this.state.metric === "zori" ? "Rent" : "ZHVI"}</dt>
        <dd>${selectedMetric == null ? "Not reported" : escapeHtml(metricFormat(this.state.metric)(selectedMetric))}</dd>
        <dt>Vs median</dt><dd>${escapeHtml(signedMoney(row.zhvi - medianValue))}</dd>
        <dt>Change</dt><dd>${escapeHtml(percent(row.change))}</dd>
      </dl>
    `;
    this.showTooltip(content, event);
  }

  showTooltip(content, event) {
    this.tooltip.innerHTML = content;
    this.tooltip.classList.add("is-visible");
    this.positionTooltip(event);
  }

  hideTooltip() {
    this.tooltip.classList.remove("is-visible");
  }

  positionTooltip(event) {
    const [x, y] = d3.pointer(event, this.stage);
    const offset = 16;
    const padding = 12;
    const bounds = this.stage.getBoundingClientRect();
    const tooltipBounds = this.tooltip.getBoundingClientRect();

    let left = x + offset;
    let top = y - tooltipBounds.height / 2;

    if (left + tooltipBounds.width + padding > bounds.width) {
      left = x - tooltipBounds.width - offset;
    }

    if (top < padding) top = padding;
    if (top + tooltipBounds.height + padding > bounds.height) {
      top = bounds.height - tooltipBounds.height - padding;
    }

    this.tooltip.style.left = `${Math.max(padding, left)}px`;
    this.tooltip.style.top = `${Math.max(padding, top)}px`;
  }

  countyMetricValue(fips) {
    const rows = this.countyHousingByFips.get(normalizeFips(fips)) || [];
    const row = rows.find((entry) => entry.date === this.stateDate) || rows.at(-1);
    return row?.zhvi ?? this.countyByFips.get(normalizeFips(fips))?.latestZhvi ?? null;
  }

  currentRows() {
    if (!this.bundle) return [];
    return this.bundle.annotatedByDate.get(this.state.selectedDate) || this.bundle.annotatedByDate.get(this.bundle.latestDate) || [];
  }

  visibleCampusesForState() {
    if (this.mode === "explore" || this.ui.has("search")) return this.campuses;
    return this.campuses.filter((campus) => this.storyCountyFips.has(campus.county_fips));
  }

  countyCampusesForCurrentView() {
    return this.campuses.filter((campus) => campus.county_fips === this.state.countyFips);
  }

  shouldShowStateHousingLayer() {
    if (this.mode !== "story") return true;
    if (this.state.view !== "state") return true;
    if (!this.activeStep) return false;
    return this.activeStep.showHousingLayer !== false;
  }

  isInteractive() {
    return this.mode === "explore" || this.ui.has("search");
  }

  canSelectPlace() {
    return this.mode === "explore" || this.ui.has("place");
  }

  defaultStatusDetail() {
    if (this.state.view === "state") {
      if (!this.shouldShowStateHousingLayer()) {
        return "Campus markers locate the four examples before the housing-price layer is introduced.";
      }

      return "County colors use Zillow home value index values; campus counties are shown as context, not a causal claim.";
    }

    const county = this.countyByFips.get(this.state.countyFips);
    return `ZIP/ZCTA variation around ${county?.shortName || "this county"} is shown for the selected month.`;
  }
}

function normalizeBundle(bundle, fips) {
  const housingRows = normalizeHousingRows(bundle.housingRows || []);
  const dates = Array.from(new Set(housingRows.map((row) => row.date))).sort();
  const baselineDate = dates[0] || null;
  const latestDate = dates.at(-1) || null;
  const baselineByPlace = new Map(
    housingRows.filter((row) => row.date === baselineDate).map((row) => [row.place, row])
  );
  const latestByPlace = new Map(
    housingRows.filter((row) => row.date === latestDate).map((row) => [row.place, row])
  );
  const annotatedRows = housingRows.map((row) => {
    const baseline = baselineByPlace.get(row.place);
    const latest = latestByPlace.get(row.place);
    return {
      ...row,
      change: baseline?.zhvi ? row.zhvi / baseline.zhvi - 1 : 0,
      latestRent: latest?.blendedRent ?? null,
      latestRentSource: latest?.rentSource ?? null
    };
  });
  const rowsByDate = d3.group(housingRows, (row) => row.date);
  const annotatedByDate = d3.group(annotatedRows, (row) => row.date);
  const metaPlaces = bundle.meta?.places?.length
    ? bundle.meta.places
    : Array.from(new Set(housingRows.map((row) => row.place))).sort(d3.ascending);

  return {
    ...bundle,
    base: rewindFeatureCollection(bundle.base),
    zctaBoundaries: rewindFeatureCollection(bundle.zctaBoundaries),
    housingRows,
    allMetrics: annotatedRows,
    rowsByDate,
    annotatedByDate,
    dates,
    baselineDate,
    latestDate,
    meta: {
      ...bundle.meta,
      fips,
      places: metaPlaces,
      defaultPlace: bundle.meta?.defaultPlace || metaPlaces[0] || ""
    }
  };
}

function normalizeCountyIndex({index, counties, campuses, countyHousingByFips, includedFips}) {
  const existingByFips = new Map((index?.counties || []).map((county) => [county.fips, county]));
  const campusLabels = d3.rollups(
    campuses,
    (rows) => rows.map((row) => row.short_label).slice(0, 2).join(", "),
    (row) => row.county_fips
  );
  const campusLabelByFips = new Map(campusLabels);
  const entries = counties.features
    .filter((feature) => !includedFips || includedFips.has(feature.properties.GEOID))
    .map((feature) => {
      const fips = feature.properties.GEOID;
      const existing = existingByFips.get(fips);
      const latestRow = (countyHousingByFips.get(fips) || []).at(-1);
      const name = existing?.name || feature.properties.NAME;
      return {
        fips,
        name,
        shortName: existing?.shortName || name.replace(/ County$/, ""),
        latestZhvi: existing?.latestZhvi ?? latestRow?.zhvi ?? null,
        zipCount: existing?.zipCount ?? 0,
        campusLabel: existing?.campusLabel || campusLabelByFips.get(fips) || ""
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    counties: entries,
    defaultFips: index?.defaultFips || "06079"
  };
}

function normalizeCountyHousingRows(rows, counties) {
  const countyNameToFips = new Map(
    counties.features.map((feature) => [normalizeCountyName(feature.properties.NAME), feature.properties.GEOID])
  );

  return rows
    .map((row) => {
      const fips = resolveCountyFips(row.fips, countyNameToFips);
      return {
        fips,
        date: normalizeDate(row.date),
        zhvi: optionalNumber(row.zhvi)
      };
    })
    .filter((row) => row.fips && row.date && row.zhvi != null)
    .sort((a, b) => a.fips.localeCompare(b.fips) || a.date.localeCompare(b.date));
}

function resolveCountyFips(value, countyNameToFips) {
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return normalizeFips(text);
  return countyNameToFips.get(normalizeCountyName(text)) || null;
}

function normalizeHousingRows(rows) {
  return rows
    .map((row) => {
      const zori = optionalNumber(row.zori);
      const hudSafmr = optionalNumber(row.hudSafmr);
      const blendedRent = optionalNumber(row.blendedRent) ?? zori ?? hudSafmr;
      return {
        ...row,
        place: String(row.place || "").trim(),
        city: row.city || String(row.place || "").replace(/^\d{5}\s+/, ""),
        latitude: optionalNumber(row.latitude),
        longitude: optionalNumber(row.longitude),
        zhvi: optionalNumber(row.zhvi),
        zori,
        hudSafmr,
        blendedRent,
        date: normalizeDate(row.date),
        hudFiscalYear: row.hudFiscalYear === "" ? null : row.hudFiscalYear,
        rentSource: row.rentSource || (zori != null ? "Zillow ZORI" : hudSafmr != null ? "HUD SAFMR" : "")
      };
    })
    .filter((row) => row.place && row.date && row.zhvi != null && row.latitude != null && row.longitude != null)
    .sort((a, b) => a.place.localeCompare(b.place) || a.date.localeCompare(b.date));
}

function normalizeCampuses(rows) {
  return rows.map((row) => ({
    ...row,
    county_fips: normalizeFips(row.county_fips),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    housed_share: row.housed_share == null || row.housed_share === "" ? null : Number(row.housed_share)
  }));
}

function chooseDate(dates, value) {
  if (!dates.length) return null;
  if (value === "latest" || !value) return dates.at(-1);
  if (dates.includes(value)) return value;
  return dates.at(-1);
}

function choosePlace(bundle, value) {
  const places = bundle.meta?.places || [];
  if (places.includes(value)) return value;
  if (places.includes(bundle.meta?.defaultPlace)) return bundle.meta.defaultPlace;
  return places[0] || "";
}

function metricValue(row, metric) {
  if (!row) return null;
  return metric === "zori" ? row.blendedRent : row.zhvi;
}

function createColorScale(values, metric) {
  if (!values.length) return () => "#dce9e7";
  return d3.scaleSequential(
    d3.extent(values),
    metric === "zori" ? d3.interpolateYlOrRd : d3.interpolateYlGnBu
  );
}

function highAboveMeanPlaces(rows, metric) {
  const values = rows.map((row) => metricValue(row, metric)).filter((value) => value != null);
  const mean = d3.mean(values);
  const deviation = d3.deviation(values);
  if (mean == null || deviation == null) return new Set();
  const cutoff = mean + deviation * 1.6;
  return new Set(rows.filter((row) => metricValue(row, metric) >= cutoff).map((row) => row.place));
}

function layoutMapLabels(anchors, selected, highlightedPlaces, options = {}) {
  const selectedPlace = selected?.place;
  const suppressedPlaces = options.suppressedPlaces || new Set();
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
    if (suppressedPlaces.has(anchor.place)) return;
    const label = mapPlaceLabel(anchor.place);
    if (!label || (usedLabels.has(label) && anchor.place !== selectedPlace)) return;
    for (const [dx, dy] of offsets) {
      const anchorEnd = dx < 0;
      const width = Math.max(28, label.length * 5.8);
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const box = anchorEnd
        ? {x0: x - width, x1: x, y0: y - 11, y1: y + 3}
        : {x0: x, x1: x + width, y0: y - 11, y1: y + 3};
      if (force || !overlaps(box)) {
        chosen.push({...anchor, label, labelX: x, labelY: y, labelAnchor: anchorEnd ? "end" : "start"});
        boxes.push(box);
        usedLabels.add(label);
        return;
      }
    }
  };

  const selectedAnchor = anchors.find((anchor) => anchor.place === selectedPlace);
  if (selectedAnchor) add(selectedAnchor, true);

  const highlighted = anchors
    .filter((anchor) => highlightedPlaces.has(anchor.place) && anchor.place !== selectedPlace)
    .sort((a, b) => d3.descending(metricValue(a, "zhvi"), metricValue(b, "zhvi")));

  for (const anchor of highlighted) {
    add(anchor);
  }

  return chosen;
}

function layoutCampusLabels(campuses, options = {}) {
  const view = options.view || "state";
  const boxes = [];
  const defaultOffsets = view === "state"
    ? [
      [12, -12, "start"],
      [12, 18, "start"],
      [-12, -12, "end"],
      [-12, 18, "end"],
      [0, -24, "middle"],
      [0, 28, "middle"]
    ]
    : [
      [15, -16, "start"],
      [15, 20, "start"],
      [-15, -16, "end"],
      [-15, 20, "end"],
      [0, -28, "middle"],
      [0, 32, "middle"]
    ];
  const overlaps = (box) =>
    boxes.some((existing) =>
      box.x0 < existing.x1 && box.x1 > existing.x0 && box.y0 < existing.y1 && box.y1 > existing.y0
    );

  return campuses.map((campus) => {
    const label = campus.short_label || "";
    const offsets = [...campusLabelOffsets(campus, view), ...defaultOffsets];
    let fallback = null;

    for (const [dx, dy, anchor = "start"] of offsets) {
      const box = textLabelBox(campus.x + dx, campus.y + dy, label, anchor, view === "state" ? 6.3 : 6.6);
      if (!fallback) fallback = {dx, dy, anchor};
      if (!overlaps(box)) {
        boxes.push(box);
        return {...campus, labelDx: dx, labelDy: dy, labelAnchor: anchor};
      }
    }

    const [dx, dy, anchor = "start"] = fallback ? [fallback.dx, fallback.dy, fallback.anchor] : defaultOffsets[0];
    boxes.push(textLabelBox(campus.x + dx, campus.y + dy, label, anchor, view === "state" ? 6.3 : 6.6));
    return {...campus, labelDx: dx, labelDy: dy, labelAnchor: anchor};
  });
}

function campusLabelOffsets(campus, view) {
  if (view === "state") {
    const stateOffsets = new Map([
      ["06013:St. Mary's", [[10, 24, "start"], [0, 34, "middle"], [12, -16, "start"]]],
      ["06001:UC Berkeley", [[-12, 18, "end"], [-12, -14, "end"]]],
      ["06079:Cal Poly", [[12, -14, "start"], [12, 18, "start"]]],
      ["06113:UC Davis", [[12, 18, "start"], [12, -14, "start"]]]
    ]);
    return stateOffsets.get(campusLabelKey(campus)) || [];
  }

  const countyOffsets = new Map([
    ["06013:St. Mary's", [[12, -22, "start"], [14, 24, "start"]]],
    ["06079:Cal Poly", [[16, -22, "start"], [18, 24, "start"]]]
  ]);
  return countyOffsets.get(campusLabelKey(campus)) || [];
}

function campusLabelKey(campus) {
  return `${campus.county_fips}:${campus.short_label}`;
}

function textLabelBox(x, y, label, anchor, characterWidth) {
  const width = Math.max(36, String(label).length * characterWidth);
  const height = 15;
  if (anchor === "end") return {x0: x - width, x1: x, y0: y - height + 3, y1: y + 4};
  if (anchor === "middle") return {x0: x - width / 2, x1: x + width / 2, y0: y - height + 3, y1: y + 4};
  return {x0: x, x1: x + width, y0: y - height + 3, y1: y + 4};
}

function campusAdjacentSelectedPlaces(anchors, selected, campuses) {
  const suppressed = new Set();
  const selectedAnchor = anchors.find((anchor) => anchor.place === selected?.place);
  if (!selectedAnchor) return suppressed;

  const isNearCampus = campuses.some((campus) => {
    const distance = Math.hypot(selectedAnchor.longitude - campus.longitude, selectedAnchor.latitude - campus.latitude);
    return distance < 0.07;
  });

  if (isNearCampus) suppressed.add(selectedAnchor.place);
  return suppressed;
}

function rewindFeatureCollection(collection) {
  return {
    ...collection,
    features: (collection.features || []).map((feature) => ({
      ...feature,
      geometry: rewindGeometry(feature.geometry)
    }))
  };
}

function rewindGeometry(geometry) {
  if (!geometry) return geometry;
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

function displayPlaceName(value) {
  const place = typeof value === "string" ? value : value?.place || "";
  const match = place.match(/^(\d{5})\s+(.+)$/);
  if (match) return `${match[2]} ${match[1]}`;
  return place.replace(/^ZIP\s+/, "");
}

function mapPlaceLabel(value) {
  const label = String(value || "").replace(/^\d{5}\s+/, "").replace(/^ZIP\s+/, "").trim();
  return /^\d{5}$/.test(label) ? "" : label;
}

function metricFormat(metric) {
  return metric === "zori" ? (value) => `${compactMoney(value)} / mo` : compactMoney;
}

function money(value) {
  if (value == null || !Number.isFinite(value)) return "Not reported";
  return d3.format("$,.0f")(value);
}

function compactMoney(value) {
  if (value == null || !Number.isFinite(value)) return "Not reported";
  return d3.format("$.2s")(value).replace("G", "B");
}

function signedMoney(value) {
  if (value == null || !Number.isFinite(value)) return "Not reported";
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

function percent(value) {
  if (value == null || !Number.isFinite(value)) return "Not reported";
  return d3.format(".0%")(value);
}

function dateLabel(date) {
  if (!date) return "";
  const dateObject = date instanceof Date ? date : new Date(`${date}T00:00:00Z`);
  return d3.utcFormat("%b %Y")(dateObject);
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeFips(value) {
  return String(value ?? "").padStart(5, "0");
}

function normalizeCountyName(value) {
  return String(value || "")
    .replace(/\s+County$/i, "")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
