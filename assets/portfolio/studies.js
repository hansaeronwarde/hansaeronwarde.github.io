(function (root) {
  "use strict";
  // Synthetic teaching models. None reproduces a client's implementation.
  const FULFILMENT_TICKS = 2;

  class Order {
    constructor() {
      this.id = "SAMPLE-001";
      this.tick = 0;
      this.available = true;
      this.activation = { state: "pending" };
      this.fulfillment = { state: "pending", progress: 0 };
      this.history = [{ tick: 0, lane: "order", event: "received" }];
    }
    get done() {
      return (
        this.activation.state === "activated" &&
        this.fulfillment.state === "fulfilled"
      );
    }
    log(lane, event, extra) {
      this.history.push({ tick: this.tick, lane, event, ...extra });
    }
    move(lane, state, extra) {
      this[lane].state = state;
      this.log(lane, state, extra);
    }
    setAvailable(available) {
      if (this.done || available === this.available) return false;
      this.available = available;
      this.log(
        "dependency",
        available ? "provider_restored" : "provider_unavailable",
      );
      return true;
    }
    step() {
      if (this.done) return false;
      this.tick++;
      if (this.activation.state === "pending")
        this.move("activation", "processing");
      else if (this.activation.state === "processing")
        this.move("activation", "activated");
      const f = this.fulfillment;
      if (f.state === "fulfilled") return true;
      if (!this.available) {
        if (f.state !== "waiting") {
          f.reason = "provider_unavailable";
          this.move("fulfillment", "waiting", { reason: f.reason });
        }
      } else if (f.state !== "processing") {
        delete f.reason;
        this.move("fulfillment", "processing");
      } else if (++f.progress === FULFILMENT_TICKS) {
        this.move("fulfillment", "fulfilled");
      }
      return true;
    }
  }

  const messages = {
    empty: "Enter the amount shown on the claim.",
    letter_o:
      "Amount can only contain digits and a decimal point. Check for a letter O in place of a zero.",
    not_numeric: "Amount can only contain digits and a decimal point.",
    too_long: "Enter at most 9 digits before the decimal point.",
    format: "Enter the amount with two decimal places, like 100.00.",
  };

  function validateAmount(value) {
    const amount = value.trim();
    if (!amount) return "empty";
    if (/[^\d.]/.test(amount)) return /o/i.test(amount) ? "letter_o" : "not_numeric";
    if (/^\d{10,}/.test(amount)) return "too_long";
    if (!/^\d{1,9}\.\d{2}$/.test(amount)) return "format";
    return null;
  }

  class Claim {
    constructor() {
      this.id = "SAMPLE-001";
      this.extracted = "1O0.00";
      this.value = this.extracted;
      this.state = "in_review";
      this.error = null;
      this.history = [
        { event: "received" },
        { event: "extracted", field: "amount", value: this.extracted },
        { event: "review_required", reason: "ambiguous_character" },
      ];
    }
    edit(value) {
      if (this.state !== "in_review") return false;
      this.value = value;
      this.error = null;
      return true;
    }
    approve() {
      if (this.state !== "in_review") return false;
      this.error = validateAmount(this.value);
      if (this.error) return false;
      this.reviewed = this.value.trim();
      this.history.push(
        {
          event: "reviewed",
          field: "amount",
          before: this.extracted,
          after: this.reviewed,
          corrected: this.reviewed !== this.extracted,
        },
        { event: "routed" },
      );
      this.state = "routed";
      return true;
    }
  }

  const CHANNELS = ["sms", "ivr", "email"];

  class Campaign {
    constructor() {
      this.id = "SAMPLE-001";
      this.smsAvailable = true;
      this.sent = false;
      this.channels = Object.fromEntries(
        CHANNELS.map((channel) => [
          channel,
          { selected: true, state: "ready", attempts: [] },
        ]),
      );
      this.history = [{ event: "composed" }];
    }
    get blocked() {
      if (this.sent) return "sent";
      return CHANNELS.some((channel) => this.channels[channel].selected)
        ? null
        : "no_channels";
    }
    select(channel, selected) {
      if (this.sent) return false;
      Object.assign(this.channels[channel], {
        selected,
        state: selected ? "ready" : "skipped",
      });
      return true;
    }
    setSmsAvailable(available) {
      if (available === this.smsAvailable) return false;
      this.smsAvailable = available;
      this.history.push({
        event: available ? "provider_restored" : "provider_unavailable",
        channel: "sms",
      });
      return true;
    }
    send() {
      if (this.blocked) return false;
      this.sent = true;
      this.history.push({ event: "scheduled" });
      CHANNELS.filter((channel) => this.channels[channel].selected).forEach(
        (channel) => this.deliver(channel),
      );
      return true;
    }
    retry(channel) {
      if (this.channels[channel].state !== "failed") return false;
      this.deliver(channel);
      return true;
    }
    deliver(channel) {
      const receipt = this.channels[channel];
      const ok = channel !== "sms" || this.smsAvailable;
      const attempt = {
        attempt: receipt.attempts.length + 1,
        result: ok ? "sent" : "failed",
        ...(ok ? {} : { reason: "provider_error" }),
      };
      receipt.attempts.push(attempt);
      receipt.state = attempt.result;
      const { result, ...detail } = attempt;
      this.history.push({ event: result, channel, ...detail });
    }
  }

  const api = { Order, Claim, Campaign, CHANNELS, messages, validateAmount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PortfolioStudies = api;
})(typeof window !== "undefined" ? window : globalThis);
