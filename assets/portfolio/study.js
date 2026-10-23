(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { Narrative, Session, config } = window.PortfolioStory;
  const narrative = new Narrative();
  const session = new Session(narrative);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width:600px)");
  const still = new URLSearchParams(location.search).get("motion") === "still";
  const saveData = Boolean(navigator.connection?.saveData);
  const video = $("film");
  const stage = document.querySelector(".stage");
  let requestedReduction = false;
  try {
    requestedReduction = localStorage.getItem("haw-reduced-motion") === "true";
  } catch {}
  let context = null;
  let progress = 0;
  let snapshot = narrative.atTick(0);
  let timer = null;
  let targetTime = 0;
  let lastStoryTick = -1;
  let initial = true;
  let interacted = false;
  const pad = (number) => String(number).padStart(3, "0");
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const range = (value, start, end) => clamp((value - start) / (end - start));
  // Card and paper travel together; the paper's words start only after the scene heading has gone.
  const paperAt = (value) => range(value, 0.84, 0.94);
  const disabled = () =>
    reduced.matches || still || saveData || requestedReduction;
  const icons = () => window.lucide?.createIcons();
  const eventName = (value) =>
    ({
      received: "Received",
      processing: "Processing",
      dependency_timeout: "Dependency timeout",
      retry_scheduled: "Retry scheduled",
      requeued: "Requeued",
      completed: "Completed",
      failed: "Failed",
      capacity_rejected: "Capacity rejected",
    })[value] || value;

  function seek() {
    if (!context || video.readyState < 2 || video.seeking || document.hidden)
      return;
    const time = Math.min(targetTime, video.duration - 0.06);
    if (Math.abs(video.currentTime - time) > 1 / 48) video.currentTime = time;
  }
  function loadVideo() {
    if (!interacted || disabled() || !context || document.hidden) return;
    const rect = stage.getBoundingClientRect();
    if (rect.bottom <= $("navigation").offsetHeight || rect.top >= innerHeight)
      return;
    const source = `assets/portfolio/media/film-${narrow.matches ? "mobile" : "desktop"}.mp4`;
    if (video.getAttribute("src") === source) return;
    video.classList.remove("ready");
    video.src = source;
    video.load();
  }
  video.addEventListener("loadeddata", () => {
    video.classList.add("ready");
    seek();
  });
  video.addEventListener("seeked", seek);
  video.addEventListener("error", () => video.classList.remove("ready"));

  function renderStory(p) {
    progress = clamp(p);
    snapshot =
      disabled() || !context
        ? narrative.atProgress(1)
        : narrative.atProgress(progress);
    const job = snapshot.jobs[2];
    const settled = disabled() || !context;
    const paper = settled ? 1 : paperAt(progress);
    const record = settled ? 1 : range(progress, 0.86, 0.95);
    const gutter = narrow.matches ? 20 : innerWidth <= 1000 ? 30 : 40;
    const unit = (innerWidth - gutter * 2) / 5;
    // Whole lanes, ending 12px short of a lane line as on desktop. 138px is the
    // "2 ATTEMPTS / TICK 016" row plus padding at the 11px type floor.
    const span = Math.ceil((138 + 12) / unit);
    const startWidth = narrow.matches ? span * unit - 12 : unit - 12;
    const finalWidth = narrow.matches
      ? innerWidth - gutter * 2
      : (innerWidth - gutter * 2) * 0.5;
    const liveX = job.worker ? gutter + (job.worker - 1) * unit : gutter;
    const liveY = stage.clientHeight * (job.state === "retrying" ? 0.62 : 0.54);
    const finalX = gutter;
    const finalY = stage.clientHeight * (narrow.matches ? 0.31 : 0.24);
    stage.style.setProperty("--intro", 1 - range(progress, 0.14, 0.22));
    stage.style.setProperty(
      "--system",
      range(progress, 0.2, 0.27) * (1 - paper),
    );
    stage.style.setProperty("--paper-in", paper);
    stage.style.setProperty("--paper-text", settled ? 1 : range(progress, 0.89, 0.96));
    stage.style.setProperty("--scene-head", 1 - range(progress, 0.84, 0.87));
    stage.style.setProperty("--subject-in", range(progress, 0.23, 0.29));
    stage.style.setProperty("--record", record);
    stage.style.setProperty("--sx", `${liveX + (finalX - liveX) * paper}px`);
    stage.style.setProperty("--sy", `${liveY + (finalY - liveY) * paper}px`);
    stage.style.setProperty(
      "--sw",
      `${startWidth + (finalWidth - startWidth) * paper}px`,
    );
    stage.dataset.progress = progress.toFixed(3);
    $("subject").dataset.state = job.state;
    $("subject").inert = Boolean(context) && record < 0.95;
    document.querySelector(".identity").inert =
      Boolean(context) && progress > 0.22;
    $("subject-state").textContent = job.state.toUpperCase();
    $("subject-attempt").textContent =
      `${job.attempts} ${job.attempts === 1 ? "ATTEMPT" : "ATTEMPTS"}`;
    $("subject-tick").textContent = `TICK ${pad(snapshot.tick)}`;
    $("subject").dataset.tick = snapshot.tick;
    const failed =
      job.state === "retrying" || (job.state === "queued" && job.attempts >= 1);
    $("scene-title").textContent =
      job.state === "completed"
        ? "Accounted for."
        : failed
          ? "A failure. Not an ending."
          : job.attempts > 1
            ? "Pick up. Carry on."
            : "Work continues.";
    $("scene-count").textContent =
      `${snapshot.counts.completed} COMPLETED / ${snapshot.counts.processing} IN FLIGHT`;
    document.querySelectorAll("[data-worker]").forEach((element) => {
      const active = snapshot.jobs.find(
        (item) => item.worker === Number(element.dataset.worker),
      );
      element.textContent = active ? pad(active.id) : "IDLE";
      element.parentElement.classList.toggle("active", Boolean(active));
      const started = active?.history.findLast(
        (event) => event.event === "processing",
      )?.tick;
      element.parentElement.style.setProperty(
        "--fill",
        active
          ? `${((snapshot.tick - started) / (active.until - started)) * 100}%`
          : "0%",
      );
    });
    if (lastStoryTick !== snapshot.tick) {
      $("story-history").innerHTML = job.history
        .map(
          (event) =>
            `<li data-event="${event.event}"><span>${pad(event.tick)}</span><span>${eventName(event.event)}</span></li>`,
        )
        .join("");
      lastStoryTick = snapshot.tick;
    }
    if (context) {
      const laneText = document.querySelector(".lane b");
      const laneFloor =
        document.querySelector(".worker-tracks").offsetTop +
        laneText.offsetTop +
        laneText.offsetHeight +
        12;
      const filmY = Math.max(liveY, laneFloor);
      const filmLimit = document.querySelector(".scene-foot").offsetTop - 12;
      const paperLimit = stage.clientHeight - 84;
      const bottomLimit =
        filmLimit +
        (paperLimit - filmLimit) * paper -
        $("subject").offsetHeight;
      stage.style.setProperty(
        "--sy",
        `${Math.min(filmY + (finalY - filmY) * paper, bottomLimit)}px`,
      );
    }
    // Tick 0 holds until 0.2, so the introduction is the one chapter still set by scroll position.
    const chapter =
      progress < 0.2
        ? 0
        : job.state === "completed"
          ? 3
          : failed || job.attempts > 1
            ? 2
            : 1;
    document
      .querySelectorAll(".chapters [data-progress]")
      .forEach((button, index) =>
        index === chapter
          ? button.setAttribute("aria-current", "step")
          : button.removeAttribute("aria-current"),
      );
    $("story-caption").textContent = [
      "EVERY REQUEST HAS A CONSEQUENCE.",
      "BOUND THE WORK. KEEP THE RECORD.",
      "RETRY THE REQUEST. NOT THE WHOLE SYSTEM.",
      "THE MOVEMENT ENDS. THE HISTORY DOESN'T.",
    ][chapter];
    document
      .querySelector(".film-tools")
      .classList.toggle("on-paper", paper >= 0.25);
    if (document.activeElement !== $("story-progress"))
      $("story-progress").value = progress * 100;
    $("story-progress").setAttribute(
      "aria-valuetext",
      `${["Introduction", "Processing", "Retry and recovery", "Completed record"][chapter]}, ${Math.round(progress * 100)} percent`,
    );
    targetTime = Math.min(1, progress / 0.82) * 12;
    seek();
    updateHeader();
  }
  function updateHeader() {
    const bar = $("navigation").offsetHeight;
    // White text drops under 4.5:1 once the paper layer is ~29% in; the paper bar carries its own background.
    const onPaper = context
      ? paperAt(progress) >= 0.25
      : document.querySelector(".paper-surface").getBoundingClientRect().top <
        bar;
    $("navigation").classList.toggle(
      "paper",
      onPaper || stage.getBoundingClientRect().bottom < bar,
    );
  }
  function pause() {
    clearInterval(timer);
    timer = null;
    $("run").setAttribute("aria-label", "Run batch");
    $("run").innerHTML = '<i data-lucide="play" aria-hidden="true"></i>';
    icons();
  }
  function renderLab() {
    const batch = session.batch;
    const selected = batch.jobs[session.selected - 1];
    $("trace-number").textContent = pad(selected.id);
    $("trace-state").textContent = selected.state.toUpperCase();
    $("trace-attempts").textContent =
      `${selected.attempts} ${selected.attempts === 1 ? "attempt" : "attempts"}`;
    $("trace-body").innerHTML = selected.history
      .map(
        (event) =>
          `<tr data-event="${event.event}"><td>${pad(event.tick)}</td><td>${eventName(event.event)}</td><td>${event.attempt}</td></tr>`,
      )
      .join("");
    $("request-select").value = String(session.selected);
    $("session-source").textContent =
      `${session.owned ? "EXPERIMENT" : "OPENING RECORD"} / TICK ${pad(batch.tick)} / SYNTHETIC`;
    document.querySelectorAll("[data-count]").forEach((element) => {
      element.textContent = batch.counts[element.dataset.count];
      element.toggleAttribute("data-zero", !batch.counts[element.dataset.count]);
    });
    $("lab-tick").textContent = `TICK ${pad(batch.tick)}`;
    $("requests").innerHTML = batch.jobs
      .map(
        (job) =>
          `<button type="button" data-request="${job.id}" data-state="${job.state}" aria-label="Request ${pad(job.id)}, ${job.state}"><span>${pad(job.id)}</span><small>${{ queued: "WAIT", processing: "RUN", retrying: "RETRY", completed: "DONE", failed: "FAIL" }[job.state]}</small></button>`,
      )
      .join("");
    $("lab-result").textContent = batch.done
      ? `${batch.counts.completed} completed. ${batch.counts.failed} failed. ${batch.tick} virtual ticks. Every request retains its history.`
      : `${batch.workers} workers. ${batch.capacity} downstream ${batch.capacity === 1 ? "slot" : "slots"}. Up to three attempts per request.`;
    $("worker-value").value = batch.workers;
    $("capacity-value").value = batch.capacity;
    $("study").dataset.tick = batch.tick;
    $("study").dataset.owned = session.owned;
  }
  function selectView(index, focus = false) {
    pause();
    ["trace", "experiment"].forEach((name, i) => {
      $(`${name}-tab`).setAttribute("aria-selected", String(i === index));
      $(`${name}-tab`).tabIndex = i === index ? 0 : -1;
      $(`${name}-panel`).hidden = i !== index;
    });
    if (focus) $(`${index ? "experiment" : "trace"}-tab`).focus();
  }
  function loadOpening(replace = false) {
    pause();
    if (!session.handoff(snapshot.tick, { replace })) {
      $("status").textContent =
        "Your experiment is preserved. Load the opening record to replace it.";
    } else {
      $("workers").value = config.workers;
      $("capacity").value = config.capacity;
      $("errors").checked = config.failures;
      $("status").textContent =
        `Opening request 003 loaded at tick ${pad(snapshot.tick)}.`;
      renderLab();
    }
    selectView(0);
  }
  function configure() {
    pause();
    session.configure({
      ...config,
      workers: Number($("workers").value),
      capacity: Number($("capacity").value),
      failures: $("errors").checked,
    });
    renderLab();
    $("status").textContent =
      "Experiment reset with the selected configuration.";
  }
  function step() {
    session.step();
    renderLab();
    if (session.batch.done) {
      pause();
      $("status").textContent = $("lab-result").textContent;
    }
  }
  $("request-select").innerHTML = Array.from(
    { length: 24 },
    (_, i) => `<option value="${i + 1}">${pad(i + 1)}</option>`,
  ).join("");
  $("request-select").addEventListener("change", (event) => {
    session.selected = Number(event.target.value);
    renderLab();
  });
  $("requests").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request]");
    if (!button) return;
    session.selected = Number(button.dataset.request);
    renderLab();
    selectView(0, true);
  });
  ["workers", "capacity", "errors"].forEach((id) =>
    $(id).addEventListener("change", configure),
  );
  ["workers", "capacity"].forEach((id) =>
    $(id).addEventListener("input", () => {
      pause();
      $(`${id === "workers" ? "worker" : "capacity"}-value`).value =
        $(id).value;
    }),
  );
  $("step").addEventListener("click", () => {
    pause();
    // The tab opens on the finished opening record; stepping it starts a fresh experiment.
    if (session.batch.done && !session.owned) configure();
    const done = session.batch.done;
    step();
    $("status").textContent = done
      ? "Batch already complete. Reset to start a new experiment."
      : `Experiment advanced to tick ${session.batch.tick}.`;
  });
  $("reset").addEventListener("click", configure);
  $("run").addEventListener("click", () => {
    if (timer) return pause();
    if (session.batch.done) configure();
    if (disabled()) {
      while (!session.batch.done) session.step();
      renderLab();
      $("status").textContent = $("lab-result").textContent;
      return;
    }
    step();
    if (session.batch.done) return;
    timer = setInterval(step, 600);
    $("run").setAttribute("aria-label", "Pause batch");
    $("run").innerHTML = '<i data-lucide="pause" aria-hidden="true"></i>';
    icons();
  });
  $("restart").addEventListener("click", () => loadOpening(true));
  ["trace", "experiment"].forEach((name, index) => {
    $(`${name}-tab`).addEventListener("click", () => selectView(index));
    $(`${name}-tab`).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      selectView(
        event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index,
        true,
      );
    });
  });
  $("inspect").addEventListener("click", () => loadOpening());

  function goToProgress(value) {
    const trigger = window.ScrollTrigger?.getById("narrative");
    if (!trigger) return;
    loadVideo();
    window.scrollTo({
      top: trigger.start + (trigger.end - trigger.start) * value,
      behavior: "instant",
    });
  }
  document
    .querySelectorAll(".chapters [data-progress]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        goToProgress(Number(button.dataset.progress)),
      ),
    );
  $("story-progress").addEventListener("input", () =>
    goToProgress(Number($("story-progress").value) / 100),
  );
  document.querySelectorAll('a[href^="#"]').forEach((link) =>
    link.addEventListener("click", (event) => {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      history.pushState(null, "", link.getAttribute("href"));
      target.scrollIntoView({
        behavior: disabled() ? "instant" : "smooth",
        block: "start",
      });
      const heading =
        link.id === "inspect"
          ? $("trace-tab")
          : target.id === "top"
            ? null
            : target.matches("h1,h2,h3")
              ? target
              : target.querySelector("h2, h3");
      if (heading) {
        if (heading.matches("h1,h2,h3")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }),
  );
  addEventListener("hashchange", () => {
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView();
  });

  // Measured in the pinned layout: under the masthead, above the film controls.
  function heroFits() {
    const body = document.body;
    const wasStatic = body.classList.contains("static-story");
    body.classList.remove("static-story");
    const identity = document.querySelector(".identity");
    const box = identity.getBoundingClientRect();
    const first = identity.firstElementChild.getBoundingClientRect();
    const last = identity.querySelector(".arrival").getBoundingClientRect();
    const fits =
      first.top - box.top >= $("navigation").offsetHeight + 8 &&
      box.bottom - last.bottom >=
        parseFloat(getComputedStyle(identity).paddingBottom) - 1;
    body.classList.toggle("static-story", wasStatic);
    return fits;
  }
  const shouldPin = () =>
    !disabled() &&
    innerHeight >= (narrow.matches ? 740 : 720) &&
    Boolean(window.ScrollTrigger) &&
    heroFits();

  function syncStory() {
    const pin = shouldPin();
    const existing = Boolean(context);
    const place = existing
      ? { offset: $("study").getBoundingClientRect().top, progress }
      : { offset: null, progress: 0 };
    context?.revert();
    context = null;
    document.body.classList.toggle("static-story", !pin);
    // Pinned, the paper words are a transition the card already carries; static, they are the section's visible heading.
    if (pin) document.querySelector(".paper-surface").setAttribute("aria-hidden", "true");
    else document.querySelector(".paper-surface").removeAttribute("aria-hidden");
    // studies-ui.js reads this class to finish the studies without timers.
    document.body.classList.toggle("motion-disabled", disabled());
    if (pin) {
      gsap.registerPlugin(ScrollTrigger);
      context = gsap.context(() => {
        const state = { value: 0 };
        gsap.fromTo(
          state,
          { value: 0 },
          {
            value: 1,
            ease: "none",
            onUpdate: () => renderStory(state.value),
            scrollTrigger: {
              id: "narrative",
              trigger: $("story"),
              start: "top top",
              end: () => `+=${innerHeight * 3}`,
              pin: true,
              pinSpacing: true,
              scrub: 0.18,
              invalidateOnRefresh: true,
              onEnter: loadVideo,
              onEnterBack: loadVideo,
            },
          },
        );
      });
      ScrollTrigger.refresh();
    } else {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.classList.remove("ready");
    }
    renderStory(pin ? progress : 1);
    if (!initial && place.offset !== null) {
      if (place.offset < innerHeight)
        window.scrollTo({
          top: scrollY + $("study").getBoundingClientRect().top - place.offset,
          behavior: "instant",
        });
      else if (pin) goToProgress(place.progress);
      // Unpinning mid-film shortens the page by the pin spacer; scrollY alone would land in the study.
      else
        window.scrollTo({
          top: scrollY + $("story").getBoundingClientRect().top,
          behavior: "instant",
        });
    }
    $("motion-toggle").hidden = reduced.matches || still || saveData;
    $("motion-toggle").setAttribute(
      "aria-label",
      requestedReduction ? "Enable motion" : "Reduce motion",
    );
    loadVideo();
  }
  $("motion-toggle").addEventListener("click", () => {
    requestedReduction = !requestedReduction;
    try {
      localStorage.setItem("haw-reduced-motion", String(requestedReduction));
    } catch {}
    pause();
    syncStory();
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
  reduced.addEventListener("change", () => {
    pause();
    syncStory();
  });
  let resizeTimer;
  const resync = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncStory, 280);
  };
  addEventListener("resize", resync);
  // Font swaps and user text-spacing styles resize the hero without resizing the window.
  const heroText = new ResizeObserver(() => {
    if (shouldPin() === document.body.classList.contains("static-story"))
      resync();
  });
  heroText.observe($("name"));
  heroText.observe(document.querySelector(".identity-bottom p"));
  addEventListener("scroll", updateHeader, { passive: true });
  ["wheel", "touchstart", "pointerdown", "keydown", "scroll"].forEach((type) =>
    addEventListener(
      type,
      () => {
        interacted = true;
        loadVideo();
      },
      { passive: true },
    ),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else seek();
  });
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) pause();
    },
    { threshold: 0 },
  ).observe($("study"));
  // The supporting studies' controls belong to studies-ui.js, which reveals them itself.
  document
    .querySelectorAll("#study [data-enhance]")
    .forEach((element) => (element.hidden = false));
  icons();
  // The study opens on the record the film ends on, whether or not the film is played.
  session.handoff(narrative.frames.length - 1);
  renderLab();
  syncStory();
  (document.fonts?.ready || Promise.resolve()).then(() => {
    window.ScrollTrigger?.refresh();
    if (location.hash)
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ behavior: "instant" });
    initial = false;
  });
})();
