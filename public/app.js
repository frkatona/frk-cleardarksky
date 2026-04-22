const state = {
  forecast: null,
  mode: "all",
  graphMode: new URLSearchParams(window.location.search).get("graphs") === "1"
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  eyebrowSourceLink: document.querySelector("#eyebrowSourceLink"),
  sourceLine: document.querySelector("#sourceLine"),
  sourceLink: document.querySelector("#sourceLink"),
  refreshButton: document.querySelector("#refreshButton"),
  graphToggle: document.querySelector("#graphToggle"),
  statusText: document.querySelector("#statusText"),
  weatherHero: document.querySelector("#weatherHero"),
  heroIcon: document.querySelector("#heroIcon"),
  heroCondition: document.querySelector("#heroCondition"),
  heroScore: document.querySelector("#heroScore"),
  heroMeta: document.querySelector("#heroMeta"),
  heroNightScores: document.querySelector("#heroNightScores"),
  hourlyStrip: document.querySelector("#hourlyStrip"),
  hourlySummary: document.querySelector("#hourlySummary"),
  summaryGrid: document.querySelector("#summaryGrid"),
  forecastGrid: document.querySelector("#forecastGrid"),
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

elements.graphToggle.checked = state.graphMode;
syncGraphToggle();

elements.refreshButton.addEventListener("click", () => {
  loadForecast(true);
});

elements.graphToggle.addEventListener("change", () => {
  state.graphMode = elements.graphToggle.checked;
  syncGraphToggle();
  renderForecast();
});

installFloatingTooltips();
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
  elements.eyebrowSourceLink.href = forecast.sourceUrl;
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

  renderHero();
  renderHourly();
  renderSummary();
  renderForecast();
  renderLegend();
  elements.statusText.textContent = `Fetched ${formatDateTime(forecast.fetchedAt)} from Clear Dark Sky.`;
}

function renderSummary() {
  if (!elements.summaryGrid) return;

  const { best, bestEntries, nextEntries } = observingContext();
  const cloud = bestEntries.cloud || nextEntries.cloud;
  const trans = bestEntries.transparency || nextEntries.transparency;
  const seeing = bestEntries.seeing || nextEntries.seeing;
  const smoke = bestEntries.smoke || nextEntries.smoke;
  const dew = dewRisk(bestEntries.humidity || nextEntries.humidity, bestEntries.wind || nextEntries.wind);

  const cards = [
    {
      icon: "sparkles",
      kicker: "Best Window",
      value: best ? formatCompactWindow(best) : "No dark window",
      meta: best ? `${Math.round(best.best.score)} / 100 composite score` : "Darkness data is unavailable."
    },
    {
      icon: "cloud",
      kicker: "Cloud",
      value: cloud?.value || "Unavailable",
      meta: cloud ? formatSlot(cloud) : "No cloud block matched the next dark hour."
    },
    {
      icon: "eye",
      kicker: "Clarity / Seeing",
      value: [trans?.value, seeing?.value].filter(Boolean).join(" / ") || "Unavailable",
      meta: trans || seeing ? formatSlot(trans || seeing) : "No matching transparency or seeing block."
    },
    {
      icon: smoke && /no smoke/i.test(smoke.value) ? "sparkles" : "smoke",
      kicker: "Smoke / Dew",
      value: [smoke?.value, dew.label].filter(Boolean).join(" / ") || "Unavailable",
      meta: dew.detail
    }
  ];

  elements.summaryGrid.replaceChildren(...cards.map(summaryCard));
}

function renderHero() {
  const { best, bestEntries, nextEntries } = observingContext();
  const cloud = bestEntries.cloud || nextEntries.cloud;
  const trans = bestEntries.transparency || nextEntries.transparency;
  const seeing = bestEntries.seeing || nextEntries.seeing;
  const score = best ? Math.round(best.best.score) : null;
  const quality = score === null ? "unknown" : score >= 75 ? "good" : score >= 50 ? "mixed" : "poor";

  elements.weatherHero.dataset.quality = quality;
  elements.heroIcon.replaceChildren();
  if (cloud) {
    elements.heroIcon.appendChild(valueIcon(valuePresentation({ id: "cloud" }, cloud).icon));
  }

  elements.heroCondition.textContent = cloud
    ? `${cloud.value}${trans ? `, ${trans.value.toLowerCase()} transparency` : ""}`
    : "Forecast unavailable";
  elements.heroScore.textContent = score === null ? "--" : String(score);
  elements.heroMeta.textContent = [
    best ? `Best observing: ${formatWindow(best)}` : null,
    seeing ? `Seeing ${seeing.value}` : null
  ]
    .filter(Boolean)
    .join(" | ");
  renderHeroNightScores();
}

function renderHeroNightScores() {
  const forecast = state.forecast;
  const rows = indexRows(forecast.rows);
  const groups = nightScoreGroups(forecast, rows);

  if (!groups.length) {
    elements.heroNightScores.replaceChildren();
    return;
  }

  const heading = document.createElement("div");
  heading.className = "hero-night-heading has-tooltip";
  setTooltip(heading, compositeScoreTooltip());
  const title = document.createElement("p");
  title.textContent = "Night scores";
  const range = document.createElement("p");
  range.textContent = `Higher is better | ${groups.length} ${groups.length === 1 ? "night" : "nights"}`;
  heading.append(title, range);

  const strip = document.createElement("div");
  strip.className = "hero-night-strip";
  const highestPeak = Math.max(...groups.map((slots) => maxNightScore(slots)));
  strip.replaceChildren(...groups.map((slots) => nightScoreCard(slots, highestPeak)));

  elements.heroNightScores.replaceChildren(heading, strip);
}

