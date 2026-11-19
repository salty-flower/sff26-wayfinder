/**
 * The organiser's walkway graph (ExpoFP wayfinding data) → a compact graph the page can route on.
 *
 * What the fields turned out to mean, read off the data itself:
 * - `virtual`: only the three segments that join Level 1 and Level 2 (stairs, escalators, lifts).
 * - `unaccessible`: only the nine short segments leading up to those level changes, on both
 *   levels. Left out: on Level 1 they lead nowhere else.
 * - `unidirection`: two short chains at the Hall 6 end. Kept one-way, from p0 to p1.
 * - `weight`: 0.1 on most dead-end stubs into booths, 0.4 on aisles, 0.3 mostly on Level 2,
 *   0.5 on one long chain behind the halls. It looks like a line class rather than a cost, so it
 *   is not used: an edge costs its length in metres.
 * - `lineEnds`: exactly the graph's dead ends. A dead end inside a booth is that booth's door.
 *
 * Only Level 1 is kept. Coordinates are stored in decimetres from the plan's corner.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { config } from "./config.ts";
import { cached, type Floor, type Place, type Pt } from "./floorplan.ts";
import { ROOT } from "./tpl.ts";

const FILE = join(ROOT, "data", "floorplan", "wf.data.js");
const META = join(ROOT, "data", "floorplan", "wf.meta.json");

export interface Walkways {
  hash: string;
  /** Node coordinates in decimetres: x0, y0, x1, y1, … */
  nodes: number[];
  /** Two-way edges as node index pairs: a0, b0, a1, b1, … */
  edges: number[];
  /** One-way edges, walkable from the first node to the second. */
  oneWay: number[];
  /** place key → the nodes where a walk to that place ends. */
  access: Map<string, number[]>;
  /** Places with no walkway at or near them. */
  unreached: string[];
  /** Places that have no door of their own in the data and were tied to the nearest walkway. */
  snapped: string[];
  /** Walkway nodes that lie inside a stage's seating area: node, place index, node, place index, … */
  inStage: number[];
}

