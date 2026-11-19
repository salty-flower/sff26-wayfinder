/**
 * Organiser's floor plan + walkway graph → dist/, a static site with no server side.
 *
 * Inputs are exactly two files fetched from the organiser's public map (cached in
 * data/floorplan/) and this project's own code. Nothing else is read.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { hallDrawing, loadFloor, overviewDrawing } from "./floorplan.ts";
import { ROOT, tpl } from "./tpl.ts";
import { loadWalkways, walkBetween } from "./walkways.ts";

const warnings: string[] = [];
const warn = (msg: string) => {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
};
function fail(msg: string): never {
  console.error(`build failed: ${msg}`);
  process.exit(1);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}
const short = (body: string | Buffer) => createHash("sha256").update(body).digest("hex").slice(0, 10);

const floor = await loadFloor(warn);
if (!floor) fail("the floor plan is not available");
const walkways = await loadWalkways(floor, warn);
if (!walkways) fail("the walkway graph is not available");

// Places no walk can reach, measured from a stage every visitor can find.
const index = new Map([...floor.places.keys()].map((k, i) => [k, i]));
const anchor = [...floor.places.values()].find((p) => p.kind === "stage")!.key;
const unreached = [...floor.places.keys()].filter((k) => k !== anchor && walkBetween(walkways, anchor, k, index) === null).sort();

const out = join(ROOT, "dist.next");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
const put = (stem: string, ext: string, body: string | Buffer) => {
  const name = `${stem}.${short(body)}.${ext}`;
  writeFileSync(join(out, "assets", name), body);
  return `/assets/${name}`;
};

// One drawing per hall, the whole-floor outline, and the places + compact Level 1 graph.
const halls: Record<string, { src: string; w: number; h: number; left: number | null; right: number | null; a: number; x0: number; y0: number }> = {};
for (const frame of [...floor.halls.values()].sort((a, b) => a.hall - b.hall)) {
  const drawing = hallDrawing(floor, frame);
  const svg = tpl.render("hall.svg.njk", drawing).replace(/\n\s*\n/g, "\n");
  halls[frame.hall] = {
    src: put(`hall-${frame.hall}`, "svg", svg),
    w: drawing.W,
    h: Math.round((drawing.H + drawing.band) * 10) / 10,
    left: frame.left,
    right: frame.right,
    a: frame.angle,
    x0: Math.round(frame.x0 * 100) / 100,
    y0: Math.round(frame.y0 * 100) / 100,
  };
}
const overview = overviewDrawing(floor);
const floorJson = JSON.stringify({
  n: walkways.nodes,
  e: walkways.edges,
  d: walkways.oneWay,
  s: walkways.inStage,
  // key, name, signage, hall, x, y (decimetres), kind, doors
  p: [...floor.places.values()].map((p) => [p.key, p.name, p.title, p.hall, Math.round(p.c[0] * 10), Math.round(p.c[1] * 10), p.kind === "wc" ? "w" : p.kind[0], walkways.access.get(p.key) ?? []]),
});

const assets = {
  css: put("app", "css", readFileSync(join(ROOT, "assets", "app.css"))),
  js: put("app", "js", readFileSync(join(ROOT, "assets", "app.js"))),
  icon: put("icon", "svg", readFileSync(join(ROOT, "assets", "icon.svg"))),
};
const data = {
  halls,
  floor: put("floor", "json", floorJson),
  ov: { src: put("floor-all", "svg", tpl.render("overview.svg.njk", overview).replace(/\n\s*\n/g, "\n")), vb: overview.vb },
  official: config.official,
  /** The day the plan was downloaded from the organiser. */
  fetched: (floor.fetchedAt || new Date().toISOString()).slice(0, 10),
  unreached,
  places: floor.places.size,
};

// The build id covers every input, so the same plan and code give the same site.
const code = ["src", "templates", "assets"].flatMap((d) => walk(join(ROOT, d))).map((f) => readFileSync(f, "utf8"));
const build = { id: short([floor.hash, walkways.hash, ...code].join("\u0000")).slice(0, 10) };

writeFileSync(join(out, "index.html"), tpl.render("index.njk", { config, assets, data, build }));
writeFileSync(join(out, "404.html"), tpl.render("404.njk", { config, assets }));
const precache = ["/", ...Object.values(assets), data.floor, data.ov.src, ...Object.values(halls).map((h) => h.src)];
writeFileSync(join(out, "sw.js"), tpl.render("sw.js.njk", { build, precache }));
writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
// Cloudflare Pages reads this file: keep the site out of search engines, let hashed files be kept.
writeFileSync(
  join(out, "_headers"),
  ["/*", "  X-Robots-Tag: noindex, nofollow", "  Referrer-Policy: no-referrer", "  X-Content-Type-Options: nosniff", "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", ""].join("\n"),
);

const dist = join(ROOT, "dist");
const old = join(ROOT, "dist.prev");
rmSync(old, { recursive: true, force: true });
if (existsSync(dist)) renameSync(dist, old);
renameSync(out, dist);
rmSync(old, { recursive: true, force: true });
mkdirSync(join(ROOT, ".cache"), { recursive: true });
writeFileSync(join(ROOT, ".cache", "last-build.json"), JSON.stringify({ id: build.id, hash: createHash("sha256").update(build.id).digest("hex").slice(0, 40), fetched: data.fetched, unreached, snapped: walkways.snapped.length, warnings }));

const size = walk(dist).reduce((n, f) => n + statSync(f).size, 0);
console.log(
  `built wayfinder: ${floor.places.size} places in ${floor.halls.size} halls, ${walkways.nodes.length / 2} walkway points, ${unreached.length} unreachable, ` +
    `${Math.round(size / 1024)} KB → dist/  [build ${build.id}, plan fetched ${data.fetched}]` +
    (warnings.length ? `  (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : ""),
);