function nightScoreGroups(forecast, rows) {
  const nightSlots = forecast.timeSlots
    .filter((slot) => isNightSlot(slot, forecast.rows))
    .map((slot) => ({
      ...slot,
      score: Math.round(scoreForSlot(slot, forecast, rows))
    }));

  const groups = [];
  let current = [];

  nightSlots.forEach((slot) => {
    const previous = current[current.length - 1];
    if (previous && !isAdjacentHour(previous, slot)) {
      groups.push(current);
      current = [];
    }
    current.push(slot);
  });

  if (current.length) groups.push(current);
  return groups;
}

function nightScoreCard(slots, highestPeak) {
  const card = document.createElement("article");
  card.className = "night-score-card has-tooltip";
  card.tabIndex = 0;
  setTooltip(card, compositeScoreTooltip());
  const peak = slots.slice().sort((left, right) => right.score - left.score)[0];
  card.classList.toggle("is-best", peak.score === highestPeak);

  const header = document.createElement("div");
  header.className = "night-score-header";
  const label = document.createElement("p");
  label.className = "night-score-label";
  label.textContent = nightLabel(slots);
  const value = document.createElement("p");
  value.className = "night-score-peak";
  value.textContent = String(peak.score);
  header.append(label, value);

  const svg = nightScoreSvg(slots);
  const axis = document.createElement("div");
  axis.className = "night-score-axis";
  ["100", "50", "0"].forEach((tick) => {
    const label = document.createElement("span");
    label.textContent = tick;
    axis.appendChild(label);
  });

  const plot = document.createElement("div");
  plot.className = "night-score-plot";
  plot.append(axis, svg);

  const times = document.createElement("div");
  times.className = "night-score-times";
  const start = document.createElement("span");
  start.textContent = slots[0].time;
  const end = document.createElement("span");
  end.textContent = slots[slots.length - 1].time;
  times.append(start, end);

  card.append(header, plot, times);
  return card;
}

function nightScoreSvg(slots) {
  const width = Math.max(180, slots.length * 26);
  const height = 74;
  const top = 14;
  const bottom = 58;
  const xFor = (index) => (slots.length === 1 ? width / 2 : 12 + (index * (width - 24)) / (slots.length - 1));
  const yFor = (score) => bottom - (Math.max(0, Math.min(100, score)) / 100) * (bottom - top);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "night-score-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  [0, 50, 100].forEach((score) => {
    const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guide.setAttribute("class", "night-score-guide");
    guide.setAttribute("x1", "0");
    guide.setAttribute("x2", String(width));
    guide.setAttribute("y1", String(yFor(score)));
    guide.setAttribute("y2", String(yFor(score)));
    svg.appendChild(guide);
  });

  const pointPairs = slots.map((slot, index) => [xFor(index), yFor(slot.score)]);
  if (pointPairs.length > 1) {
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("class", "night-score-area");
    area.setAttribute(
      "d",
      `${pathFromPoints(pointPairs)} L ${pointPairs[pointPairs.length - 1][0].toFixed(2)} ${bottom} L ${pointPairs[0][0].toFixed(2)} ${bottom} Z`
    );
    svg.appendChild(area);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("class", "night-score-line");
    line.setAttribute("d", pathFromPoints(pointPairs));
    svg.appendChild(line);
  }

  const peakScore = maxNightScore(slots);
  slots.forEach((slot, index) => {
    if (slot.score !== peakScore) return;

    const x = xFor(index);
    const y = yFor(slot.score);
    const peakLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    peakLine.setAttribute("class", "night-score-peak-line");
    peakLine.setAttribute("x1", String(x));
    peakLine.setAttribute("x2", String(x));
    peakLine.setAttribute("y1", String(top));
    peakLine.setAttribute("y2", String(bottom));
    svg.appendChild(peakLine);

    const peakTime = document.createElementNS("http://www.w3.org/2000/svg", "text");
    peakTime.setAttribute("class", "night-score-peak-time");
    peakTime.setAttribute("x", String(x));
    peakTime.setAttribute("y", String(Math.max(9, y - 6)));
    peakTime.textContent = slot.time;
    svg.appendChild(peakTime);
  });

  slots.forEach((slot, index) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", slot.score === peakScore ? "night-score-dot is-peak has-tooltip" : "night-score-dot has-tooltip");
    dot.setAttribute("cx", String(xFor(index)));
    dot.setAttribute("cy", String(yFor(slot.score)));
    dot.setAttribute("r", slot.score === peakScore ? "4.5" : "3.6");
    setTooltip(dot, `${formatSlot(slot)}: ${slot.score}. ${compositeScoreTooltip()}`);
    svg.appendChild(dot);
  });

  return svg;
}

function maxNightScore(slots) {
  return Math.max(...slots.map((slot) => slot.score));
}

