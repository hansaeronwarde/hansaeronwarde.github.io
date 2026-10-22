(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 600px)");
  const still = new URLSearchParams(location.search).get("motion") === "still";
  const saveData = Boolean(navigator.connection?.saveData);
  const video = $("scroll-video");
  const story = $("film-story");
  const stage = document.querySelector(".film-stage");
  const panels = [...document.querySelectorAll("[data-case-panel]")];
  const state = { progress: 0 };
  let queueLab;
  let filmContext,
    filmMode = null,
    ready = false,
    frozen = false,
    targetTime = 0;
  let initializing = true,
    requestedReduction = false,
    interacted = false;
  try {
    requestedReduction = localStorage.getItem("haw-reduced-motion") === "true";
  } catch {}

  const motionDisabled = () =>
    reduced.matches || still || saveData || requestedReduction;
  // The hero is in flow (site.css), so the stage only exceeds its 100svh
  // min-height when the hero cannot fit; a pinned stage that tall would hide
  // its own bottom, so the film unpins instead.
  const heroFits = () =>
    stage.offsetHeight <= parseFloat(getComputedStyle(stage).minHeight) + 1;
  const icons = () => window.lucide?.createIcons();
  document.body.classList.add("enhanced");
  icons();

  function activateCase(panel, announce = false) {
    if (panel.id !== "case-middleware") queueLab?.pause();
    panels.forEach((item) => (item.hidden = item !== panel));
    document
      .querySelectorAll(".project-index [data-case-link]")
      .forEach((link) => {
        if (link.dataset.caseLink === panel.id)
          link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    if (announce)
      $("case-announcement").textContent = panel
        .querySelector("h2")
        .innerText.replace(/\s+/g, " ")
        .trim();
    window.ScrollTrigger?.refresh();
  }

  function mountQueue(panel) {
    if (!window.PortfolioQueue) return null;
    const figure = panel.querySelector(".architecture");
    const system = panel.querySelector(".system-map");
    figure.classList.add("queue-enhanced");
    const navigation = document.createElement("div");
    navigation.className = "lab-tabs";
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", "Integration middleware study");
    navigation.innerHTML = ["System", "Experiment", "Trace"]
      .map(
        (name, index) =>
          `<button type="button" role="tab" id="lab-tab-${index}" aria-controls="lab-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${name}<sup>0${index + 1}</sup></button>`,
      )
      .join("");
    figure.querySelector("figcaption").after(navigation);
    system.id = "lab-panel-0";
    system.setAttribute("role", "tabpanel");
    system.setAttribute("aria-labelledby", "lab-tab-0");
    const experiment = document.createElement("div");
    experiment.className = "queue-experiment";
    experiment.id = "lab-panel-1";
    experiment.hidden = true;
    experiment.setAttribute("role", "tabpanel");
    experiment.setAttribute("aria-labelledby", "lab-tab-1");
    experiment.innerHTML = `
      <div class="lab-controls">
        <div class="field"><span id="queue-workers-label">Workers</span> <output id="worker-value" for="queue-workers" aria-live="off">5</output><input id="queue-workers" aria-labelledby="queue-workers-label" type="range" min="1" max="8" value="5"></div>
        <div class="field"><span id="queue-capacity-label">Downstream capacity</span> <output id="capacity-value" for="queue-capacity" aria-live="off">5</output><input id="queue-capacity" aria-labelledby="queue-capacity-label" type="range" min="1" max="8" value="5"></div>
        <label>Requests<select id="queue-size"><option>12</option><option selected>24</option><option>48</option></select></label>
        <label class="lab-failure"><input id="queue-failure" type="checkbox" checked>Transient errors</label>
        <div class="lab-transport">
          <button class="icon" type="button" data-run aria-label="Run batch" title="Run batch"><i data-lucide="play" aria-hidden="true"></i></button>
          <button class="icon" type="button" data-tick aria-label="Advance one tick" title="Advance one tick"><i data-lucide="step-forward" aria-hidden="true"></i></button>
          <button class="icon" type="button" data-reset aria-label="Reset batch" title="Reset batch"><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="lab-metrics">
        <div><span data-count="queued">24</span><small>Waiting</small></div>
        <div><span data-count="processing">0</span><small>In flight</small></div>
        <div><span data-count="retrying">0</span><small>Retry wait</small></div>
        <div><span data-count="completed">0</span><small>Completed</small></div>
        <div><span data-count="failed">0</span><small>Failed</small></div>
      </div>
      <div class="lab-workspace">
        <div class="lab-requests"><div class="lab-label"><span>REQUEST REGISTER</span><span data-clock>TICK 000</span></div><div class="request-register" role="group" aria-label="Synthetic requests"></div><div class="lab-legend"><span>Queued</span><span>Processing</span><span>Retrying</span><span>Completed</span><span>Failed</span></div></div>
        <div class="lab-workers"><span class="lab-label">WORKER POOL</span><ol>${Array.from({ length: 8 }, (_, index) => `<li data-worker="${index + 1}"><span>W0${index + 1}</span><strong>idle</strong><i></i></li>`).join("")}</ol></div>
      </div>
      <div class="lab-conclusion"><h4>Capacity is a constraint.</h4><p data-conclusion>Five workers. Five downstream slots. Every request starts with a record.</p><span>SYNTHETIC WORKLOAD / VIRTUAL TICKS</span></div>`;
    const trace = document.createElement("div");
    trace.id = "lab-panel-2";
    trace.className = "queue-trace";
    trace.hidden = true;
    trace.setAttribute("role", "tabpanel");
    trace.setAttribute("aria-labelledby", "lab-tab-2");
    trace.innerHTML = `
      <div class="trace-heading"><div><span class="eyebrow">REQUEST HISTORY</span><h3>One request.<br />Every transition.</h3></div><label>Request<select id="trace-request"></select></label><button class="icon" type="button" data-export aria-label="Download batch trace as JSON" title="Download batch trace as JSON"><i data-lucide="download" aria-hidden="true"></i></button></div>
      <div class="trace-record"><span data-trace-state></span><span data-trace-attempts></span><span data-trace-source>Source: synthetic study</span></div>
      <div class="trace-table-wrap"><table><caption class="sr-only">Selected request event history</caption><thead><tr><th scope="col">Tick</th><th scope="col">Event</th><th scope="col">Attempt</th></tr></thead><tbody></tbody></table></div>
      <div class="trace-source"><span>Source: this portfolio's synthetic queue study.</span><a class="arrow-link" href="assets/portfolio/queue-model.js" target="_blank" rel="noreferrer">Study source<i data-lucide="arrow-up-right" aria-hidden="true"></i></a></div>`;
    figure.querySelector(".flow").before(experiment, trace);
    const status = document.createElement("span");
    status.className = "sr-only";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    figure.append(status);
    const views = [system, experiment, trace];
    views.forEach((item) => (item.tabIndex = 0));
    const tabs = [...navigation.querySelectorAll("button")];
    let batch,
      interval = null,
      selected = 1;
    const input = (id) => experiment.querySelector("#" + id);
    function view(index, focus = false) {
      views.forEach((item, itemIndex) => (item.hidden = itemIndex !== index));
      tabs.forEach((tab, tabIndex) => {
        tab.setAttribute("aria-selected", String(tabIndex === index));
        tab.tabIndex = tabIndex === index ? 0 : -1;
      });
      if (focus) tabs[index].focus();
      if (index !== 1) pause();
      window.ScrollTrigger?.refresh();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => view(index));
      tab.addEventListener("keydown", (event) => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % 3;
        else if (event.key === "ArrowLeft") next = (index + 2) % 3;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = 2;
        else return;
        event.preventDefault();
        view(next, true);
      });
    });
    function pause() {
      clearInterval(interval);
      interval = null;
      const button = experiment.querySelector("[data-run]");
      button.setAttribute("aria-label", "Run batch");
      button.title = "Run batch";
      button.innerHTML = '<i data-lucide="play" aria-hidden="true"></i>';
      icons();
    }
    function render() {
      const counts = batch.counts;
      experiment
        .querySelectorAll("[data-count]")
        .forEach((node) => (node.textContent = counts[node.dataset.count]));
      experiment.querySelector("[data-clock]").textContent =
        "TICK " + String(batch.tick).padStart(3, "0");
      experiment.querySelectorAll("[data-job]").forEach((button, index) => {
        const job = batch.jobs[index];
        button.dataset.state = job.state;
        button.querySelector("small").textContent = {
          queued: "WAIT",
          processing: "RUN",
          retrying: "RETRY",
          completed: "DONE",
          failed: "FAIL",
        }[job.state];
        button.setAttribute(
          "aria-label",
          `Request ${job.id}: ${job.state}. Inspect trace`,
        );
        button.title = `Request ${job.id} / ${job.state}`;
      });
      experiment.querySelectorAll("[data-worker]").forEach((node) => {
        const slot = Number(node.dataset.worker);
        node.hidden = slot > batch.workers;
        const job = batch.jobs.find((item) => item.worker === slot);
        node.classList.toggle("busy", Boolean(job));
        node.querySelector("strong").textContent = job
          ? "#" + String(job.id).padStart(3, "0")
          : "idle";
      });
      const rejected = batch.events.filter(
        (event) => event.event === "capacity_rejected",
      ).length;
      experiment.querySelector("[data-conclusion]").textContent = batch.done
        ? `${counts.completed} completed. ${counts.failed} failed. ${batch.tick} virtual ticks. ${rejected} capacity rejections; each remains in the trace.`
        : batch.workers > batch.capacity
          ? `${batch.workers} workers compete for ${batch.capacity} downstream ${batch.capacity === 1 ? "slot" : "slots"}. Excess attempts are rejected and retry with backoff, up to three attempts.`
          : `${batch.workers} ${batch.workers === 1 ? "worker stays" : "workers stay"} within ${batch.capacity} downstream ${batch.capacity === 1 ? "slot" : "slots"}. Transient errors ${batch.failures ? "retry with backoff" : "are off"}; no request loses its record.`;
      const job = batch.jobs[selected - 1];
      trace.querySelector("[data-trace-state]").textContent =
        "#" + String(job.id).padStart(3, "0") + " / " + job.state;
      trace.querySelector("[data-trace-attempts]").textContent =
        job.attempts + (job.attempts === 1 ? " attempt" : " attempts");
      trace.querySelector("tbody").innerHTML = job.history
        .map(
          (event) =>
            `<tr><td>${String(event.tick).padStart(3, "0")}</td><td>${event.event.replaceAll("_", " ")}</td><td>${event.attempt}</td></tr>`,
        )
        .join("");
    }
    function tick() {
      batch.step();
      render();
      if (batch.done) {
        pause();
        status.textContent =
          experiment.querySelector("[data-conclusion]").textContent;
      }
    }
    function reset() {
      pause();
      batch = new window.PortfolioQueue.Batch({
        size: Number(input("queue-size").value),
        workers: Number(input("queue-workers").value),
        capacity: Number(input("queue-capacity").value),
        failures: input("queue-failure").checked,
      });
      selected = Math.min(selected, batch.jobs.length);
      input("worker-value").value = String(batch.workers);
      input("capacity-value").value = String(batch.capacity);
      experiment.querySelector(".request-register").innerHTML = batch.jobs
        .map(
          (job) =>
            `<button type="button" data-job="${job.id}"><span>${String(job.id).padStart(3, "0")}</span><small>WAIT</small></button>`,
        )
        .join("");
      trace.querySelector("select").innerHTML = batch.jobs
        .map(
          (job) =>
            `<option value="${job.id}">Request ${String(job.id).padStart(3, "0")}</option>`,
        )
        .join("");
      trace.querySelector("select").value = String(selected);
      render();
      status.textContent =
        "Batch reset. " + batch.jobs.length + " requests queued.";
    }
    experiment.querySelector("[data-run]").addEventListener("click", () => {
      if (interval) return pause();
      if (batch.done) reset();
      if (motionDisabled()) {
        while (!batch.done) batch.step();
        render();
        status.textContent =
          experiment.querySelector("[data-conclusion]").textContent;
        return;
      }
      tick();
      if (batch.done) return;
      interval = setInterval(tick, 600);
      const button = experiment.querySelector("[data-run]");
      button.setAttribute("aria-label", "Pause batch");
      button.title = "Pause batch";
      button.innerHTML = '<i data-lucide="pause" aria-hidden="true"></i>';
      icons();
    });
    experiment.querySelector("[data-tick]").addEventListener("click", () => {
      pause();
      tick();
      status.textContent =
        experiment.querySelector("[data-conclusion]").textContent +
        " Tick " +
        batch.tick;
    });
    experiment.querySelector("[data-reset]").addEventListener("click", reset);
    experiment
      .querySelector(".request-register")
      .addEventListener("click", (event) => {
        const button = event.target.closest("[data-job]");
        if (!button) return;
        selected = Number(button.dataset.job);
        trace.querySelector("select").value = String(selected);
        render();
        view(2);
        tabs[2].focus();
      });
    trace.querySelector("select").addEventListener("change", (event) => {
      selected = Number(event.target.value);
      render();
    });
    trace.querySelector("[data-export]").addEventListener("click", () => {
      const data = {
        source: "Synthetic portfolio study",
        units: "virtual ticks",
        config: {
          size: batch.jobs.length,
          workers: batch.workers,
          capacity: batch.capacity,
          failures: batch.failures,
        },
        tick: batch.tick,
        events: batch.events,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "synthetic-queue-trace.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    experiment.querySelectorAll("input,select").forEach((control) => {
      control.addEventListener("change", reset);
      if (control.type === "range")
        control.addEventListener("input", () => {
          pause();
          input(
            control.id === "queue-workers" ? "worker-value" : "capacity-value",
          ).value = control.value;
        });
    });
    panel.querySelector("[data-replay]").hidden = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
    });
    reset();
    return { pause, reset, view };
  }

  queueLab = mountQueue($("case-middleware"));
  icons();

  function hashId() {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return "";
    }
  }

  function scrollDirectly(action) {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    try {
      action();
    } finally {
      root.style.scrollBehavior = previous;
    }
  }

  function markLocation(id, isCase) {
    document
      .querySelectorAll("#site-menu nav a, .masthead nav a")
      .forEach((link) => {
        if (link.hash === "#" + id || (isCase && link.hash === "#projects"))
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
  }

  function navigate(id, { push = false, focus = true, scroll = true } = {}) {
    if (id === "main-content") id = "resume";
    const destination = document.getElementById(id);
    if (!destination) return;
    const panel = panels.find((item) => item.id === id);
    if (panel) activateCase(panel, focus);
    if (push && location.hash !== "#" + id)
      history.pushState(null, "", "#" + id);
    if ($("site-menu").open) $("site-menu").close();
    markLocation(id, Boolean(panel));
    if (!scroll) return;
    if (focus && id !== "top") {
      const heading = destination.matches("h1,h2")
        ? destination
        : destination.querySelector("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
    if (motionDisabled() || initializing) {
      scrollDirectly(() =>
        destination.scrollIntoView({ behavior: "auto", block: "start" }),
      );
    } else {
      destination.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) =>
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const id = link.getAttribute("href").slice(1);
      if (!document.getElementById(id)) return;
      event.preventDefault();
      navigate(id, { push: true });
    }),
  );
  // Back to the hash-less entry restores the default case and clears the
  // nav location, as on first load.
  addEventListener("hashchange", () => {
    if (hashId()) return navigate(hashId(), { focus: false });
    activateCase(panels[0]);
    markLocation("", false);
  });
  activateCase(panels.find((panel) => panel.id === hashId()) || panels[0]);

  const menu = $("site-menu");
  $("open-menu").hidden = false;
  $("open-menu").addEventListener("click", () => {
    menu.showModal();
    document.body.classList.add("menu-open");
  });
  $("close-menu").addEventListener("click", () => menu.close());
  menu.addEventListener("close", () =>
    document.body.classList.remove("menu-open"),
  );
  menu.addEventListener("click", (event) => {
    const rect = menu.getBoundingClientRect();
    if (
      event.target === menu &&
      (event.clientX < rect.left || event.clientX > rect.right)
    )
      menu.close();
  });

  $("copy-email").hidden = false;
  $("copy-email").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("haeronwarde@gmail.com");
      $("copy-status").textContent = "Email address copied.";
    } catch {
      $("copy-status").textContent = "haeronwarde@gmail.com";
    }
  });

  function documentNav() {
    const headerHeight = $("navigation").offsetHeight;
    const after =
      $("projects").getBoundingClientRect().top <= headerHeight + 20;
    // +60 is the film-mode scrim hanging below the bar; it must not smear the paper.
    const paperUnderHeader =
      state.progress > 0.9 &&
      document.querySelector(".paper-reveal").getBoundingClientRect().top <=
        headerHeight + 60;
    $("navigation").classList.toggle("document-nav", after || paperUnderHeader);
  }

  // The film is 6-11 MB, so it waits for the first scroll or input; the poster
  // stays visible until frames are decoded.
  const firstInput = [
    "scroll",
    "wheel",
    "touchstart",
    "pointerdown",
    "keydown",
  ];
  function onFirstInput() {
    interacted = true;
    firstInput.forEach((type) => removeEventListener(type, onFirstInput));
    loadFilm();
  }
  firstInput.forEach((type) =>
    addEventListener(type, onFirstInput, { passive: true }),
  );

  function loadFilm() {
    if (!interacted || motionDisabled() || !filmContext) return;
    if (initializing && hashId() && hashId() !== "top") return;
    const rect = stage.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) return;
    const source = mobile.matches
      ? "assets/portfolio/media/film-mobile.mp4"
      : "assets/portfolio/media/film-desktop.mp4";
    if (video.getAttribute("src") === source) return;
    ready = false;
    stage.dataset.video = "loading";
    video.classList.remove("ready");
    video.poster = mobile.matches
      ? "assets/portfolio/media/poster-mobile.jpg"
      : "assets/portfolio/media/poster.jpg";
    video.src = source;
    video.preload = "auto";
    video.load();
  }

  // Only one seek is outstanding; new scroll positions replace old targets.
  function seek() {
    if (!filmContext || !ready || frozen || video.seeking || document.hidden)
      return;
    const time = Math.min(targetTime, Math.max(0, video.duration - 0.05));
    if (Math.abs(video.currentTime - time) > 1 / 48) {
      stage.dataset.requested = time.toFixed(3);
      video.currentTime = time;
    }
  }

  function renderFilm() {
    const progress = state.progress;
    targetTime = Math.min(progress / 0.82, 1) * 12;
    const seconds = Math.min(12, Math.floor(targetTime));
    $("film-time").textContent =
      `00:${String(seconds).padStart(2, "0")} / 00:12`;
    if (document.activeElement !== $("film-scrub"))
      $("film-scrub").value = String(Math.min(progress / 0.82, 1) * 100);
    $("film-scrub").setAttribute("aria-valuetext", `${seconds} seconds of 12`);
    const chapter = progress < 0.23 ? 0 : progress < 0.53 ? 1 : 2;
    $("chapter-label").textContent = [
      "INTRODUCTION",
      "EVERYDAY DEPENDENCIES",
      "BEHIND THE SERVICE",
    ][chapter];
    document
      .querySelectorAll("[data-chapter]")
      .forEach((button) =>
        Number(button.dataset.chapter) === chapter
          ? button.setAttribute("aria-current", "step")
          : button.removeAttribute("aria-current"),
      );
    const interactive = progress < 0.82;
    stage
      .querySelectorAll(".film-footer button,.film-footer a,.film-footer input")
      .forEach((control) => (control.tabIndex = interactive ? 0 : -1));
    stage.dataset.progress = progress.toFixed(3);
    const routeProgress = Math.max(0, Math.min(1, (progress - 0.53) / 0.24));
    stage.style.setProperty("--route-progress", routeProgress);
    stage.style.setProperty(
      "--worker-progress",
      Math.max(0, Math.min(1, (progress - 0.55) / 0.22)),
    );
    documentNav();
    seek();
  }

  function setFrozen(value) {
    frozen = value;
    const label = frozen ? "Play film" : "Pause film";
    $("freeze").setAttribute("aria-pressed", String(frozen));
    $("freeze").setAttribute("aria-label", label);
    $("freeze").title = label;
    $("freeze").innerHTML =
      `<i data-lucide="${frozen ? "play" : "pause"}" aria-hidden="true"></i>`;
    icons();
    seek();
  }

  function goToProgress(progress) {
    const trigger = window.ScrollTrigger?.getById("film");
    if (!trigger) return;
    loadFilm();
    if (frozen) setFrozen(false);
    scrollDirectly(() =>
      window.scrollTo({
        top: trigger.start + (trigger.end - trigger.start) * progress,
        behavior: "auto",
      }),
    );
  }
  $("film-scrub").addEventListener("input", (event) =>
    goToProgress((Number(event.target.value) / 100) * 0.82),
  );
  $("film-scrub").addEventListener("blur", renderFilm);
  document
    .querySelectorAll("[data-chapter]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        goToProgress([0, 0.34, 0.66][Number(button.dataset.chapter)]),
      ),
    );
  $("freeze").addEventListener("click", () => setFrozen(!frozen));
  video.addEventListener("loadeddata", () => {
    ready = true;
    video.classList.add("ready");
    stage.dataset.video = "ready";
    seek();
  });
  video.addEventListener("seeking", () => (stage.dataset.seeking = "true"));
  video.addEventListener("seeked", () => {
    stage.dataset.actual = video.currentTime.toFixed(3);
    stage.dataset.seeking = "false";
    seek();
  });
  video.addEventListener("error", () => {
    ready = false;
    stage.dataset.video = "unavailable";
    video.classList.remove("ready");
  });
  mobile.addEventListener("change", () => {
    if (filmContext) loadFilm();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) seek();
  });
  addEventListener("scroll", documentNav, { passive: true });

  function syncMotion() {
    const disabled = motionDisabled();
    document.body.classList.toggle("motion-disabled", disabled);
    const button = $("motion-toggle");
    button.disabled = reduced.matches || still || saveData;
    button.setAttribute("aria-pressed", String(disabled));
    const label = button.disabled
      ? "Reduced motion"
      : disabled
        ? "Enable motion"
        : "Reduce motion";
    button.innerHTML = `<i data-lucide="${disabled ? "play" : "pause"}" aria-hidden="true"></i><span>${label}</span>`;
    button.title = button.disabled
      ? "Motion follows your device or data preference"
      : "";
    icons();
    queueLab?.pause();
    syncFilm();
  }

  // Where the reader is, in terms that survive adding or removing the pin
  // spacer: film progress while inside the film, else the offset from #projects.
  function scrollPlace() {
    const trigger = window.ScrollTrigger?.getById("film");
    const projects = $("projects").getBoundingClientRect().top + scrollY;
    if (trigger ? scrollY <= trigger.end : scrollY < projects)
      return { progress: trigger ? trigger.progress : 0 };
    return { offset: scrollY - projects };
  }

  function restorePlace(place) {
    const trigger = window.ScrollTrigger?.getById("film");
    let top = story.getBoundingClientRect().top + scrollY;
    if ("offset" in place)
      top = $("projects").getBoundingClientRect().top + scrollY + place.offset;
    else if (trigger)
      top = trigger.start + (trigger.end - trigger.start) * place.progress;
    scrollDirectly(() => scrollTo(0, top));
  }

  function syncFilm() {
    const pin =
      !motionDisabled() &&
      heroFits() &&
      Boolean(window.gsap && window.ScrollTrigger);
    const mode = pin ? "pinned" : "static";
    if (mode === filmMode) return;
    // Without this, rotating out of and back into the pinned film kept the old
    // scrollY in a document 3 viewports shorter or longer, stranding the reader.
    const place = filmMode && !initializing ? scrollPlace() : null;
    filmMode = mode;
    buildFilm(pin);
    if (place) restorePlace(place);
  }

  function buildFilm(pin) {
    if (!pin) {
      filmContext?.revert();
      filmContext = null;
      if (frozen) setFrozen(false);
      ready = false;
      state.progress = 0;
      document.body.classList.add("static-film");
      document.body.classList.remove("scroll-enabled");
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.classList.remove("ready");
      renderFilm();
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    document.body.classList.remove("static-film");
    document.body.classList.add("scroll-enabled");
    filmContext = gsap.context(() => {
      const timeline = gsap.timeline({
        scrollTrigger: {
          id: "film",
          trigger: story,
          start: "top top",
          end: () => `+=${innerHeight * 3}`,
          pin: story,
          pinSpacing: true,
          anticipatePin: 1,
          scrub: 0.18,
          invalidateOnRefresh: true,
          onEnter: () => {
            if (!initializing) loadFilm();
          },
          onEnterBack: () => loadFilm(),
        },
        onUpdate: renderFilm,
      });
      timeline
        .fromTo(
          state,
          { progress: 0 },
          { progress: 1, duration: 1, ease: "none" },
          0,
        )
        .fromTo(
          ".film-identity",
          { autoAlpha: 1, y: 0 },
          { autoAlpha: 0, y: -35, duration: 0.065, ease: "none" },
          0.15,
        )
        .fromTo(
          ".story-line-one",
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.045, ease: "none" },
          0.235,
        )
        .to(
          ".story-line-one",
          { opacity: 0, y: -25, duration: 0.045, ease: "none" },
          0.485,
        )
        .fromTo(
          ".story-line-two",
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.045, ease: "none" },
          0.535,
        )
        .to(
          ".story-line-two",
          { opacity: 0, y: -25, duration: 0.035, ease: "none" },
          0.775,
        )
        .fromTo(
          ".film-worker-field",
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 0.04, ease: "none" },
          0.55,
        )
        .to(
          ".film-worker-field",
          { autoAlpha: 0, duration: 0.035, ease: "none" },
          0.775,
        )
        .fromTo(
          ".film-footer,.film-progress",
          { autoAlpha: 1 },
          { autoAlpha: 0, duration: 0.025, ease: "none" },
          0.82,
        )
        .fromTo(
          ".request-route",
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.04, ease: "none" },
          0.54,
        )
        // White labels on a scrim fail once the paper slides under them, so
        // they leave, swap colour while hidden, and return over solid paper.
        .to(
          ".request-route",
          { autoAlpha: 0, duration: 0.02, ease: "none" },
          0.89,
        )
        .fromTo(
          ".request-route",
          { color: "#ffffff", "--route-scrim": 1 },
          {
            color: "#cc3828",
            "--route-scrim": 0,
            duration: 0.001,
            ease: "none",
          },
          0.93,
        )
        .to(
          ".request-route",
          { autoAlpha: 1, duration: 0.02, ease: "none" },
          0.97,
        )
        .fromTo(
          ".paper-reveal",
          { yPercent: 101, y: 0 },
          { yPercent: 0, y: 0, duration: 0.17, ease: "power2.inOut" },
          0.83,
        )
        .fromTo(
          ".film-progress span",
          { scaleX: 0 },
          { scaleX: 1, duration: 1, ease: "none" },
          0,
        );
    });
    if (!hashId() || hashId() === "top") loadFilm();
    ScrollTrigger.refresh();
    renderFilm();
  }

  $("motion-toggle").addEventListener("click", () => {
    requestedReduction = !requestedReduction;
    try {
      localStorage.setItem("haw-reduced-motion", String(requestedReduction));
    } catch {}
    syncMotion();
  });
  reduced.addEventListener("change", syncMotion);
  // A resize or a user style sheet (text spacing, zoom) can make the hero
  // outgrow the viewport. The delay lets ScrollTrigger's own resize refresh
  // release the pinned stage's old width before it is measured.
  let fitTimer;
  new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(syncFilm, 250);
  }).observe(stage);
  syncMotion();
  (document.fonts?.ready || Promise.resolve()).then(() => {
    window.ScrollTrigger?.refresh();
    if (hashId()) navigate(hashId(), { focus: false });
    initializing = false;
    documentNav();
  });
})();
