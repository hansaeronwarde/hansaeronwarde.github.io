// Runtime checks for the portfolio. Needs the site served at BASE (default
// http://127.0.0.1:8767/) and Google Chrome: the bundled Chromium cannot decode
// the H.264 film, so contrast would only ever be sampled on the poster.
// `codeblocks` also drives Playwright's WebKit, which must be installed.
// Usage: node tests/e2e_portfolio.mjs [check ...]   (exit 1 on any failure)
// The repo has no package.json, so Playwright resolves from wherever it is
// installed: an ordinary import first, then PLAYWRIGHT_FROM, a path to any
// package.json whose node_modules contains playwright.
import { createRequire } from "node:module";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    if (!process.env.PLAYWRIGHT_FROM) {
      console.error("Playwright not found. Install it, or set PLAYWRIGHT_FROM=/path/to/package.json of a project that has it.");
      throw error;
    }
    return createRequire(process.env.PLAYWRIGHT_FROM)("playwright");
  }
}
const playwright = await loadPlaywright();
const { chromium, webkit } = playwright.chromium ? playwright : playwright.default;

const BASE = process.env.BASE || "http://127.0.0.1:8767/";
const PAGES = [
  "index.html",
  "cases.html",
  "work/integration-middleware.html",
  "work/sim-activation.html",
  "work/claims-intake.html",
  "work/campaign-delivery.html",
  "notes/bounded-concurrency.html",
  "notes/human-judgment.html",
  "notes/independent-failure.html",
  "notes/legacy-rebuild.html",
];
const SUBPAGES = PAGES.slice(1);
const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
const selected = new Set(process.argv.slice(2));
const failures = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function open(viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...options,
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && page.errors.push(`${r.status()} ${r.url()}`));
  return { context, page };
}

async function load(page, path = "index.html") {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const idle = (page, path) => page.goto(BASE + path, { waitUntil: "networkidle" });

const frames = (page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

const overflow = (page) =>
  page.evaluate(() => {
    const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth;
    if (sw <= cw) return 0;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > cw + 1 && getComputedStyle(e).position !== "fixed")
      .filter((e) => !e.closest("pre, [class*=scroll]") || e.matches("pre"))
      .slice(-3)
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}→${Math.round(e.getBoundingClientRect().right)}`);
    return `${sw - cw}px (${wide.join(", ")})`;
  });

// Text is hidden, the frame is captured, then each text run's line boxes are
// composited against the real pixels behind them (opacity included).
// The red period after the name is decoration, which 1.4.3 exempts.
const HOME_FILM = { roots: [".stage", "#navigation"], animated: ".identity,.system-scene,.scene-heading,.paper-surface,.paper-surface > *,.subject", skip: "#name > span" };

async function sampleContrast(page, film = HOME_FILM) {
  const items = await page.evaluate(({ roots, animated, skip }) => {
    const out = [];
    const state = (el) => {
      let opacity = 1;
      let transitional = false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") return null;
        const o = Number(cs.opacity);
        if (e.matches(animated) && o > 0.02 && o < 0.98) transitional = true;
        opacity *= o;
      }
      return opacity < 0.05 ? null : { opacity, transitional };
    };
    const inView = (q) =>
      q.width > 1 && q.height > 1 && q.bottom > 0 && q.top < innerHeight && q.right > 0 && q.left < innerWidth;
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}`;
    for (const root of roots.map((sel) => document.querySelector(sel))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode()); ) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        const s = state(el);
        if (!s || (skip && el.closest(skip))) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter(inView).map((q) => [q.left, q.top, q.width, q.height]);
        if (!rects.length) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        out.push({ label: `${name(el)} "${n.textContent.trim().slice(0, 28)}"`, color: cs.color, ...s, need: large ? 3 : 4.5, rects });
      }
      for (const svg of root.querySelectorAll("svg")) {
        const s = state(svg);
        const q = svg.getBoundingClientRect();
        if (!s || !inView(q)) continue;
        out.push({ label: `icon ${svg.closest("[aria-label]")?.getAttribute("aria-label") || svg.classList[1] || "svg"}`, color: getComputedStyle(svg).color, ...s, need: 3, rects: [[q.left, q.top, q.width, q.height]] });
      }
    }
    return out;
  }, film);
  const all = film.roots.map((r) => `${r}, ${r} *`).join(", ");
  const hide = await page.addStyleTag({
    content: `${all} { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
      ${film.roots.map((r) => `${r} svg`).join(", ")} { visibility: hidden !important; }`,
  });
  await frames(page);
  const png = (await page.screenshot({ type: "png", timeout: 90000 })).toString("base64");
  await hide.evaluate((e) => e.remove());
  return page.evaluate(
    async ({ png, items }) => {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      return items.map((item) => {
        const [r, g, b, a = 1] = item.color.match(/[\d.]+/g).map(Number);
        const alpha = a * item.opacity;
        const values = [];
        for (const [x, y, w, h] of item.rects)
          for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + h)); yy++)
            for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + w)); xx++) {
              const i = (yy * width + xx) * 4;
              const [br, bg, bb] = [data[i], data[i + 1], data[i + 2]];
              const fg = lum(alpha * r + (1 - alpha) * br, alpha * g + (1 - alpha) * bg, alpha * b + (1 - alpha) * bb);
              const back = lum(br, bg, bb);
              values.push((Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05));
            }
        values.sort((p, q) => p - q);
        return { label: item.label, need: item.need, transitional: item.transitional, min: values[0], p2: values[Math.floor(values.length * 0.02)] };
      });
    },
    { png, items },
  );
}

// Text below 11px, or link text below 12px; film overlays count at any opacity because scroll reveals them.
function typeCensus(page, filmSel = null) {
  return page.evaluate((filmSel) => {
    const film = filmSel && document.querySelector(filmSel);
    const shown = (el) => {
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        if (e.hidden) return false;
        const cs = getComputedStyle(e);
        if (cs.display === "none") return false;
        // Film overlays rest at opacity 0 and are revealed by scroll.
        if (!film?.contains(e) && (cs.visibility === "hidden" || Number(cs.opacity) < 0.05)) return false;
      }
      return !el.closest(".sr-only, dialog:not([open])");
    };
    const bad = [];
    let min = Infinity;
    const note = (el, size, text) => {
      const floor = el.closest("a") ? 12 : 11;
      min = Math.min(min, size);
      if (size < floor) bad.push(`${size}px<${floor} "${text.slice(0, 30)}" (${el.tagName.toLowerCase()}.${el.classList[0] || ""})`);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest("script,style") || !shown(el)) continue;
      note(el, parseFloat(getComputedStyle(el).fontSize), n.textContent.trim());
    }
    for (const el of document.body.querySelectorAll("*")) {
      for (const pseudo of ["::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        if (/^(none|normal|""|'')$/.test(cs.content) || !shown(el)) continue;
        note(el, parseFloat(cs.fontSize), `${pseudo} ${cs.content}`);
      }
    }
    return { min, bad };
  }, filmSel);
}

function summarise(name, rows) {
  const measured = rows.filter((r) => !r.transitional && r.min !== undefined);
  const failing = measured.filter((r) => r.min < r.need);
  const worst = measured.reduce((a, b) => (b.min / b.need < a.min / a.need ? b : a));
  const worstP2 = measured.reduce((a, b) => (b.p2 / b.need < a.p2 / a.need ? b : a));
  const film = measured.filter((r) => r.p === "static" || r.p < 0.83);
  const filmWorst = film.reduce((a, b) => (b.min / b.need < a.min / a.need ? b : a));
  const detail = `${measured.length} runs (${rows.length - measured.length} mid-fade skipped); worst min ${worst.min.toFixed(2)}:1 (needs ${worst.need}) ${worst.label} @p${worst.p}; worst p2 ${worstP2.p2.toFixed(2)}:1 ${worstP2.label}; over footage worst min ${filmWorst.min.toFixed(2)}:1 (needs ${filmWorst.need}) ${filmWorst.label} @p${filmWorst.p}`;
  check(name, failing.length === 0, failing.length ? `${failing.length} failing, ${detail}; e.g. ${failing.slice(0, 4).map((f) => `${f.label}@p${f.p} ${f.min.toFixed(2)}`).join("; ")}` : detail);
}