function compositeScoreTooltip() {
  return "Composite score weights: cloud cover 28%, ECMWF cloud 14%, transparency 20%, seeing 16%, darkness 12%, smoke 4%, wind 4%, humidity 2%. Higher is better.";
}

function nightLabel(slots) {
  const start = slots[0];
  const end = slots[slots.length - 1];
  if (start.date === end.date) return `${formatShortDate(start.date)} night`;
  return `${formatShortDate(start.date)}-${formatShortDate(end.date)}`;
}

function renderHourly() {
  if (!elements.hourlyStrip || !elements.hourlySummary) return;

  const forecast = state.forecast;
  const rows = indexRows(forecast.rows);
  const cloudRow = forecast.rows.find((row) => row.id === "cloud");
  const visibleSlots = forecast.timeSlots.slice(0, 30);
  const cards = visibleSlots.map((slot) => {
    const entries = entriesAtKey(rows, slot.key);
    const cloud = entries.cloud;
    const temperature = entries.temperature;
    const humidity = entries.humidity;
    const score = Math.round(scoreForSlot(slot, forecast, rows));
    const card = document.createElement("article");
    card.className = "hour-card has-tooltip";
    card.tabIndex = 0;
    setTooltip(card, [
      formatSlot(slot),
      cloud ? `Cloud ${cloud.value}` : null,
      entries.transparency ? `Transparency ${entries.transparency.value}` : null,
      entries.seeing ? `Seeing ${entries.seeing.value}` : null
    ]
      .filter(Boolean)
      .join(". "));

    const time = document.createElement("p");
    time.className = "hour-time";
    time.textContent = slot.time;

    const iconWrap = document.createElement("div");
    iconWrap.className = "hour-icon";
    if (cloud && cloudRow) {
      iconWrap.appendChild(valueIcon(valuePresentation(cloudRow, cloud).icon));
    }

    const value = document.createElement("p");
    value.className = "hour-value";
    value.textContent = cloud ? shortCloudValue(cloud.value) : "--";

    const meta = document.createElement("p");
    meta.className = "hour-meta";
    meta.textContent = temperature ? compactRange(temperature.value, "F") : humidity ? compactRange(humidity.value, "%") : `${score}`;

    const bar = document.createElement("span");
    bar.className = "hour-score";
    bar.style.setProperty("--score", `${score}%`);

    card.append(time, iconWrap, value, meta, bar);
    return card;
  });

  const best = findBestWindow(forecast, rows);
  elements.hourlySummary.textContent = best ? `Peak ${Math.round(best.best.score)} near ${formatSlot(best.best.slot)}.` : "";
  elements.hourlyStrip.replaceChildren(...cards);
}

function renderForecast() {
  const forecast = state.forecast;
  if (!forecast) return;

  const rows = rowsWithDarknessFirst(forecast.rows);
  const visibleSlots = forecast.timeSlots.filter((slot) => state.mode === "all" || isNightSlot(slot, forecast.rows));
  const fragment = document.createDocumentFragment();

  elements.forecastGrid.style.setProperty("--cols", Math.max(visibleSlots.length, 1));
  fragment.appendChild(gridCell("corner", ""));

  visibleSlots.forEach((slot, index) => {
    const cell = gridCell("time-cell", "");
    const isDayStart = isDayStartSlot(slot, index);
    if (isDayStart) {
      cell.classList.add("is-day-start");
    }

    const date = document.createElement("span");
    date.className = isDayStart ? "time-date is-day-label" : "time-date";
    date.textContent = isDayStart ? formatChartDate(slot.date) : "\u00a0";

    const time = document.createElement("span");
    time.className = "time-main";
    time.textContent = slot.time;

    cell.append(date, time);
    fragment.appendChild(cell);
  });

  rows.forEach((row) => {
    const rowLabel = gridCell("row-label", "");
    rowLabel.appendChild(rowLabelIcon(row));
    const label = document.createElement("span");
    label.textContent = row.label;
    rowLabel.appendChild(label);
    fragment.appendChild(rowLabel);

    const byKey = new Map(row.entries.map((entry) => [entry.key, entry]));
    if (state.graphMode && isGraphableRow(row)) {
      fragment.appendChild(graphCell(row, visibleSlots, byKey));
    } else {
      visibleSlots.forEach((slot, index) => {
        const entry = byKey.get(slot.key);
        const cell = entry ? forecastCell(entry, row) : emptyCell();
        cell.classList.toggle("is-day-start", isDayStartSlot(slot, index));
        fragment.appendChild(cell);
      });
    }
  });

  elements.forecastGrid.replaceChildren(fragment);
}

function rowsWithDarknessFirst(rows) {
  const darkness = rows.find((row) => row.id === "darkness");
  const rest = rows.filter((row) => row.id !== "darkness");
  return darkness ? [darkness, ...rest] : rest;
}

function isDayStartSlot(slot, index) {
  return index === 0 || slot.time === "0:00";
}

function rowLabelIcon(row) {
  const iconMap = {
    darkness: "moon",
    cloud: "cloud",
    ecmwfCloud: "cloud",
    transparency: "eye",
    seeing: "waves",
    smoke: "flame",
    wind: "wind",
    humidity: "droplet",
    temperature: "thermometer"
  };
  const wrapper = document.createElement("span");
  wrapper.className = "row-label-icon";
  wrapper.appendChild(valueIcon(iconMap[row.id] || "circle"));
  return wrapper;
}

