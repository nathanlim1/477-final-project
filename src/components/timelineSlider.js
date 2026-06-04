export function createTimelineSlider(container, options) {
  const state = {
    dates: options.dates || [],
    value: options.value || options.dates?.at(-1) || null,
    onChange: options.onChange
  };

  container.innerHTML = "";

  const root = document.createElement("div");
  root.className = "timeline-control";

  const header = document.createElement("div");
  header.className = "timeline-header";

  const title = document.createElement("div");
  title.className = "timeline-title";
  title.textContent = "Housing Timeline";

  const current = document.createElement("div");
  current.className = "timeline-date";

  header.append(title, current);

  const input = document.createElement("input");
  input.className = "timeline-input";
  input.type = "range";
  input.min = "0";
  input.step = "1";
  input.setAttribute("aria-label", "Selected housing month");

  const extent = document.createElement("div");
  extent.className = "timeline-extent";

  const label = document.createElement("div");
  label.className = "timeline-label";

  root.append(header, input, extent, label);
  container.append(root);

  input.addEventListener("input", () => {
    const index = Number(input.value);
    setValue(state.dates[index], {notify: true});
  });

  function setDates(dates, nextValue, setOptions = {}) {
    state.dates = Array.from(dates || []);
    input.max = String(Math.max(0, state.dates.length - 1));
    input.disabled = state.dates.length < 2;
    extent.innerHTML = state.dates.length
      ? `<span>${formatDate(state.dates[0])}</span><span>${formatDate(state.dates.at(-1))}</span>`
      : "<span>No dates</span><span></span>";
    setValue(nextValue || state.dates.at(-1) || null, setOptions);
  }

  function setValue(nextValue, setOptions = {}) {
    const notify = setOptions.notify !== false;
    if (!state.dates.length) {
      state.value = null;
      input.value = "0";
      current.textContent = "No data";
      label.textContent = "Select a county with ZIP-level housing data.";
      return;
    }

    const value = state.dates.includes(nextValue) ? nextValue : state.dates.at(-1);
    const index = state.dates.indexOf(value);
    state.value = value;
    input.value = String(index);
    current.textContent = formatDate(value);
    label.textContent = `Showing ZIP housing values for ${formatDate(value)}.`;

    if (notify && typeof state.onChange === "function") {
      state.onChange(value);
    }
  }

  setDates(state.dates, state.value, {notify: false});

  return {
    setDates,
    setValue,
    get value() {
      return state.value;
    },
    destroy() {
      container.innerHTML = "";
    }
  };
}

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
