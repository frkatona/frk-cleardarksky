import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 4173);
export const SOURCE_URL = "https://www.cleardarksky.com/c/StateCollegePAkey.html?1";
const CACHE_MS = 5 * 60 * 1000;
const PUBLIC_MODEL_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_PUBLIC_MODEL_LOCATION = "State College, PA";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const rowMeta = [
  { id: "cloud", label: "Cloud Cover", cadence: "hourly" },
  { id: "ecmwfCloud", label: "ECMWF Cloud", cadence: "hourly" },
  { id: "transparency", label: "Transparency", cadence: "hourly" },
  { id: "seeing", label: "Seeing", cadence: "hourly" },
  { id: "darkness", label: "Darkness", cadence: "15 min" },
  { id: "smoke", label: "Smoke", cadence: "hourly" },
  { id: "wind", label: "Wind", cadence: "hourly" },
  { id: "humidity", label: "Humidity", cadence: "hourly" },
  { id: "temperature", label: "Temperature", cadence: "hourly" }
];

const usStateCodes = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy"
};

let forecastCache = null;
const publicModelCache = new Map();

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/forecast") {
      const refresh = requestUrl.searchParams.get("refresh") === "1";
      const payload = await getForecast(refresh);
      sendJson(response, 200, payload);
      return;
    }

    if (requestUrl.pathname === "/api/public-model") {
      const refresh = requestUrl.searchParams.get("refresh") === "1";
      const location = requestUrl.searchParams.get("location") || DEFAULT_PUBLIC_MODEL_LOCATION;
      const payload = await getPublicModelForecast(location, refresh);
      sendJson(response, 200, payload);
      return;
    }

    await serveStatic(requestUrl.pathname, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "Unable to load forecast data.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => {
    console.log(`AK Clear Sky is running at http://localhost:${PORT}`);
  });
}

async function serveStatic(urlPath, response) {
  const cleanPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const requestedPath = path.resolve(publicDir, `.${cleanPath}`);
  const allowed =
    requestedPath === publicDir || requestedPath.startsWith(`${publicDir}${path.sep}`);

  if (!allowed) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(requestedPath);
    const extension = path.extname(requestedPath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

export async function getForecast(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && forecastCache && now - forecastCache.cachedAt < CACHE_MS) {
    return forecastCache.payload;
  }

  const upstream = await fetch(SOURCE_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "AK-clear-sky-local-reader/1.0"
    }
  });

  if (!upstream.ok) {
    throw new Error(`Clear Dark Sky responded with ${upstream.status}`);
  }

  const html = new TextDecoder("iso-8859-1").decode(await upstream.arrayBuffer());
  const payload = parseForecast(html);
  payload.fetchedAt = new Date().toISOString();
  payload.cacheSeconds = Math.round(CACHE_MS / 1000);

  forecastCache = {
    cachedAt: now,
    payload
  };

  return payload;
}

export async function getPublicModelForecast(locationQuery = DEFAULT_PUBLIC_MODEL_LOCATION, forceRefresh = false) {
  const query = cleanText(locationQuery) || DEFAULT_PUBLIC_MODEL_LOCATION;
  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = publicModelCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.cachedAt < PUBLIC_MODEL_CACHE_MS) {
    return cached.payload;
  }

  const location = await resolvePublicModelLocation(query);
  const forecastUrl = publicModelForecastUrl(location);
  const forecast = await fetchJson(forecastUrl, "Open-Meteo forecast");
  const payload = publicModelPayload(query, location, forecast, forecastUrl);

  publicModelCache.set(cacheKey, {
    cachedAt: now,
    payload
  });

  return payload;
}