const checks = {
  async bytes() {
    for (const [path, poster] of [["index.html", ".footage img"]])
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const { context, page } = await open({ width, height });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      const urls = new Map();
      const sizes = new Map();
      cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
      cdp.on("Network.dataReceived", (e) => sizes.set(e.requestId, (sizes.get(e.requestId) || 0) + (e.encodedDataLength || e.dataLength)));
      cdp.on("Network.loadingFinished", (e) => sizes.set(e.requestId, Math.max(sizes.get(e.requestId) || 0, e.encodedDataLength)));
      const total = (filter) => [...sizes].filter(([id]) => filter(urls.get(id) || "")).reduce((s, [, n]) => s + n, 0);
      await page.goto(BASE + path, { waitUntil: "load" });
      await page.waitForTimeout(8000);
      const idleAll = total(() => true);
      const idleFilm = total((u) => u.endsWith(".mp4"));
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(4000);
      const afterFilm = total((u) => u.endsWith(".mp4"));
      const posterKept = await page.evaluate((poster) => getComputedStyle(document.querySelector(poster)).display !== "none", poster);
      check(`${path} no-scroll bytes ${width}x${height}`, idleFilm === 0 && idleAll < 2_500_000, `total ${idleAll.toLocaleString()} B, film ${idleFilm.toLocaleString()} B in 8 s idle`);
      check(`${path} film loads after first scroll ${width}x${height}`, afterFilm > 0 && posterKept, `film ${afterFilm.toLocaleString()} B within 4 s of a wheel; poster kept: ${posterKept}`);
      await context.close();
    }
  },

  // A study control that finishes or hides itself must keep focus off <body> and
  // off Reset, where one more Enter would wipe the result; the focus target must
  // clear the fixed masthead.
  async focus() {
    const { context, page } = await open({ width: 1440, height: 900 });
    const active = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const top = a.getBoundingClientRect().top;
        const clear = top >= document.getElementById("navigation").getBoundingClientRect().bottom;
        return { id: a.id || a.closest("[id]")?.id || a.tagName, clear, top: Math.round(top) };
      });
    await load(page, "work/sim-activation.html");
    await page.click("#tel-reset");
    await page.focus("#tel-step");
    let presses = 0;
    for (; presses < 10 && (await page.getAttribute("#tel-step", "aria-disabled")) !== "true"; presses++) await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const tel = await active();
    const events = await page.textContent("#tel-count");
    check("work/sim-activation.html focus telecom: finished Step keeps focus and a further Enter does not reset", presses > 0 && tel.id === "tel-step" && events !== "1 EVENT", `${presses} presses, activeElement ${tel.id}, record ${events}`);
    await load(page, "work/claims-intake.html");
    await page.click("#clm-reset");
    await page.fill("#clm-amount", "100.00");
    await page.evaluate(() => scrollTo(0, scrollY + document.getElementById("clm-amount").getBoundingClientRect().top - 120));
    await page.focus("#clm-approve");
    await page.keyboard.press("Enter");
    await frames(page);
    const clm = await active();
    check("work/claims-intake.html focus claims: Approve focuses the state, clear of the masthead", clm.id === "clm-state" && clm.clear, `activeElement ${clm.id}, top ${clm.top}`);
    await load(page, "work/campaign-delivery.html");
    await page.click("#cmp-reset");
    await page.focus("#cmp-send");
    await page.keyboard.press("Enter");
    await frames(page);
    const cmp = await active();
    check("work/campaign-delivery.html focus campaigns: Send focuses an outcome, not Reset, clear of the masthead", cmp.id === "cmp-sms" && cmp.clear, `activeElement ${cmp.id}, top ${cmp.top}`);
    await context.close();
  },

  // If a page's model script fails, its no-JS record stays rather than dead controls.
  async fallback() {
    const runs = [
      ...["work/sim-activation.html", "work/claims-intake.html", "work/campaign-delivery.html"].flatMap((path) => [[path, "studies.js"], [path, "studies-ui.js"]]),
      ["work/integration-middleware.html", "middleware.js"],
      ["work/integration-middleware.html", "queue-model.js"],
      ...SUBPAGES.filter((p) => p.startsWith("notes/")).map((path) => [path, "notes.js"]),
    ];
    for (const [path, script] of runs) {
      const { context, page } = await open({ width: 1280, height: 800 });
      await page.route(`**/${script}`, (route) => route.abort());
      await load(page, path);
      const r = await page.evaluate(() => ({
        controls: [...document.querySelectorAll("main [data-enhance]")].filter((e) => !e.hidden).length,
        fallbacks: [...document.querySelectorAll("main [data-nojs]")].filter((e) => e.hidden).length,
      }));
      check(`${path} without ${script}: no controls revealed, no-JS record kept`, r.controls === 0 && r.fallbacks === 0, `${r.controls} controls shown, ${r.fallbacks} fallbacks hidden`);
      await context.close();
    }
    // study.js reveals only its own controls; d20.js owns the preview toggles.
    const { context, page } = await open({ width: 1280, height: 800 });
    await page.route("**/d20.js", (route) => route.abort());
    await load(page, "index.html");
    const r = await page.evaluate(() => ({
      study: [...document.querySelectorAll("#study [data-enhance]")].filter((e) => e.hidden).length,
      previews: [...document.querySelectorAll("[data-preview] [data-enhance]")].filter((e) => !e.hidden).length,
    }));
    check("index.html without d20.js: the request study keeps its controls, the previews stay static", r.study === 0 && r.previews === 0, `${r.study} request-study controls hidden, ${r.previews} preview toggles shown`);
    await context.close();
  },

  // The connector is measured from layout; at desktop width the form sits beside the box.
  async connector() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await load(page, "work/claims-intake.html");
    const read = () => page.evaluate(() => {
      const svg = document.querySelector("#clm-review .connector");
      return { hidden: svg?.hidden, d: svg?.querySelector("path").getAttribute("d") };
    });
    const before = await read();
    await page.click("#clm-reset");
    await page.fill("#clm-amount", "100.00");
    await page.click("#clm-approve");
    await frames(page);
    const after = await read();
    const drawn = (c) => c.hidden === false && /^M[\d.]+ [\d.]+H/.test(c.d || "");
    check("work/claims-intake.html claims connector drawn on load and redrawn after Approve", drawn(before) && drawn(after) && before.d !== after.d, `load: hidden ${before.hidden}, d "${before.d}"; routed: hidden ${after.hidden}, d "${after.d}"`);
    await context.close();
  },

  async fonts() {
    for (const [width, height, reducedMotion] of [[1440, 900, "no-preference"], [390, 844, "no-preference"], [320, 568, "no-preference"], [390, 844, "reduce"]]) {
      const bad = new Set();
      let min = Infinity;
      for (const path of SUBPAGES) {
        const { context, page } = await open({ width, height }, { reducedMotion });
        await load(page, path);
        const r = await typeCensus(page);
        min = Math.min(min, r.min);
        r.bad.forEach((b) => bad.add(`${path} ${b}`));
        await context.close();
      }
      check(`${SUBPAGES.length} case, note and index pages type floor ${width}x${height} ${reducedMotion}: text >= 11px, links >= 12px`, bad.size === 0, `min ${min}px; ${bad.size} runs below floor${bad.size ? ": " + [...bad].slice(0, process.env.VERBOSE ? Infinity : 6).join("; ") : ""}`);
    }
  },

  // A <br class="desktop"> must not run the hero's words together where it is hidden.
  async hero() {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const { context, page } = await open({ width, height });
      await load(page, "index.html");
      const text = await page.evaluate(() => document.querySelector(".identity-bottom p").innerText.replace(/\s+/g, " ").trim());
      check(`index.html hero words separated ${width}x${height}`, text.includes("systems behind billing, SIM activation"), JSON.stringify(text));
      await context.close();
    }
  },

  // Masthead legible without JS, plus no ghost text, dead controls or sideways scroll.
  async nojs() {
    for (const path of PAGES)
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const { context, page } = await open({ width, height }, { javaScriptEnabled: false });
      await page.goto(BASE + path + (path === "index.html" ? "#work" : ""), { waitUntil: "load" });
      const r = await page.evaluate(() => {
        const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
        const mast = document.getElementById("navigation");
        const before = getComputedStyle(mast, "::before");
        const painted = before.content !== "none" && !/rgba\(0, 0, 0, 0\)|transparent/.test(before.backgroundColor);
        const own = getComputedStyle(mast).backgroundColor;
        const bg = painted ? before.backgroundColor : !/rgba\(0, 0, 0, 0\)|transparent/.test(own) ? own : getComputedStyle(document.body).backgroundColor;
        const fg = getComputedStyle(mast.querySelector("nav a")).color;
        const [a, b] = [lum(fg), lum(bg)];
        const ghost = [...document.querySelectorAll("main *")].filter((e) => {
          if (e.closest("[hidden]") || !e.textContent.trim() || e.children.length) return false;
          const cs = getComputedStyle(e);
          return cs.display !== "none" && (cs.visibility === "hidden" || +cs.opacity === 0);
        }).map((e) => e.textContent.trim().slice(0, 20));
        const controls = [...document.querySelectorAll("main button, main input, main select")].filter((e) => e.offsetParent && !e.closest("form[action], [hidden]")).map((e) => e.outerHTML.slice(0, 50));
        return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), ghost, controls, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      check(`${path} no-JS masthead legible ${width}x${height}`, r.ratio >= 4.5, `${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}:1`);
      check(`${path} no-JS ${width}x${height}: no ghost text, no dead controls, no overflow`, !r.ghost.length && !r.controls.length && r.sw <= 0, `ghost ${r.ghost.slice(0, 3).join(" | ")}; controls ${r.controls.slice(0, 3).join(" | ")}; overflow ${r.sw}`);
      await context.close();
    }
  },

  // Invisible film layers (opacity 0) once swallowed every pointer hit on the hero links.
  async hits() {
    const sizes = [[1440, 900], [1600, 1000], [390, 844], [320, 800], [844, 390], [820, 1180], [1024, 600], [700, 900]];
    const pages = [
      { path: "index.html", hero: ".identity-bottom a", heroes: 5, controls: ".film-tools button, .film-tools input" },
    ];
    for (const { path, hero: heroSel, heroes: heroCount, controls: film } of pages)
    for (const [variant, options] of [["motion", {}], ["reduced motion", { reducedMotion: "reduce" }], ["no JS", { javaScriptEnabled: false }]]) {
      const misses = [];
      for (const [width, height] of sizes) {
        const { context, page } = await open({ width, height }, options);
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.waitForTimeout(400);
        const controls = `${heroSel}, ${film}, #navigation a, #navigation button`;
        const result = await page.evaluate(({ controls, heroSel }) => {
          const out = [];
          for (const a of document.querySelectorAll(controls)) {
            const hero = a.matches(heroSel);
            let q = a.getBoundingClientRect();
            if (!q.width || !q.height || getComputedStyle(a).visibility === "hidden") continue;
            if (hero && (q.top < 0 || q.bottom > innerHeight)) {
              a.scrollIntoView({ block: "center" });
              q = a.getBoundingClientRect();
            } else if (q.top < 0 || q.bottom > innerHeight) continue;
            let hit = 0;
            const by = new Set();
            for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
              for (const fy of [0.25, 0.5, 0.75]) {
                const t = document.elementFromPoint(q.left + q.width * fx, q.top + q.height * fy);
                if (t && (t === a || a.contains(t))) hit++;
                else by.add(t ? `${t.tagName.toLowerCase()}.${String(t.className).split(" ")[0]}` : "nothing");
              }
            if (hero) window.scrollTo(0, 0);
            out.push({ label: (a.getAttribute("aria-label") || a.textContent).trim().slice(0, 14), hero, hit, by: [...by] });
          }
          return out;
        }, { controls, heroSel });
        const heroes = result.filter((r) => r.hero);
        if (heroes.length !== heroCount) misses.push(`${width}x${height}: ${heroes.length} hero links measured`);
        for (const r of result) if (r.hit < 15) misses.push(`${width}x${height} ${r.label} ${r.hit}/15 (by ${r.by.join(",")})`);
        await context.close();
      }
      check(`${path} pointer hits ${variant}: hero links and film/masthead controls 15/15 at ${sizes.length} sizes`, misses.length === 0, misses.slice(0, 6).join("; ") || "all controls 15/15");
    }
    for (const [width, height] of [[1440, 900], [390, 844], [820, 1180]]) {
      const { context, page } = await open({ width, height });
      await load(page, "index.html");
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      const navigations = [];
      cdp.on("Page.frameRequestedNavigation", (e) => navigations.push(e.url));
      const attempt = (selector) =>
        page.click(selector, { timeout: 3000 }).then(() => "clicked", (e) => e.message.split("\n").find((l) => /intercepts/.test(l))?.trim() || e.message.split("\n")[0]);
      const email = await attempt(".arrival > a[href^='mailto:']");
      await page.waitForTimeout(300);
      const mailto = navigations.some((u) => u.startsWith("mailto:"));
      const row = await attempt(".arrival-index a[href='work/integration-middleware.html']");
      const landed = await page.waitForURL(/work\/integration-middleware\.html$/, { timeout: 5000 }).then(() => true, () => false);
      check(`index.html real click on hero links ${width}x${height}`, email === "clicked" && mailto && row === "clicked" && landed, `Email: ${email}, mailto requested ${mailto}; Work row 01: ${row}, landed ${landed}`);
      await context.close();
    }
  },

  // Static film (reduced motion, ?motion=still, Save-Data, or a hero too tall to pin):
  // the hero scrolls under the bar, so the bar itself must carry the contrast.
  async masthead() {
    const saveData = () => Object.defineProperty(navigator, "connection", { value: { saveData: true } });
    const variants = [
      ["reduced motion 1440x900", { reducedMotion: "reduce" }, "", [1440, 900]],
      ["reduced motion 390x844", { reducedMotion: "reduce" }, "", [390, 844]],
      ["?motion=still 1440x900", {}, "?motion=still", [1440, 900]],
      ["Save-Data 1440x900", {}, "", [1440, 900], saveData],
      ["unpinned 844x390", {}, "", [844, 390]],
      ["unpinned 1280x400", {}, "", [1280, 400]],
    ];
    for (const [file, staticClass] of [["index.html", "static-story"]])
    for (const [name, options, path, [width, height], init] of variants) {
      const { context, page } = await open({ width, height }, options);
      if (init) await page.addInitScript(init);
      await load(page, file + path);
      const isStatic = await page.evaluate((c) => document.body.classList.contains(c), staticClass);
      let worst = null;
      for (let y = 0; y <= 1200; y += 60) {
        await page.evaluate((y) => scrollTo(0, y), y);
        // Past the masthead's 0.15s colour transition into its paper style.
        await page.waitForTimeout(300);
        for (const r of await mastheadContrast(page)) if (!worst || r.min / r.need < worst.min / worst.need) worst = { ...r, y };
      }
      check(`${file} static masthead contrast ${name}`, isStatic && worst && worst.min >= worst.need, `static ${isStatic}; worst "${worst?.label}" ${worst?.min.toFixed(2)}:1 (needs ${worst?.need}) at scrollY ${worst?.y}`);
      await context.close();
    }
  },

  // Portrait -> landscape -> portrait mid-film: the reader stays in the story and the re-pinned film follows scroll.
  async rotate() {
    const { context, page } = await open({ width: 390, height: 844 });
    await load(page, "index.html");
    await page.mouse.wheel(0, 2);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const t = ScrollTrigger.getById("narrative");
      document.documentElement.style.scrollBehavior = "auto";
      scrollTo(0, t.start + (t.end - t.start) * 0.5);
    });
    await page.waitForTimeout(600);
    const state = () =>
      page.evaluate(() => {
        const stage = document.querySelector(".stage").getBoundingClientRect();
        const story = document.getElementById("story").getBoundingClientRect();
        const t = window.ScrollTrigger?.getById("narrative");
        return {
          y: scrollY,
          stageTop: stage.top,
          stageBottom: stage.bottom,
          inStory: story.top <= innerHeight / 2 && story.bottom >= innerHeight / 2,
          vh: innerHeight,
          pinned: Boolean(t) && !document.body.classList.contains("static-story"),
          start: t?.start,
          end: t?.end,
          progress: Number(document.querySelector(".stage").dataset.progress),
        };
      });
    const filled = (s) => s.stageTop <= 0.5 && s.stageBottom >= s.vh - 0.5;
    const tracks = (s) => s.pinned && Math.abs(s.progress - (s.y - s.start) / (s.end - s.start)) < 0.02;
    const describe = (s) => `scrollY ${Math.round(s.y)}, stage ${Math.round(s.stageTop)}..${Math.round(s.stageBottom)}, pinned ${s.pinned}, in story ${s.inStory}, progress ${s.progress}${s.pinned ? ` (scroll says ${((s.y - s.start) / (s.end - s.start)).toFixed(3)})` : ""}`;
    const before = await state();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(1200);
    const landscape = await state();
    check("index.html rotate to landscape mid-film: unpinned, reader still in the story", before.pinned && before.progress > 0.3 && !landscape.pinned && landscape.inStory, `before ${describe(before)}; landscape ${describe(landscape)}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    const back = await state();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(1200);
    const wheeled = await state();
    check("index.html rotate back to portrait: re-pinned, reader in the story, progress follows scroll", back.pinned && back.inStory && (!filled(back) || tracks(back)) && tracks(wheeled) && wheeled.progress >= back.progress, `${describe(back)}; after 100px wheel ${describe(wheeled)}`);
    await context.close();
  },

  async record() {
    const { context, page } = await open({ width: 1280, height: 800 });
    await load(page, "index.html");
    await page.mouse.wheel(0, 2);
    const read = () =>
      page.evaluate(() => {
        const t = (id) => document.getElementById(id).textContent.trim();
        const rows = (sel) => [...document.querySelectorAll(sel)].map((r) => [...r.children].slice(0, 2).map((c) => c.textContent.trim()).join(" "));
        return {
          pinned: !document.body.classList.contains("static-story"),
          card: [document.querySelector("#subject-label b").textContent, t("subject-state"), t("subject-attempt").toLowerCase(), ...rows("#story-history li")],
          trace: [t("trace-number"), t("trace-state"), t("trace-attempts").toLowerCase(), ...rows("#trace-body tr")],
          selected: document.getElementById("request-select").value,
        };
      });
    const span = await page.evaluate(() => {
      const t = ScrollTrigger.getById("narrative");
      return [t.start, t.end];
    });
    for (let p = 0; p <= 1.0001; p += 0.1) {
      await page.evaluate((y) => scrollTo(0, y), span[0] + (span[1] - span[0]) * p);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => scrollTo(0, scrollY + document.getElementById("study").getBoundingClientRect().top));
    await page.waitForTimeout(400);
    const played = await read();
    check("index.html study trace equals the opening record after a normal scroll", played.pinned && JSON.stringify(played.card) === JSON.stringify(played.trace), `card ${played.card.join(" / ")}; trace ${played.trace.join(" / ")}`);
    await page.selectOption("#request-select", "7");
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.waitForTimeout(800);
    const resized = await read();
    check("index.html selection survives a resize across the pin threshold", !resized.pinned && resized.selected === "7" && resized.trace[0] === "007", `pinned ${played.pinned} → ${resized.pinned}, selected ${resized.selected}, trace ${resized.trace[0]}`);
    await context.close();
  },

  // Home hero: name, lede, case index and CTA never collide; pinned only when it clears
  // the masthead and film controls; the masthead stays on screen. With and without 1.4.12.
  async homefit() {
    const spacingCss = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
    const widths = [];
    for (let w = 320; w <= 1920; w += 24) widths.push(w);
    // Layout edges: nav hiding, phone/tablet, index beside vs under the name, wide type.
    widths.push(360, 361, 375, 376, 390, 600, 601, 940, 941, 1000, 1001, 1024, 1084, 1100, 1600);
    const sorted = [...new Set(widths)].sort((a, b) => a - b);
    const runs = [];
    for (const spacing of [false, true]) for (const height of [740, 844, 900, 1024]) runs.push({ spacing, height });
    const results = await Promise.all(
      runs.map(async ({ spacing, height }) => {
        const { context, page } = await open({ width: sorted[0], height });
        await load(page, "index.html");
        if (spacing) await page.addStyleTag({ content: spacingCss });
        const bad = [];
        let pinned = 0;
        for (const width of sorted) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(300);
          // Settled: the debounced re-pin has run and the layout has held for 500ms.
          const settled = await page
            .waitForFunction(
              () => {
                const key = `${document.body.classList.contains("static-story")} ${document.querySelector(".identity > .eyebrow").getBoundingClientRect().top}`;
                const now = performance.now();
                if (window.__homeKey !== key) [window.__homeKey, window.__homeSince] = [key, now];
                return now - window.__homeSince >= 500;
              },
              null,
              { polling: 100, timeout: 5000 },
            )
            .then(() => true, () => false);
          const g = await page.evaluate(() => {
            const box = (sel) => {
              const r = document.createRange();
              r.selectNodeContents(document.querySelector(sel));
              const rs = [...r.getClientRects()].filter((q) => q.width > 0.5);
              return { l: Math.min(...rs.map((q) => q.left)), r: Math.max(...rs.map((q) => q.right)), t: Math.min(...rs.map((q) => q.top)), b: Math.max(...rs.map((q) => q.bottom)) };
            };
            const parts = { eyebrow: ".identity > .eyebrow", name: "#name", lede: ".identity-bottom p", index: ".arrival-index", cta: ".arrival > a" };
            const b = Object.fromEntries(Object.entries(parts).map(([k, s]) => [k, box(s)]));
            const keys = Object.keys(b);
            const hits = [];
            for (let i = 0; i < keys.length; i++)
              for (let j = i + 1; j < keys.length; j++) {
                const [p, q] = [b[keys[i]], b[keys[j]]];
                if (p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b) hits.push(`${keys[i]}×${keys[j]}`);
              }
            const header = document.getElementById("navigation");
            const pinned = !document.body.classList.contains("static-story");
            return {
              pinned,
              hits,
              underMasthead: pinned ? b.eyebrow.t - header.getBoundingClientRect().bottom : 0,
              aboveControls: pinned ? document.querySelector(".film-tools").getBoundingClientRect().top - Math.max(b.lede.b, b.cta.b) : 0,
              headerOverflow: Math.max(...[...header.querySelectorAll("a, button")].filter((e) => e.offsetWidth).map((e) => e.getBoundingClientRect().right)) - document.documentElement.clientWidth,
              // A row whose text overruns its own cell is clipped by the stage without widening the page.
              indexOverflow: Math.max(...[...document.querySelectorAll(".arrival-index a")].map((a) => box(`.arrival-index a[href="${a.getAttribute("href")}"]`).r - a.getBoundingClientRect().right)),
            };
          });
          if (g.pinned) pinned++;
          const problems = [...g.hits];
          if (!settled) problems.push("layout never settled");
          if (g.underMasthead < 0) problems.push(`${-g.underMasthead.toFixed(0)}px under masthead`);
          if (g.aboveControls < 0) problems.push(`${-g.aboveControls.toFixed(0)}px under film controls`);
          if (g.headerOverflow > 0.5) problems.push(`masthead ${g.headerOverflow.toFixed(0)}px off screen`);
          if (g.indexOverflow > 0.5) problems.push(`case index ${g.indexOverflow.toFixed(0)}px clipped`);
          if (problems.length) bad.push(`${width}x${height} ${problems.join(", ")}`);
        }
        await context.close();
        return { spacing, bad, pinned };
      }),
    );
    for (const spacing of [false, true]) {
      const rows = results.filter((r) => r.spacing === spacing);
      const bad = rows.flatMap((r) => r.bad);
      const cells = rows.length * sorted.length;
      check(`index.html hero fit ${spacing ? "with 1.4.12 text spacing" : "plain"}: ${sorted.length} widths x 740/844/900/1024`, bad.length === 0, `${cells - bad.length}/${cells} cells clean, ${rows.reduce((s, r) => s + r.pinned, 0)} pinned${bad.length ? "; " + bad.slice(0, 6).join("; ") : ""}`);
    }

    // At the end of the film the record card settles beside (desktop) or under (phone) the paper heading.
    const ends = [];
    for (const [width, height] of [[360, 740], [390, 844], [430, 932], [600, 900], [768, 1024], [1280, 800], [1440, 900]]) {
      const { context, page } = await open({ width, height });
      await load(page, "index.html");
      const end = await page.evaluate(() => ScrollTrigger.getById("narrative").end);
      await page.evaluate((y) => scrollTo(0, y - 2), end);
      await page.waitForTimeout(400);
      const overlap = await page.evaluate(() => {
        const card = document.getElementById("subject").getBoundingClientRect();
        const r = document.createRange();
        r.selectNodeContents(document.querySelector(".paper-surface h2"));
        return Math.max(0, ...[...r.getClientRects()].filter((q) => q.width > 0.5 && q.left < card.right && card.left < q.right).map((q) => q.bottom - card.top).filter((d) => d > 0 && card.bottom > 0));
      });
      if (overlap) ends.push(`${width}x${height} ${overlap.toFixed(0)}px`);
      await context.close();
    }
    check("index.html film end: the record card clears the paper heading", ends.length === 0, ends.join("; ") || "7 sizes clean");
  },

  // Through the film the phone record card sits under the lane numbers it crosses and above the
  // scene footer, spans whole lanes ending 12px short of a lane line, and holds the 11px floor.
  async homecard() {
    const bad = [];
    let cells = 0;
    let minLane = Infinity;
    let minFoot = Infinity;
    let tallest = 0;
    for (const [width, height] of [[320, 760], [360, 740], [375, 812], [390, 844], [430, 932], [600, 900]]) {
      const { context, page } = await open({ width, height });
      await page.route("**/*.mp4", (r) => r.abort());
      await load(page, "index.html");
      if (!(await page.evaluate(() => Boolean(window.ScrollTrigger?.getById("narrative"))))) {
        bad.push(`${width}x${height} not pinned`);
        await context.close();
        continue;
      }
      for (let i = 0; i <= 61; i += 3) {
        const p = 0.23 + i / 100;
        await page.evaluate((p) => {
          const t = ScrollTrigger.getById("narrative");
          document.documentElement.style.scrollBehavior = "auto";
          scrollTo(0, t.start + (t.end - t.start) * p);
        }, p);
        await page.waitForTimeout(450);
        await frames(page);
        const g = await page.evaluate(() => {
          const subject = document.getElementById("subject");
          const card = subject.getBoundingClientRect();
          const laneGap = Math.min(...[...document.querySelectorAll(".lane b")].map((b) => b.getBoundingClientRect()).filter((q) => q.left < card.right && card.left < q.right).map((q) => card.top - q.bottom));
          const lines = [...document.querySelectorAll(".lane")].map((l) => l.getBoundingClientRect().left);
          lines.push(document.querySelector(".lane:last-child").getBoundingClientRect().right);
          const fonts = [];
          const walker = document.createTreeWalker(subject, NodeFilter.SHOW_TEXT);
          for (let n; (n = walker.nextNode()); ) if (n.textContent.trim() && n.parentElement.getClientRects().length) fonts.push(parseFloat(getComputedStyle(n.parentElement).fontSize));
          return {
            laneGap,
            footGap: document.querySelector(".scene-foot").getBoundingClientRect().top - card.bottom,
            snap: Math.min(...lines.map((x) => Math.abs(x - 12 - card.right))),
            past: card.right - document.documentElement.clientWidth,
            overflow: Math.max(...[...subject.querySelectorAll(".subject-top, .subject-summary")].map((e) => e.scrollWidth - e.clientWidth)),
            font: Math.min(...fonts),
            height: card.height,
          };
        });
        cells++;
        minLane = Math.min(minLane, g.laneGap);
        minFoot = Math.min(minFoot, g.footGap);
        tallest = Math.max(tallest, g.height);
        const problems = [];
        if (!(g.laneGap >= 8)) problems.push(`top ${g.laneGap.toFixed(1)}px from a lane number`);
        if (!(g.footGap >= 0)) problems.push(`${(-g.footGap).toFixed(1)}px over the scene footer`);
        if (!(g.snap <= 0.75)) problems.push(`right edge ${g.snap.toFixed(1)}px off a lane line − 12`);
        if (g.past > 0) problems.push(`${g.past.toFixed(1)}px past the viewport`);
        if (g.overflow > 0) problems.push(`header/summary overflows ${g.overflow}px`);
        if (!(g.font >= 11)) problems.push(`${g.font}px text`);
        if (problems.length) bad.push(`${width}x${height} p${p.toFixed(2)} ${problems.join(", ")}`);
      }
      await context.close();
    }
    check("index.html phone film card: under the lane numbers it crosses (+8px), above the scene footer, lane-snapped, 11px floor", bad.length === 0 && cells === 6 * 21, `${cells - bad.length}/${cells} cells clean; min lane gap ${minLane.toFixed(1)}px, min footer gap ${minFoot.toFixed(1)}px, tallest card ${tallest.toFixed(0)}px${bad.length ? "; " + bad.slice(0, 6).join("; ") : ""}`);
  },

  async homecontrast() {
    const points = [0, 0.1, 0.18, 0.26, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95, 1];
    for (const [width, height] of [[1440, 900], [390, 844]])
      for (const poster of [false, true]) {
        const { context, page } = await open({ width, height });
        // Poster only: the film loads on first interaction and may never arrive.
        if (poster) await page.route("**/*.mp4", (r) => r.abort());
        await load(page, "index.html");
        await page.mouse.wheel(0, 2);
        const video = poster
          ? "blocked"
          : await page.waitForFunction(() => document.getElementById("film").classList.contains("ready"), null, { timeout: 30000 }).then(() => "ready", () => "not ready");
        const rows = [];
        for (const p of points) {
          await page.evaluate((p) => {
            const t = ScrollTrigger.getById("narrative");
            document.documentElement.style.scrollBehavior = "auto";
            scrollTo(0, t.start + (t.end - t.start) * p);
          }, p);
          await page.waitForTimeout(700);
          await page.waitForFunction(() => { const v = document.getElementById("film"); return !v.classList.contains("ready") || !v.seeking; }, null, { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(200);
          for (const r of await sampleContrast(page)) rows.push({ ...r, p });
        }
        summarise(`index.html contrast film ${width}x${height} (${points.length} scrub points, video ${video}, red name period exempt)`, rows);
        await context.close();
      }
    for (const [width, height] of [[1440, 900], [1280, 800], [390, 844]]) {
      const still = await open({ width, height }, { reducedMotion: "reduce" });
      await load(still.page, "index.html");
      summarise(`index.html contrast static film ${width}x${height} (red name period exempt)`, (await sampleContrast(still.page)).map((r) => ({ ...r, p: "static" })));
      await still.context.close();
    }
  },

  async homefonts() {
    for (const [width, height, reducedMotion] of [[1440, 900, "no-preference"], [390, 844, "no-preference"], [320, 568, "no-preference"], [390, 844, "reduce"]]) {
      const { context, page } = await open({ width, height }, { reducedMotion });
      await load(page, "index.html");
      const bad = new Set();
      let min = Infinity;
      const pinned = await page.evaluate(() => !document.body.classList.contains("static-story"));
      for (const p of pinned ? [0, 0.5, 1] : [null]) {
        if (p !== null) {
          await page.evaluate((p) => { const t = ScrollTrigger.getById("narrative"); scrollTo(0, t.start + (t.end - t.start) * p); }, p);
          await page.waitForTimeout(400);
        }
        const r = await typeCensus(page, ".stage");
        min = Math.min(min, r.min);
        r.bad.forEach((b) => bad.add(b));
      }
      check(`index.html type floor ${width}x${height} ${reducedMotion}: text >= 11px, links >= 12px`, bad.size === 0, `min ${min}px; ${bad.size} runs below floor${bad.size ? ": " + [...bad].slice(0, 6).join("; ") : ""}`);
      await context.close();
    }
  },

  // A <label> names its first labelable descendant, and <output> is labelable, so the
  // range inputs need their own name. Read from Chromium's accessibility tree.
  async sliders() {
    for (const [path, tab, want] of [
      ["index.html", "#experiment-tab", ["Workers", "Downstream capacity"]],
      ["work/integration-middleware.html", null, ["Workers", "Downstream capacity"]],
      ["notes/bounded-concurrency.html", null, ["Downstream capacity"]],
    ]) {
      const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
      await load(page, path);
      if (tab) await page.evaluate((tab) => document.querySelector(tab).click(), tab);
      await page.waitForTimeout(200);
      const cdp = await context.newCDPSession(page);
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const names = nodes.filter((n) => n.role?.value === "slider" && !n.ignored).map((n) => n.name?.value || "");
      const ranges = await page.evaluate(() => [...document.querySelectorAll('input[type="range"]')].filter((e) => e.getClientRects().length).length);
      check(`${path} capacity sliders are named`, want.every((w) => names.includes(w)) && names.length === want.length && names.every(Boolean), `${ranges} visible range inputs; slider names ${JSON.stringify(names)}`);
      await context.close();
    }
  },

  // Turning motion off mid-film removes the pin spacer; the reader must stay in the story.
  async homemotion() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await load(page, "index.html");
    await page.evaluate(() => { const t = ScrollTrigger.getById("narrative"); scrollTo(0, t.start + (t.end - t.start) * 0.5); });
    await page.waitForTimeout(500);
    await page.click("#motion-toggle");
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const story = document.getElementById("story").getBoundingClientRect();
      return { static: document.body.classList.contains("static-story"), inStory: story.top <= innerHeight / 2 && story.bottom >= innerHeight / 2, top: Math.round(story.top) };
    });
    check("index.html motion off mid-film keeps the reader in the story", r.static && r.inStory, `static ${r.static}; #story top ${r.top}px`);
    await context.close();
  },

  // WCAG 1.4.12 on every page and section, not only the hero: no horizontal scroll.
  async spacing() {
    for (const path of PAGES) {
      const bad = [];
      for (const width of [320, 360, 390, 1024, 1280, 1440]) {
        const { context, page } = await open({ width, height: 844 }, { reducedMotion: "reduce" });
        await idle(page, path);
        await page.addStyleTag({ content: SPACING });
        await page.waitForTimeout(300);
        const o = await overflow(page);
        if (o) bad.push(`${width}: ${o}`);
        await context.close();
      }
      check(`${path} 1.4.12 text spacing: no horizontal scroll at 320/360/390/1024/1280/1440`, !bad.length, bad.join("; "));
    }
  },

  // The Run button is named by aria-label alone; studies-ui.js only updates a title that the page authored.
  async telrun() {
    for (const [path, tooltip] of [["work/sim-activation.html", false]]) {
      const still = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
      await load(still.page, path);
      await still.page.evaluate(() => document.getElementById("tel-provider").click());
      await still.page.evaluate(() => document.getElementById("tel-run").click());
      await still.page.waitForTimeout(300);
      const status = await still.page.textContent("#tel-status");
      check(`${path} reduced motion: a held order says how to continue`, status.includes("Restore the provider to continue."), status);
      await still.context.close();

      const moving = await open({ width: 1280, height: 800 });
      await load(moving.page, path);
      const title = () => moving.page.evaluate(() => document.getElementById("tel-run").getAttribute("title"));
      await moving.page.evaluate(() => document.getElementById("tel-run").click());
      const running = await title();
      await moving.page.evaluate(() => document.getElementById("tel-run").click());
      const paused = await title();
      const ok = tooltip ? running === "Pause order" && paused === "Run order" : running === null && paused === null;
      check(`${path} run button title ${tooltip ? "tracks its label" : "is absent"}`, ok, `running ${running}, paused ${paused}`);
      await moving.context.close();
    }
  },
  async layout() {
    for (const path of PAGES) {
      const bad = [];
      for (const [width, height] of [[1280, 800], [768, 1024], [390, 844], [360, 740], [844, 390], [390, 600]]) {
        const { context, page } = await open({ width, height }, { reducedMotion: "reduce" });
        await idle(page, path);
        const o = await overflow(page);
        if (o) bad.push(`${width}x${height} overflow ${o}`);
        if (page.errors.length) bad.push(`${width}x${height} errors ${page.errors.slice(0, 2).join("; ")}`);
        await context.close();
      }
      check(`${path} layout: no overflow, no errors at 6 sizes`, !bad.length, bad.join("; "));
    }
  },

  // Every Tab stop is visible, ringed and the top element at its centre, so nothing sits under the fixed header.
  async keyboard() {
    for (const path of PAGES)
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      const { context, page } = await open({ width, height }, { reducedMotion: "reduce" });
      await idle(page, path);
      const bad = [];
      let n = 0;
      let prev = null;
      for (let i = 0; i < 160; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const cs = getComputedStyle(e), r = e.getBoundingClientRect();
          const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
          const covers = [...document.querySelectorAll("header, [class*=masthead], nav")].filter((h) => ["fixed", "sticky"].includes(getComputedStyle(h).position) && !h.contains(e));
          const coverBottom = Math.max(0, ...covers.map((h) => h.getBoundingClientRect().bottom));
          const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
          const onTop = !!hit && (hit === e || e.contains(hit) || hit.contains(e));
          return { onTop, key: e.outerHTML.slice(0, 60), label: (e.getAttribute("aria-label") || e.textContent || e.id).trim().slice(0, 30), ring, top: r.top, bottom: r.bottom, vh: innerHeight, coverBottom, visible: r.width > 0 && r.height > 0 };
        });
        if (!f || prev === f.key) break;
        prev = f.key;
        n++;
        if (!f.visible) bad.push(`invisible "${f.label}"`);
        else if (!f.ring) bad.push(`no ring "${f.label}"`);
        else if (!f.onTop || f.top >= f.vh || f.bottom <= 0) bad.push(`obscured "${f.label}" top ${Math.round(f.top)} under ${Math.round(f.coverBottom)}`);
      }
      check(`${path} keyboard ${width}: ${n} stops visible, ringed, unobscured`, !bad.length && n > 0, bad.slice(0, 5).join("; "));
      await context.close();
    }
  },

  async motion() {
    for (const path of PAGES) {
      const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
      await idle(page, path);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
      });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({
        running: document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getTiming().duration || 0) > 10).map((a) => `${a.animationName || a.transitionProperty || a.constructor.name} on ${a.effect?.target?.className || a.effect?.target?.tagName}`),
        smooth: getComputedStyle(document.documentElement).scrollBehavior,
        playing: [...document.querySelectorAll("video")].filter((v) => !v.paused).length,
      }));
      check(`${path} reduced motion: nothing animating, no smooth scroll, no playing video`, !r.running.length && r.smooth !== "smooth" && !r.playing, `running ${r.running.slice(0, 3).join(", ")}; scroll ${r.smooth}; playing ${r.playing}`);
      await context.close();
    }
  },

  async print() {
    for (const path of PAGES) {
      const { context, page } = await open({ width: 794, height: 1123 }, { reducedMotion: "reduce" });
      await idle(page, path);
      await page.emulateMedia({ media: "print" });
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        commands: [...document.querySelectorAll("main :is(button.icon, button.command, #run, #step, #reset, #restart)")].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== "none").map((e) => e.getAttribute("aria-label") || e.textContent.trim().slice(0, 20)),
      }));
      const pdf = await page.pdf({ format: "A4", printBackground: false });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      // Run, step, reset and command buttons print as dead chrome; tabs and request tokens print as state.
      check(`${path} print: no overflow, no command buttons, ${pages} A4 pages`, r.sw <= 0 && !r.commands.length && pages > 0, `overflow ${r.sw}; buttons printed ${r.commands.slice(0, 6).join(", ")}`);
      await context.close();
    }
  },

  // WCAG 2.5.8: 24x24, or inline in a sentence, or clear of neighbours by the 24px circle.
  async targets() {
    for (const path of PAGES) {
      const { context, page } = await open({ width: 390, height: 844 }, { reducedMotion: "reduce" });
      await idle(page, path);
      const small = await page.evaluate(() => {
        const all = [...document.querySelectorAll("a[href], button, input, select, summary, label:has(input)")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
        });
        const rects = all.map((e) => e.getBoundingClientRect());
        const circleHits = (i) => {
          const r = rects[i], cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          return rects.some((o, j) => {
            if (j === i || all[j].contains(all[i]) || all[i].contains(all[j])) return false;
            const dx = Math.max(o.left - cx, 0, cx - o.right), dy = Math.max(o.top - cy, 0, cy - o.bottom);
            if (Math.hypot(dx, dy) < 12) return true;
            const ox = o.left + o.width / 2, oy = o.top + o.height / 2;
            return (o.width < 24 || o.height < 24) && Math.hypot(ox - cx, oy - cy) < 24;
          });
        };
        return all.filter((e, i) => {
          if (e.matches("input") && e.closest("label")) return false;
          const r = e.getBoundingClientRect();
          if (r.width >= 24 && r.height >= 24) return false;
          const inline = e.parentElement && getComputedStyle(e).display === "inline" && /\S/.test([...e.parentElement.childNodes].filter((n) => n !== e).map((n) => n.textContent).join(""));
          return !inline && circleHits(i);
        }).map((e) => `"${(e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      });
      check(`${path} 2.5.8 targets >= 24x24 (inline links + spacing exception)`, !small.length, small.slice(0, 6).join("; "));
      await context.close();
    }
  },

  // Lab, not field: 1.6 Mbps, 150 ms RTT, 4x CPU.
  async network() {
    const profile = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
    for (const path of ["index.html", "cases.html", "work/claims-intake.html", "notes/bounded-concurrency.html"])
    for (const [width, height] of [[390, 844], [1280, 800]]) {
      const { context, page } = await open({ width, height });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", profile);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const media = [];
      page.on("request", (r) => /\.(mp4|webm)/.test(r.url()) && media.push(r.url().split("/").pop()));
      await page.addInitScript(() => {
        window.__lcp = 0;
        window.__cls = 0;
        window.__lcpEl = "";
        new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpEl = `${e.element?.tagName}.${e.element?.className}`; } }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(BASE + path, { waitUntil: "load", timeout: 120000 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), el: window.__lcpEl, cls: +window.__cls.toFixed(3), poster: [...document.images].filter((i) => /poster/.test(i.currentSrc)).map((i) => i.complete && i.naturalWidth > 0) }));
      check(`${path} slow network ${width} (lab): LCP ${r.lcp}ms < 4000, CLS ${r.cls} < 0.1, no film before scroll`, r.cls < 0.1 && r.lcp > 0 && r.lcp < 4000 && !media.length && (path !== "index.html" || (r.poster.length > 0 && r.poster.every(Boolean))), `LCP el ${r.el}; poster ${r.poster.join(",")}; film requests ${media.join(",") || "none"}`);
      await context.close();
    }
  },

  async n4() {
    for (const javaScriptEnabled of [true, false]) {
      const { context, page } = await open({ width: 390, height: 844 }, { reducedMotion: "reduce", javaScriptEnabled });
      await idle(page, "notes/legacy-rebuild.html");
      const state = () => page.evaluate(() => {
        const o = document.getElementById("n4-out");
        return { ready: o.dataset.ready, text: o.textContent, border: getComputedStyle(o).borderLeftColor, size: getComputedStyle(o).fontSize };
      });
      const start = await state();
      if (!javaScriptEnabled) {
        check("notes/legacy-rebuild.html N4 no-JS: blocked status at 17px", start.ready === "false" && start.size === "17px" && /blocked/.test(start.text), JSON.stringify(start));
        await context.close();
        continue;
      }
      const boxes = page.locator("#n4-layers input");
      for (let i = 0; i < 5; i++) await boxes.nth(i).check();
      const five = await state();
      await boxes.nth(5).focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
      const six = await state();
      const status = await page.locator("#note-status").textContent();
      check("notes/legacy-rebuild.html N4 gate: five ticked stays blocked, the sixth by Space turns ready with a new rule colour and is announced", five.ready === "false" && /Not ready: Operation\.$/.test(five.text) && six.ready === "true" && six.border !== five.border && /All six/.test(status), `${five.text} [${five.border}] → ${six.text} [${six.border}]; status "${status}"`);
      await context.close();
    }
  },

  // Lab INP: the worst event duration over a few real clicks at 4x CPU.
  async inp() {
    const cases = [
      ["index.html", "[data-toggle]"],
      ["notes/bounded-concurrency.html", "main input, main button"],
      ["notes/independent-failure.html", "main input, main button"],
      ["notes/human-judgment.html", "main input, main button"],
      ["notes/legacy-rebuild.html", "main input[type=checkbox]"],
      ["work/integration-middleware.html", "main button, main input"],
      ["work/claims-intake.html", "main button"],
    ];
    for (const [path, sel] of cases) {
      const { context, page } = await open({ width: 390, height: 844 }, { reducedMotion: "reduce" });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        window.__ev = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev = Math.max(window.__ev, e.duration); }).observe({ type: "event", durationThreshold: 16, buffered: true });
      });
      await idle(page, path);
      const loc = page.locator(sel).filter({ visible: true });
      const n = Math.min(await loc.count(), 6);
      for (let i = 0; i < n; i++) {
        await loc.nth(i).scrollIntoViewIfNeeded();
        await loc.nth(i).click({ force: true });
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(400);
      const worst = await page.evaluate(() => Math.round(window.__ev));
      check(`${path} INP lab (4x CPU, ${n} interactions): worst ${worst}ms <= 200`, n > 0 && worst <= 200 && !page.errors.length, page.errors.join("; "));
      await context.close();
    }
  },

  // Every visible checkbox, radio or slider label is 13px on every page, at both widths.
  async labels() {
    for (const path of PAGES)
    for (const width of [1280, 390]) {
      const { context, page } = await open({ width, height: 844 }, { reducedMotion: "reduce" });
      await idle(page, path);
      await page.evaluate(() => document.getElementById("experiment-tab")?.click());
      const r = await page.evaluate(() => ({
        sizes: [...document.querySelectorAll("label:has(input), .slider")].filter((e) => e.getBoundingClientRect().width).map((e) => getComputedStyle(e).fontSize),
        inputs: [...document.querySelectorAll("main input:is([type=checkbox], [type=radio], [type=range])")].filter((e) => e.getBoundingClientRect().width).length,
      }));
      const off = r.sizes.filter((s) => s !== "13px");
      check(`${path} ${width}: control labels 13px`, !off.length && (r.sizes.length > 0 || r.inputs === 0), `${r.sizes.length} labels, ${r.inputs} visible inputs${off.length ? `; off: ${[...new Set(off)].join(",")}` : ""}`);
      await context.close();
    }
  },

  // The opening Work rows and the nav lead to the case pages.
  async routes() {
    const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
    await idle(page, "index.html");
    const rows = await page.evaluate(() => [...document.querySelectorAll(".arrival-index a")].map((a) => a.getAttribute("href")));
    check("index.html Work rows go to the four case pages in case order", rows.join() === "work/integration-middleware.html,work/sim-activation.html,work/claims-intake.html,work/campaign-delivery.html", rows.join());
    for (const path of PAGES) {
      await idle(page, path);
      const nav = await page.evaluate(() => { const a = document.querySelector("nav[aria-label=Primary] a"); return `${new URL(a.href).pathname.split("/").pop()} "${a.textContent.trim()}"`; });
      check(`${path} nav Work goes to cases.html`, nav === 'cases.html "Work"', nav);
    }
    await idle(page, "index.html");
    await page.click(".arrival-index a:nth-of-type(3)");
    await page.waitForLoadState("networkidle");
    check("index.html clicking Work row 03 lands on the claims case", page.url().endsWith("work/claims-intake.html"), page.url());
    await context.close();
  },

  // study.js scrolls to the preview; Enter on its jump link must leave focus on the h3, and Tab then moves on.
  async jumpfocus() {
    const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
    await idle(page, "index.html");
    for (const hash of ["#telecom", "#claims"]) {
      await page.focus(`.principle-people a[href="${hash}"]`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      const f = await page.evaluate((h) => ({ tag: document.activeElement.tagName, id: document.activeElement.id, inside: document.querySelector(h).contains(document.activeElement) }), hash);
      check(`index.html Enter on ${hash} focuses its heading`, f.inside && f.tag === "H3", JSON.stringify(f));
      await page.keyboard.press("Tab");
      const next = await page.evaluate((h) => {
        const preview = document.querySelector(h);
        const a = document.activeElement;
        return a !== document.body && (preview.contains(a) || Boolean(preview.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) && a.id !== `${h.slice(1)}-title`;
      }, hash);
      check(`index.html next Tab after ${hash} moves forward from the heading`, next);
    }
    await context.close();
  },

  // The cap row carries "CAP" and a 2px rule, with and without JS, and follows the slider.
  async n1cap() {
    for (const javaScriptEnabled of [true, false]) {
      const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce", javaScriptEnabled });
      await idle(page, "notes/bounded-concurrency.html");
      const at = () => page.evaluate(() => {
        const rows = document.querySelectorAll("#n1-rows tr:has(.cap)");
        const r = rows[0];
        return r ? `${rows.length} ${r.cells[0].textContent} rule ${getComputedStyle(r.cells[0]).borderBottomWidth}` : "none";
      });
      const five = await at();
      let two = "n/a";
      if (javaScriptEnabled) {
        await page.locator("#n1-capacity").fill("2");
        await page.locator("#n1-capacity").dispatchEvent("change");
        await page.waitForTimeout(100);
        two = await at();
      }
      check(`notes/bounded-concurrency.html N1 CAP ${javaScriptEnabled ? "JS" : "no-JS"}: on row 5 with a 2px rule${javaScriptEnabled ? ", moves to row 2" : ""}`, five === "1 5 CAP rule 2px" && (!javaScriptEnabled || two === "1 2 CAP rule 2px"), `${five} → ${two}`);
      await context.close();
    }
  },

  // Code blocks wrap rather than scroll sideways, in WebKit as well as Chrome.
  async codeblocks() {
    const paths = SUBPAGES.filter((p) => /^(work|notes)\//.test(p));
    for (const [name, launch] of [["chrome", () => chromium.launch({ channel: "chrome", headless: true })], ["webkit", () => webkit.launch()]]) {
      const engine = await launch();
      const bad = [];
      let cells = 0;
      let blocks = 0;
      for (const path of paths)
      for (const width of [320, 390, 768, 1280])
      for (const spaced of [false, true]) {
        const page = await engine.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
        await idle(page, path);
        if (spaced) await page.addStyleTag({ content: SPACING });
        const r = await page.evaluate(() => [[...document.querySelectorAll("pre")].map((e) => e.scrollWidth - e.clientWidth), document.documentElement.scrollWidth - document.documentElement.clientWidth]);
        cells++;
        blocks += r[0].length;
        if (r[0].some((d) => d > 0) || r[1] > 0) bad.push(`${path} ${width}${spaced ? "+spacing" : ""}: pre ${r[0]} page ${r[1]}`);
        await page.close();
      }
      await engine.close();
      check(`${name} code blocks and pages do not scroll sideways: ${cells} cells`, !bad.length && blocks > 0, `${blocks} code blocks measured${bad.length ? "; " + bad.slice(0, 5).join("; ") : ""}`);
    }
  },

  // The closing contact band on the home page: contrast, fragments into it, copy email.
  async band() {
    for (const width of [1280, 390]) {
      const { context, page } = await open({ width, height: 844 }, { reducedMotion: "reduce" });
      await idle(page, "index.html");
      const r = await page.evaluate(() => {
        const lum = (c) => {
          const m = c.match(/[\d.]+/g).map(Number);
          const [r, g, b] = m.slice(0, 3).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] ?? 1, rgb: m.slice(0, 3) };
        };
        const back = lum(getComputedStyle(document.querySelector(".closing")).backgroundColor);
        const ratio = (el) => {
          const f = lum(getComputedStyle(el).color);
          const mix = f.rgb.map((v, i) => v * f.a + back.rgb[i] * (1 - f.a));
          const F = lum(`rgb(${mix.join(",")})`).L;
          return +((Math.max(F, back.L) + 0.05) / (Math.min(F, back.L) + 0.05)).toFixed(2);
        };
        return [...document.querySelectorAll(".closing :is(h2, p, a, figcaption span, .section-label span)")].filter((e) => e.textContent.trim() && e.getBoundingClientRect().width).map((e) => [e.textContent.trim().slice(0, 24), ratio(e), getComputedStyle(e).fontSize]);
      });
      const worst = r.reduce((m, x) => (x[1] < m[1] ? x : m), ["none", Infinity, ""]);
      check(`index.html contact band contrast ${width}: every text run >= 4.5:1`, r.length > 0 && r.every((x) => x[1] >= 4.5), `${r.length} runs; worst "${worst[0]}" ${worst[1]}:1 @${worst[2]}`);
      // WCAG 1.4.11: each control's focus ring against the green band, reached by keyboard so :focus-visible applies.
      await page.keyboard.press("Tab");
      const rings = await page.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const band = lum(getComputedStyle(document.querySelector("#contact .closing")).backgroundColor);
        return [...document.querySelectorAll("#contact .closing :is(a[href], button)")].filter((e) => e.getBoundingClientRect().width).map((e) => {
          e.focus();
          const cs = getComputedStyle(e);
          const ring = lum(cs.outlineColor);
          return { label: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20), visible: e.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, colour: cs.outlineColor, ratio: +((Math.max(ring, band) + 0.05) / (Math.min(ring, band) + 0.05)).toFixed(2) };
        });
      });
      const weakest = rings.reduce((m, r) => (r.ratio < m.ratio ? r : m), { label: "none", ratio: Infinity });
      check(`index.html contact band focus rings ${width}: visible and >= 3:1 on the band`, rings.length > 0 && rings.every((r) => r.visible && r.ratio >= 3), `${rings.length} controls; weakest "${weakest.label}" ${weakest.colour} ${weakest.ratio}:1${rings.some((r) => !r.visible) ? `; no ring on ${rings.filter((r) => !r.visible).map((r) => r.label).join(", ")}` : ""}`);
      for (const id of ["engineering-focus", "stack", "certs", "education", "about", "contact"]) {
        await idle(page, `index.html#${id}`);
        await page.waitForTimeout(300);
        const [top, vh] = await page.evaluate((id) => [Math.round(document.getElementById(id).getBoundingClientRect().top), innerHeight], id);
        check(`index.html #${id} ${width} lands in view`, top >= 0 && top < vh * 0.6, `top ${top}`);
      }
      await idle(page, "index.html");
      await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
      const copy = page.locator("#copy-email");
      const visible = await copy.isVisible();
      if (visible) {
        await copy.click();
        await page.waitForTimeout(300);
      }
      const status = visible ? await page.textContent("#copy-status") : "";
      check(`index.html copy email ${width} announces`, visible && /copied/i.test(status), visible ? status : "button not visible");
      await context.close();
    }
  },
};

