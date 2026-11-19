/**
 * The organiser's ExpoFP floor plan → places with coordinates, one upright frame per hall.
 *
 * The plan is fetched into data/floorplan/ and kept there; builds read the cached copy and only
 * ask the server again when it is old. Units are metres. In the file, small x is the Hall 6 end,
 * large x the Hall 1 end, and large y the side where the entrances are marked. The building is
 * an arc, so each hall is turned by its own angle; a hall frame undoes that turn, which puts the
 * entrance side at the bottom, the next-higher hall number on the left and the next-lower on the right.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { ROOT } from "./tpl.ts";

export type Pt = [number, number];

export interface Place {
  /** Stable handle: the booth code ("5G19") or the place name ("Catalyst Stage"). */
  key: string;
  name: string;
  /** Exhibitor or signage text from the plan, upper case as given. */
  title: string;
  /** wc and door are point features (toilets, hall entrances); the rest are floor areas. */
  kind: "stage" | "area" | "booth" | "wc" | "door";
  /** "premium" / "open" when the plan says so (stages). */
  access: string | null;
  /** The hall the place physically stands in. A few booths carry another hall's number. */
  hall: number;
  /** Corners and centre in plan coordinates. */
  poly: Pt[];
  c: Pt;
  w: number;
  h: number;
}

export interface HallFrame {
  hall: number;
  angle: number;
  /** Frame origin in turned coordinates, and frame size in metres. */
  x0: number;
  y0: number;
  W: number;
  H: number;
  places: Place[];
  left: number | null;
  right: number | null;
}

export interface Floor {
  hash: string;
  /** When the plan was last downloaded from the organiser, as an ISO date. */
  fetchedAt: string;
  halls: Map<number, HallFrame>;
  places: Map<string, Place>;
}

const DIR = join(ROOT, "data", "floorplan");
const FILE = join(DIR, "fp.svg.Level1.js");
const META = join(DIR, "fp.meta.json");

