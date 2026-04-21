const state = {
  forecast: null,
  mode: "all"
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  sourceLine: document.querySelector("#sourceLine"),
  sourceLink: document.querySelector("#sourceLink"),
  refreshButton: document.querySelector("#refreshButton"),
  statusText: document.querySelector("#statusText"),
  summaryGrid: document.querySelector("#summaryGrid"),
  forecastGrid: document.querySelector("#forecastGrid"),
  darknessTrack: document.querySelector("#darknessTrack"),
  darknessTimes: document.querySelector("#darknessTimes"),
  darknessSummary: document.querySelector("#darknessSummary"),
  legendGrid: document.querySelector("#legendGrid"),
  originalChart: document.querySelector("#originalChart"),
  originalChartLink: document.querySelector("#originalChartLink")
};

const rowWeights = {
  cloud: 0.28,
  ecmwfCloud: 0.14,
  transparency: 0.2,
  seeing: 0.16,
  darkness: 0.12,
  smoke: 0.04,
  wind: 0.04,
  humidity: 0.02
};

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode || "all";
    document.querySelectorAll(".segment").forEach((segment) => {
      segment.classList.toggle("is-active", segment === button);
    });
    renderForecast();
  });
});

elements.refreshButton.addEventListener("click", () => {
  loadForecast(true);
});

loadForecast(false);

