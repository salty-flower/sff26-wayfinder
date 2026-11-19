// SFF 2026 Wayfinder: find a place, say where you are, get a walk along the aisles.
// One static page. No accounts, no cookies, no requests to anyone else. The only thing kept on
// the device is the start you chose and the language (localStorage).
(() => {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DATA = JSON.parse($("#data").textContent);
  const hallInfo = DATA.halls;
  const view = $("#view");
  const input = $("#q");

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
    },
  };

  // ---- words, in two languages. Place names stay as the organiser wrote them.

  const WORDS = {
    en: {
      unofficial: "Unofficial · not affiliated with SFF, MAS, GFTN or Singapore EXPO",
      search: "Booth, exhibitor, stage, toilet…",
      other: "中文",
      venue: "Whole venue",
      tapHall: "Tap a hall, or search above.",
      tapBooth: "Tap any booth to see it.",
      nearest: "Nearest",
      wc: "Toilet",
      food: "Food & drink",
      info: "Info kiosk",
      stages: "Stages",
      whereAreYou: "Where are you?",
      imAt: "I'm at",
      pickStart: "Where are you now?",
      pickHint: "Type a booth code or a name, or pick a stage. You can also tap a booth on any map.",
      pickPlaceholder: "Booth or name: 5G19 · Sierra · Catalyst",
      none: "Nothing found. Try the first characters of a booth code, or one word of the name.",
      from: "From",
      linkStart: "start from the link",
      walk: (m) => `about ${m} m on foot`,
      youAreHere: "You are here",
      noPath: "no walkway data",
      back: "Back of hall",
      arrived: "I've arrived",
      imHere: "I'm here",
      change: "Change start",
      setStart: "Set where I am",
      share: "Share",
      copied: "Link copied",
      hall: "Hall",
      entrance: "entrance side",
      rear: "back of hall",
      middle: "middle of the hall",
      towards: (h) => `towards Hall ${h}`,
      needStart: "Set where you are first; then this finds the nearest one.",
      nearWc: "Nearest toilets",
      noneNear: "None could be reached from there.",
      loading: "Loading…",
      failed: "The map data did not load. Check your connection and try again.",
      close: "Close",
      aboutTitle: "About this map",
      about: (d) => [
        "An unofficial wayfinding helper. It is not affiliated with, endorsed by or run by Singapore FinTech Festival, MAS, GFTN or Singapore EXPO.",
        `Booths, stages and walkways come from the organiser's public floor plan, fetched on ${d.fetched}. The organiser's own map is the authority:`,
        "Known limits:",
      ],
      limits: (d) => [
        "The plan marks no doors for Halls 3 and 5. Their maps show the entrance side, not the doors.",
        "Some of the organiser's walkway lines run through large open booths. Follow the direction of a route, not its exact line.",
        d.unreached.length ? `The walkway data does not reach ${d.unreached.length} places: ${d.unreached.join(", ")}.` : "",
        "Distances are metres along the aisles, not minutes. Crowds decide the minutes.",
        "There is no live positioning. You say where you are.",
      ],
      privacy: "This site stores nothing about visitors: no accounts, no cookies, no analytics. Your chosen start and language stay on your device.",
    },
    zh: {
      unofficial: "非官方 · 与 SFF、MAS、GFTN、Singapore EXPO 无关",
      search: "摊位号、展商、舞台、洗手间…",
      other: "EN",
      venue: "全场",
      tapHall: "点一个馆，或在上面搜索。",
      tapBooth: "点任意摊位查看。",
      nearest: "最近的",
      wc: "洗手间",
      food: "餐饮",
      info: "问询台",
      stages: "舞台",
      whereAreYou: "我在哪？",
      imAt: "我在",
      pickStart: "你现在在哪？",
      pickHint: "输入摊位号或名字，或直接选一个舞台；也可以在任意一张地图上点摊位。",
      pickPlaceholder: "摊位号或名字：5G19 · Sierra · Catalyst",
      none: "没找到。试试摊位号的前几位，或名字里的一个词。",
      from: "从",
      linkStart: "链接里的起点",
      walk: (m) => `步行约 ${m} 米`,
      youAreHere: "你在这里",
      noPath: "无步道数据",
      back: "后场",
      arrived: "我到了",
      imHere: "我在这",
      change: "改起点",
      setStart: "设我在哪",
      share: "分享",
      copied: "已复制链接",
      hall: "Hall",
      entrance: "靠入口侧",
      rear: "靠后场",
      middle: "中段",
      towards: (h) => `偏 Hall ${h} 一边`,
      needStart: "先设好你在哪，再找最近的。",
      nearWc: "最近的洗手间",
      noneNear: "从那里走不到任何一个。",
      loading: "载入中…",
      failed: "地图数据没载入，检查网络后再试。",
      close: "关闭",
      aboutTitle: "关于这张图",
      about: (d) => [
        "这是一个非官方的找路小工具，与 Singapore FinTech Festival、MAS、GFTN、Singapore EXPO 均无关联，也未获其认可。",
        `摊位、舞台和步道来自主办方公开的平面图，抓取于 ${d.fetched}。以主办方自己的地图为准：`,
        "已知的局限：",
      ],
      limits: (d) => [
        "平面图没有标出 Hall 3 和 Hall 5 的门，这两个馆只标了入口侧。",
        "主办方的部分步道线穿过大型开放式展位。看路线的方向，不必照着线走。",
        d.unreached.length ? `步道数据走不到这 ${d.unreached.length} 处：${d.unreached.join("、")}。` : "",
        "距离是沿过道的米数，不是分钟；要走多久看人流。",
        "没有实时定位，起点由你自己设。",
      ],
      privacy: "本站不保存访问者的任何信息：没有账号、cookie 或统计。你选的起点和语言只留在你的设备上。",
    },
  };
  let lang = store.get("lang") === "zh" ? "zh" : "en";
  const t = (key, ...args) => {
    const value = WORDS[lang][key];
    return typeof value === "function" ? value(...args) : value;
  };

  // ---- data: drawings as text, places and the walkway graph

  const texts = new Map();
  function fetchText(src) {
    if (!texts.has(src)) {
      texts.set(
        src,
        fetch(src).then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.text();
        }),
      );
      texts.get(src).catch(() => texts.delete(src));
    }
    return texts.get(src);
  }

  const squash = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const categoryOf = (p) => (p.kind === "w" ? "wc" : p.kind === "s" ? "stage" : p.kind === "d" ? "door" : /f&b|cafe/i.test(p.name) ? "food" : /info kiosk/i.test(p.name) ? "info" : "");
  // Everyday words for a kind of place, so "restroom" or "洗手间" finds the toilets.
  const EXTRA = { wc: "toilet wc restroom washroom bathroom loo", food: "food drink cafe coffee eat fb", info: "info information help", door: "entrance door entry", stage: "stage" };
  const CJK = [
    [/洗手间|厕所|卫生间/, "wc"],
    [/餐|咖啡|吃|喝/, "food"],
    [/问询|咨询|服务台/, "info"],
    [/入口|门/, "door"],
    [/舞台/, "stage"],
  ];

  let floorReady = null;
  function loadFloor() {
    floorReady ??= fetchText(DATA.floor)
      .then((text) => {
        const raw = JSON.parse(text);
        const count = raw.n.length / 2;
        const x = new Float32Array(count);
        const y = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          x[i] = raw.n[i * 2] / 10;
          y[i] = raw.n[i * 2 + 1] / 10;
        }
        const adj = Array.from({ length: count }, () => []);
        for (let i = 0; i < raw.e.length; i += 2) {
          adj[raw.e[i]].push(raw.e[i + 1]);
          adj[raw.e[i + 1]].push(raw.e[i]);
        }
        for (let i = 0; i < raw.d.length; i += 2) adj[raw.d[i]].push(raw.d[i + 1]);
        const stageOf = new Int16Array(count).fill(-1);
        for (let i = 0; i < raw.s.length; i += 2) stageOf[raw.s[i]] = raw.s[i + 1];
        const places = raw.p.map(([key, name, title, hall, px, py, kind, doors], i) => {
          const p = { i, key, name, title, hall, x: px / 10, y: py / 10, kind, doors };
          p.cat = categoryOf(p);
          p.words = [key, name, title].map(squash);
          p.extra = EXTRA[p.cat] || "";
          return p;
        });
        return { x, y, adj, stageOf, places, byKey: new Map(places.map((p) => [p.key, p])) };
      })
      .catch((err) => {
        floorReady = null;
        throw err;
      });
    return floorReady;
  }

  /**
   * Shortest walks from a place along the walkways. With `toKey` it stops at that place and
   * returns the walk; without, it returns the distance to every walkway point. Aisles also run
   * through the stages' seating; cutting through a stage that is neither end costs four times
   * its length, so a route goes round. The metres reported are the real length of the walk.
   */
  function walks(floor, fromKey, toKey) {
    const from = floor.byKey.get(fromKey);
    const to = toKey ? floor.byKey.get(toKey) : null;
    if (!from?.doors.length || (toKey && !to?.doors.length)) return null;
    const { x, y, adj, stageOf } = floor;
    const count = x.length;
    const cost = new Float64Array(count).fill(Infinity);
    const dist = new Float64Array(count).fill(Infinity);
    const prev = new Int32Array(count).fill(-1);
    const done = new Uint8Array(count);
    const goal = new Uint8Array(count);
    if (to) for (const n of to.doors) goal[n] = 1;
    for (const n of from.doors) {
      cost[n] = 0;
      dist[n] = 0;
    }
    const toll = (n) => (to && stageOf[n] >= 0 && stageOf[n] !== from.i && stageOf[n] !== to.i ? 4 : 1);
    for (;;) {
      let u = -1;
      for (let i = 0; i < count; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) return to ? null : dist;
      if (goal[u]) {
        const pts = [];
        for (let n = u; n >= 0; n = prev[n]) pts.push([x[n], y[n]]);
        return { m: Math.round(dist[u]), pts: pts.reverse() };
      }
      done[u] = 1;
      for (const v of adj[u]) {
        const step = Math.hypot(x[u] - x[v], y[u] - y[v]);
        const c = cost[u] + step * Math.max(toll(u), toll(v));
        if (c < cost[v]) {
          cost[v] = c;
          dist[v] = dist[u] + step;
          prev[v] = u;
        }
      }
    }
  }

  /** Forgiving lookup: case, spaces and hyphens do not matter; "5g19-a" and "2d13 (platinum)" find the booth. */
  function findPlaces(floor, typed, limit = 12) {
    const q = squash(typed);
    const kind = CJK.find(([re]) => re.test(typed))?.[1];
    if (!q && kind) return floor.places.filter((p) => p.cat === kind).slice(0, 30);
    if (!q) return [];
    const score = (p, needle) => {
      const [key, name, title] = p.words;
      if (key === needle) return 0;
      if (key.startsWith(needle)) return 1;
      if (name.startsWith(needle) || title.startsWith(needle)) return 2;
      if (key.includes(needle) || name.includes(needle) || title.includes(needle)) return 3;
      if (needle.length >= 3 && p.extra.split(" ").some((w) => w.startsWith(needle))) return 4;
      return -1;
    };
    const run = (needle) =>
      floor.places
        .map((p) => ({ p, s: score(p, needle) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => a.s - b.s || a.p.key.length - b.p.key.length || a.p.key.localeCompare(b.p.key))
        .map((r) => r.p);
    let hits = run(q);
    // A sub-booth or a sponsor tier typed after the code: fall back to the code itself.
    const code = q.match(/^\d[a-z]{1,2}\d{2}/);
    if (!hits.length && code) hits = run(code[0]);
    return hits.slice(0, limit);
  }

  // ---- where the visitor is, and what the address bar says

  const state = () => {
    const q = new URLSearchParams(location.search);
    return { to: q.get("to") || "", from: q.get("from") || "", hall: Number(q.get("hall")) || 0 };
  };
  function go(next, replace = false) {
    const q = new URLSearchParams();
    if (next.to) q.set("to", next.to);
    if (next.from) q.set("from", next.from);
    if (next.hall) q.set("hall", String(next.hall));
    const url = q.toString() ? `/?${q}` : "/";
    history[replace ? "replaceState" : "pushState"](null, "", url);
    input.value = "";
    render();
    scrollTo({ top: 0, behavior: "instant" });
  }
  addEventListener("popstate", () => render());

  function getHere() {
    try {
      const v = JSON.parse(store.get("here") || "null");
      return v && v.key && hallInfo[v.hall] ? v : null;
    } catch {
      return null;
    }
  }
  function setHere(place) {
    store.set("here", place ? JSON.stringify({ key: place.key, name: place.name, hall: place.hall }) : null);
    // A start chosen here replaces one that came with a shared link.
    const s = state();
    if (s.from) history.replaceState(null, "", s.to ? `/?to=${encodeURIComponent(s.to)}` : "/");
    drawHere();
    render();
  }

  const roundel = (hall) => el("b", `rd h${hall}`, String(hall));
  const hallOrder = (() => {
    const order = [];
    const first = Object.keys(hallInfo).map(Number).find((h) => hallInfo[h].left === null);
    for (let h = first; h != null && order.length < 9; h = hallInfo[h].right) order.push(h);
    return order;
  })();
  function toFrame(hall, x, y) {
    const info = hallInfo[hall];
    const a = (-info.a * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a) - info.x0, x * Math.sin(a) + y * Math.cos(a) - info.y0];
  }

  // ---- "I'm at …": always in view

  const hereBar = $("#here");
  function drawHere() {
    const here = getHere();
    hereBar.replaceChildren();
    hereBar.classList.toggle("set", Boolean(here));
    const main = el("button", "here-main");
    main.type = "button";
    if (here) main.append(el("span", "here-k", t("imAt")), roundel(here.hall), el("b", "", here.name));
    else main.append(el("span", "here-k", t("whereAreYou")));
    main.addEventListener("click", () => pickStart());
    hereBar.append(main);
    if (here) {
      const clear = el("button", "here-clear", "×");
      clear.type = "button";
      clear.setAttribute("aria-label", "Clear");
      clear.addEventListener("click", () => setHere(null));
      hereBar.append(clear);
    }
  }

  // ---- lists of places

  function placeRow(p, onPick, extra) {
    const row = el("button", "row");
    row.type = "button";
    row.append(roundel(p.hall));
    const text = el("span", "row-text");
    text.append(el("b", "", p.name));
    if (p.title && squash(p.title) !== squash(p.name)) text.append(el("span", "", p.title));
    row.append(text);
    if (extra) row.append(el("i", "row-extra", extra));
    row.addEventListener("click", () => onPick(p));
    return row;
  }

  const sheet = $("#sheet");
  sheet.addEventListener("click", (e) => e.target === sheet && sheet.close());
  function openSheet(...nodes) {
    const close = el("button", "sheet-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", () => sheet.close());
    sheet.replaceChildren(close, ...nodes);
    if (!sheet.open && typeof sheet.showModal === "function") sheet.showModal();
  }

  /** Ask where the visitor is. `then` runs once a start is chosen. */
  function pickStart(then) {
    const box = el("input", "pick-input");
    box.type = "search";
    box.placeholder = t("pickPlaceholder");
    for (const [k, v] of Object.entries({ autocomplete: "off", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "search", "aria-label": t("pickStart") })) box.setAttribute(k, v);
    const hint = el("p", "note", t("loading"));
    const list = el("div", "rows");
    openSheet(el("h2", "sheet-title", t("pickStart")), box, hint, list);
    box.focus();
    loadFloor().then(
      (floor) => {
        const choose = (p) => {
          sheet.close();
          setHere(p);
          then?.();
        };
        const draw = () => {
          const typed = box.value.trim();
          const hits = typed ? findPlaces(floor, typed, 8) : floor.places.filter((p) => p.cat === "stage");
          hint.textContent = typed ? (hits.length ? "" : t("none")) : t("pickHint");
          hint.hidden = !hint.textContent;
          list.replaceChildren(...hits.map((p) => placeRow(p, choose)));
        };
        box.addEventListener("input", draw);
        box.addEventListener("keydown", (e) => e.key === "Enter" && $(".row", list)?.click());
        draw();
      },
      () => {
        hint.textContent = t("failed");
      },
    );
  }

  function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      node.hidden = true;
    }, 2200);
  }

  // ---- nearest toilet / food / info kiosk, by metres along the aisles

  function nearest(cat) {
    const s = state();
    const start = s.from || getHere()?.key;
    if (!start) {
      toast(t("needStart"));
      pickStart(() => nearest(cat));
      return;
    }
    loadFloor().then((floor) => {
      const dist = walks(floor, start);
      if (!dist) return void toast(t("noneNear"));
      const found = [];
      for (const p of floor.places) {
        if (p.cat !== cat || p.key === start) continue;
        const m = Math.min(...p.doors.map((n) => dist[n]), Infinity);
        if (m < Infinity) found.push({ p, m });
      }
      found.sort((a, b) => a.m - b.m);
      if (!found.length) return void toast(t("noneNear"));
      // Men's, women's and shared blocks stand in different places, so toilets are a short list to pick from.
      if (cat !== "wc") return void go({ to: found[0].p.key, from: s.from });
      const list = el("div", "rows");
      for (const { p, m } of found.slice(0, 5)) {
        list.append(placeRow(p, () => (sheet.close(), go({ to: p.key, from: s.from })), `${Math.round(m)} m`));
      }
      openSheet(el("h2", "sheet-title", t("nearWc")), list);
    }, () => toast(t("failed")));
  }

  // ---- the views

  function whereabouts(hall, fx, fy) {
    const info = hallInfo[hall];
    const depth = fy / info.h;
    const across = fx / info.w;
    const parts = [depth > 0.62 ? t("entrance") : depth < 0.38 ? t("rear") : t("middle")];
    if (across < 0.38 && info.left) parts.push(t("towards", info.left));
    else if (across > 0.62 && info.right) parts.push(t("towards", info.right));
    return parts.join(" · ");
  }

  function hallStrip(fromHall, toHall) {
    const strip = el("div", "strip");
    const a = hallOrder.indexOf(fromHall);
    const b = hallOrder.indexOf(toHall);
    hallOrder.forEach((h, i) => {
      const cell = el("span", `strip-hall h${h}${h === fromHall ? " from" : ""}${h === toHall ? " to" : ""}${i > Math.min(a, b) && i < Math.max(a, b) ? " via" : ""}`);
      cell.append(roundel(h));
      if (i >= Math.min(a, b) && i < Math.max(a, b)) cell.classList.add(a < b ? "go-right" : "go-left");
      strip.append(cell);
    });
    return strip;
  }

  const backLink = () => {
    const back = el("button", "back", t("venue"));
    back.type = "button";
    back.addEventListener("click", () => go({ from: state().from }));
    return back;
  };

  /** A hall, upright, entrance side at the bottom; with a target lit up and a walk to it when known. */
  async function hallCard(hall, target, originKey, originIsLink) {
    const info = hallInfo[hall];
    const box = el("div", `card h${hall}`);
    const head = el("div", "card-head");
    const title = el("div", "card-title");
    title.append(roundel(hall), el("span", "", target ? target.name : `${t("hall")} ${hall}`));
    head.append(title);
    const route = el("div", "route");
    const sides = el("div", "sides");
    const side = (h, where) => {
      const node = el("button", `side${h ? ` h${h}` : ""}`);
      node.type = "button";
      if (h) {
        node.append(...(where === "left" ? [el("i", "", "←"), roundel(h), el("span", "", `${t("hall")} ${h}`)] : [el("span", "", `${t("hall")} ${h}`), roundel(h), el("i", "", "→")]));
        node.addEventListener("click", () => go({ hall: h, from: state().from }));
      } else node.disabled = true;
      return node;
    };
    sides.append(side(info.left, "left"), el("span", "sides-back", t("back")), side(info.right, "right"));
    const stage = el("div", "stage");
    stage.style.aspectRatio = `${info.w} / ${info.h}`;
    const foot = el("div", "foot");
    box.append(head, route, sides, stage, foot);

    try {
      stage.innerHTML = await fetchText(info.src);
    } catch {
      stage.append(el("p", "note", t("failed")));
      return box;
    }
    const svg = stage.firstElementChild;
    const shapeOf = (k) => (k ? $$("[data-k]", svg).find((n) => n.dataset.k === k) : null);
    const mark = (k, cls, label) => {
      const node = shapeOf(k);
      if (!node) return null;
      node.classList.add(cls);
      const [x, y] = node.dataset.c.split(",").map(Number);
      const pts = (node.getAttribute("points") || `${x - 1.5},${y - 1.5} ${x + 1.5},${y + 1.5}`).trim().split(/\s+/).map((p) => p.split(",").map(Number));
      const top = Math.min(...pts.map((p) => p[1]));
      const bottom = Math.max(...pts.map((p) => p[1]));
      const wide = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
      // The dot sits on the place; the name goes just above it, or below when the place is near the top.
      const below = top / info.h < 0.16;
      const pin = el("div", `pin ${cls}${wide / info.w > 0.12 ? " big" : ""}${below ? " below" : ""}${x / info.w < 0.24 ? " at-left" : x / info.w > 0.76 ? " at-right" : ""}`);
      pin.style.left = `${(x / info.w) * 100}%`;
      pin.style.top = `${(y / info.h) * 100}%`;
      if (label) {
        const tag = el("span", "", label);
        tag.style.setProperty("--lift", `${(((below ? bottom - y : y - top) / info.w) * 100).toFixed(2)}cqw`);
        pin.append(tag);
      }
      stage.append(pin);
      return { x, y };
    };

    // Any place on the map opens that place.
    svg.addEventListener("click", (e) => {
      const node = e.target.closest?.("[data-k]");
      if (node) go({ to: node.dataset.k, from: state().from });
    });
    if (!target) {
      route.append(el("p", "note", t("tapBooth")));
      return box;
    }

    const spot = mark(target.key, "is-target", target.name);
    if (target.title && squash(target.title) !== squash(target.name)) title.append(el("small", "", target.title));
    if (spot) title.append(el("small", "where", whereabouts(hall, spot.x, spot.y)));

    const here = getHere();
    const floor = await loadFloor().catch(() => null);
    const origin = floor && originKey ? floor.byKey.get(originKey) : null;
    const arrived = Boolean(origin && origin.key === target.key);
    const line = (text, strong) => {
      const row = el("div", "route-text");
      row.append(el("span", "", text));
      if (strong) row.append(el("b", "", strong));
      return row;
    };
    if (arrived) {
      route.append(line(t("youAreHere")));
    } else if (origin && floor) {
      const label = `${t("from")} ${origin.name}${originIsLink ? ` (${t("linkStart")})` : ""}`;
      const found = walks(floor, origin.key, target.key);
      const crossing = origin.hall !== hall;
      if (crossing) {
        const whole = el("div", "whole");
        try {
          whole.innerHTML = await fetchText(DATA.ov.src);
          const ov = whole.firstElementChild;
          if (found) {
            const all = found.pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");
            const a = found.pts[0];
            const b = found.pts.at(-1);
            ov.append(
              svgEl("polyline", { class: "ov-path-edge", points: all }),
              svgEl("polyline", { class: "ov-path", points: all }),
              svgEl("circle", { class: "ov-from", cx: a[0], cy: a[1], r: DATA.ov.vb[2] / 70 }),
              svgEl("circle", { class: `ov-to h${hall}`, cx: b[0], cy: b[1], r: DATA.ov.vb[2] / 55 }),
            );
          }
          route.append(whole);
        } catch {
          route.append(hallStrip(origin.hall, hall));
        }
      } else {
        mark(origin.key, "is-from", origin.name);
      }
      route.append(line(label, found ? t("walk", found.m) : t("noPath")));
      if (found) {
        const local = found.pts.map(([px, py]) => toFrame(hall, px, py).map((n) => n.toFixed(1)).join(",")).join(" ");
        svg.append(svgEl("polyline", { class: "path-edge", points: local }), svgEl("polyline", { class: "path", points: local }));
      }
    }

    // The action row stays in reach above the "I'm at" bar while the card is on screen.
    const btn = (cls, text, act) => {
      const b = el("button", `btn ${cls}`, text);
      b.type = "button";
      b.addEventListener("click", act);
      return b;
    };
    if (!arrived) foot.append(btn("strong", here || originIsLink ? t("arrived") : t("imHere"), () => setHere(target)));
    foot.append(
      btn("", here ? t("change") : t("setStart"), () => pickStart()),
      btn("", t("share"), async () => {
        const start = originIsLink ? originKey : here?.key;
        const url = `${location.origin}/?to=${encodeURIComponent(target.key)}${start && start !== target.key ? `&from=${encodeURIComponent(start)}` : ""}`;
        try {
          if (navigator.share) await navigator.share({ url });
          else {
            await navigator.clipboard.writeText(url);
            toast(t("copied"));
          }
        } catch {
          /* the visitor closed the share sheet */
        }
      }),
    );
    return box;
  }

  async function drawHome() {
    const wrap = el("div", "home");
    const whole = el("div", "whole big");
    wrap.append(whole, el("p", "note", t("tapHall")));
    const halls = el("div", "halls");
    for (const h of hallOrder) {
      const b = el("button", `hall-btn h${h}`);
      b.type = "button";
      b.append(roundel(h), el("span", "", `${t("hall")} ${h}`));
      b.addEventListener("click", () => go({ hall: h }));
      halls.append(b);
    }
    wrap.append(halls);

    const quick = el("div", "quick");
    quick.append(el("h2", "", t("nearest")));
    const chips = el("div", "chips");
    for (const cat of ["wc", "food", "info"]) {
      const b = el("button", "chip", t(cat));
      b.type = "button";
      b.dataset.cat = cat;
      b.addEventListener("click", () => nearest(cat));
      chips.append(b);
    }
    quick.append(chips, el("h2", "", t("stages")));
    const stages = el("div", "rows");
    quick.append(stages);
    wrap.append(quick);
    view.replaceChildren(wrap);

    fetchText(DATA.ov.src).then((text) => {
      whole.innerHTML = text;
      whole.firstElementChild.addEventListener("click", (e) => {
        const hall = e.target.closest?.("[data-hall]")?.dataset.hall;
        if (hall) go({ hall: Number(hall) });
      });
    }, () => undefined);
    loadFloor().then((floor) => {
      stages.replaceChildren(...floor.places.filter((p) => p.cat === "stage").map((p) => placeRow(p, (x) => go({ to: x.key }))));
    }, () => stages.append(el("p", "note", t("failed"))));
  }

  let turn = 0;
  async function render() {
    const mine = ++turn;
    const s = state();
    const typed = input.value.trim();
    if (typed) {
      const list = el("div", "rows");
      view.replaceChildren(list);
      const floor = await loadFloor().catch(() => null);
      if (mine !== turn) return;
      if (!floor) return void list.append(el("p", "note", t("failed")));
      const hits = findPlaces(floor, typed);
      if (!hits.length) list.append(el("p", "note", t("none")));
      list.append(...hits.map((p) => placeRow(p, (x) => go({ to: x.key, from: s.from }))));
      return;
    }
    if (!s.to && !s.hall) return void drawHome();

    view.replaceChildren(backLink(), el("p", "note", t("loading")));
    const floor = await loadFloor().catch(() => null);
    if (mine !== turn) return;
    if (!floor) return void view.replaceChildren(backLink(), el("p", "note", t("failed")));
    // A link may carry a key typed by hand: accept the closest match.
    const lookup = (key) => floor.byKey.get(key) || findPlaces(floor, key, 1)[0] || null;
    const target = s.to ? lookup(s.to) : null;
    if (s.to && !target) return void view.replaceChildren(backLink(), el("p", "note", t("none")));
    const linked = s.from ? lookup(s.from) : null;
    const origin = linked?.key || getHere()?.key || "";
    const hall = target ? target.hall : s.hall;
    if (!hallInfo[hall]) return void drawHome();
    const card = await hallCard(hall, target, origin, Boolean(linked));
    if (mine === turn) view.replaceChildren(backLink(), card);
  }

  // ---- language, about

  function applyLang() {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
    for (const node of $$("[data-t]")) node.textContent = t(node.dataset.t);
    input.placeholder = t("search");
    $("#lang").textContent = t("other");
    drawHere();
    render();
  }
  $("#lang").addEventListener("click", () => {
    lang = lang === "en" ? "zh" : "en";
    store.set("lang", lang);
    applyLang();
  });
  $("#about-open").addEventListener("click", () => {
    const [intro, source, limitsHead] = t("about", DATA);
    const link = el("a", "", DATA.official.replace(/^https?:\/\/|\/$/g, ""));
    link.href = DATA.official;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    const src = el("p", "", `${source} `);
    src.append(link);
    const list = el("ul", "limits");
    for (const item of t("limits", DATA).filter(Boolean)) list.append(el("li", "", item));
    openSheet(el("h2", "sheet-title", t("aboutTitle")), el("p", "lead", t("unofficial")), el("p", "", intro), src, el("p", "", limitsHead), list, el("p", "", t("privacy")));
  });

  let typing = 0;
  input.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(render, 60);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#view .row")?.click();
  });

  applyLang();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.update())
      .catch(() => undefined);
  }
})();