// Masthead text against the real pixels with only the masthead's own text hidden,
// so hero text sliding under a translucent bar counts against it.
async function mastheadContrast(page) {
  const items = await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.getElementById("navigation"), NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      let opacity = 1;
      let hidden = false;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden") hidden = true;
        opacity *= Number(cs.opacity);
      }
      const r = document.createRange();
      r.selectNodeContents(n);
      const rects = [...r.getClientRects()].filter((q) => q.width > 1 && q.height > 1).map((q) => [q.left, q.top, q.width, q.height]);
      if (hidden || !rects.length) continue;
      const cs = getComputedStyle(el);
      out.push({ label: n.textContent.trim().slice(0, 20), color: cs.color, opacity, need: parseFloat(cs.fontSize) >= 24 ? 3 : 4.5, rects });
    }
    return out;
  });
  const hide = await page.addStyleTag({ content: `#navigation, #navigation * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } #navigation svg { visibility: hidden !important; }` });
  await frames(page);
  const png = (await page.screenshot({ type: "png", timeout: 90000 })).toString("base64");
  await hide.evaluate((e) => e.remove());
  return page.evaluate(
    async ({ png, items }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      return items.map((item) => {
        const [r, g, b, a = 1] = item.color.match(/[\d.]+/g).map(Number);
        const alpha = a * item.opacity;
        let min = Infinity;
        for (const [x, y, w, h] of item.rects)
          for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + h)); yy++)
            for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + w)); xx++) {
              const i = (yy * width + xx) * 4;
              const fg = lum(alpha * r + (1 - alpha) * data[i], alpha * g + (1 - alpha) * data[i + 1], alpha * b + (1 - alpha) * data[i + 2]);
              const back = lum(data[i], data[i + 1], data[i + 2]);
              min = Math.min(min, (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05));
            }
        return { label: item.label, need: item.need, min };
      });
    },
    { png, items },
  );
}

for (const [name, run] of Object.entries(checks)) {
  if (selected.size && !selected.has(name)) continue;
  try {
    await run();
  } catch (error) {
    check(name, false, `threw ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
