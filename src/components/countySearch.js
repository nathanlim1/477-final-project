export function createCountySearch(container, options) {
  const candidates = buildCountyResults(options.counties, options.countyIndex);
  const state = {
    selected: null,
    onSelect: options.onSelect,
    onClear: options.onClear
  };

  container.innerHTML = "";

  const root = document.createElement("div");
  root.className = "county-search";

  const title = document.createElement("div");
  title.className = "county-search-title";
  title.textContent = "Find a County";

  const input = document.createElement("input");
  input.className = "county-search-input";
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "County name";
  input.setAttribute("aria-label", "Search for a California county");

  const clearButton = document.createElement("button");
  clearButton.className = "county-search-clear";
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.hidden = true;

  const inputRow = document.createElement("div");
  inputRow.className = "county-search-row";
  inputRow.append(input, clearButton);

  const list = document.createElement("div");
  list.className = "county-search-results";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  const note = document.createElement("div");
  note.className = "county-search-note";
  note.textContent = "Search the final map by county.";

  root.append(title, inputRow, list, note);
  container.append(root);

  input.addEventListener("input", () => {
    state.selected = null;
    renderResults(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const firstButton = list.querySelector("button");
      if (firstButton) {
        event.preventDefault();
        firstButton.click();
      }
    }

    if (event.key === "Escape") {
      clear();
    }
  });

  clearButton.addEventListener("click", () => clear());

  function renderResults(query) {
    const matches = findMatches(query, candidates);
    list.innerHTML = "";

    if (!query.trim()) {
      list.hidden = true;
      note.textContent = state.selected
        ? `Focused on ${state.selected.label}.`
        : "Search the final map by county.";
      clearButton.hidden = !state.selected;
      return;
    }

    if (!matches.length) {
      list.hidden = false;
      const empty = document.createElement("div");
      empty.className = "county-search-empty";
      empty.textContent = "No county found.";
      list.append(empty);
      note.textContent = "Try a California county name.";
      clearButton.hidden = false;
      return;
    }

    list.hidden = false;
    clearButton.hidden = false;

    for (const result of matches.slice(0, 8)) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.innerHTML = `
        <span>${escapeHtml(result.label)}</span>
        <small>${escapeHtml(result.detail)}</small>
      `;
      button.addEventListener("click", () => select(result));
      list.append(button);
    }

    note.textContent = "Selecting a county loads its ZIP map on demand.";
  }

  function select(result) {
    state.selected = result;
    input.value = result.label;
    list.hidden = true;
    list.innerHTML = "";
    clearButton.hidden = false;
    note.textContent = `Focused on ${result.label}.`;

    if (typeof state.onSelect === "function") {
      state.onSelect(result);
    }
  }

  function clear(clearOptions = {}) {
    state.selected = null;
    input.value = "";
    list.hidden = true;
    list.innerHTML = "";
    clearButton.hidden = true;
    note.textContent = "Search the final map by county.";

    if (clearOptions.notify !== false && typeof state.onClear === "function") {
      state.onClear();
    }
  }

  return {
    clear,
    destroy() {
      container.innerHTML = "";
    }
  };
}

function buildCountyResults(counties, countyIndex) {
  const featureByFips = new Map((counties.features || []).map((feature) => [feature.properties.GEOID, feature]));
  const metadataByFips = new Map((countyIndex?.counties || []).map((county) => [county.fips, county]));

  return (countyIndex?.counties || []).map((metadata) => {
    const fips = metadata.fips;
    const feature = featureByFips.get(fips);
    const name = metadata.name || feature?.properties?.NAME || fips;
    const shortName = metadata?.shortName || name.replace(/ County$/, "");

    return decorateCandidate({
      type: "county",
      id: fips,
      fips,
      name: shortName,
      label: name,
      detail: metadata?.campusLabel ? `${metadata.campusLabel}; ${metadata.zipCount || 0} ZIP markets` : `${metadata?.zipCount || 0} ZIP markets`,
      geometry: feature?.geometry
    });
  }).filter((candidate) => candidate.geometry);
}

function decorateCandidate(candidate) {
  const normalizedName = normalize(candidate.name);
  const normalizedLabel = normalize(candidate.label);

  return {
    ...candidate,
    normalizedName,
    normalizedLabel,
    searchText: `${normalizedName} ${normalizedLabel}`
  };
}

function findMatches(query, candidates) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, normalizedQuery)
    }))
    .filter((match) => match.score < 100)
    .sort((a, b) => a.score - b.score || a.candidate.label.localeCompare(b.candidate.label))
    .map((match) => match.candidate);
}

function scoreCandidate(candidate, query) {
  if (candidate.normalizedName === query || candidate.normalizedLabel === query) return 0;
  if (candidate.normalizedName.startsWith(query)) return 1;
  if (candidate.normalizedLabel.startsWith(query)) return 2;
  if (candidate.searchText.includes(query)) return 3;
  return 100;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bcounty\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