async function loadForecast(refresh) {
  setBusy(refresh ? "Refreshing chart data..." : "Fetching latest chart data...");

  try {
    const response = await fetch(`/api/forecast${refresh ? "?refresh=1" : ""}`);
    if (!response.ok) {
      throw new Error(`Local server responded with ${response.status}`);
    }
    state.forecast = await response.json();
    render();
  } catch (error) {
    renderError(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function render() {
  const forecast = state.forecast;
  elements.pageTitle.textContent = forecast.title.replace("Clear Sky Chart", "Clear Sky");
  elements.sourceLink.href = forecast.sourceUrl;
  elements.sourceLine.textContent = [
    forecast.lastUpdated ? `Updated ${forecast.lastUpdated}` : null,
    forecast.coordinates ? `Coordinates ${forecast.coordinates}` : null
  ]
    .filter(Boolean)
    .join(" | ");

  if (forecast.image?.src) {
    elements.originalChart.src = forecast.image.src;
    elements.originalChart.alt = forecast.image.alt || "Original Clear Sky Chart";
    elements.originalChartLink.href = forecast.image.src;
  }

  renderSummary();
  renderForecast();
  renderDarkness();
  renderLegend();
  elements.statusText.textContent = `Fetched ${formatDateTime(forecast.fetchedAt)} from Clear Dark Sky.`;
}

function renderSummary() {
  const forecast = state.forecast;
  const rows = indexRows(forecast.rows);
  const best = findBestWindow(forecast, rows);
  const nextDark = firstDarkSlot(forecast, rows);
  const bestEntries = best?.best ? entriesAtKey(rows, best.best.key) : {};
  const nextEntries = nextDark ? entriesAtKey(rows, nextDark.key) : {};
  const cloud = bestEntries.cloud || nextEntries.cloud;
  const trans = bestEntries.transparency || nextEntries.transparency;
  const seeing = bestEntries.seeing || nextEntries.seeing;
  const dew = dewRisk(bestEntries.humidity || nextEntries.humidity, bestEntries.wind || nextEntries.wind);

  const cards = [
    {
      kicker: "Best Window",
      value: best ? formatWindow(best) : "No dark window",
      meta: best ? `Composite score ${Math.round(best.best.score)} from pulled forecast blocks.` : "Darkness data is unavailable."
    },
    {
      kicker: "Cloud",
      value: cloud?.value || "Unavailable",
      meta: cloud ? formatSlot(cloud) : "No cloud block matched the next dark hour."
    },
    {
      kicker: "Transparency / Seeing",
      value: [trans?.value, seeing?.value].filter(Boolean).join(" / ") || "Unavailable",
      meta: trans || seeing ? formatSlot(trans || seeing) : "No matching transparency or seeing block."
    },
    {
      kicker: "Dew Risk",
      value: dew.label,
      meta: dew.detail
    }
  ];

  elements.summaryGrid.replaceChildren(...cards.map(summaryCard));
}

function renderForecast() {
  const forecast = state.forecast;
  if (!forecast) return;

  const rows = forecast.rows.filter((row) => row.id !== "darkness");
  const visibleSlots = forecast.timeSlots.filter((slot) => state.mode === "all" || isNightSlot(slot, forecast.rows));
  const fragment = document.createDocumentFragment();

  elements.forecastGrid.style.setProperty("--cols", Math.max(visibleSlots.length, 1));
  fragment.appendChild(gridCell("corner", ""));

  visibleSlots.forEach((slot, index) => {
    const cell = gridCell("time-cell", "");
    if (index === 0 || slot.time === "0:00") {
      cell.classList.add("is-day-start");
    }

    const time = document.createElement("span");
    time.className = "time-main";
    time.textContent = slot.time;

    const date = document.createElement("span");
    date.className = "time-date";
    date.textContent = index === 0 || slot.time === "0:00" ? formatDate(slot.date) : "\u00a0";

    cell.append(time, date);
    fragment.appendChild(cell);
  });

  rows.forEach((row) => {
    const rowLabel = gridCell("row-label", "");
    const label = document.createElement("span");
    label.textContent = row.label;
    const cadence = document.createElement("span");
    cadence.className = "row-cadence";
    cadence.textContent = row.cadence;
    rowLabel.append(label, cadence);
    fragment.appendChild(rowLabel);

    const byKey = new Map(row.entries.map((entry) => [entry.key, entry]));
    visibleSlots.forEach((slot) => {
      const entry = byKey.get(slot.key);
      fragment.appendChild(entry ? forecastCell(entry) : emptyCell());
    });
  });

  elements.forecastGrid.replaceChildren(fragment);
}

function renderDarkness() {
  const forecast = state.forecast;
  const darkness = forecast.rows.find((row) => row.id === "darkness");
  if (!darkness) return;

  elements.darknessTrack.style.setProperty("--dark-cols", darkness.entries.length);
  elements.darknessTrack.replaceChildren(
    ...darkness.entries.map((entry) => {
      const segment = document.createElement("span");
      segment.className = "darkness-segment";
      segment.style.setProperty("--cell-bg", entry.color);
      segment.title = `${formatSlot(entry)} | ${entry.details}`;
      return segment;
    })
  );

  const ticks = darkness.entries.filter((entry) => entry.minute === 0 && entry.hour % 4 === 0);
  elements.darknessTimes.style.setProperty("--tick-cols", Math.max(ticks.length, 1));
  elements.darknessTimes.replaceChildren(
    ...ticks.map((entry) => {
      const tick = document.createElement("span");
      tick.textContent = `${formatDate(entry.date)} ${entry.time}`;
      return tick;
    })
  );

  const darkest = darkness.entries
    .filter((entry) => Number.isFinite(entry.metrics?.limitingMag))
    .sort((left, right) => right.metrics.limitingMag - left.metrics.limitingMag)[0];

  elements.darknessSummary.textContent = darkest
    ? `Darkest block: ${formatSlot(darkest)}, limiting mag ${darkest.metrics.limitingMag.toFixed(1)}.`
    : "";
}

function renderLegend() {
  const rows = state.forecast.rows.filter((row) => row.id !== "darkness");
  const groups = rows.map((row) => {
    const group = document.createElement("article");
    group.className = "legend-group";

    const title = document.createElement("h3");
    title.className = "legend-title";
    title.textContent = row.label;

    const chips = document.createElement("div");
    chips.className = "legend-chips";

    const unique = [];
    const seen = new Set();
    row.entries.forEach((entry) => {
      if (!seen.has(entry.value)) {
        seen.add(entry.value);
        unique.push(entry);
      }
    });

    unique.slice(0, 18).forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "legend-chip";
      chip.style.setProperty("--cell-bg", entry.color);
      chip.style.setProperty("--cell-color", entry.textColor);
      chip.textContent = entry.value;
      chips.appendChild(chip);
    });

    group.append(title, chips);
    return group;
  });

  elements.legendGrid.replaceChildren(...groups);
}

function forecastCell(entry) {
  const wrapper = document.createElement("div");
  wrapper.className = "forecast-cell";

  const content = document.createElement(entry.href ? "a" : "span");
  content.className = "cell-link";
  content.style.setProperty("--cell-bg", entry.color);
  content.style.setProperty("--cell-color", entry.textColor);
  content.textContent = shortValue(entry);
  content.title = `${formatSlot(entry)} | ${entry.details}`;
  content.setAttribute("aria-label", `${entry.title}`);

  if (entry.href) {
    content.href = entry.href;
    content.target = "_blank";
    content.rel = "noreferrer";
  }

  wrapper.appendChild(content);
  return wrapper;
}

function emptyCell() {
  const cell = document.createElement("div");
  cell.className = "forecast-cell is-empty";
  return cell;
}

function gridCell(className, text) {
  const cell = document.createElement("div");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function summaryCard(card) {
  const article = document.createElement("article");
  article.className = "summary-card";

  const kicker = document.createElement("p");
  kicker.className = "summary-kicker";
  kicker.textContent = card.kicker;

  const value = document.createElement("p");
  value.className = "summary-value";
  value.textContent = card.value;

  const meta = document.createElement("p");
  meta.className = "summary-meta";
  meta.textContent = card.meta;

  article.append(kicker, value, meta);
  return article;
}

function indexRows(rows) {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        ...row,
        byKey: new Map(row.entries.map((entry) => [entry.key, entry]))
      }
    ])
  );
}

function entriesAtKey(rows, key) {
  return Object.fromEntries(
    Object.entries(rows).map(([id, row]) => [id, row.byKey.get(key)]).filter(([, entry]) => entry)
  );
}