function renderLegend() {
  if (!elements.legendGrid) return;

  const rows = rowsWithDarknessFirst(state.forecast.rows);
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

    unique
      .sort((left, right) => right.score - left.score || legendSortTieBreaker(row, left, right))
      .slice(0, 18)
      .forEach((entry) => {
        const value = valuePresentation(row, entry);
        const chip = document.createElement("span");
        chip.className = "legend-chip has-tooltip";
        chip.style.setProperty("--cell-bg", entry.color);
        chip.style.setProperty("--cell-color", entry.textColor);
        setTooltip(chip, tooltipForEntry(row, entry, value));
        chip.setAttribute("aria-label", `${row.label}: ${entry.value}`);
        chip.appendChild(valueDisplay(value));
        chips.appendChild(chip);
      });

    group.append(title, chips);
    return group;
  });

  elements.legendGrid.replaceChildren(...groups);
}

function legendSortTieBreaker(row, left, right) {
  const leftValue = graphValueFor(row.id, left)?.value;
  const rightValue = graphValueFor(row.id, right)?.value;
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue - rightValue;
  }
  return left.value.localeCompare(right.value, undefined, { numeric: true, sensitivity: "base" });
}

function forecastCell(entry, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "forecast-cell";
  const value = valuePresentation(row, entry);

  const content = document.createElement(entry.href ? "a" : "span");
  content.className = "cell-link has-tooltip";
  content.style.setProperty("--cell-bg", entry.color);
  content.style.setProperty("--cell-color", entry.textColor);
  setTooltip(content, tooltipForEntry(row, entry, value));
  content.setAttribute("aria-label", `${row.label}: ${entry.title}`);
  content.appendChild(valueDisplay(value));

  if (entry.href) {
    content.href = entry.href;
    content.target = "_blank";
    content.rel = "noreferrer";
  }

  wrapper.appendChild(content);
  return wrapper;
}

const graphableRows = new Set(["darkness", "cloud", "ecmwfCloud", "seeing", "smoke", "wind", "humidity", "temperature"]);

function isGraphableRow(row) {
  return graphableRows.has(row.id);
}

function graphCell(row, visibleSlots, byKey) {
  const cell = document.createElement("div");
  cell.className = "forecast-graph-cell";
  cell.style.gridColumn = `span ${Math.max(visibleSlots.length, 1)}`;

  const points = visibleSlots.map((slot, index) => {
    const entry = byKey.get(slot.key);
    const graphValue = entry ? graphValueFor(row.id, entry) : null;
    return {
      index,
      slot,
      entry,
      ...graphValue
    };
  });

  const usablePoints = points.filter((point) => point && Number.isFinite(point.value));
  if (!usablePoints.length) {
    cell.classList.add("is-empty");
    return cell;
  }

  const domain = graphDomain(row.id, usablePoints);
  const width = visibleSlots.length * 100;
  const height = 96;
  const top = 14;
  const bottom = 78;
  const yFor = (value) => {
    const clamped = Math.min(domain.max, Math.max(domain.min, value));
    const ratio = (clamped - domain.min) / (domain.max - domain.min || 1);
    return bottom - ratio * (bottom - top);
  };
  const xFor = (index) => index * 100 + 50;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "forecast-graph");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-label", `${row.label} graph`);

  const baseline = document.createElementNS("http://www.w3.org/2000/svg", "line");
  baseline.setAttribute("class", "graph-baseline");
  baseline.setAttribute("x1", "0");
  baseline.setAttribute("x2", String(width));
  baseline.setAttribute("y1", String(bottom));
  baseline.setAttribute("y2", String(bottom));
  svg.appendChild(baseline);

  usablePoints.forEach((point) => {
    const x = xFor(point.index);
    if (point.isRange) {
      const bar = document.createElementNS("http://www.w3.org/2000/svg", "line");
      bar.setAttribute("class", "graph-range has-tooltip");
      bar.setAttribute("x1", String(x));
      bar.setAttribute("x2", String(x));
      bar.setAttribute("y1", String(yFor(point.max)));
      bar.setAttribute("y2", String(yFor(point.min)));
      setTooltip(bar, graphTooltip(row, point));
      svg.appendChild(bar);
    }
  });

  const segments = graphPathSegments(usablePoints, xFor, yFor);
  segments.forEach((segment) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "graph-line");
    path.setAttribute("d", segment);
    svg.appendChild(path);
  });

  usablePoints.forEach((point) => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("class", point.isRange ? "graph-marker is-range has-tooltip" : "graph-marker has-tooltip");
    marker.setAttribute("cx", String(xFor(point.index)));
    marker.setAttribute("cy", String(yFor(point.value)));
    marker.setAttribute("r", point.isRange ? "3.1" : "3.8");
    setTooltip(marker, graphTooltip(row, point));
    svg.appendChild(marker);
  });

  const scale = document.createElement("div");
  scale.className = "graph-scale";
  const high = document.createElement("span");
  high.textContent = formatGraphValue(row.id, domain.max);
  const low = document.createElement("span");
  low.textContent = formatGraphValue(row.id, domain.min);
  scale.append(high, low);

  const separators = daySeparatorLayer(visibleSlots);
  cell.append(separators, svg, scale);
  return cell;
}

