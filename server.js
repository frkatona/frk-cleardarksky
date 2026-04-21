import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const SOURCE_URL = "https://www.cleardarksky.com/c/StateCollegePAkey.html?1";
const CACHE_MS = 5 * 60 * 1000;

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

let forecastCache = null;

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/forecast") {
      const refresh = requestUrl.searchParams.get("refresh") === "1";
      const payload = await getForecast(refresh);
      sendJson(response, 200, payload);
      return;
    }

    await serveStatic(requestUrl.pathname, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "Unable to load the Clear Sky forecast.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
});

server.listen(PORT, () => {
  console.log(`AK Clear Sky is running at http://localhost:${PORT}`);
});

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

async function getForecast(forceRefresh = false) {
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

function parseForecast(html) {
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
