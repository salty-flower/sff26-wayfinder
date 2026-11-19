# SFF 2026 Wayfinder

A phone-first map for finding your way around Singapore FinTech Festival 2026
(Singapore EXPO, 18–20 November 2026).
Search for a booth, exhibitor, stage, toilet or food area,
say where you are,
and get a walk along the aisles with its length in metres.

**Unofficial.**
This project is not affiliated with, endorsed by or run by
Singapore FinTech Festival, MAS, GFTN or Singapore EXPO.
The organiser's own interactive map is the authority:
<https://sgfintechfestival2026.expofp.com/>.

It was built for this one event and is not maintained after it.

## What it does

- One search box over every booth code and exhibitor name, the stages, lounges, food areas,
  information kiosks, registration, toilets and hall entrances.
  Matching is forgiving: `5g 19`, `5G19-A` and `restroom` all find something.
- Each place opens on a map of its hall, turned upright with the entrance side at the bottom,
  with the neighbouring halls named on either side.
- "I'm here", set by search or by tapping a booth, then a route along the walkways
  to anywhere else, inside a hall or across halls.
- Nearest toilet, food or information kiosk, by walking distance.
- Links that carry a route: `/?to=5G19&from=2G25`.
- Works offline after the first visit. English and Chinese.

The site is static files only.
It sets no cookies, has no accounts and no analytics, and makes no requests to other sites.
The chosen start point and language are kept in the browser's `localStorage`.

## Whose data this is

The floor plan and the walkway graph belong to the event organiser.
They are **not in this repository**.
The build downloads them from the organiser's public ExpoFP map,
caches them under `data/` (git-ignored),
and writes a compact derived form into `dist/` (also git-ignored).
If you publish a build, you are publishing data derived from the organiser's plan;
keep the unofficial label and the link back to their map.

The two files are undocumented internals of the ExpoFP viewer, not an API.
Their location and format can change without notice,
and the parsers here were written against one event's files.

## Build and deploy your own copy