function daySeparatorLayer(visibleSlots) {
  const layer = document.createElement("div");
  layer.className = "graph-day-separators";

  visibleSlots.forEach((slot, index) => {
    if (!isDayStartSlot(slot, index)) return;
    const separator = document.createElement("span");
    separator.className = "graph-day-separator";
    separator.style.gridColumn = String(index + 1);
    layer.appendChild(separator);
  });

  return layer;
}

function graphValueFor(rowId, entry) {
  switch (rowId) {
    case "darkness": {
      const limitingMag = Number(entry.metrics?.limitingMag);
      return Number.isFinite(limitingMag) ? exactGraphValue(limitingMag) : null;
    }
    case "cloud":
    case "ecmwfCloud": {
      const value = percentFromText(entry.value);
      return Number.isFinite(value) ? exactGraphValue(value) : null;
    }
    case "seeing": {
      const rating = Number(entry.value.match(/(\d)\/5/)?.[1]);
      return Number.isFinite(rating) ? exactGraphValue(rating) : null;
    }
    case "smoke": {
      if (/no smoke/i.test(entry.value)) return exactGraphValue(0);
      const amount = Number(entry.value.match(/\d+(?:\.\d+)?/)?.[0]);
      return Number.isFinite(amount) ? exactGraphValue(amount) : null;
    }
    case "wind":
    case "humidity":
    case "temperature":
      return rangeGraphValue(entry.value);
    default:
      return null;
  }
}

function exactGraphValue(value) {
  return {
    min: value,
    max: value,
    value,
    isRange: false
  };
}

function rangeGraphValue(value) {
  const clean = String(value).replace(/\s+/g, " ").trim();
  const numbers = [...clean.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!numbers.length) return null;

  if (/^>/.test(clean)) {
    return {
      min: numbers[0],
      max: numbers[0] + Math.max(5, Math.abs(numbers[0]) * 0.12),
      value: numbers[0],
      isRange: true
    };
  }

  if (/^</.test(clean)) {
    return {
      min: numbers[0] - Math.max(5, Math.abs(numbers[0]) * 0.12),
      max: numbers[0],
      value: numbers[0],
      isRange: true
    };
  }

  if (numbers.length >= 2) {
    const [min, max] = [Math.min(numbers[0], numbers[1]), Math.max(numbers[0], numbers[1])];
    return {
      min,
      max,
      value: (min + max) / 2,
      isRange: true
    };
  }

  return exactGraphValue(numbers[0]);
}

function graphDomain(rowId, points) {
  if (rowId === "cloud" || rowId === "ecmwfCloud") return { min: 0, max: 100 };
  if (rowId === "seeing") return { min: 1, max: 5 };
  if (rowId === "humidity") return { min: 0, max: 100 };

  const lows = points.map((point) => point.min);
  const highs = points.map((point) => point.max);
  let min = Math.min(...lows);
  let max = Math.max(...highs);

  if (rowId === "smoke" || rowId === "wind") {
    min = 0;
    max = Math.max(rowId === "smoke" ? 10 : 20, max);
  }

  if (rowId === "temperature") {
    min = Math.floor(min / 10) * 10;
    max = Math.ceil(max / 10) * 10;
  }

  if (rowId === "darkness") {
    min = Math.floor(min);
    max = Math.ceil(max);
  }

  if (min === max) {
    min -= 1;
    max += 1;
  }

  return { min, max };
}

function graphPathSegments(points, xFor, yFor) {
  const segments = [];
  let current = [];

  points.forEach((point, sequenceIndex) => {
    if (sequenceIndex > 0 && point.index - points[sequenceIndex - 1].index > 1) {
      if (current.length > 1) segments.push(pathFromPoints(current));
      current = [];
    }
    current.push([xFor(point.index), yFor(point.value)]);
  });

  if (current.length > 1) segments.push(pathFromPoints(current));
  return segments;
}

function pathFromPoints(points) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function graphTooltip(row, point) {
  const range = point.isRange ? `${formatGraphValue(row.id, point.min)} to ${formatGraphValue(row.id, point.max)}` : formatGraphValue(row.id, point.value);
  return `${row.label}: ${range}. ${point.entry.value}. ${formatSlot(point.slot)}.`;
}

function formatGraphValue(rowId, value) {
  if (rowId === "cloud" || rowId === "ecmwfCloud" || rowId === "humidity") {
    return `${Math.round(value)}%`;
  }
  if (rowId === "seeing") return `${Math.round(value)}/5`;
  if (rowId === "darkness") return `LM ${value.toFixed(1)}`;
  if (rowId === "wind") return `${Math.round(value)} mph`;
  if (rowId === "temperature") return `${Math.round(value)}F`;
  if (rowId === "smoke") return `${Math.round(value)} ug`;
  return String(Math.round(value));
}

function valueDisplay(value) {
  const display = document.createElement("span");
  display.className = "value-display";
  display.appendChild(valueIcon(value.icon));

  if (value.badge) {
    const badge = document.createElement("span");
    badge.className = "value-badge";
    badge.textContent = value.badge;
    display.appendChild(badge);
  }

  return display;
}

