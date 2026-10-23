(function (root) {
  "use strict";
  const S =
    root.PortfolioStudies ||
    (typeof require === "function" ? require("./studies.js") : null);
  const pad = (n, width = 3) => String(n).padStart(width, "0");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const words = (s) => s.replace(/_/g, " ");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const CHANNEL = { sms: "SMS", ivr: "IVR", email: "Email" };
  const LANE = {
    order: "Order",
    activation: "Activation",
    fulfillment: "Fulfillment",
    dependency: "Provider",
  };

  const views = {
    telEvent(e) {
      if (e.event === "provider_unavailable") return "Unavailable";
      if (e.event === "provider_restored") return "Restored";
      return cap(e.event) + (e.reason ? `: ${words(e.reason)}` : "");
    },
    telRecord(order) {
      return order.history
        .map(
          (e) =>
            `<tr data-event="${e.event}"><td>${pad(e.tick)}</td><td>${LANE[e.lane]}</td><td>${views.telEvent(e)}</td></tr>`,
        )
        .join("");
    },
    telLane(order, lane) {
      const s = order[lane];
      const since = order.history.findLast((e) => e.lane === lane);
      const stops = { pending: 0, processing: 0.5, waiting: 0.5 };
      let p = s.state in stops ? stops[s.state] : 1;
      if (lane === "fulfillment" && s.state === "processing")
        p = 0.5 + s.progress * 0.25;
      if (s.state === "waiting" && !s.progress && !order.history.some(
        (e) => e.lane === "fulfillment" && e.event === "processing",
      ))
        p = 0;
      let detail = since ? `Since tick ${pad(since.tick)}` : "Not started";
      if (s.state === "waiting")
        detail = `${cap(words(s.reason))}. Activation is unaffected.`;
      if (lane === "fulfillment" && s.state === "processing")
        detail = `Step ${s.progress + 1} of 2`;
      return { state: s.state, word: cap(s.state), detail, p };
    },
    clmDetail(e) {
      if (e.event === "extracted") return `${cap(e.field)} read as ${e.value}`;
      if (e.event === "review_required") return cap(words(e.reason));
      if (e.event === "reviewed")
        return `${cap(e.field)} ${e.before} → ${e.after}, ${e.corrected ? "corrected" : "unchanged"}`;
      return "–";
    },
    clmRecord(claim) {
      return claim.history
        .map(
          (e, i) =>
            `<tr data-event="${e.event}"><td>${pad(i + 1, 2)}</td><td>${cap(words(e.event))}</td><td>${esc(views.clmDetail(e))}</td></tr>`,
        )
        .join("");
    },
    clmDiff(before, after) {
      const mark = (a, b) =>
        [...a].map((ch, i) => (a.length === b.length && ch !== b[i] ? `<mark>${esc(ch)}</mark>` : esc(ch))).join("");
      return [mark(before, after), mark(after, before)];
    },
    events: (n) => `${n} ${n === 1 ? "EVENT" : "EVENTS"}`,
    cmpEvent(e) {
      const name = e.channel ? `${CHANNEL[e.channel]} ${words(e.event)}` : cap(e.event);
      return name + (e.reason ? `: ${words(e.reason)}` : "");
    },
    cmpRecord(campaign) {
      return campaign.history
        .map(
          (e, i) =>
            `<tr data-event="${e.event}"><td>${pad(i + 1, 2)}</td><td>${views.cmpEvent(e)}</td><td>${e.attempt || "–"}</td></tr>`,
        )
        .join("");
    },
    cmpAttempts(receipt) {
      return receipt.attempts
        .map(
          (a) =>
            `<li data-result="${a.result}"><span>${pad(a.attempt, 2)}</span><span>${cap(a.result)}${a.reason ? `: ${words(a.reason)}` : ""}</span></li>`,
        )
        .join("");
    },
    cmpReason(campaign) {
      return {
        no_channels: "Select at least one channel to send.",
        sent: "Sent. Reset to compose again.",
      }[campaign.blocked] || "Sends to every selected channel.";
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = views;
    return;
  }
  root.SupportingViews = views;

  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => reduced.matches || document.body.classList.contains("motion-disabled");
  const icons = () => root.lucide?.createIcons();
  const say = (id, text) => {
    $(id).textContent = "";
    requestAnimationFrame(() => ($(id).textContent = text));
  };
  // Restart a one-shot CSS animation on an element whose content changed.
  const settle = (el) => {
    el.classList.remove("settle");
    void el.offsetWidth;
    el.classList.add("settle");
  };

  // Each case page holds only its own study.
  if ($("tel-lanes")) {
    let order = new S.Order();
    let telTimer = null;
    function telRender(changed = []) {
      $("tel-source").textContent =
        `SYNTHETIC STUDY / ORDER ${order.id} / TICK ${pad(order.tick)}`;
      for (const lane of ["activation", "fulfillment"]) {
        const v = views.telLane(order, lane);
        const el = $(`tel-${lane}`);
        const word = el.querySelector("[data-word]");
        el.dataset.state = v.state;
        el.querySelector(".service-track").style.setProperty("--p", v.p);
        el.querySelectorAll("[data-stop]").forEach((stop) => {
          const at = stop.dataset.stop === v.state ||
            (v.state === "waiting" && stop.dataset.stop === (v.p ? "processing" : "pending"));
          stop.toggleAttribute("data-current", at);
        });
        if (word.textContent !== v.word) {
          word.textContent = v.word;
          if (changed.length) settle(word);
        }
        el.querySelector("[data-detail]").textContent = v.detail;
      }
      $("tel-record").innerHTML = views.telRecord(order);
      $("tel-count").textContent = views.events(order.history.length);
      // aria-disabled, not disabled: a focused button that disables itself drops focus to <body>.
      $("tel-step").setAttribute("aria-disabled", String(order.done));
      $("tel-run").setAttribute("aria-disabled", String(order.done));
  }
  function telPause() {
    clearInterval(telTimer);
    telTimer = null;
    $("tel-run").setAttribute("aria-label", "Run order");
    if ($("tel-run").title) $("tel-run").title = "Run order";
    $("tel-run").innerHTML = '<i data-lucide="play" aria-hidden="true"></i>';
    icons();
  }
  function telStep() {
    const before = order.history.length;
    order.step();
    const fresh = order.history.slice(before);
    telRender(fresh);
    return fresh;
  }
  function telSummary() {
    if (order.done) return `Order complete at tick ${pad(order.tick)}. Activated and fulfilled.`;
    if (order.fulfillment.state === "waiting")
      return `Tick ${pad(order.tick)}. Activation ${order.activation.state}; fulfillment waiting on the provider.`;
    return `Tick ${pad(order.tick)}. Activation ${order.activation.state}; fulfillment ${order.fulfillment.state}.`;
  }
  const finished = () => {
    if (order.done) say("tel-status", `${telSummary()} Reset to run again.`);
    return order.done;
  };
  $("tel-step").addEventListener("click", () => {
    if (finished()) return;
    telPause();
    telStep();
    say("tel-status", telSummary());
  });
  $("tel-run").addEventListener("click", () => {
    if (telTimer) return telPause();
    if (finished()) return;
    const blocked = () =>
      !order.available && order.fulfillment.state === "waiting" &&
      order.activation.state === "activated";
    const report = () =>
      say("tel-status", telSummary() + (blocked() ? " Restore the provider to continue." : ""));
    if (still()) {
      while (!order.done && !blocked()) telStep();
      return report();
    }
    const tick = () => {
      if (document.hidden || !$("tel-lanes").offsetParent) return telPause();
      telStep();
      if (order.done || blocked()) {
        telPause();
        report();
      }
    };
    tick();
    if (!telTimer && (order.done || blocked())) return;
    telTimer = setInterval(tick, 600);
    $("tel-run").setAttribute("aria-label", "Pause order");
    if ($("tel-run").title) $("tel-run").title = "Pause order";
    $("tel-run").innerHTML = '<i data-lucide="pause" aria-hidden="true"></i>';
    icons();
  });
  $("tel-reset").addEventListener("click", () => {
    telPause();
    const available = $("tel-provider").checked;
    order = new S.Order();
    order.setAvailable(available);
    telRender();
    say("tel-status", `Order reset. Provider ${available ? "available" : "unavailable"}.`);
  });
  $("tel-provider").addEventListener("change", (event) => {
    order.setAvailable(event.target.checked);
    telRender([1]);
    const provider = `Provider ${event.target.checked ? "restored" : "unavailable"}.`;
    say(
      "tel-status",
      order.done
        ? `${provider} The order is already complete.`
        : event.target.checked
          ? `${provider} Fulfillment resumes when the order advances.`
          : `${provider} Fulfillment will wait; activation continues.`,
    );
  });
  $("tel-provider").checked = true;
  telRender();
  }

  if ($("clm-review")) {
    let claim = new S.Claim();
    function clmRender() {
      const routed = claim.state === "routed";
      const review = $("clm-review");
      review.dataset.state = claim.state;
      review.dataset.error = claim.error || "";
      $("clm-source").textContent =
        `SYNTHETIC STUDY / CLAIM ${claim.id} / ${routed ? "ROUTED" : "IN REVIEW"}`;
      $("clm-state").textContent = routed ? "Routed" : "In review";
      $("clm-detail").textContent = routed
        ? `Approved as ${claim.reviewed}. ${claim.reviewed !== claim.extracted ? "The correction is in the record." : "Approved unchanged."}`
        : "One character in the amount is ambiguous.";
      const input = $("clm-amount");
      const error = $("clm-error");
      if (claim.error) {
        error.hidden = false;
        error.innerHTML = `<span class="sr-only">Error: </span>${S.messages[claim.error]}`;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", "clm-hint clm-error");
      } else {
        error.hidden = true;
        input.removeAttribute("aria-invalid");
        input.setAttribute("aria-describedby", "clm-hint");
      }
      $("clm-form").hidden = routed;
      $("clm-diff").hidden = !routed;
      if (routed) {
        const dd = $("clm-diff").querySelectorAll("dd");
        [dd[0].innerHTML, dd[1].innerHTML] = views.clmDiff(claim.extracted, claim.reviewed);
      }
      $("clm-record").innerHTML = views.clmRecord(claim);
      $("clm-count").textContent = views.events(claim.history.length);
      clmConnector();
  }
  function clmConnector() {
    const review = $("clm-review");
    let svg = review.querySelector(".connector");
    if (!svg) {
      review.insertAdjacentHTML(
        "beforeend",
        '<svg class="connector" aria-hidden="true" focusable="false"><path /></svg>',
      );
      svg = review.querySelector(".connector");
    }
    const box = $("clm-box").getBoundingClientRect();
    const target = $("clm-form").hidden ? $("clm-diff").querySelector("dd") : $("clm-amount");
    const field = target.getBoundingClientRect();
    const host = review.getBoundingClientRect();
    // Stacked layouts put the label and hint between the two; a line would cross them.
    svg.hidden = review.offsetParent === null || field.left <= box.right;
    if (svg.hidden) return;
    const x1 = box.right - host.left, x2 = field.left - host.left - 8;
    const y1 = box.top + box.height / 2 - host.top;
    let y2 = field.top + field.height / 2 - host.top;
    if (Math.abs(y2 - y1) < 8) y2 = y1;
    const mid = x1 + (x2 - x1) / 2;
    svg.querySelector("path").setAttribute("d", `M${x1} ${y1}H${mid}V${y2}H${x2}`);
  }
  $("clm-amount").addEventListener("input", (event) => {
    if (claim.error) {
      claim.edit(event.target.value);
      clmRender();
    } else claim.edit(event.target.value);
  });
  $("clm-form").addEventListener("submit", (event) => {
    event.preventDefault();
    claim.edit($("clm-amount").value);
    if (claim.approve()) {
      clmRender();
      settle($("clm-state"));
      say("clm-status", `Approved ${claim.reviewed}. Claim routed; before and after are in the record.`);
      $("clm-state").setAttribute("tabindex", "-1");
      $("clm-state").focus();
    } else {
      clmRender();
      settle($("clm-error"));
      $("clm-amount").focus();
    }
  });
  $("clm-reset").addEventListener("click", () => {
    claim = new S.Claim();
    $("clm-amount").value = claim.value;
    clmRender();
    say("clm-status", "Claim reset to the extracted value, 1O0.00.");
  });
  // Also fires when a hidden case panel is revealed: measured at 0×0, the line would stay hidden.
  new ResizeObserver(clmConnector).observe($("clm-review"));
  document.fonts?.ready.then(clmConnector);
  $("clm-amount").value = claim.value;
  clmRender();
  }

  if ($("cmp-branches")) {
    let campaign = new S.Campaign();
    function cmpRender(drawn = []) {
      const sent = campaign.sent;
      const failed = S.CHANNELS.filter((c) => campaign.channels[c].state === "failed").length;
      $("cmp-branches").dataset.sent = String(sent);
      $("cmp-source").textContent =
        `SYNTHETIC STUDY / CAMPAIGN ${campaign.id} / ${sent ? "SENT" : "NOT SENT"}${failed ? ` / ${failed} FAILED` : ""}`;
      for (const ch of S.CHANNELS) {
        const r = campaign.channels[ch];
        const el = $(`cmp-${ch}`);
        el.dataset.state = r.state;
        if (drawn.includes(ch)) settle(el);
        const word = el.querySelector("[data-word]");
        word.textContent = cap(r.state);
        el.querySelector("[data-attempts]").innerHTML = views.cmpAttempts(r);
        const box = el.querySelector("[data-select]");
        box.checked = r.selected;
        box.disabled = sent;
        const retry = el.querySelector("[data-retry]");
        if (retry) retry.hidden = r.state !== "failed";
      }
      const blocked = campaign.blocked;
      const send = $("cmp-send");
      send.setAttribute("aria-disabled", String(Boolean(blocked)));
      send.hidden = blocked === "sent";
      $("cmp-reason").textContent = views.cmpReason(campaign);
      $("cmp-reason").dataset.tone = blocked === "no_channels" ? "warn" : "";
      $("cmp-record").innerHTML = views.cmpRecord(campaign);
      $("cmp-count").textContent = views.events(campaign.history.length);
  }
  const focusOutcome = (ch) => {
    const word = $(`cmp-${ch}`).querySelector("[data-word]");
    word.tabIndex = -1;
    word.focus();
  };
  const outcome = (ch) => {
    const r = campaign.channels[ch];
    return `${CHANNEL[ch]} ${r.state}, attempt ${r.attempts.length}`;
  };
  document.querySelectorAll("[data-select]").forEach((box) =>
    box.addEventListener("change", () => {
      campaign.select(box.dataset.select, box.checked);
      cmpRender();
      if (campaign.blocked === "no_channels")
        say("cmp-status", "No channels selected. Send is unavailable.");
    }),
  );
  $("cmp-send").addEventListener("click", () => {
    if (!campaign.send()) {
      say("cmp-status", views.cmpReason(campaign));
      return;
    }
    const picked = S.CHANNELS.filter((c) => campaign.channels[c].selected);
    cmpRender(picked);
    say("cmp-status", `Sent. ${picked.map(outcome).join(". ")}.`);
    const retry = document.querySelector("[data-retry]:not([hidden])");
    if (retry) retry.focus();
    else focusOutcome(picked[0]);
  });
  document.querySelectorAll("[data-retry]").forEach((button) =>
    button.addEventListener("click", () => {
      const ch = button.dataset.retry;
      campaign.retry(ch);
      cmpRender([ch]);
      say("cmp-status", `Retried ${CHANNEL[ch]}. ${outcome(ch)}. Other receipts unchanged.`);
      if (button.hidden) focusOutcome(ch);
    }),
  );
  $("cmp-provider").addEventListener("change", (event) => {
    campaign.setSmsAvailable(event.target.checked);
    say("cmp-status", `SMS provider ${event.target.checked ? "available" : "unavailable"}.`);
  });
  $("cmp-reset").addEventListener("click", () => {
    campaign = new S.Campaign();
    campaign.setSmsAvailable($("cmp-provider").checked);
    cmpRender();
    say("cmp-status", "Campaign reset. All three channels selected.");
  });
  $("cmp-provider").checked = true;
  cmpRender();
  }

  icons();
  // Revealed last: if setup throws, the no-JS records stay instead of dead controls.
  document.querySelectorAll("[data-enhance]").forEach((el) => (el.hidden = false));
  document.querySelectorAll("[data-nojs]").forEach((el) => (el.hidden = true));
})(typeof window !== "undefined" ? window : globalThis);