Requirements: [Bun](https://bun.sh), [Nushell](https://www.nushell.sh) for the wrapper script,
and [wrangler](https://developers.cloudflare.com/workers/wrangler/) only if you deploy to Cloudflare Pages.

```sh
bun install
nu build.nu            # or: bun run build
```

This fetches the plan, and writes the site to `dist/`.
Any static file server can serve that folder;
`_headers` is read by Cloudflare Pages and ignored elsewhere.

To publish to Cloudflare Pages:

```sh
cp .env.example .env   # set WAYFINDER_PAGES_PROJECT
wrangler login
nu build.nu --deploy
```

The Pages project is created on first deploy.
A build whose inputs have not changed has the same build id and is not deployed again;
`--force` overrides that.
After a deploy the script checks that the new build is the one answering,
that the `X-Robots-Tag: noindex` header is present and that no cookie is set.

The site asks search engines to stay away (`robots.txt`, `noindex`).
Remove that in `src/build.ts` and `templates/index.njk` if you want it indexed.

### Checking a deployed copy

```sh
bunx playwright-core install chromium
bun tools/check.ts https://your-copy.example shots/
```

`tools/check.ts` drives a phone-sized Chromium with real touch events at 360×800 and 360×640,
in light and dark:
search by code and by name, setting the start both ways, routes inside a hall and across halls,
nearest toilet, a shared link opened cold, the language toggle, and a visit with the network off.
It prints what the page showed at each step and saves screenshots.
The places it uses are SFF 2026 booths; change them for another event.
The Chromium lookup knows the Linux layout of Playwright's cache;
elsewhere, set `CHROME_BIN`.

## Pointing it at another ExpoFP-hosted event

Start in `src/config.ts`:

- `name`: the page title.
- `official`: the organiser's map, linked from the about sheet.
- `floorplan.url` and `floorplan.walkwaysUrl`:
  `https://<event>.expofp.com/data/fp.svg.<Layer>.js` and `…/data/wf.data.js`.
  Open the organiser's map with the browser's network panel to see the real names.
- `floorplan.spellings`: names the plan writes in capitals that should keep inner capitals.
- `floorplan.snapMetres`: how far a doorless booth may be from a walkway and still be tied to it.

Then expect to edit code, because several things are specific to this venue:

- `src/floorplan.ts` assumes booth codes begin with the hall number (`5G19` is in Hall 5),
  derives each hall's rotation from the booths that carry its number,
  and has a special case for Hall 1, which has no booths.
- Toilets and entrances are recognised by this plan's names (`Toilets | Hall 5`, `Entrance | Hall 4 East`).
- Only the layer called `Level1` is read, from both files.
- The wording of the unofficial label, in `templates/index.njk` and in the dictionary at the top of `assets/app.js`,
  names this event's organisers.
- The everyday words that find a category (`restroom`, `coffee`, `洗手间`) are in `assets/app.js`.

## The data format

These took time to work out and are not written down anywhere else.

### Floor plan (`fp.svg.<Layer>.js`)

A script that carries an SVG drawing as a string,
plus a JSON array of meshes assigned to `window['__fpPaths…']`.

- Booths are `<rect id="b<code>" data-title="<exhibitor>" x y width height transform="rotate(a)">`.
  Units are metres.
- **The rotation is about the rectangle's own centre.**
  Not about the drawing origin (that scatters the halls across the page),
  and not about the rectangle's `(x, y)` corner
  (that looks right from a distance but moves booths by metres in the most rotated hall).
  The walkway graph settles it:
  with the centre as pivot, 1 aisle junction falls inside a Hall 2 booth;
  with the corner, 97 do.
- Entrances, toilets and similar point features are `<g id="b<name>">` groups with no rectangle.
  Their shapes are in the mesh array, referenced by `data-index`.
- The building is an arc, so each hall has its own rotation (from about 42° to −18° here).
  Undoing a hall's rotation gives an upright frame with the entrance side on one edge.
- A few booths carry one hall's number and stand in another;
  a booth whose rotation differs from its hall's grid is usually one of those.

### Walkway graph (`wf.data.js`)

A script that carries one JSON object with a `lines` array.
Each line has two end points `p0` and `p1` (`layer`, `x`, `y`, in the plan's metres) and some flags.
End points that coincide to within 10 cm are the same junction.

- `virtual`: true only on the three segments that join Level 1 and Level 2
  (stairs, escalators, lifts).
- `unaccessible`: true only on the nine short segments that lead up to those level changes.
  Both kinds are dropped here, since only one level is drawn.
- `unidirection`: true on two short chains at one end of the building.
  Treated as one-way from `p0` to `p1`.
  That direction is an assumption; nothing in the data confirms it.
- `weight`: **not determined.**
  It is 0.1 on most dead-end stubs into booths, 0.4 on aisles, 0.3 mostly on Level 2,
  and 0.5 on one long chain behind the halls.
  It reads like a line class more than a cost, so it is ignored: an edge costs its length.
- `lineEnds` lists exactly the dead ends of the graph.
  A dead end inside a booth is that booth's door.

What the build does with it:

- Keeps the one connected network and drops scraps that touch nothing.
- A booth with no dead end inside it has no door in the data.
  It is tied to the nearest walkway point within `snapMetres` of its edge;
  a booth with nothing that close is reported as unreachable and gets no route.
- Aisles also run through the seating of the stages.
  Crossing a stage that is neither end of the walk costs four times its length,
  so routes go round.

## Known limits

- No live positioning. You say where you are.
- Distances are metres along the walkways, not minutes. Crowds decide the minutes.
- Halls 3 and 5 have no entrance markers in the plan, so none are drawn there.
- Some of the organiser's walkway lines pass through large open stands;
  a route may be drawn across one.
- In the plan as fetched on 19 November 2026, six booths in Hall 4 had no walkway near them
  and get a location but no route.
- Stage sessions, exhibitor descriptions and the agenda are out of scope.

## Layout

- `src/config.ts`: the knobs.
- `src/floorplan.ts`: plan → places and one upright frame per hall.
- `src/walkways.ts`: walkway graph → compact routing graph.
- `src/build.ts`: writes `dist/`.
- `templates/`: the page, the hall and overview drawings, the service worker.
- `assets/app.js`, `assets/app.css`: the page itself; no framework, no bundler.
- `tools/check.ts`: the touch walkthrough.
- `build.nu`: build and deploy wrapper.

## Licence

MIT for the code, see [LICENSE](LICENSE).
The licence does not cover the organiser's floor plan or anything derived from it.