function valueIcon(name) {
  const icon = document.createElement("span");
  icon.className = `value-icon value-icon-${name}`;
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `<svg viewBox="0 0 24 24">${iconPaths[name] || iconPaths.circle}</svg>`;
  return icon;
}

const iconPaths = {
  alert:
    '<path d="M12 3 2.7 20h18.6L12 3Z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path>',
  circle: '<circle cx="12" cy="12" r="7"></circle>',
  cloud:
    '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 12.5 4.5 4.5 0 0 1 17.5 19Z"></path>',
  droplet:
    '<path d="M12 2s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"></path>',
  eye:
    '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  flame:
    '<path d="M12 22a6 6 0 0 0 6-6c0-2.2-1.1-4.1-3.3-5.9.2 1.7-.6 2.8-1.6 3.4.2-3.4-1.3-6.4-4.1-8.5.2 2.8-1.4 4.4-2.7 6.1A7.1 7.1 0 0 0 6 16a6 6 0 0 0 6 6Z"></path><path d="M12 22a2.8 2.8 0 0 0 2.8-2.8c0-1.3-.7-2.4-2.1-3.4 0 1-.5 1.8-1.3 2.2-.1-1.4-.8-2.7-2-3.5.1 1.7-1.2 2.5-1.2 4.6A2.8 2.8 0 0 0 12 22Z"></path>',
  haze:
    '<path d="M4 8h16"></path><path d="M2 12h20"></path><path d="M4 16h16"></path>',
  moon:
    '<path d="M21 14.8A8.5 8.5 0 0 1 9.2 3 7 7 0 1 0 21 14.8Z"></path>',
  smoke:
    '<path d="M5 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"></path><path d="M7 11c1.4 0 1.4-1.5 2.8-1.5s1.4 1.5 2.8 1.5S15 9.5 16.4 9.5"></path><path d="M9 6c1 0 1-1.2 2-1.2s1 1.2 2 1.2"></path>',
  sparkles:
    '<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"></path><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"></path>',
  sun:
    '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.9 4.9 1.4 1.4"></path><path d="m17.7 17.7 1.4 1.4"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m4.9 19.1 1.4-1.4"></path><path d="m17.7 6.3 1.4-1.4"></path>',
  thermometer:
    '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"></path><path d="M12 8v8"></path>',
  waves:
    '<path d="M3 8c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"></path><path d="M3 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"></path><path d="M3 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"></path>',
  wind:
    '<path d="M3 8h11a3 3 0 1 0-3-3"></path><path d="M3 13h15a3 3 0 1 1-3 3"></path><path d="M3 18h7"></path>'
};

function valuePresentation(row, entry) {
  switch (row.id) {
    case "darkness":
      return darknessPresentation(entry);
    case "cloud":
    case "ecmwfCloud":
      return cloudPresentation(entry);
    case "transparency":
      return transparencyPresentation(entry);
    case "seeing":
      return seeingPresentation(entry);
    case "smoke":
      return smokePresentation(entry);
    case "wind":
      return {
        icon: "wind",
        badge: compactRange(entry.value, ""),
        description: windDescription(entry.value)
      };
    case "humidity":
      return {
        icon: "droplet",
        badge: compactRange(entry.value, "%"),
        description: humidityDescription(entry.value)
      };
    case "temperature":
      return {
        icon: "thermometer",
        badge: compactRange(entry.value, "F"),
        description: temperatureDescription(entry.value)
      };
    default:
      return {
        icon: "circle",
        badge: compactValue(entry.value),
        description: entry.value
      };
  }
}

function darknessPresentation(entry) {
  const limitingMag = entry.metrics?.limitingMag;
  const sunAlt = entry.metrics?.sunAlt;
  return {
    icon: Number.isFinite(sunAlt) && sunAlt > -6 ? "sun" : "moon",
    badge: Number.isFinite(limitingMag) ? limitingMag.toFixed(1) : compactValue(entry.value),
    description: darknessDescription(entry)
  };
}

function darknessDescription(entry) {
  const limitingMag = entry.metrics?.limitingMag;
  const sunAlt = entry.metrics?.sunAlt;
  const moonIllum = entry.metrics?.moonIllum;
  const details = [];

  if (Number.isFinite(limitingMag)) details.push(`limiting magnitude ${limitingMag.toFixed(1)}`);
  if (Number.isFinite(sunAlt)) details.push(`sun altitude ${sunAlt.toFixed(1)} deg`);
  if (Number.isFinite(moonIllum)) details.push(`moon ${Math.round(moonIllum)}% illuminated`);

  let quality = "Darkness data from the Clear Dark Sky chart";
  if (Number.isFinite(sunAlt) && sunAlt > 0) {
    quality = "Daylight; stars are washed out";
  } else if (Number.isFinite(sunAlt) && sunAlt > -6) {
    quality = "Civil twilight; only bright targets are practical";
  } else if (Number.isFinite(limitingMag) && limitingMag >= 5.5) {
    quality = "Astronomically dark; faint targets are favored";
  } else if (Number.isFinite(limitingMag) && limitingMag >= 4) {
    quality = "Dark enough for many deep-sky targets";
  } else if (Number.isFinite(limitingMag) && limitingMag >= 2.5) {
    quality = "Twilight or moonlight limits faint detail";
  } else if (Number.isFinite(limitingMag)) {
    quality = "Bright sky; faint objects will be difficult";
  }

  return details.length ? `${quality}; ${details.join(", ")}` : quality;
}

