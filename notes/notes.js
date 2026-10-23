(function (root) {
  "use strict";

  function sweep(Batch, capacity) {
    return Array.from({ length: 8 }, (_, i) => {
      const batch = new Batch({ workers: i + 1, capacity });
      while (!batch.done) batch.step();
      return {
        workers: i + 1,
        tick: batch.tick,
        failed: batch.counts.failed,
        calls: batch.jobs.reduce((sum, job) => sum + job.attempts, 0),
      };
    });
  }
  function sweepRows(rows, capacity) {
    // Retries can push calls past the 64-request batch.
    const scale = Math.max(64, ...rows.map((r) => r.calls));
    return rows
      .map(
        (r) =>
          `<tr${r.workers > capacity ? " data-over" : ""}${r.workers === capacity ? " data-match" : ""}><td>${r.workers}${r.workers === capacity ? ' <small class="cap">CAP</small>' : ""}</td><td>${r.tick}</td><td>${r.failed}</td><td><span class="bar" style="--w: ${(r.calls / scale) * 100}%"></span>${r.calls}</td></tr>`,
      )
      .join("");
  }

  function statuses(design, available) {
    if (design === "one")
      return [
        available
          ? ["Order", "Complete", "Activated and delivered."]
          : ["Order", "Pending", "Waiting on logistics. Whether the SIM works is not recorded here."],
      ];
    return [
      ["Activation", "Activated", "Recorded on its own."],
      available
        ? ["Fulfillment", "Delivered", "Recorded on its own."]
        : ["Fulfillment", "Waiting", "Logistics provider unavailable. Activation is unaffected."],
    ];
  }

  function claimRecord(review) {
    return review
      ? [
          ["Extracted", "Amount read as 1O0.00"],
          ["Review required", "Ambiguous character"],
          ["Reviewed", "1O0.00 → 100.00, corrected by the encoder"],
          ["Routed", "Amount 100.00"],
        ]
      : [
          ["Extracted", "Amount read as 1O0.00"],
          ["Routed", "Amount 1O0.00, which is not a number", "routed_unchecked"],
        ];
  }

  const LAYERS = ["Interface", "Service boundary", "Data", "Infrastructure", "Delivery", "Operation"];
  function readiness(ready) {
    const missing = LAYERS.filter((layer) => !ready.includes(layer));
    return missing.length
      ? `Cutover blocked. Not ready: ${missing.join(", ")}.`
      : "All six layers ready. Move the first workflow.";
  }

  const api = { sweep, sweepRows, statuses, claimRecord, readiness, LAYERS };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  const $ = (id) => document.getElementById(id);
  const say = (text) => {
    $("note-status").textContent = "";
    requestAnimationFrame(() => ($("note-status").textContent = text));
  };
  const picked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

  if ($("n1-capacity")) {
    const render = () => {
      const capacity = Number($("n1-capacity").value);
      $("n1-capacity-value").value = capacity;
      $("n1-rows").innerHTML = sweepRows(sweep(root.PortfolioQueue.Batch, capacity), capacity);
      return capacity;
    };
    $("n1-capacity").addEventListener("input", render);
    $("n1-capacity").addEventListener("change", () => {
      const capacity = render();
      const most = sweep(root.PortfolioQueue.Batch, capacity)[7];
      say(`Downstream capacity ${capacity}. At 8 workers: ${most.failed} failed, ${most.calls} calls sent.`);
    });
    render();
  }

  if ($("n2-design")) {
    const render = () => {
      $("n2-out").innerHTML = statuses(picked("n2-design"), $("n2-provider").checked)
        .map(([name, state, detail]) => `<li data-state="${state.toLowerCase()}"><span>${name}</span><strong>${state}</strong><small>${detail}</small></li>`)
        .join("");
    };
    document.querySelectorAll("#n2-controls input").forEach((input) =>
      input.addEventListener("change", () => {
        render();
        say([...$("n2-out").querySelectorAll("li")].map((li) => `${li.children[0].textContent}: ${li.children[1].textContent}`).join(". ") + ".");
      }),
    );
    render();
  }

  if ($("n3-review")) {
    const render = () => {
      const rows = claimRecord(picked("n3-review") === "review");
      $("n3-rows").innerHTML = rows
        .map(([event, detail, key = event.toLowerCase().replace(/ /g, "_")], i) => `<tr data-event="${key}"><td>${String(i + 1).padStart(2, "0")}</td><td>${event}</td><td>${detail}</td></tr>`)
        .join("");
      return rows;
    };
    document.querySelectorAll("input[name='n3-review']").forEach((input) =>
      input.addEventListener("change", () => {
        const rows = render();
        say(`${rows.length} events. ${rows.at(-1)[1]}.`);
      }),
    );
    render();
  }

  if ($("n4-layers")) {
    const render = () => {
      const ready = [...$("n4-layers").querySelectorAll("input:checked")].map((input) => input.value);
      $("n4-out").dataset.ready = ready.length === LAYERS.length;
      return ($("n4-out").textContent = readiness(ready));
    };
    $("n4-layers").addEventListener("change", () => say(render()));
    render();
  }

  root.lucide?.createIcons();
  // Revealed last: if setup throws, the no-JS state stays instead of dead controls.
  document.querySelectorAll("[data-enhance]").forEach((el) => (el.hidden = false));
})(typeof window !== "undefined" ? window : globalThis);
