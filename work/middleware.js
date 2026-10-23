(function (root) {
  "use strict";
  const { Batch } =
    typeof module !== "undefined" && module.exports
      ? require("../assets/portfolio/queue-model.js")
      : root.PortfolioQueue;
  const pad = (n) => String(n).padStart(3, "0");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const NAME = {
    received: "Received",
    processing: "Processing",
    dependency_timeout: "Dependency timeout",
    capacity_rejected: "Capacity rejected",
    retry_scheduled: "Retry scheduled",
    requeued: "Requeued",
    completed: "Completed",
    failed: "Failed",
  };
  // The first tick at the project's settings where every stage holds work and 003 waits to retry.
  const OPENING = 4;

  function opening() {
    const batch = new Batch();
    while (batch.tick < OPENING) batch.step();
    return batch;
  }

  function views(batch, selected) {
    const token = (job) =>
      `<button type="button" data-request="${job.id}" data-state="${job.state}" aria-pressed="${job.id === selected}" aria-label="Request ${pad(job.id)}, ${job.state}">${pad(job.id)}</button>`;
    const of = (state) => batch.jobs.filter((job) => job.state === state);
    const busy = of("processing");
    const job = batch.jobs[selected - 1];
    return {
      source: `SYNTHETIC STUDY / ${batch.workers} WORKERS / ${batch.capacity} DOWNSTREAM / TICK ${pad(batch.tick)}`,
      queued: batch.pending.map((id) => token(batch.jobs[id - 1])).join(""),
      queuedCount: String(batch.pending.length),
      workers: Array.from({ length: batch.workers }, (_, i) => {
        const active = busy.find((item) => item.worker === i + 1);
        return `<li><span>W${i + 1}</span>${active ? token(active) : "<i>Idle</i>"}</li>`;
      }).join(""),
      workersCount: `${busy.length} / ${batch.workers}`,
      downstream: Array.from(
        { length: batch.capacity },
        (_, i) => `<i${i < busy.length ? " data-used" : ""}></i>`,
      ).join(""),
      downstreamCount: `${busy.length} / ${batch.capacity}`,
      retrying: of("retrying").map(token).join(""),
      retryingCount: String(of("retrying").length),
      done: [...of("completed"), ...of("failed")].sort((a, b) => a.id - b.id).map(token).join(""),
      doneCount: `${of("completed").length} / ${of("failed").length}`,
      record: job.history
        .map(
          (e) =>
            `<tr data-event="${e.event}"><td>${pad(e.tick)}</td><td>${NAME[e.event]}</td><td>${e.attempt}</td></tr>`,
        )
        .join(""),
      recordLabel: `REQUEST ${pad(job.id)} / ${job.state.toUpperCase()} / ${plural(job.attempts, "ATTEMPT").toUpperCase()}`,
      summary: batch.done
        ? `Batch complete at tick ${pad(batch.tick)}. ${of("completed").length} completed, ${of("failed").length} failed. Every request kept its record.`
        : `Tick ${pad(batch.tick)}. ${batch.pending.length} waiting, ${busy.length} in flight, ${of("retrying").length} in retry wait.`,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { views, opening, Batch };
    return;
  }

  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let batch = opening();
  let selected = 3;
  let timer = null;

  function render() {
    const focused = document.activeElement?.closest?.("#mw-pipe [data-request]")?.dataset.request;
    const v = views(batch, selected);
    for (const key of ["source", "queuedCount", "workersCount", "downstreamCount", "retryingCount", "doneCount", "recordLabel"])
      $(`mw-${key}`).textContent = v[key];
    for (const key of ["queued", "workers", "downstream", "retrying", "done", "record"])
      $(`mw-${key}`).innerHTML = v[key];
    $("mw-pipe").dataset.done = String(batch.done);
    // Each tick rebuilds the tokens; keep a keyboard user on the request they were on.
    if (focused) $("mw-pipe").querySelector(`[data-request="${focused}"]`)?.focus();
  }
  const say = (text) => {
    $("mw-status").textContent = "";
    requestAnimationFrame(() => ($("mw-status").textContent = text));
  };
  function setRun(running) {
    $("mw-run").setAttribute("aria-label", running ? "Pause batch" : "Run batch");
    $("mw-run").innerHTML = `<i data-lucide="${running ? "pause" : "play"}" aria-hidden="true"></i>`;
    root.lucide?.createIcons();
  }
  function pause() {
    clearInterval(timer);
    timer = null;
    setRun(false);
  }
  function configure() {
    pause();
    batch = new Batch({
      workers: Number($("mw-pool").value),
      capacity: Number($("mw-capacity").value),
      failures: $("mw-errors").checked,
    });
    render();
  }
  function step() {
    batch.step();
    render();
    if (batch.done) {
      pause();
      say(views(batch, selected).summary);
    }
  }

  $("mw-run").addEventListener("click", () => {
    if (timer) return pause();
    if (batch.done) configure();
    if (reduced.matches) {
      while (!batch.done) batch.step();
      render();
      return say(views(batch, selected).summary);
    }
    step();
    if (batch.done) return;
    timer = setInterval(() => (document.hidden ? pause() : step()), 600);
    setRun(true);
  });
  $("mw-step").addEventListener("click", () => {
    pause();
    if (batch.done) return say("Batch complete. Reset to start again.");
    step();
    if (!batch.done) say(views(batch, selected).summary);
  });
  $("mw-reset").addEventListener("click", () => {
    configure();
    say(`Reset to tick 000 with ${batch.workers} workers and ${batch.capacity} downstream slots.`);
  });
  ["pool", "capacity"].forEach((name) => {
    $(`mw-${name}`).addEventListener("input", (event) => {
      pause();
      $(`mw-${name}-value`).value = event.target.value;
    });
    $(`mw-${name}`).addEventListener("change", configure);
  });
  $("mw-errors").addEventListener("change", configure);
  $("mw-pipe").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request]");
    if (!button) return;
    selected = Number(button.dataset.request);
    button.focus();
    render();
    say(`Showing the record for request ${pad(selected)}.`);
  });
  new IntersectionObserver(([entry]) => entry.isIntersecting || pause()).observe($("mw-pipe"));

  render();
  root.lucide?.createIcons();
  // Revealed last: if setup throws, the no-JS snapshot stays instead of dead controls.
  document.querySelectorAll("[data-enhance]").forEach((el) => (el.hidden = false));
})(typeof window !== "undefined" ? window : globalThis);