function cloudPresentation(entry) {
  const percent = percentFromText(entry.value);
  const lower = entry.value.toLowerCase();
  const badge = lower.includes("clear") ? "" : Number.isFinite(percent) ? `${Math.round(percent)}%` : "";
  return {
    icon: lower.includes("clear") ? "sparkles" : "cloud",
    badge,
    description: cloudDescription(percent, lower)
  };
}

function transparencyPresentation(entry) {
  const lower = entry.value.toLowerCase();
  if (lower.includes("transparent")) {
    return { icon: "sparkles", badge: "5", description: "Best transparency for faint objects." };
  }
  if (lower.includes("above")) {
    return { icon: "sparkles", badge: "4", description: "Good transparency for low-contrast objects." };
  }
  if (lower.includes("below")) {
    return { icon: "haze", badge: "2", description: "Haze or moisture may reduce contrast." };
  }
  if (lower.includes("poor")) {
    return { icon: "haze", badge: "1", description: "Low transparency; bright targets only." };
  }
  if (lower.includes("cloudy")) {
    return { icon: "cloud", badge: "", description: "Too cloudy for a reliable transparency forecast." };
  }
  return { icon: "eye", badge: "3", description: "Usable transparency for many targets." };
}

function seeingPresentation(entry) {
  const lower = entry.value.toLowerCase();
  const rating = entry.value.match(/(\d)\/5/)?.[1] || "";

  if (lower.includes("excellent")) {
    return { icon: "sparkles", badge: rating || "5/5", description: "Very steady air for high magnification." };
  }
  if (lower.includes("good")) {
    return { icon: "waves", badge: rating || "4/5", description: "Steady enough for planets and fine detail." };
  }
  if (lower.includes("poor")) {
    return { icon: "waves", badge: rating || "2/5", description: "Turbulence likely softens fine detail." };
  }
  if (lower.includes("bad")) {
    return { icon: "alert", badge: rating || "1/5", description: "Unsteady air; high magnification suffers." };
  }
  if (lower.includes("cloudy")) {
    return { icon: "cloud", badge: "", description: "Too cloudy for a seeing forecast." };
  }
  return { icon: "waves", badge: rating || "3/5", description: "Moderate atmospheric steadiness." };
}

function smokePresentation(entry) {
  if (/no smoke/i.test(entry.value)) {
    return { icon: "sparkles", badge: "", description: "No meaningful smoke forecast." };
  }

  const amount = entry.value.match(/\d+(?:\.\d+)?/)?.[0] || "";
  const number = Number(amount);
  let description = "Smoke may reduce transparency.";
  if (number >= 35) {
    description = "Smoke likely affects transparency; check air quality guidance.";
  } else if (number > 0 && number <= 10) {
    description = "Light smoke; transparency impact may be limited.";
  }

  return { icon: "smoke", badge: amount, description };
}

function tooltipForEntry(row, entry, value) {
  return `${entry.value}: ${value.description} ${formatSlot(entry)}.`;
}

function percentFromText(value) {
  if (/clear/i.test(value)) return 0;
  if (/overcast/i.test(value)) return 100;
  const percent = Number(String(value).match(/(\d+(?:\.\d+)?)%/)?.[1]);
  return Number.isFinite(percent) ? percent : Number.NaN;
}

function compactRange(value, suffix) {
  const clean = String(value).replace(/\s+/g, " ").trim();
  const range = clean.match(/([<>]?)\s*(-?\d+(?:\.\d+)?)\s*(?:to|-)\s*(-?\d+(?:\.\d+)?)/i);
  if (range) {
    return `${range[1] || ""}${range[2]}-${range[3]}${suffix}`;
  }

  const single = clean.match(/^([<>]?)\s*(-?\d+(?:\.\d+)?)/);
  if (single) {
    return `${single[1] || ""}${single[2]}${suffix}`;
  }

  return compactValue(value);
}

function compactValue(value) {
  return String(value)
    .replace("covered", "")
    .replace("Above average", "4")
    .replace("Below Average", "2")
    .replace("Too cloudy to forecast", "")
    .replace("No Smoke", "")
    .trim();
}

function cloudDescription(percent, lower) {
  if (lower.includes("clear") || percent <= 0) return "Favorable; no cloud cover forecast.";
  if (percent <= 20) return "Mostly clear; good observing odds.";
  if (percent <= 50) return "Mixed sky; check source maps for cloud edges.";
  if (percent <= 80) return "Cloudy; expect limited openings.";
  return "Poor; sky likely blocked.";
}

function windDescription(value) {
  const wind = averageFromText(value) ?? 0;
  if (wind <= 5) return "Very light wind; best for telescope stability.";
  if (wind <= 11) return "Light wind; generally workable.";
  if (wind <= 16) return "Breezy; mount stability may matter.";
  if (wind <= 28) return "Windy; comfort and stability are reduced.";
  return "High wind; exposed setups may be risky.";
}

