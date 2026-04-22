import path from "node:path";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getForecast } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const publicDir = path.join(rootDir, "public");
const distDir = path.join(rootDir, "dist");
const apiDir = path.join(distDir, "api");

await rm(distDir, { recursive: true, force: true });
await cp(publicDir, distDir, { recursive: true });
await mkdir(apiDir, { recursive: true });
await writeFile(path.join(distDir, ".nojekyll"), "");

const forecast = await getForecast(true);
await writeFile(path.join(apiDir, "forecast.json"), `${JSON.stringify(forecast, null, 2)}\n`);

console.log(`Built GitHub Pages artifact at ${distDir}`);
