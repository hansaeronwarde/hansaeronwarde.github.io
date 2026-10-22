// Runtime checks for the portfolio. Needs the site served at BASE (default
// http://127.0.0.1:8767/) and Google Chrome: the bundled Chromium cannot decode
// the H.264 film, so contrast would only ever be sampled on the poster.
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
const { chromium } = playwright.chromium ? playwright : playwright.default;

const BASE = process.env.BASE || "http://127.0.0.1:8767/";
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
  return { context, page };
}

async function load(page, path = "cases.html") {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const frames = (page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

// Text is hidden, the frame is captured, then each text run's line boxes are
// composited against the real pixels behind them (opacity included).
const CASES_FILM = { roots: [".film-stage", "#navigation"], animated: ".film-identity,.story-line,.request-route,.film-footer,.paper-reveal" };
// The red period after the name is decoration, which 1.4.3 exempts.
const HOME_FILM = { roots: [".stage", "#navigation"], animated: ".identity,.system-scene,.scene-heading,.paper-surface,.paper-surface > *,.subject", skip: "#name > span" };

async function sampleContrast(page, includeStatic = false, film = CASES_FILM) {
  const items = await page.evaluate(({ includeStatic, roots, animated, skip }) => {
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
    if (includeStatic && document.body.classList.contains("static-film")) {
      const footer = document.querySelector(".film-footer");
      const q = footer.getBoundingClientRect();
      const s = state(footer);
      if (s) out.push({ label: "footer::before static label", color: getComputedStyle(footer, "::before").color, ...s, need: 4.5, rects: [[q.left, q.top + 8, Math.min(220, q.width), q.height - 8]] });
    }
    return out;
  }, { includeStatic, ...film });
  const all = film.roots.map((r) => `${r}, ${r} *`).join(", ");
  const hide = await page.addStyleTag({
    content: `${all} { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
      ${film.roots.map((r) => `${r} svg`).join(", ")} { visibility: hidden !important; } .film-footer::before { color: transparent !important; }`,
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
function typeCensus(page, filmSel) {
  return page.evaluate((filmSel) => {
    const film = document.querySelector(filmSel);
    const shown = (el) => {
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        if (e.hidden) return false;
        const cs = getComputedStyle(e);
        if (cs.display === "none") return false;
        // Film overlays rest at opacity 0 and are revealed by scroll.
        if (!film.contains(e) && (cs.visibility === "hidden" || Number(cs.opacity) < 0.05)) return false;
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

async function toProgress(page, p) {
  await page.evaluate((p) => {
    const t = ScrollTrigger.getById("film");
    document.documentElement.style.scrollBehavior = "auto";
    scrollTo(0, t.start + (t.end - t.start) * p);
  }, p);
  await page.waitForTimeout(450);
  await page
    .waitForFunction(() => {
      const s = document.querySelector(".film-stage");
      return s.dataset.video !== "ready" || s.dataset.seeking !== "true";
    }, null, { timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(150);
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
  async contrast() {
    const points = [];
    for (let p = 0; p <= 0.14 + 1e-9; p += 0.02) points.push(p);
    for (let p = 0.29; p <= 0.47 + 1e-9; p += 0.03) points.push(p);
    for (let p = 0.59; p <= 0.77 + 1e-9; p += 0.03) points.push(p);
    points.push(0.86, 0.9, 0.93, 0.96, 0.98, 1);
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const { context, page } = await open({ width, height });
      await load(page);
      await page.mouse.wheel(0, 2);
      const video = await page
        .waitForFunction(() => document.querySelector(".film-stage").dataset.video === "ready", null, { timeout: 30000 })
        .then(() => "ready", () => "not ready");
      const rows = [];
      for (const p of points) {
        await toProgress(page, p);
        for (const r of await sampleContrast(page)) rows.push({ ...r, p: +p.toFixed(3) });
      }
      summarise(`cases.html contrast film ${width}x${height} (${points.length} scrub points, video ${video})`, rows);
      await context.close();
      const still = await open({ width, height }, { reducedMotion: "reduce" });
      await load(still.page);
      summarise(`cases.html contrast static film ${width}x${height}`, (await sampleContrast(still.page, true)).map((r) => ({ ...r, p: "static" })));
      await still.context.close();
    }
  },

  async bytes() {
    for (const [path, poster] of [["cases.html", ".film-poster"], ["index.html", ".footage img"]])
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
    await load(page, "cases.html#case-activation");
    await page.click("#tel-reset");
    await page.focus("#tel-step");
    let presses = 0;
    for (; presses < 10 && (await page.getAttribute("#tel-step", "aria-disabled")) !== "true"; presses++) await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const tel = await active();
    const events = await page.textContent("#tel-count");
    check("cases.html focus telecom: finished Step keeps focus and a further Enter does not reset", presses > 0 && tel.id === "tel-step" && events !== "1 EVENT", `${presses} presses, activeElement ${tel.id}, record ${events}`);
    await load(page, "cases.html#case-capture");
    await page.click("#clm-reset");
    await page.fill("#clm-amount", "100.00");
    await page.evaluate(() => scrollTo(0, scrollY + document.getElementById("clm-amount").getBoundingClientRect().top - 120));
    await page.focus("#clm-approve");
    await page.keyboard.press("Enter");
    await frames(page);
    const clm = await active();
    check("cases.html focus claims: Approve focuses the state, clear of the masthead", clm.id === "clm-state" && clm.clear, `activeElement ${clm.id}, top ${clm.top}`);
    await load(page, "cases.html#case-campaigns");
    await page.click("#cmp-reset");
    await page.focus("#cmp-send");
    await page.keyboard.press("Enter");
    await frames(page);
    const cmp = await active();
    check("cases.html focus campaigns: Send focuses an outcome, not Reset, clear of the masthead", cmp.id === "cmp-sms" && cmp.clear, `activeElement ${cmp.id}, top ${cmp.top}`);
    await context.close();
  },

  // If the study scripts fail, the no-JS records must stay rather than dead controls.
  async studyfallback() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.route("**/studies.js", (route) => route.abort());
    await load(page, "cases.html#case-activation");
    const r = await page.evaluate(() => ({
      controls: [...document.querySelectorAll(".support [data-enhance]")].filter((e) => !e.hidden).length,
      fallbacks: [...document.querySelectorAll(".support [data-nojs]")].filter((e) => e.hidden).length,
    }));
    check("cases.html study scripts failing leave the no-JS records", r.controls === 0 && r.fallbacks === 0, `${r.controls} controls shown, ${r.fallbacks} fallbacks hidden`);
    await context.close();
  },

  // Case panels start hidden, so the claims connector is first measured at 0x0.
  async connector() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await load(page, "cases.html#case-activation");
    await page.click('.project-index [data-case-link="case-capture"]');
    await frames(page);
    const c = await page.evaluate(() => {
      const svg = document.querySelector("#clm-review .connector");
      return { hidden: svg?.hidden, d: svg?.querySelector("path").getAttribute("d") };
    });
    check("cases.html claims connector drawn after a case switch", c.hidden === false && /^M[\d.]+ [\d.]+H/.test(c.d || ""), `hidden ${c.hidden}, d "${c.d}"`);
    await context.close();
  },

  async history() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await load(page);
    const shown = () => page.evaluate(() => [...document.querySelectorAll("[data-case-panel]")].filter((p) => !p.hidden).map((p) => p.id).join(","));
    const current = () => page.evaluate(() => document.querySelector('.project-index [aria-current="true"]')?.dataset.caseLink);
    const navLocation = () => page.evaluate(() => [...document.querySelectorAll('[aria-current="location"]')].map((a) => a.getAttribute("href")).join(","));
    await page.click('.project-index [data-case-link="case-activation"]');
    await page.click('.project-index [data-case-link="case-capture"]');
    // The masthead and the menu each mark #projects while a case is shown, and nothing at the top.
    const steps = [["#case-activation", "case-activation", "#projects,#projects"], ["", "case-middleware", ""]];
    for (const [hash, expected, nav] of steps) {
      await page.evaluate(() => history.back());
      await page.waitForFunction((h) => location.hash === h, hash);
      await page.waitForTimeout(300);
      const [s, c, l] = [await shown(), await current(), await navLocation()];
      check(`cases.html Back to "${hash || "(no hash)"}" shows ${expected}, nav location "${nav}"`, s === expected && c === expected && l === nav, `visible ${s}, aria-current ${c}, nav aria-current="location" on "${l}"`);
    }
    await context.close();
  },

  async reflow() {
    for (const [width, height] of [[320, 256], [360, 225]]) {
      const { context, page } = await open({ width, height });
      await load(page);
      const g = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { mast: r("#navigation").bottom, kicker: r(".film-kicker").top, h1: r("#name").top, h1b: r("#name").bottom, note: r(".identity-note p").bottom, stage: r(".film-stage").bottom };
      });
      const ok = g.kicker >= g.mast - 0.5 && g.h1 >= g.mast - 0.5 && g.h1b <= g.stage && g.note <= g.stage;
      check(`cases.html reflow ${width}x${height}: hero below masthead, inside stage`, ok, `masthead bottom ${g.mast}, kicker top ${g.kicker.toFixed(0)}, h1 ${g.h1.toFixed(0)}..${g.h1b.toFixed(0)}, note bottom ${g.note.toFixed(0)}, stage bottom ${g.stage.toFixed(0)}`);
      await context.close();
    }
    const { context, page } = await open({ width: 320, height: 568 });
    await load(page);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check("cases.html no horizontal scroll at 320x568", sw <= cw, `scrollWidth ${sw}, clientWidth ${cw}`);
    await context.close();
  },

  async fonts() {
    const census = (page) => typeCensus(page, ".film-stage");
    for (const [width, height, reducedMotion] of [[1440, 900, "no-preference"], [390, 844, "no-preference"], [320, 568, "no-preference"], [390, 844, "reduce"]]) {
      const { context, page } = await open({ width, height }, { reducedMotion });
      await load(page);
      const bad = new Set();
      let min = Infinity;
      for (const id of ["case-middleware", "case-activation", "case-capture", "case-campaigns"]) {
        await page.evaluate((id) => document.querySelector(`.project-index [data-case-link="${id}"]`).click(), id);
        await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelector(".credits").setAttribute("open", ""));
        const r = await census(page);
        min = Math.min(min, r.min);
        r.bad.forEach((b) => bad.add(b));
      }
      await page.evaluate(() => document.getElementById("site-menu").showModal());
      const m = await census(page);
      min = Math.min(min, m.min);
      m.bad.forEach((b) => bad.add(b));
      check(`cases.html type floor ${width}x${height} ${reducedMotion}: text >= 11px, links >= 12px`, bad.size === 0, `min ${min}px; ${bad.size} runs below floor${bad.size ? ": " + [...bad].slice(0, process.env.VERBOSE ? Infinity : 6).join("; ") : ""}`);
      await context.close();
    }
  },

  async hero() {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const { context, page } = await open({ width, height });
      await load(page);
      const text = await page.evaluate(() => document.querySelector(".identity-note p").innerText.replace(/\s+/g, " ").trim());
      check(`cases.html hero words separated ${width}x${height}`, text.includes("systems behind billing"), JSON.stringify(text));
      await context.close();
    }
  },

  async credits() {
    const { context, page } = await open({ width: 1440, height: 900 });
    await load(page);
    await page.click(".credits summary");
    const sizes = await page.$$eval(".credits a", (links) => links.map((a) => { const r = a.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check("cases.html film credit links >= 24x24", sizes.every(([w, h]) => w >= 24 && h >= 24), sizes.map((s) => s.join("x")).join(", "));
    await context.close();
  },

  async nojs() {
    for (const path of ["cases.html", "index.html"])
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const { context, page } = await open({ width, height }, { javaScriptEnabled: false });
      await page.goto(BASE + path + "#work", { waitUntil: "load" });
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
        return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
      check(`${path} no-JS masthead legible ${width}x${height}`, r.ratio >= 4.5, `${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}:1`);
      await context.close();
    }
  },

  // Invisible film layers (opacity 0) once swallowed every pointer hit on the hero links.
  async hits() {
    const sizes = [[1440, 900], [1600, 1000], [390, 844], [320, 800], [844, 390], [820, 1180], [1024, 600], [700, 900]];
    const pages = [
      { path: "cases.html", hero: ".identity-links a", heroes: 2, controls: ".film-footer button, .film-footer a, .film-footer input" },
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
      const { context, page } = await open({ width, height }, { acceptDownloads: true });
      await load(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      const navigations = [];
      cdp.on("Page.frameRequestedNavigation", (e) => navigations.push(e.url));
      const attempt = (selector) =>
        page.click(selector, { timeout: 3000 }).then(() => "clicked", (e) => e.message.split("\n").find((l) => /intercepts/.test(l))?.trim() || e.message.split("\n")[0]);
      const email = await attempt(".identity-links a[href^='mailto:']");
      await page.waitForTimeout(300);
      await page.route(/linkedin\.com/, (route) => route.fulfill({ status: 204 }));
      const linkedInRequest = page.waitForRequest(/linkedin\.com\/in\/hansaeronwarde/, { timeout: 5000 }).then(() => true, () => false);
      const linkedIn = await attempt(".identity-links a[href*='linkedin.com']");
      const requested = await linkedInRequest;
      const mailto = navigations.some((u) => u.startsWith("mailto:"));
      check(`cases.html real click on hero links ${width}x${height}`, email === "clicked" && mailto && linkedIn === "clicked" && requested, `Email: ${email}, mailto requested ${mailto}; LinkedIn: ${linkedIn}, requested ${requested}`);
      await context.close();
    }
  },

  // The hero is in flow and wraps the note under the name, so neither collides
  // with the other or the masthead; a hero taller than the viewport grows the
  // stage and the film unpins. Swept with and without the WCAG 1.4.12 override.
  async fit() {
    const spacingCss = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
    const widths = [];
    for (let w = 320; w <= 1920; w += 8) widths.push(w);
    // Sizes where earlier layouts failed (r2 and final audits), plus each type-scale edge.
    widths.push(601, 620, 630, 640, 801, 810, 820, 834, 853, 900, 912, 940, 944, 1024, 1100, 1101, 1240, 1241, 1600, 1700);
    const sorted = [...new Set(widths)].sort((a, b) => a - b);
    const heights = [568, 761, 844, 900, 1180];
    const runs = [];
    for (const spacing of [false, true]) for (const height of heights) runs.push({ spacing, height });
    const results = await Promise.all(
      runs.map(async ({ spacing, height }) => {
        const { context, page } = await open({ width: sorted[0], height });
        await load(page);
        if (spacing) await page.addStyleTag({ content: spacingCss });
        const bad = [];
        let pinned = 0;
        for (const width of sorted) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(260);
          // Settled: ScrollTrigger has released the old pinned width, and the film is pinned exactly when the hero fits.
          const settled = await page
            .waitForFunction(() => {
              const s = document.querySelector(".film-stage");
              const fits = s.offsetHeight <= parseFloat(getComputedStyle(s).minHeight) + 1;
              return Math.abs(s.getBoundingClientRect().width - document.documentElement.clientWidth) < 1 && fits === document.body.classList.contains("scroll-enabled");
            }, null, { timeout: 3000 })
            .then(() => true, () => false);
          await frames(page);
          const g = await heroGeometry(page);
          if (g.pinned) pinned++;
          const problems = [];
          if (!settled) problems.push("pin state never matched fit");
          if (g.nameNote) problems.push(`name/note overlap ${g.nameNote}px`);
          if (g.kicker) problems.push(`kicker overlap ${g.kicker}px`);
          if (g.footer) problems.push(`hero/footer overlap ${g.footer}px`);
          if (g.aboveMasthead < -0.5) problems.push(`${-g.aboveMasthead}px above masthead`);
          if (problems.length) bad.push(`${width}x${height} ${problems.join(", ")}`);
        }
        await context.close();
        return { spacing, height, bad, pinned };
      }),
    );
    for (const spacing of [false, true]) {
      const rows = results.filter((r) => r.spacing === spacing);
      const bad = rows.flatMap((r) => r.bad);
      const cells = rows.length * sorted.length;
      check(
        `cases.html hero fit ${spacing ? "with 1.4.12 text spacing" : "plain"}: ${sorted.length} widths 320-1920 x ${heights.join("/")}`,
        bad.length === 0,
        `${cells - bad.length}/${cells} cells clean, ${rows.reduce((s, r) => s + r.pinned, 0)} pinned${bad.length ? "; " + bad.slice(0, 6).join("; ") : ""}`,
      );
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
    for (const [file, staticClass] of [["cases.html", "static-film"], ["index.html", "static-story"]])
    for (const [name, options, path, [width, height], init] of variants) {
      const { context, page } = await open({ width, height }, options);
      if (init) await page.addInitScript(init);
      await load(page, file + path);
      const isStatic = await page.evaluate((c) => document.body.classList.contains(c), staticClass);
      let worst = null;
      // The home hero is taller, so it crosses the bar over a longer run.
      for (let y = 0; y <= (file === "index.html" ? 1200 : 600); y += 60) {
        await page.evaluate((y) => scrollTo(0, y), y);
        // Past the masthead's 0.15s colour transition into its paper style.
        await page.waitForTimeout(300);
        for (const r of await mastheadContrast(page)) if (!worst || r.min / r.need < worst.min / worst.need) worst = { ...r, y };
      }
      check(`${file} static masthead contrast ${name}`, isStatic && worst && worst.min >= worst.need, `static ${isStatic}; worst "${worst?.label}" ${worst?.min.toFixed(2)}:1 (needs ${worst?.need}) at scrollY ${worst?.y}`);
      await context.close();
    }
  },

  // Portrait -> landscape -> portrait mid-film once left the stage 1,266px down a blank page.
  async rotate() {
    const { context, page } = await open({ width: 390, height: 844 });
    await load(page);
    await page.mouse.wheel(0, 2);
    await page.waitForTimeout(500);
    await toProgress(page, 0.5);
    const state = () =>
      page.evaluate(() => {
        const stage = document.querySelector(".film-stage").getBoundingClientRect();
        const t = window.ScrollTrigger?.getById("film");
        // While pinned the story is position: fixed; its spacer holds its document position.
        const story = document.getElementById("film-story");
        const placed = story.parentElement.classList.contains("pin-spacer") ? story.parentElement : story;
        const storyTop = placed.getBoundingClientRect().top + scrollY;
        return {
          y: scrollY,
          stageTop: stage.top,
          stageBottom: stage.bottom,
          vh: innerHeight,
          pinned: Boolean(t),
          start: t?.start,
          end: t?.end,
          storyTop,
          progress: Number(document.querySelector(".film-stage").dataset.progress),
        };
      });
    const filled = (s) => s.stageTop <= 0.5 && s.stageBottom >= s.vh - 0.5;
    const tracks = (s) => s.pinned && Math.abs(s.start - s.storyTop) < 1 && Math.abs(s.progress - (s.y - s.start) / (s.end - s.start)) < 0.01;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(1200);
    const landscape = await state();
    check("cases.html rotate to landscape lands on the hero, not past it", !landscape.pinned && landscape.stageBottom > 0 && landscape.stageTop < landscape.vh, `scrollY ${Math.round(landscape.y)}, stage ${Math.round(landscape.stageTop)}..${Math.round(landscape.stageBottom)}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    const back = await state();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(1200);
    const wheeled = await state();
    const describe = (s) => `scrollY ${Math.round(s.y)}, stage ${Math.round(s.stageTop)}..${Math.round(s.stageBottom)}, film start ${s.start?.toFixed(1)} (story top ${s.storyTop.toFixed(1)}), progress ${s.progress}`;
    check("cases.html rotate back to portrait: stage fills the viewport, progress follows scroll", filled(back) && tracks(back) && filled(wheeled) && tracks(wheeled) && wheeled.progress > back.progress, `${describe(back)}; after 100px wheel ${describe(wheeled)}`);
    await context.close();
  },

  async d19record() {
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
    check("index.html d19 study trace equals the opening record after a normal scroll", played.pinned && JSON.stringify(played.card) === JSON.stringify(played.trace), `card ${played.card.join(" / ")}; trace ${played.trace.join(" / ")}`);
    await page.selectOption("#request-select", "7");
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.waitForTimeout(800);
    const resized = await read();
    check("index.html d19 selection survives a resize across the pin threshold", !resized.pinned && resized.selected === "7" && resized.trace[0] === "007", `pinned ${played.pinned} → ${resized.pinned}, selected ${resized.selected}, trace ${resized.trace[0]}`);
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
          for (const r of await sampleContrast(page, false, HOME_FILM)) rows.push({ ...r, p });
        }
        summarise(`index.html contrast film ${width}x${height} (${points.length} scrub points, video ${video}, red name period exempt)`, rows);
        await context.close();
      }
    for (const [width, height] of [[1440, 900], [1280, 800], [390, 844]]) {
      const still = await open({ width, height }, { reducedMotion: "reduce" });
      await load(still.page, "index.html");
      summarise(`index.html contrast static film ${width}x${height} (red name period exempt)`, (await sampleContrast(still.page, false, HOME_FILM)).map((r) => ({ ...r, p: "static" })));
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

  // study.js reveals only its own controls; if studies-ui.js never runs, the supporting studies keep their no-JS records.
  async homefallback() {
    const { context, page } = await open({ width: 1280, height: 800 });
    await page.route("**/studies-ui.js", (r) => r.abort());
    await load(page, "index.html");
    const r = await page.evaluate(() => ({
      enhanced: [...document.querySelectorAll(".support [data-enhance]")].filter((e) => !e.hidden).length,
      fallbacks: [...document.querySelectorAll(".support [data-nojs]")].filter((e) => e.hidden).length,
      study: [...document.querySelectorAll("#study [data-enhance]")].filter((e) => e.hidden).length,
    }));
    check("index.html without studies-ui.js: supporting studies keep their no-JS records", r.enhanced === 0 && r.fallbacks === 0 && r.study === 0, `${r.enhanced} enhanced controls shown, ${r.fallbacks} fallbacks hidden, ${r.study} request-study controls hidden`);
    await context.close();
  },

  // A <label> names its first labelable descendant, and <output> is labelable, so the
  // range inputs need their own name. Read from Chromium's accessibility tree.
  async sliders() {
    for (const [path, tab] of [["index.html", "#experiment-tab"], ["cases.html", "#lab-tab-1"]]) {
      const { context, page } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
      await load(page, path);
      await page.evaluate((tab) => document.querySelector(tab).click(), tab);
      await page.waitForTimeout(200);
      const cdp = await context.newCDPSession(page);
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const names = nodes.filter((n) => n.role?.value === "slider" && !n.ignored).map((n) => n.name?.value || "");
      const ranges = await page.evaluate(() => [...document.querySelectorAll('input[type="range"]')].filter((e) => e.getClientRects().length).length);
      const want = ["Workers", "Downstream capacity"];
      check(`${path} capacity sliders are named`, want.every((w) => names.includes(w)) && names.every(Boolean), `${ranges} visible range inputs; slider names ${JSON.stringify(names)}`);
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

  // WCAG 1.4.12 on every page section, not only the hero: no horizontal scroll on phones.
  async spacingreflow() {
    const spacingCss = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
    const bad = [];
    for (const path of ["index.html", "cases.html"])
      for (const width of [320, 360, 390, 1024, 1440]) {
        const { context, page } = await open({ width, height: 844 });
        await load(page, path);
        await page.addStyleTag({ content: spacingCss });
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sw > 0) bad.push(`${path} ${width}: ${sw}px`);
        await context.close();
      }
    check("text spacing: no horizontal scroll at 320/360/390/1024/1440 on both pages", bad.length === 0, bad.join("; ") || "10 cells clean");
  },

  // Shared studies-ui.js on both pages: the case-study page keeps its Run/Pause tooltip, the home page has none.
  async telrun() {
    for (const [path, tooltip] of [["cases.html", true], ["index.html", false]]) {
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
};

// Range rects of display type at line-height < 1 span the font's content area,
// well past the glyphs, so the name is measured by its ink from the baseline.
function heroGeometry(page) {
  return page.evaluate(() => {
    const rects = (root) => {
      const out = [];
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) out.push(q);
      }
      return out;
    };
    const ctx = document.createElement("canvas").getContext("2d");
    const name = [];
    const w = document.createTreeWalker(document.getElementById("name"), NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const cs = getComputedStyle(n.parentElement);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(n.textContent.trim().toUpperCase());
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) {
        if (q.width < 0.5) continue;
        const base = q.top + m.fontBoundingBoxAscent;
        name.push({ left: q.left, right: q.right, top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent });
      }
    }
    const kicker = rects(document.querySelector(".film-kicker"));
    const note = rects(document.querySelector(".identity-note"));
    const footer = rects(document.querySelector(".film-footer"));
    const overlap = (A, B) => {
      let most = 0;
      for (const a of A)
        for (const b of B) {
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 0.5 && y > 0.5) most = Math.max(most, Math.round(x));
        }
      return most;
    };
    const hero = [...kicker, ...name, ...note];
    return {
      nameNote: overlap(name, note),
      kicker: Math.max(overlap(kicker, name), overlap(kicker, note)),
      footer: overlap(hero, footer),
      aboveMasthead: Math.round(Math.min(...hero.map((q) => q.top)) - document.getElementById("navigation").getBoundingClientRect().bottom),
      pinned: document.body.classList.contains("scroll-enabled"),
    };
  });
}

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