function humidityDescription(value) {
  const humidity = averageFromText(value) ?? 0;
  if (humidity < 70) return "Lower dew risk.";
  if (humidity < 80) return "Moderate dew risk.";
  if (humidity < 90) return "Elevated dew risk.";
  return "High dew or fog risk, especially with light wind.";
}

function temperatureDescription(value) {
  const temp = averageFromText(value) ?? 0;
  if (temp < 32) return "Cold; plan clothing and battery capacity.";
  if (temp <= 70) return "Comfortable observing range.";
  if (temp <= 85) return "Warm; comfort and gear cooling may matter.";
  return "Hot; comfort and equipment heat management matter.";
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

  const heading = document.createElement("div");
  heading.className = "summary-heading";
  if (card.icon) {
    const icon = document.createElement("span");
    icon.className = "summary-icon";
    icon.appendChild(valueIcon(card.icon));
    heading.appendChild(icon);
  }

  const kicker = document.createElement("p");
  kicker.className = "summary-kicker";
  kicker.textContent = card.kicker;
  heading.appendChild(kicker);

  const value = document.createElement("p");
  value.className = "summary-value";
  value.textContent = card.value;

  const meta = document.createElement("p");
  meta.className = "summary-meta";
  meta.textContent = card.meta;

  article.append(heading, value, meta);
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

function observingContext() {
  const forecast = state.forecast;
  const rows = indexRows(forecast.rows);
  const best = findBestWindow(forecast, rows);
  const nextDark = firstDarkSlot(forecast, rows);
  const bestEntries = best?.best ? entriesAtKey(rows, best.best.key) : {};
  const nextEntries = nextDark ? entriesAtKey(rows, nextDark.key) : {};

  return {
    rows,
    best,
    nextDark,
    bestEntries,
    nextEntries
  };
}

function scoreForSlot(slot, forecast, rows) {
  const entries = entriesAtKey(rows, slot.key);
  return Object.entries(rowWeights).reduce((sum, [id, weight]) => {
    const entry = id === "darkness" ? darknessForSlot(slot, forecast.rows) : entries[id];
    return sum + (entry?.score || 0) * weight;
  }, 0);
}

function findBestWindow(forecast, rows) {
  const candidates = forecast.timeSlots
    .filter((slot) => isNightSlot(slot, forecast.rows))
    .map((slot) => {
      const entries = entriesAtKey(rows, slot.key);
      const score = scoreForSlot(slot, forecast, rows);
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

function shortCloudValue(value) {
  const lower = value.toLowerCase();
  if (lower.includes("clear")) return "Clear";
  if (lower.includes("overcast")) return "Overcast";
  const percent = percentFromText(value);
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : value.replace("covered", "").trim();
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

function formatCompactWindow(window) {
  if (!window) return "";
  if (window.start.key === window.end.key) {
    return `${formatShortDate(window.start.date)} ${window.start.time}`;
  }
  return `${formatShortDate(window.start.date)} ${window.start.time}\n${formatShortDate(window.end.date)} ${window.end.time}`;
}

function formatSlot(entry) {
  return `${formatDate(entry.date)} ${entry.time}`;
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatChartDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat([], { weekday: "short", month: "long", day: "numeric" }).format(date);
}

function formatShortDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat([], { weekday: "short" }).format(date);
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

function syncGraphToggle() {
  elements.graphToggle.closest(".switch-control")?.classList.toggle("is-checked", state.graphMode);
}

function setTooltip(element, text) {
  element.dataset.tooltip = text;
  element.removeAttribute("title");
}

function installFloatingTooltips() {
  const tooltip = document.createElement("div");
  tooltip.className = "floating-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);

  let activeTarget = null;

  function tooltipTarget(event) {
    if (!(event.target instanceof Element)) return null;
    return event.target.closest(".has-tooltip[data-tooltip]");
  }

  function show(target, x, y) {
    const text = target.dataset.tooltip;
    if (!text) return;

    activeTarget = target;
    target.removeAttribute("title");
    tooltip.textContent = text;
    tooltip.classList.add("is-visible");
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    position(x, y);
  }

  function position(x, y) {
    if (!activeTarget) return;

    const margin = 12;
    const offset = 16;
    const rect = tooltip.getBoundingClientRect();
    let left = x + offset;
    let top = y + offset;

    if (left + rect.width + margin > window.innerWidth) {
      left = x - rect.width - offset;
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = y - rect.height - offset;
    }

    tooltip.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
  }

  function hide() {
    activeTarget = null;
    tooltip.classList.remove("is-visible");
  }

  document.addEventListener("pointerover", (event) => {
    const target = tooltipTarget(event);
    if (!target || target === activeTarget) return;
    show(target, event.clientX, event.clientY);
  });

  document.addEventListener("pointermove", (event) => {
    if (activeTarget) position(event.clientX, event.clientY);
  });

  document.addEventListener("pointerout", (event) => {
    if (!activeTarget) return;
    if (event.relatedTarget instanceof Node && activeTarget.contains(event.relatedTarget)) return;
    hide();
  });

  document.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    show(target, rect.left + rect.width / 2, rect.top + rect.height);
  });

  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}

function renderError(error) {
  elements.statusText.textContent = "Forecast fetch failed.";
  if (!elements.summaryGrid) return;
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