interface RawLine {
  p0: { layer: string; x: number; y: number };
  p1: { layer: string; x: number; y: number };
  unaccessible: boolean;
  unidirection: boolean;
  virtual: boolean;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** Distance from a point to a polygon's outline; 0 inside. */
function gapTo(p: Pt, poly: Pt[]): number {
  if (inside(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

export function parseWalkways(src: string, floor: Floor): Walkways {
  const data: { lines: RawLine[] } = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  const lines = data.lines.filter((l) => l.p0.layer === "Level1" && l.p1.layer === "Level1" && !l.unaccessible && !l.virtual);

  // ---- nodes, merged on a 10 cm grid

  const ids = new Map<string, number>();
  const pts: Pt[] = [];
  const idOf = (p: { x: number; y: number }) => {
    const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = pts.length;
      ids.set(key, id);
      pts.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
    }
    return id;
  };
  type Edge = { a: number; b: number; oneWay: boolean };
  const seen = new Set<string>();
  let edges: Edge[] = [];
  for (const l of lines) {
    const a = idOf(l.p0);
    const b = idOf(l.p1);
    if (a === b) continue;
    const key = l.unidirection ? `${a}>${b}` : `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a, b, oneWay: l.unidirection });
  }

  // ---- keep the one connected network; scraps that touch nothing else cannot be walked to

  const neighbours = (list: Edge[]) => {
    const adj = new Map<number, number[]>();
    for (const e of list) {
      adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
      adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
    }
    return adj;
  };
  let adj = neighbours(edges);
  const group = new Map<number, number>();
  const sizes: number[] = [];
  for (const start of adj.keys()) {
    if (group.has(start)) continue;
    const g = sizes.length;
    let size = 0;
    const stack = [start];
    group.set(start, g);
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of adj.get(u) ?? []) {
        if (!group.has(v)) {
          group.set(v, g);
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  edges = edges.filter((e) => group.get(e.a) === main);
  adj = neighbours(edges);
  const live = [...adj.keys()];
  const deadEnds = live.filter((n) => adj.get(n)!.length === 1);

  // ---- where each place is entered

  const access = new Map<string, number[]>();
  const unreached: string[] = [];
  const snapped: string[] = [];
  const places = [...floor.places.values()];
  // A dead end is the door of the place it lies in, or of the nearest place it stops just short
  // of. Where places overlap, the smaller one wins.
  const owner = new Map<number, Place>();
  for (const n of deadEnds) {
    const near = places
      .map((p) => ({ p, gap: gapTo(pts[n]!, p.poly) }))
      .filter((x) => x.gap <= 1.5)
      .sort((x, y) => x.gap - y.gap || x.p.w * x.p.h - y.p.w * y.p.h);
    if (near[0]) owner.set(n, near[0].p);
  }
  for (const place of places) {
    const doors = deadEnds.filter((n) => owner.get(n) === place);
    if (doors.length) {
      access.set(place.key, doors);
      continue;
    }
    // No door in the data: tie the place to the closest walkway point just outside it.
    let best = -1;
    let bestGap: number = config.floorplan.snapMetres;
    for (const n of live) {
      if (owner.has(n)) continue;
      const g = gapTo(pts[n]!, place.poly);
      if (g > 0 && g < bestGap) {
        bestGap = g;
        best = n;
      }
    }
    if (best >= 0) {
      access.set(place.key, [best]);
      snapped.push(place.key);
    } else {
      unreached.push(place.key);
    }
  }

  // ---- drop stubs that lead to nothing a visitor can pick, then renumber

  const wanted = new Set([...access.values()].flat());
  for (let changed = true; changed; ) {
    changed = false;
    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const before = edges.length;
    edges = edges.filter((e) => !((degree.get(e.a) === 1 && !wanted.has(e.a)) || (degree.get(e.b) === 1 && !wanted.has(e.b))));
    changed = edges.length !== before;
  }
  const renumber = new Map<number, number>();
  const nodes: number[] = [];
  const idx = (n: number) => {
    let i = renumber.get(n);
    if (i === undefined) {
      i = renumber.size;
      renumber.set(n, i);
      nodes.push(Math.round(pts[n]![0] * 10), Math.round(pts[n]![1] * 10));
    }
    return i;
  };
  const twoWay: number[] = [];
  const oneWay: number[] = [];
  for (const e of edges) (e.oneWay ? oneWay : twoWay).push(idx(e.a), idx(e.b));
  for (const [key, list] of access) access.set(key, list.filter((n) => renumber.has(n)).map((n) => renumber.get(n)!));

  // Aisles also run through the stages' seating. The page makes those costly to cut through, so
  // a route only enters a stage that is its start or its goal.
  const inStage: number[] = [];
  places.forEach((place, at) => {
    if (place.kind !== "stage") return;
    for (const [n, i] of renumber) if (inside(pts[n]!, place.poly)) inStage.push(i, at);
  });

  return { hash: createHash("sha256").update(src).digest("hex"), nodes, edges: twoWay, oneWay, access, unreached, snapped, inStage };
}

export async function loadWalkways(floor: Floor, warn: (m: string) => void): Promise<Walkways | null> {
  const src = await cached(config.floorplan.walkwaysUrl, FILE, META, (t) => t.includes('"lines"') && t.includes('"lineEnds"'), warn);
  if (!src) {
    warn("no walkway data available: nothing can be built");
    return null;
  }
  try {
    const walk = parseWalkways(src, floor);
    if (walk.edges.length < 500) throw new Error(`only ${walk.edges.length / 2} walkway segments found`);
    return walk;
  } catch (err) {
    warn(`walkway data could not be read (${(err as Error).message}): nothing can be built`);
    return null;
  }
}

/**
 * Shortest walk between two places along the walkways: its length in metres and the points it
 * passes. The page has its own copy of this search; this one serves the build's checks.
 * Seating of a stage that is neither end of the walk costs four times its length, so a route
 * goes round a stage rather than through it.
 */
export function walkBetween(walk: Walkways, from: string, to: string, placeIndex?: Map<string, number>): { m: number; pts: Pt[] } | null {
  const starts = walk.access.get(from);
  const goals = new Set(walk.access.get(to));
  if (!starts?.length || !goals.size) return null;
  const count = walk.nodes.length / 2;
  const stageOf = new Map<number, number>();
  for (let i = 0; i < walk.inStage.length; i += 2) stageOf.set(walk.inStage[i]!, walk.inStage[i + 1]!);
  const ends = new Set([placeIndex?.get(from), placeIndex?.get(to)]);
  const toll = (n: number) => (stageOf.has(n) && !ends.has(stageOf.get(n)) ? 4 : 1);
  const adj: [number, number][][] = Array.from({ length: count }, () => []);
  const len = (a: number, b: number) => Math.hypot(walk.nodes[a * 2]! - walk.nodes[b * 2]!, walk.nodes[a * 2 + 1]! - walk.nodes[b * 2 + 1]!) / 10;
  for (let i = 0; i < walk.edges.length; i += 2) {
    const a = walk.edges[i]!;
    const b = walk.edges[i + 1]!;
    adj[a]!.push([b, len(a, b)]);
    adj[b]!.push([a, len(a, b)]);
  }
  for (let i = 0; i < walk.oneWay.length; i += 2) adj[walk.oneWay[i]!]!.push([walk.oneWay[i + 1]!, len(walk.oneWay[i]!, walk.oneWay[i + 1]!)]);
  // `cost` steers the search; `dist` is the real length of the walk it finds.
  const cost = new Float64Array(count).fill(Infinity);
  const dist = new Float64Array(count).fill(Infinity);
  const prev = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  for (const s of starts) {
    cost[s] = 0;
    dist[s] = 0;
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < count; i++) if (!done[i] && cost[i]! < Infinity && (u < 0 || cost[i]! < cost[u]!)) u = i;
    if (u < 0) return null;
    if (goals.has(u)) {
      const pts: Pt[] = [];
      for (let n = u; n >= 0; n = prev[n]!) pts.push([walk.nodes[n * 2]! / 10, walk.nodes[n * 2 + 1]! / 10]);
      return { m: Math.round(dist[u]!), pts: pts.reverse() };
    }
    done[u] = 1;
    for (const [v, w] of adj[u]!) {
      const c = cost[u]! + w * Math.max(toll(u), toll(v));
      if (c < cost[v]!) {
        cost[v] = c;
        dist[v] = dist[u]! + w;
        prev[v] = u;
      }
    }
  }
}