/** Get a file from the organiser's server into the cache; keep the old copy on any failure. */
export async function cached(url: string, file: string, metaFile: string, looksRight: (text: string) => boolean, warn: (m: string) => void): Promise<string | null> {
  mkdirSync(DIR, { recursive: true });
  let meta: { etag?: string; checkedAt?: string; fetchedAt?: string } = {};
  try {
    meta = JSON.parse(readFileSync(metaFile, "utf8"));
  } catch {
    meta = {};
  }
  const have = existsSync(file);
  const age = meta.checkedAt ? Date.now() - Date.parse(meta.checkedAt) : Infinity;
  if (!have || age > config.floorplan.recheckHours * 3600 * 1000) {
    try {
      const res = await fetch(url, {
        headers: have && meta.etag ? { "If-None-Match": meta.etag } : {},
        signal: AbortSignal.timeout(have ? 8000 : 30000),
      });
      if (res.status === 200) {
        const text = await res.text();
        if (!looksRight(text)) throw new Error("response does not look like the expected file");
        writeFileSync(`${file}.part`, text);
        renameSync(`${file}.part`, file);
        meta.etag = res.headers.get("etag") ?? undefined;
        meta.fetchedAt = new Date().toISOString();
      } else if (res.status !== 304) {
        throw new Error(`HTTP ${res.status}`);
      }
      meta.checkedAt = new Date().toISOString();
      writeFileSync(metaFile, JSON.stringify(meta));
    } catch (err) {
      warn(`${url.split("/").pop()}: fetch failed (${(err as Error).message}); ${have ? "using the cached copy" : "no cached copy"}`);
    }
  }
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

const turn = (p: Pt, deg: number): Pt => {
  const t = (-deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const CODE_RE = /^([1-6])(?:[A-Z]{1,2}\d{2}|-SK-\d+|(?:HEX|POD|MR|ROOM)-[\d-]+|Media)/;
const BOOTH_RE = /^([1-6])[A-Z]{1,2}\d{2}/;

/** "FUTUREMATTERS STAGE  (Premium)" → "FutureMatters Stage". */
function pretty(raw: string): string {
  let s = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (/^[A-Z&]{1,3}\d*$/.test(w) || !/[a-zA-Z]/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
    .replace(/\b(It|Of|And|For|By|To)\b/g, (m, _w, at) => (at === 0 ? m : m.toLowerCase()));
  for (const brand of config.floorplan.spellings) s = s.replace(new RegExp(brand, "ig"), brand);
  return s;
}

interface RawRect {
  id: string;
  title: string;
  poly: Pt[];
  c: Pt;
  w: number;
  h: number;
  angle: number;
}

function parseRects(src: string): RawRect[] {
  const out: RawRect[] = [];
  for (const m of src.matchAll(/<rect\s+id="b?([^"]*)"([^>]*)>/g)) {
    const attrs = Object.fromEntries([...m[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(attrs[k]));
    if (![x, y, w, h].every(Number.isFinite)) continue;
    const angle = Number(attrs.transform?.match(/rotate\(([-\d.]+)\)/)?.[1] ?? 0);
    // The rotation is about the rectangle's own centre: not the drawing origin (that scatters the
    // halls), and not its (x, y) corner (that looks right from afar but shifts a booth by metres
    // in the most turned hall). The walkway graph settles it: with the centre as pivot, 1 aisle
    // junction falls inside a Hall 2 booth; with the corner, 97 do.
    const t = (angle * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const mx = x! + w! / 2;
    const my = y! + h! / 2;
    const corner = (px: number, py: number): Pt => [mx + (px - mx) * cos - (py - my) * sin, my + (px - mx) * sin + (py - my) * cos];
    const poly = [corner(x!, y!), corner(x! + w!, y!), corner(x! + w!, y! + h!), corner(x!, y! + h!)];
    const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    out.push({
      id: unescape(m[1]!),
      title: unescape(attrs["data-title"] ?? ""),
      poly,
      c: [(poly[0]![0] + poly[2]![0]) / 2, (poly[0]![1] + poly[2]![1]) / 2],
      w: w!,
      h: h!,
      angle,
    });
  }
  return out;
}

/** Entrances, toilets and the like: `<g id="b…">` groups whose shape lives in the mesh array. */
function parsePois(src: string, meshes: { positions: Pt[] }[]): { name: string; c: Pt; box: Pt[] }[] {
  const out: { name: string; c: Pt; box: Pt[] }[] = [];
  for (const m of src.matchAll(/<g id="b([^"]*)"[^>]*>/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let end = -1;
    const tag = /<(\/?)g\b[^>]*?(\/?)>/g;
    tag.lastIndex = start;
    for (let t = tag.exec(src); t; t = tag.exec(src)) {
      if (t[2]) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
      if (t.index - start > 400000) break;
    }
    if (end < 0) continue;
    const pts = [...src.slice(start, end).matchAll(/data-index="(\d+)"/g)].flatMap((i) => meshes[Number(i[1])]?.positions ?? []);
    if (!pts.length) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    out.push({
      name: m[1]!.replace(/&amp;/g, "&"),
      c: [(x0 + x1) / 2, (y0 + y1) / 2],
      box: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    });
  }
  return out;
}

/** The mesh array is a plain JSON literal assigned to window['__fpPaths…']; cut it out by bracket depth. */
function parseMeshes(src: string): { positions: Pt[] }[] {
  const at = src.indexOf("window['__fpPaths");
  const start = at >= 0 ? src.indexOf("[{", at) : -1;
  if (start < 0) return [];
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 91) depth++;
    else if (ch === 93 && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  return [];
}

export function parseFloor(src: string): Floor {
  const meshes = parseMeshes(src);
  const rects = parseRects(src).filter((r) => r.id || r.title);
  const pois = parsePois(src, meshes);

  // ---- each hall's turn angle and core rectangle, from the booths that carry its number

  const angle = new Map<number, number>();
  const core = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let hall = 2; hall <= 6; hall++) {
    const own = rects.filter((r) => BOOTH_RE.exec(r.id)?.[1] === String(hall));
    if (own.length < 4) continue;
    const a = median(own.map((r) => r.angle));
    // A booth turned differently from its hall's grid usually stands somewhere else.
    const pts = own.filter((r) => Math.abs(r.angle - a) < 1.5).flatMap((r) => r.poly.map((p) => turn(p, a)));
    angle.set(hall, a);
    core.set(hall, {
      x0: Math.min(...pts.map((p) => p[0])),
      y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])),
      y1: Math.max(...pts.map((p) => p[1])),
    });
  }
  // Hall 1 has no booths. Its floor is the one four-sided dark slab in the background layer
  // that holds the Festival Stage.
  const festival = rects.find((r) => /FESTIVAL STAGE/i.test(r.title));
  if (festival) {
    const a = ((((festival.angle + 45) % 90) + 90) % 90) - 45;
    const slab = meshes.find((m) => {
      if (m.positions.length < 4 || m.positions.length > 6) return false;
      const xs = m.positions.map((p) => p[0]);
      const ys = m.positions.map((p) => p[1]);
      const inside = festival.c[0] > Math.min(...xs) && festival.c[0] < Math.max(...xs) && festival.c[1] > Math.min(...ys) && festival.c[1] < Math.max(...ys);
      return inside && Math.max(...xs) - Math.min(...xs) < 160;
    });
    if (slab) {
      const pts = slab.positions.map((p) => turn(p, a));
      angle.set(1, a);
      core.set(1, {
        x0: Math.min(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        x1: Math.max(...pts.map((p) => p[0])),
        y1: Math.max(...pts.map((p) => p[1])),
      });
    }
  }

  /** Distance from a plan point to a hall's core rectangle; 0 inside. */
  const gap = (hall: number, p: Pt): number => {
    const k = core.get(hall)!;
    const q = turn(p, angle.get(hall)!);
    return Math.hypot(Math.max(k.x0 - q[0], 0, q[0] - k.x1), Math.max(k.y0 - q[1], 0, q[1] - k.y1));
  };

  // ---- places, each put in the hall it physically stands in

  const places = new Map<string, Place>();
  const halls = new Map<number, HallFrame>();
  const byHall = new Map<number, Place[]>();
  for (const r of rects) {
    const code = CODE_RE.exec(r.id);
    if (!code && !r.title) continue; // unnamed back-of-house boxes
    const name = code ? r.id.split(" ")[0]! : pretty(r.id ? r.id.split(" | ")[0]! : r.title);
    const key0 = name;
    // The hall a place is numbered or labelled for wins while the place stands in or right by it;
    // otherwise geometry decides (a few booths carry another hall's number).
    const named = Number(r.id.match(/\| Hall (\d)/)?.[1] ?? code?.[1] ?? 0) || null;
    const ranked = [...core.keys()].map((hall) => ({ hall, d: gap(hall, r.c) })).sort((a, b) => a.d - b.d);
    const best = ranked.find((x) => x.hall === named && x.d <= 8) ?? ranked[0];
    if (!best || best.d > 45) continue;
    let key = key0;
    for (let n = 2; places.has(key); n++) key = `${key0} ${n}`;
    const place: Place = {
      key,
      name,
      title: r.title,
      kind: /\bSTAGE\b/i.test(r.title) ? "stage" : BOOTH_RE.test(r.id) || code ? "booth" : "area",
      access: r.title.match(/\((premium|open)\)/i)?.[1]?.toLowerCase() ?? null,
      hall: best.hall,
      poly: r.poly,
      c: r.c,
      w: r.w,
      h: r.h,
    };
    places.set(key, place);
    byHall.set(best.hall, [...(byHall.get(best.hall) ?? []), place]);
  }

  // ---- toilets and hall entrances: point features, filed under the nearest hall

  for (const poi of pois) {
    const wc = /^Toilets/i.test(poi.name);
    const door = /^Entrance \| Hall/i.test(poi.name);
    if (!wc && !door) continue;
    const best = [...core.keys()].map((hall) => ({ hall, d: gap(hall, poi.c) })).sort((a, b) => a.d - b.d)[0];
    if (!best || best.d > 45) continue;
    const [head, tail = ""] = poi.name.split(" | ");
    // A block the organiser names after one hall is filed under that hall when it stands beside it,
    // so the name and the map shown agree; blocks named for two halls go by where they stand.
    const named = Number(/^Hall (\d)\b(?!-)/.exec(tail)?.[1] ?? 0);
    const hall = core.has(named) && gap(named, poi.c) <= 30 ? named : best.hall;
    const name = wc
      ? `Toilets${/Female/i.test(head!) ? " (women)" : /Male/i.test(head!) ? " (men)" : ""} · ${tail}`
      : `Entrance · ${tail}`;
    if (places.has(name)) continue;
    const place: Place = {
      key: name,
      name,
      title: "",
      kind: wc ? "wc" : "door",
      access: null,
      hall,
      poly: poi.box,
      c: poi.c,
      w: poi.box[1]![0] - poi.box[0]![0],
      h: poi.box[2]![1] - poi.box[1]![1],
    };
    places.set(name, place);
    byHall.set(hall, [...(byHall.get(hall) ?? []), place]);
  }

  // ---- hall frames: everything that stands in the hall, plus a margin

  const PAD = 4;
  for (const [hall, list] of byHall) {
    const a = angle.get(hall)!;
    const k = core.get(hall)!;
    const solid = list.filter((p) => p.kind !== "wc" && p.kind !== "door");
    const pts = solid.flatMap((p) => p.poly.map((q) => turn(q, a)));
    let x0 = Math.min(k.x0, ...pts.map((p) => p[0])) - PAD;
    let y0 = Math.min(k.y0, ...pts.map((p) => p[1])) - PAD;
    let x1 = Math.max(k.x1, ...pts.map((p) => p[0])) + PAD;
    let y1 = Math.max(k.y1, ...pts.map((p) => p[1])) + PAD;
    // Toilets and entrances sit just outside the booths; the frame grows to take in the near ones.
    for (const p of list.filter((q) => q.kind === "wc" || q.kind === "door")) {
      const q = turn(p.c, a);
      if (q[0] < x0 - 32 || q[0] > x1 + 32 || q[1] < y0 - 32 || q[1] > y1 + 32) continue;
      x0 = Math.min(x0, q[0] - PAD);
      y0 = Math.min(y0, q[1] - PAD);
      x1 = Math.max(x1, q[0] + PAD);
      y1 = Math.max(y1, q[1] + PAD);
    }
    halls.set(hall, { hall, angle: a, x0, y0, W: x1 - x0, H: y1 - y0, places: list, left: null, right: null });
  }
  // Neighbours along the arc, by where the hall centres sit in the plan (small x = left).
  const order = [...halls.values()]
    .map((f) => ({ hall: f.hall, x: median(f.places.filter((p) => p.kind !== "wc" && p.kind !== "door").map((p) => p.c[0])) }))
    .sort((p, q) => p.x - q.x)
    .map((p) => p.hall);
  order.forEach((hall, i) => {
    halls.get(hall)!.left = order[i - 1] ?? null;
    halls.get(hall)!.right = order[i + 1] ?? null;
  });

  return { hash: createHash("sha256").update(src).digest("hex"), fetchedAt: "", halls, places };
}

export async function loadFloor(warn: (m: string) => void): Promise<Floor | null> {
  const src = await cached(config.floorplan.url, FILE, META, (t) => t.includes("__fpPaths") && (t.match(/<rect /g)?.length ?? 0) > 100, warn);
  if (!src) {
    warn("no floor plan available: nothing can be built");
    return null;
  }
  try {
    const floor = parseFloor(src);
    try {
      floor.fetchedAt = JSON.parse(readFileSync(META, "utf8")).fetchedAt ?? "";
    } catch {
      floor.fetchedAt = "";
    }
    if (floor.halls.size < 3 || floor.places.size < 100) throw new Error(`only ${floor.halls.size} halls and ${floor.places.size} places found`);
    return floor;
  } catch (err) {
    warn(`floor plan could not be read (${(err as Error).message}): nothing can be built`);
    return null;
  }
}

/** Plan coordinates → a hall's upright frame. */
export function toFrame(frame: HallFrame, p: Pt): Pt {
  const q = turn(p, frame.angle);
  return [q[0] - frame.x0, q[1] - frame.y0];
}

/** A hall frame point → plan coordinates. */
export function fromFrame(frame: HallFrame, p: Pt): Pt {
  return turn([p[0] + frame.x0, p[1] + frame.y0], -frame.angle);
}

/** All halls at once, as they stand along the building: what templates/overview.svg.njk draws. */
export function overviewDrawing(floor: Floor) {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const halls = [...floor.halls.values()]
    .sort((a, b) => a.hall - b.hall)
    .map((f) => {
      const corners = ([[0, 0], [f.W, 0], [f.W, f.H], [0, f.H]] as Pt[]).map((p) => fromFrame(f, p));
      const centre = fromFrame(f, [f.W / 2, f.H / 2]);
      // The entrance side is the frame's bottom edge.
      const door = [fromFrame(f, [f.W * 0.08, f.H]), fromFrame(f, [f.W * 0.92, f.H])];
      return {
        hall: f.hall,
        points: corners.map((p) => `${r1(p[0])},${r1(p[1])}`).join(" "),
        door: `M${r1(door[0]![0])} ${r1(door[0]![1])}L${r1(door[1]![0])} ${r1(door[1]![1])}`,
        cx: r1(centre[0]),
        cy: r1(centre[1]),
        corners,
      };
    });
  const all = halls.flatMap((h) => h.corners);
  const pad = 6;
  const x = Math.min(...all.map((p) => p[0])) - pad;
  const y = Math.min(...all.map((p) => p[1])) - pad;
  const w = Math.max(...all.map((p) => p[0])) + pad - x;
  const h = Math.max(...all.map((p) => p[1])) + pad - y;
  return {
    vb: [r1(x), r1(y), r1(w), r1(h)],
    halls: halls.map(({ corners: _corners, ...rest }) => rest),
    stages: [...floor.places.values()].filter((p) => p.kind === "stage").map((p) => p.poly.map((q) => `${r1(q[0])},${r1(q[1])}`).join(" ")),
    text: r1((13 / 324) * w),
  };
}

// ---------------------------------------------------------------- drawing one hall

/** What templates/hall.svg.njk draws. Coordinates are metres in the hall frame. */
export function hallDrawing(floor: Floor, frame: HallFrame) {
  // Text sizes are chosen for a map shown about 324 px wide.
  const pxPerM = 324 / frame.W;
  const fs = (px: number) => Math.round((px / pxPerM) * 100) / 100;
  const charW = 0.58;
  const pt = (p: Pt) => toFrame(frame, p).map((n) => Math.round(n * 10) / 10).join(",");

  const r1 = (n: number) => Math.round(n * 10) / 10;
  // Toilets and entrances of this hall, and those of its neighbours that fall inside the frame.
  const points = [...floor.places.values()]
    .filter((p) => p.kind === "wc" || p.kind === "door")
    .map((p) => ({ p, at: toFrame(frame, p.c) }))
    .filter(({ p, at }) => p.hall === frame.hall || (at[0] > 2 && at[0] < frame.W - 2 && at[1] > 2 && at[1] < frame.H - 2))
    .map(({ p, at }) => ({ key: p.key, kind: p.kind, x: r1(at[0]), y: r1(at[1]) }));

  const shapes = frame.places
    .filter((p) => p.kind !== "wc" && p.kind !== "door")
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .map((p) => {
      const corners = p.poly.map((q) => toFrame(frame, q));
      const xs = corners.map((q) => q[0]);
      const ys = corners.map((q) => q[1]);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bh = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

      // A label is drawn only where it can be read: it must fit the shape at a legible size.
      const fit = (text: string, sizes: number[]): { lines: string[]; size: number } | null => {
        for (const px of sizes) {
          const size = fs(px);
          const room = Math.max(1, Math.floor((bw - 1) / (size * charW)));
          if (text.length <= room && bh >= size * 1.5) return { lines: [text], size };
          const words = text.split(" ");
          for (let cut = 1; cut < words.length; cut++) {
            const a = words.slice(0, cut).join(" ");
            const b = words.slice(cut).join(" ");
            if (a.length <= room && b.length <= room && bh >= size * 2.7) return { lines: [a, b], size };
          }
        }
        return null;
      };
      let label: { lines: string[]; size: number } | null = null;
      if (p.kind === "stage") label = fit(p.name, [11, 10, 9, 8, 7]) ?? { lines: [p.name.replace(/ Stage$/, "")], size: fs(7) };
      else if (p.kind === "area") label = fit(p.name, [9, 8, 7.5]);
      // The largest booths read better by the name on their signage, set as the plan gives it.
      else label = (bw * bh > 110 && p.title ? fit(p.title, [7.5, 7]) : null) ?? fit(p.key, [9, 8, 7.5]);
      const cap = p.kind === "booth" && label !== null && label.lines.join(" ") !== p.key;

      return {
        key: p.key,
        kind: p.kind,
        cap,
        title: p.kind === "booth" ? p.title : "",
        points: p.poly.map(pt).join(" "),
        cx: Math.round(cx * 10) / 10,
        cy: Math.round(cy * 10) / 10,
        label: label && {
          size: label.size,
          lines: label.lines.map((text, i) => ({
            text,
            y: Math.round((cy + (i - (label!.lines.length - 1) / 2) * label!.size * 1.15 + label!.size * 0.35) * 10) / 10,
          })),
        },
      };
    });

  return {
    hall: frame.hall,
    W: Math.round(frame.W * 10) / 10,
    H: Math.round(frame.H * 10) / 10,
    band: fs(15),
    text: fs(9),
    small: fs(7.5),
    shapes,
    points,
  };
}