function findBestWindow(forecast, rows) {
  const candidates = forecast.timeSlots
    .filter((slot) => isNightSlot(slot, forecast.rows))
    .map((slot) => {
      const entries = entriesAtKey(rows, slot.key);
      const score = Object.entries(rowWeights).reduce((sum, [id, weight]) => {
        const entry = id === "darkness" ? darknessForSlot(slot, forecast.rows) : entries[id];
        return sum + (entry?.score || 0) * weight;
      }, 0);
      return { slot, key: slot.key, score, entries };
    })
    .filter((candidate) => candidate.entries.cloud);

  if (!candidates.length) {
    return null;
  }

  const best = candidates.slice().sort((left, right) => right.score - left.score)[0];
  const threshold = Math.max(55, best.score - 10);
  const bestIndex = candidates.findIndex((candidate) => candidate.key === best.key);

  let start = bestIndex;
  let end = bestIndex;
  while (start > 0 && candidates[start - 1].score >= threshold && isAdjacentHour(candidates[start - 1].slot, candidates[start].slot)) {
    start -= 1;
  }
  while (
    end < candidates.length - 1 &&
    candidates[end + 1].score >= threshold &&
    isAdjacentHour(candidates[end].slot, candidates[end + 1].slot)
  ) {
    end += 1;
  }

  return {
    best,
    start: candidates[start].slot,
    end: candidates[end].slot
  };
}

function firstDarkSlot(forecast, rows) {
  return forecast.timeSlots.find((slot) => isNightSlot(slot, forecast.rows) && rows.cloud?.byKey.get(slot.key));
}

function isNightSlot(slot, rows) {
  const darkness = darknessForSlot(slot, rows);
  if (!darkness) {
    return slot.hour >= 19 || slot.hour <= 6;
  }
  return (darkness.metrics?.sunAlt ?? 0) < -6 || (darkness.metrics?.limitingMag ?? 0) >= 3;
}

function darknessForSlot(slot, rows) {
  const darkness = rows.find((row) => row.id === "darkness");
  return darkness?.entries.find((entry) => entry.key === slot.key);
}

function isAdjacentHour(left, right) {
  const leftDate = new Date(`${left.date}T${pad(left.hour)}:${pad(left.minute)}:00`);
  const rightDate = new Date(`${right.date}T${pad(right.hour)}:${pad(right.minute)}:00`);
  return rightDate.getTime() - leftDate.getTime() === 60 * 60 * 1000;
}

function dewRisk(humidity, wind) {
  if (!humidity) {
    return { label: "Unavailable", detail: "No matching humidity forecast block." };
  }

  const humidityValue = averageFromText(humidity.value);
  const windValue = wind ? averageFromText(wind.value) : null;
  const stillAir = windValue !== null && windValue <= 11;

  if (humidityValue >= 90 && stillAir) {
    return { label: "High", detail: `${humidity.value} humidity with ${wind.value} wind near the selected window.` };
  }
  if (humidityValue >= 80) {
    return { label: "Elevated", detail: `${humidity.value} humidity near ${formatSlot(humidity)}.` };
  }
  return { label: "Lower", detail: `${humidity.value} humidity near ${formatSlot(humidity)}.` };
}

function shortValue(entry) {
  if (entry.value.startsWith("LM ")) return entry.value;
  return entry.value
    .replace("covered", "")
    .replace("Above average", "Above avg")
    .replace("Below Average", "Below avg")
    .replace("Too cloudy to forecast", "Cloudy")
    .trim();
}

function averageFromText(value) {
  const numbers = [...String(value).matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!numbers.length) return null;
  return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}

function formatWindow(window) {
  if (window.start.key === window.end.key) {
    return formatSlot(window.start);
  }
  if (window.start.date !== window.end.date) {
    return `${formatDate(window.start.date)} ${window.start.time} - ${formatDate(window.end.date)} ${window.end.time}`;
  }
  return `${formatDate(window.start.date)} ${window.start.time}-${window.end.time}`;
}

function formatSlot(entry) {
  return `${formatDate(entry.date)} ${entry.time}`;
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function setBusy(message) {
  elements.refreshButton.disabled = true;
  elements.statusText.textContent = message;
}

function renderError(error) {
  elements.statusText.textContent = "Forecast fetch failed.";
  elements.summaryGrid.replaceChildren();

  const card = document.createElement("article");
  card.className = "summary-card error-panel";
  const kicker = document.createElement("p");
  kicker.className = "summary-kicker";
  kicker.textContent = "Error";
  const value = document.createElement("p");
  value.className = "summary-value";
  value.textContent = "Could not load Clear Dark Sky data";
  const meta = document.createElement("p");
  meta.className = "summary-meta";
  meta.textContent = error instanceof Error ? error.message : String(error);
  card.append(kicker, value, meta);
  elements.summaryGrid.appendChild(card);
}
