/**
 * Walk through the wayfinder the way a thumb does, at two phone heights and in both palettes.
 *
 *   bun tools/check.ts <base-url> <out-dir>
 *
 * Real touch events. Each step prints what the page showed; screenshots land in <out-dir>.
 * Also reports what a first visit downloads.
 *
 * The places it types and taps (2G25, 2D13, 5G19, 3G07, the Catalyst Stage) are those of the
 * SFF 2026 plan. For another event, replace them with places of that plan.
 * Needs a Chromium: `bunx playwright-core install chromium`, or point CHROME_BIN at one.
 */
import { chromium, type Page } from "playwright-core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findChrome(): string {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const root = join(homedir(), ".cache", "ms-playwright");
  for (const dir of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    const bin = join(root, dir, "chrome-linux64", "chrome");
    if (dir.startsWith("chromium-") && existsSync(bin)) return bin;
  }
  throw new Error("no Chromium found; set CHROME_BIN");
}

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) {
  console.error("usage: bun tools/check.ts <base-url> <out-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: findChrome() });
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

for (const [height, scheme] of [[800, "light"], [640, "dark"]] as const) {
  const tag = `360x${height}-${scheme}`;
  const ctx = await browser.newContext({ viewport: { width: 360, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const shot = (name: string) => page.screenshot({ path: join(outDir, `${name}_${tag}.png`) });
  const here = () => page.locator("#here").innerText().then(flat);
  const routeText = () => page.locator(".route-text").first().innerText().then(flat);
  const title = () => page.locator(".card-title").first().innerText().then(flat);
  const search = async (text: string) => {
    await page.fill("#q", text);
    await settle(500);
    return (await page.locator("#view .row").allInnerTexts()).map(flat);
  };
  const points = (sel: string) => page.evaluate((s) => document.querySelector(s)?.getAttribute("points")?.trim().split(/\s+/).length ?? 0, sel);
  /** Buttons of the open card that are off screen, or that something else would take the tap for. */
  const blocked = (p: Page) =>
    p.evaluate(() => {
      const out: string[] = [];
      for (const btn of document.querySelectorAll(".card .foot button")) {
        const r = btn.getBoundingClientRect();
        const [mx, my] = [r.left + r.width / 2, r.top + r.height / 2];
        const onScreen = r.top >= 0 && r.bottom <= innerHeight;
        const reached = [[mx, my], [r.left + r.width * 0.2, my], [r.left + r.width * 0.8, my]].every(([x, y]) => btn.contains(document.elementFromPoint(x!, y!)));
        if (!onScreen || !reached) out.push(btn.textContent ?? "");
      }
      return out;
    });

  // ---- first load
  await page.goto(base, { waitUntil: "load" });
  await settle(1200);
  const label = await page.locator(".unofficial").evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { text: n.textContent ?? "", visible: r.top >= 0 && r.bottom <= innerHeight };
  });
  check(label.visible && /Unofficial/.test(label.text), `${tag}: first load shows "${label.text}" without scrolling`);
  const offSite = requests.filter((u) => !u.startsWith(base));
  check(offSite.length === 0, `${tag}: requests to other sites on first load: ${offSite.length}`);
  await shot("1-home");

  // ---- search by code and by name
  const byCode = await search("5g 19");
  check(byCode[0]?.includes("5G19") ?? false, `${tag}: search "5g 19" → ${byCode.slice(0, 2).join(" | ")}`);
  const byName = await search("sierra");
  check(byName.some((r) => /SIERRA/i.test(r)), `${tag}: search "sierra" → ${byName.slice(0, 3).join(" | ")}`);
  const byWord = await search("restroom");
  check(byWord.length > 0 && byWord.every((r) => /Toilets/.test(r)), `${tag}: search "restroom" → ${byWord.length} toilets`);
  await search("2d13");
  await shot("2-search");
  await page.locator("#view .row").first().tap();
  await settle(1500);
  check((await title()).includes("2D13"), `${tag}: tapping the result opens ${await title()}`);

  // ---- set the start by search; a walk inside one hall
  await page.locator(".here-main").tap();
  await settle(500);
  await page.fill(".pick-input", "2g25");
  await settle(500);
  await shot("3-pick-start");
  await page.locator("#sheet .row").first().tap();
  await settle(1500);
  check((await here()).includes("2G25"), `${tag}: start set by search → "${await here()}"`);
  const same = await routeText();
  check(/\d+ m on foot/.test(same) && (await points(".hallmap .path")) > 2, `${tag}: same hall 2G25 → 2D13: ${same} [path of ${await points(".hallmap .path")} points]`);
  check((await blocked(page)).length === 0, `${tag}: the card's buttons are on screen and take the tap [blocked: ${(await blocked(page)).join(", ") || "none"}]`);
  await shot("4-same-hall");

  // ---- across halls
  await search("catalyst");
  await page.locator("#view .row").first().tap();
  await settle(1800);
  const cross = await routeText();
  check(/\d+ m on foot/.test(cross) && (await points(".ovmap .ov-path")) > 5, `${tag}: across halls 2G25 → Catalyst Stage: ${cross} [whole-venue path of ${await points(".ovmap .ov-path")} points]`);
  check((await blocked(page)).length === 0, `${tag}: buttons still clear on the taller card [blocked: ${(await blocked(page)).join(", ") || "none"}]`);
  await shot("5-cross-hall");

  // ---- arrive; then set the start by tapping a booth
  await page.locator(".foot .btn.strong").tap();
  await settle(1500);
  check((await here()).includes("Catalyst") && (await routeText()).includes("You are here"), `${tag}: "I've arrived" → "${await here()}", card says: ${await routeText()}`);
  await page.locator('.hallmap [data-k="3G07"]').tap();
  await settle(1500);
  check((await title()).includes("3G07"), `${tag}: tapping booth 3G07 on the map opens ${await title()}`);
  await page.locator(".foot .btn.strong").tap();
  await settle(1200);
  check((await here()).includes("3G07"), `${tag}: start set by tap → "${await here()}"`);

  // ---- nearest toilet, from Hall 2 and from Hall 5
  for (const [start, hall] of [["2G25", 2], ["5G19", 5]] as const) {
    await page.evaluate(([k, h]) => localStorage.setItem("here", JSON.stringify({ key: k, name: k, hall: h })), [start, hall] as const);
    await page.goto(base, { waitUntil: "load" });
    await settle(900);
    await page.locator('.chip[data-cat="wc"]').tap();
    await settle(1500);
    const offered = (await page.locator("#sheet .row").allInnerTexts()).map(flat);
    console.log(`     ${tag}: nearest toilets from ${start}: ${offered.join(" | ")}`);
    await shot(`6-toilet-list-${start}`);
    await page.locator("#sheet .row").first().tap();
    await settle(1800);
    check(/Toilets/.test(await title()) && /\d+ m on foot/.test(await routeText()), `${tag}: nearest toilet from ${start} → ${await title()} · ${await routeText()}`);
    await shot(`6-nearest-toilet-${start}`);
  }
  await page.goto(base, { waitUntil: "load" });
  await settle(700);
  await page.locator('.chip[data-cat="food"]').tap();
  await settle(1500);
  check(/\d+ m on foot/.test(await routeText()), `${tag}: nearest food from 5G19 → ${await title()} · ${await routeText()}`);

  // ---- language
  await page.locator("#lang").tap();
  await settle(700);
  const zh = await page.locator(".unofficial").innerText();
  check(/非官方/.test(zh), `${tag}: 中文 → "${zh}"`);
  await shot("7-chinese");
  await page.reload({ waitUntil: "load" });
  await settle(700);
  check(/非官方/.test(await page.locator(".unofficial").innerText()), `${tag}: the language choice survives a reload`);
  await page.locator("#lang").tap();
  await settle(400);
  await page.locator("#about-open").tap();
  await settle(500);
  check(/Unofficial/.test(await page.locator("#sheet").innerText()), `${tag}: the about sheet repeats the unofficial label`);
  await shot("8-about");
  await ctx.close();

  // ---- a shared link, opened cold in a fresh browser; then offline
  const cold = await browser.newContext({ viewport: { width: 360, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  const p2 = await cold.newPage();
  let bytes = 0;
  const files: string[] = [];
  p2.on("response", async (res) => {
    const size = Number((await res.allHeaders())["content-length"] ?? 0) || (await res.body().catch(() => Buffer.alloc(0))).length;
    bytes += size;
    files.push(new URL(res.url()).pathname);
  });
  await p2.goto(`${base}/?to=5G19&from=2G25`, { waitUntil: "load" });
  await p2.waitForTimeout(2500);
  const linked = flat(await p2.locator(".route-text").first().innerText());
  check(/2G25/.test(linked) && /\d+ m on foot/.test(linked), `${tag}: shared link /?to=5G19&from=2G25 opened cold → ${flat(await p2.locator(".card-title").first().innerText())} · ${linked}`);
  check((await blocked(p2)).length === 0, `${tag}: buttons clear on the shared-link card [blocked: ${(await blocked(p2)).join(", ") || "none"}]`);
  await p2.screenshot({ path: join(outDir, `9-shared-link_${tag}.png`) });
  const kept = await p2.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 30; i++) {
      const keys = await caches.keys();
      const n = keys.length ? (await (await caches.open(keys[0]!)).keys()).length : 0;
      if (n >= 12) return n;
      await new Promise((r) => setTimeout(r, 500));
    }
    return 0;
  });
  await p2.waitForTimeout(500);
  console.log(`     ${tag}: first visit fetched ${files.length} files; after the offline copy filled, ${Math.round(bytes / 1024)} KB of response bodies in total`);
  await cold.setOffline(true);
  try {
    await p2.goto(`${base}/?to=Catalyst%20Stage&from=5G19`, { waitUntil: "load", timeout: 15000 });
    await p2.waitForTimeout(2000);
    const off = flat(await p2.locator(".route-text").first().innerText());
    const path = await p2.evaluate(() => document.querySelector(".ovmap .ov-path")?.getAttribute("points")?.trim().split(/\s+/).length ?? 0);
    check(kept >= 12 && /\d+ m on foot/.test(off) && path > 5, `${tag}: offline after one visit [${kept} files kept] → ${off}, whole-venue path of ${path} points`);
  } catch (err) {
    check(false, `${tag}: offline: ${(err as Error).message.split("\n")[0]}`);
  }
  await cold.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