async function resolvePublicModelLocation(query) {
  const coordinates = parseCoordinateQuery(query);
  if (coordinates) {
    return {
      name: `${coordinates.latitude.toFixed(3)}, ${coordinates.longitude.toFixed(3)}`,
      label: `${coordinates.latitude.toFixed(3)}, ${coordinates.longitude.toFixed(3)}`,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      elevation: null,
      timezone: null,
      country: null,
      admin1: null,
      geocodingUrl: null
    };
  }

  let geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  let payload = await fetchJson(geocodingUrl, "Open-Meteo geocoding");
  if (!payload.results?.length && query.includes(",")) {
    const fallbackQuery = cleanText(query.split(",")[0]);
    geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(fallbackQuery)}&count=5&language=en&format=json`;
    payload = await fetchJson(geocodingUrl, "Open-Meteo geocoding");
  }
  const result = choosePublicLocationResult(payload.results, query);
  if (!result) {
    throw new Error(`No public geocoding result matched "${query}".`);
  }

  const parts = [result.name, result.admin1, result.country].filter(Boolean);
  return {
    name: result.name,
    label: parts.join(", "),
    latitude: Number(result.latitude),
    longitude: Number(result.longitude),
    elevation: Number.isFinite(Number(result.elevation)) ? Number(result.elevation) : null,
    timezone: result.timezone || null,
    country: result.country || null,
    admin1: result.admin1 || null,
    geocodingUrl
  };
}

function choosePublicLocationResult(results = [], query) {
  const candidates = Array.isArray(results) ? results : [];
  if (!candidates.length) return null;

  const qualifier = cleanText(String(query).split(",").slice(1).join(" ")).toLowerCase();
  if (!qualifier) return candidates[0];

  return (
    candidates.find((candidate) => {
      const stateCode = usStateCodes[cleanText(candidate.admin1).toLowerCase()];
      return [candidate.admin1, candidate.country, candidate.country_code, stateCode]
        .filter(Boolean)
        .some((value) => cleanText(value).toLowerCase() === qualifier);
    }) || candidates[0]
  );
}

function publicModelForecastUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: "auto",
    forecast_hours: "120",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "wind_speed_10m",
      "wind_gusts_10m",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "is_day"
    ].join(",")
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AK-clear-sky-public-model/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${label} responded with ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.reason || `${label} returned an error.`);
  }
  return payload;
}

function publicModelPayload(query, location, forecast, forecastUrl) {
  const hours = modelHours(forecast);
  const nightHours = hours.filter((hour) => hour.isNight);
  const candidates = nightHours.length ? nightHours : hours;
  const best = candidates.slice().sort((left, right) => right.score - left.score)[0] || null;
  const nights = groupModelNights(nightHours);

  return {
    title: `${location.label} Public Sky Model`,
    query,
    fetchedAt: new Date().toISOString(),
    source: {
      label: "Open-Meteo Forecast API and Geocoding API",
      forecastUrl,
      geocodingUrl: location.geocodingUrl,
      docsUrl: "https://open-meteo.com/en/docs"
    },
    location: {
      name: location.name,
      label: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: location.elevation,
      timezone: forecast.timezone || location.timezone,
      utcOffsetSeconds: forecast.utc_offset_seconds
    },
    units: forecast.hourly_units || {},
    best,
    nights,
    hours
  };
}

function modelHours(forecast) {
  const hourly = forecast.hourly || {};
  return (hourly.time || []).map((time, index) => {
    const [date, clock = "0:00"] = String(time).split("T");
    const [hour = 0, minute = 0] = clock.split(":").map(Number);
    const values = {
      temperature: numberAt(hourly.temperature_2m, index),
      humidity: numberAt(hourly.relative_humidity_2m, index),
      dewPoint: numberAt(hourly.dew_point_2m, index),
      cloudCover: numberAt(hourly.cloud_cover, index),
      lowCloud: numberAt(hourly.cloud_cover_low, index),
      midCloud: numberAt(hourly.cloud_cover_mid, index),
      highCloud: numberAt(hourly.cloud_cover_high, index),
      visibility: numberAt(hourly.visibility, index),
      windSpeed: numberAt(hourly.wind_speed_10m, index),
      windGust: numberAt(hourly.wind_gusts_10m, index),
      precipitationProbability: numberAt(hourly.precipitation_probability, index),
      precipitation: numberAt(hourly.precipitation, index),
      weatherCode: numberAt(hourly.weather_code, index),
      isDay: numberAt(hourly.is_day, index)
    };
    const components = modelComponents(values, hour);
    const score = Math.round(scoreFromModelComponents(components));

    return {
      index,
      key: time,
      date,
      time: `${hour}:${String(minute).padStart(2, "0")}`,
      hour,
      minute,
      score,
      isNight: modelIsNight(values, hour),
      summary: modelHourSummary(values),
      values,
      components
    };
  });
}

function modelComponents(values, hour) {
  const componentMeta = [
    { id: "cloud", label: "Cloud cover", color: "#4e79a7", weight: 0.24, score: scorePercentInverse(values.cloudCover), value: `${round(values.cloudCover)}% total` },
    { id: "highCloud", label: "High cloud", color: "#76b7b2", weight: 0.12, score: clamp(100 - values.highCloud * 0.75, 0, 100), value: `${round(values.highCloud)}% high` },
    { id: "transparency", label: "Visibility", color: "#59a14f", weight: 0.18, score: scoreVisibility(values), value: formatVisibility(values.visibility) },
    { id: "seeing", label: "Steadiness", color: "#b07aa1", weight: 0.14, score: scoreSeeing(values), value: `${round(values.windSpeed)} mph wind / ${round(values.windGust)} mph gust` },
    { id: "darkness", label: "Darkness", color: "#edc948", weight: 0.12, score: scoreModelDarkness(values, hour), value: values.isDay === 1 ? "daylight" : "night" },
    { id: "precipitation", label: "Dry odds", color: "#bab0ab", weight: 0.08, score: scoreDryOdds(values), value: `${round(values.precipitationProbability)}% precip` },
    { id: "wind", label: "Wind", color: "#f28e2b", weight: 0.07, score: scoreWindValue(values.windSpeed), value: `${round(values.windSpeed)} mph` },
    { id: "humidity", label: "Humidity", color: "#e15759", weight: 0.05, score: scoreHumidityValue(values.humidity), value: `${round(values.humidity)}%` }
  ];

  return componentMeta.map((component) => ({
    ...component,
    score: Math.round(clamp(component.score, 0, 100)),
    contribution: clamp(component.score, 0, 100) * component.weight
  }));
}

function scoreFromModelComponents(components) {
  return components.reduce((sum, component) => sum + component.contribution, 0);
}

function scorePercentInverse(value) {
  return clamp(100 - (Number.isFinite(value) ? value : 100), 0, 100);
}

function scoreVisibility(values) {
  const miles = visibilityMiles(values.visibility);
  const base = clamp(((miles - 3) / 12) * 100, 0, 100);
  const humidityPenalty = values.humidity > 85 ? 12 : values.humidity > 75 ? 6 : 0;
  const highCloudPenalty = values.highCloud > 60 ? 10 : values.highCloud > 35 ? 5 : 0;
  return clamp(base - humidityPenalty - highCloudPenalty, 0, 100);
}

function scoreSeeing(values) {
  const wind = Number.isFinite(values.windSpeed) ? values.windSpeed : 25;
  const gust = Number.isFinite(values.windGust) ? values.windGust : wind;
  return clamp(104 - wind * 2.3 - gust * 1.25, 0, 100);
}

function scoreModelDarkness(values, hour) {
  if (values.isDay === 1) return 0;
  if (hour >= 22 || hour <= 3) return 100;
  if (hour >= 20 || hour <= 5) return 82;
  return 58;
}

function scoreDryOdds(values) {
  const probability = Number.isFinite(values.precipitationProbability) ? values.precipitationProbability : 0;
  const amount = Number.isFinite(values.precipitation) ? values.precipitation : 0;
  return clamp(100 - probability * 1.08 - amount * 220, 0, 100);
}

function scoreWindValue(value) {
  if (value <= 5) return 100;
  if (value <= 11) return 86;
  if (value <= 16) return 70;
  if (value <= 28) return 45;
  if (value <= 45) return 20;
  return 5;
}

function scoreHumidityValue(value) {
  if (value < 70) return 95;
  if (value < 80) return 72;
  if (value < 90) return 42;
  return 18;
}

function modelIsNight(values, hour) {
  return values.isDay === 0 || hour >= 20 || hour <= 6;
}

function modelHourSummary(values) {
  return [
    `${round(values.cloudCover)}% cloud`,
    `${formatVisibility(values.visibility)} visibility`,
    `${round(values.humidity)}% humidity`,
    `${round(values.windSpeed)} mph wind`
  ].join(" | ");
}

function groupModelNights(nightHours) {
  const groups = [];
  let current = [];

  nightHours.forEach((hour) => {
    const previous = current[current.length - 1];
    if (previous && hour.index - previous.index > 1) {
      groups.push(modelNightGroup(current));
      current = [];
    }
    current.push(hour);
  });

  if (current.length) groups.push(modelNightGroup(current));
  return groups;
}

function modelNightGroup(hours) {
  const peak = hours.slice().sort((left, right) => right.score - left.score)[0];
  return {
    label: hours[0].date === hours[hours.length - 1].date ? `${hours[0].date} night` : `${hours[0].date} to ${hours[hours.length - 1].date}`,
    peak,
    hours
  };
}

function parseCoordinateQuery(query) {
  const match = String(query).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  return { latitude, longitude };
}

function numberAt(values, index) {
  const value = Number(values?.[index]);
  return Number.isFinite(value) ? value : Number.NaN;
}

function visibilityMiles(value) {
  return Number.isFinite(value) ? value / 1609.344 : 0;
}

function formatVisibility(value) {
  const miles = visibilityMiles(value);
  return Number.isFinite(miles) ? `${miles.toFixed(miles >= 10 ? 0 : 1)} mi` : "Unavailable";
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function parseForecast(html) {
  const title =
    getMetaContent(html, "DC.title") ||
    textBetween(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    "Clear Sky Chart";
  const coordinates = getMetaContent(html, "ICBM") || null;
  const lastUpdated =
    textBetween(html, /Last updated\s*([^<.]+)\./i) ||
    textBetween(html, /Page updated by [^<]* at\s*([^<]+?)\s+which/i) ||
    null;
  const sourcePageUpdated =
    textBetween(html, /Copyright[\s\S]*?Page updated\s*([^<]+?)\s+on/i) || null;
  const image = parseChartImage(html);
  const areas = parseAreas(html);
  const groups = groupAreasByRow(areas);
  const baseDate = getBaseDate(lastUpdated);

  const rows = groups.map((group, index) => {
    const meta = rowMeta[index] || {
      id: `row-${index + 1}`,
      label: `Forecast Row ${index + 1}`,
      cadence: "hourly"
    };

    const entries = group.areas
      .sort((left, right) => left.coords[0] - right.coords[0])
      .map((area, entryIndex) => {
        const parsed = parseAreaTitle(area.title, meta.id);
        const entry = {
          index: entryIndex,
          title: area.title,
          time: parsed.time,
          hour: parsed.hour,
          minute: parsed.minute,
          value: parsed.value,
          details: parsed.details,
          model: parsed.model,
          metrics: parsed.metrics,
          href: area.href ? new URL(area.href, SOURCE_URL).href : null,
          coords: area.coords,
          color: colorFor(meta.id, parsed),
          score: scoreFor(meta.id, parsed)
        };
        entry.textColor = readableTextColor(entry.color);
        return entry;
      });

    assignDates(entries, baseDate);

    return {
      ...meta,
      y: group.y,
      entries
    };
  });

  const cloudRow = rows.find((row) => row.id === "cloud") || rows.find((row) => row.cadence === "hourly");
  const timeSlots = cloudRow
    ? cloudRow.entries.map((entry, index) => ({
        index,
        key: entry.key,
        time: entry.time,
        hour: entry.hour,
        minute: entry.minute,
        date: entry.date,
        dayOffset: entry.dayOffset
      }))
    : [];

  return {
    title: cleanText(title),
    sourceUrl: SOURCE_URL,
    coordinates,
    lastUpdated: cleanText(lastUpdated),
    sourcePageUpdated: cleanText(sourcePageUpdated),
    image,
    rows,
    timeSlots
  };
}

function parseChartImage(html) {
  const tag = html.match(/<img\b[^>]*id=["']csk_image["'][^>]*>/i)?.[0];
  if (!tag) {
    return null;
  }

  const src = getAttr(tag, "src");
  return {
    src: src ? new URL(src, SOURCE_URL).href : null,
    alt: cleanText(getAttr(tag, "alt")),
    width: Number(getAttr(tag, "width")) || null,
    height: Number(getAttr(tag, "height")) || null
  };
}

function parseAreas(html) {
  return [...html.matchAll(/<area\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const title = cleanText(getAttr(tag, "title"));
      const coords = getAttr(tag, "coords")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));

      return {
        title,
        coords,
        href: getAttr(tag, "href") || null
      };
    })
    .filter((area) => area.title && area.coords.length >= 4);
}

function groupAreasByRow(areas) {
  const rows = new Map();
  for (const area of areas) {
    const y = area.coords[1];
    if (!rows.has(y)) {
      rows.set(y, []);
    }
    rows.get(y).push(area);
  }

  return [...rows.entries()]
    .map(([y, rowAreas]) => ({ y: Number(y), areas: rowAreas }))
    .filter((row) => row.areas.length > 5)
    .sort((left, right) => left.y - right.y);
}

function parseAreaTitle(title, rowId) {
  const cleaned = cleanText(title);

  if (rowId === "darkness") {
    const match = cleaned.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    const time = match?.[1] || "";
    const details = match?.[2] || cleaned;
    const metrics = {
      limitingMag: numberFrom(details, /Limiting Mag:\s*(-?\d+(?:\.\d+)?)/i),
      sunAlt: numberFrom(details, /SunAlt:\s*(-?\d+(?:\.\d+)?)/i),
      moonAlt: numberFrom(details, /MoonAlt\s*(-?\d+(?:\.\d+)?)/i),
      moonIllum: numberFrom(details, /MoonIllum\s*(-?\d+(?:\.\d+)?)%/i)
    };

    return {
      ...timeParts(time),
      value: Number.isFinite(metrics.limitingMag) ? `LM ${metrics.limitingMag.toFixed(1)}` : "Darkness",
      details,
      model: null,
      metrics
    };
  }

  const match = cleaned.match(/^(\d{1,2}:\d{2}):\s*(.+?)(?:\s*\(([^()]+)\))?$/);
  const time = match?.[1] || "";
  const value = match?.[2] || cleaned;
  const model = match?.[3] || null;

  return {
    ...timeParts(time),
    value: cleanText(value),
    details: cleaned,
    model,
    metrics: {}
  };
}

function assignDates(entries, baseDate) {
  let dayOffset = 0;
  let previousMinutes = null;

  for (const entry of entries) {
    const currentMinutes = entry.hour * 60 + entry.minute;
    if (previousMinutes !== null && currentMinutes < previousMinutes) {
      dayOffset += 1;
    }

    entry.dayOffset = dayOffset;
    entry.date = addDays(baseDate, dayOffset);
    entry.key = `${entry.date}T${entry.time}`;
    previousMinutes = currentMinutes;
  }
}

function colorFor(rowId, parsed) {
  switch (rowId) {
    case "cloud":
    case "ecmwfCloud":
      return cloudColor(parsed.value);
    case "transparency":
      return transparencyColor(parsed.value);
    case "seeing":
      return seeingColor(parsed.value);
    case "darkness":
      return darknessColor(parsed.metrics);
    case "smoke":
      return smokeColor(parsed.value);
    case "wind":
      return windColor(parsed.value);
    case "humidity":
      return humidityColor(parsed.value);
    case "temperature":
      return temperatureColor(parsed.value);
    default:
      return "#4d5562";
  }
}

function qualityColor(score) {
  if (score >= 90) return "#167345";
  if (score >= 75) return "#2f8f46";
  if (score >= 60) return "#88a83a";
  if (score >= 45) return "#d59b2d";
  if (score >= 30) return "#c56a32";
  if (score >= 15) return "#b64233";
  return "#7d2427";
}

function scoreFor(rowId, parsed) {
  switch (rowId) {
    case "cloud":
    case "ecmwfCloud":
      return scoreCloud(parsed.value);
    case "transparency":
      return scoreFromWords(parsed.value, {
        transparent: 100,
        "above average": 86,
        "below average": 42,
        poor: 20,
        "too cloudy": 0,
        cloudy: 8,
        average: 68
      });
    case "seeing":
      return scoreFromWords(parsed.value, {
        excellent: 100,
        good: 84,
        poor: 38,
        bad: 18,
        "too cloudy": 0,
        cloudy: 8,
        average: 66
      });
    case "darkness":
      return scoreDarkness(parsed.metrics);
    case "smoke":
      return scoreSmoke(parsed.value);
    case "wind":
      return scoreWind(parsed.value);
    case "humidity":
      return scoreHumidity(parsed.value);
    case "temperature":
      return scoreTemperature(parsed.value);
    default:
      return 50;
  }
}

function cloudColor(value) {
  return qualityColor(scoreCloud(value));
}

function transparencyColor(value) {
  return qualityColor(
    scoreFromWords(value, {
      transparent: 100,
      "above average": 86,
      "below average": 42,
      poor: 20,
      "too cloudy": 0,
      cloudy: 8,
      average: 68
    })
  );
}

function seeingColor(value) {
  return qualityColor(
    scoreFromWords(value, {
      excellent: 100,
      good: 84,
      poor: 38,
      bad: 18,
      "too cloudy": 0,
      cloudy: 8,
      average: 66
    })
  );
}

function darknessColor(metrics) {
  const sunAlt = metrics?.sunAlt;
  const limitingMag = metrics?.limitingMag;

  if (Number.isFinite(sunAlt) && sunAlt > 0) return "#f5d98f";
  if (Number.isFinite(sunAlt) && sunAlt > -6) return "#df9a3a";
  if (Number.isFinite(limitingMag) && limitingMag < 2.5) return "#33bec8";
  if (Number.isFinite(limitingMag) && limitingMag < 4) return "#2374bd";
  if (Number.isFinite(limitingMag) && limitingMag < 5.5) return "#214d9b";
  return "#151c5a";
}

function smokeColor(value) {
  return qualityColor(scoreSmoke(value));
}

function windColor(value) {
  return qualityColor(scoreWind(value));
}

function humidityColor(value) {
  return qualityColor(scoreHumidity(value));
}

function temperatureColor(value) {
  return qualityColor(scoreTemperature(value));
}

function scoreCloud(value) {
  return Math.max(0, 100 - cloudPercent(value));
}

function scoreDarkness(metrics) {
  const sunAlt = metrics?.sunAlt;
  const limitingMag = metrics?.limitingMag;
  if (Number.isFinite(sunAlt) && sunAlt > 0) return 0;
  if (Number.isFinite(sunAlt) && sunAlt > -6) return 18;
  if (!Number.isFinite(limitingMag)) return 60;
  return clamp((limitingMag / 6.5) * 100, 0, 100);
}

function scoreSmoke(value) {
  const amount = smokeAmount(value);
  if (amount <= 0) return 100;
  if (amount <= 5) return 90;
  if (amount <= 20) return 70;
  if (amount <= 40) return 45;
  if (amount <= 80) return 22;
  return 5;
}

function scoreWind(value) {
  const wind = rangeAverage(value);
  if (wind <= 5) return 100;
  if (wind <= 11) return 86;
  if (wind <= 16) return 70;
  if (wind <= 28) return 45;
  if (wind <= 45) return 20;
  return 5;
}

function scoreHumidity(value) {
  const humidity = rangeAverage(value);
  if (humidity < 70) return 95;
  if (humidity < 80) return 72;
  if (humidity < 90) return 42;
  return 18;
}

function scoreTemperature(value) {
  const temp = rangeAverage(value);
  if (temp >= 45 && temp <= 70) return 100;
  if (temp >= 32 && temp <= 80) return 76;
  if (temp >= 20 && temp <= 90) return 48;
  return 24;
}

function cloudPercent(value) {
  const lower = value.toLowerCase();
  if (lower.includes("clear")) return 0;
  if (lower.includes("overcast")) return 100;
  const percent = numberFrom(value, /(\d+(?:\.\d+)?)%/);
  return Number.isFinite(percent) ? clamp(percent, 0, 100) : 50;
}

function smokeAmount(value) {
  if (/no smoke/i.test(value)) return 0;
  const amount = numberFrom(value, /(\d+(?:\.\d+)?)/);
  return Number.isFinite(amount) ? amount : 0;
}

function rangeAverage(value) {
  const numbers = [...String(value).matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (numbers.length === 0) return 0;
  if (/^>/.test(value.trim())) return numbers[0] + 5;
  if (/^</.test(value.trim())) return numbers[0] - 5;
  return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}

function scoreFromWords(value, table) {
  const lower = value.toLowerCase();
  for (const [needle, score] of Object.entries(table)) {
    if (lower.includes(needle)) {
      return score;
    }
  }
  return 50;
}

function readableTextColor(hex) {
  const [red, green, blue] = hexToRgb(hex);
  const luminance = relativeLuminance(red, green, blue);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#151515" : "#fffaf2";
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

function relativeLuminance(red, green, blue) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getBaseDate(lastUpdated) {
  const match = String(lastUpdated || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function timeParts(time) {
  const [hour, minute] = String(time || "0:00").split(":").map(Number);
  return {
    time,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0
  };
}

function getMetaContent(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\b[^>]*name=["']${escapedName}["'][^>]*>`, "i"));
  return match ? cleanText(getAttr(match[0], "content")) : null;
}

function getAttr(tag, attr) {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "");
}

function textBetween(value, pattern) {
  return cleanText(value.match(pattern)?.[1] || "");
}

function cleanText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&deg;/gi, " deg")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function numberFrom(value, pattern) {
  const number = Number(String(value).match(pattern)?.[1]);
  return Number.isFinite(number) ? number : Number.NaN;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
