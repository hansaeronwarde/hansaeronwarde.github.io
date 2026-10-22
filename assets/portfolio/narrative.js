(function (root) {
  "use strict";
  const { Batch } =
    typeof module !== "undefined" && module.exports
      ? require("./queue-model.js")
      : root.PortfolioQueue;
  const config = Object.freeze({
    size: 24,
    workers: 5,
    capacity: 5,
    failures: true,
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));

  class Narrative {
    constructor() {
      const batch = new Batch(config);
      this.frames = [];
      do {
        this.frames.push(
          clone({
            tick: batch.tick,
            jobs: batch.jobs,
            counts: batch.counts,
            events: batch.events,
          }),
        );
        if (batch.done) break;
        batch.step();
      } while (batch.tick < 200);
      const subject = (frame) => frame.jobs[2];
      this.failureTick = this.frames.find(
        (frame) => subject(frame).state === "retrying",
      ).tick;
      this.retryTick = this.frames.find(
        (frame) =>
          subject(frame).attempts === 2 &&
          subject(frame).state === "processing",
      ).tick;
      this.completedTick = this.frames.find(
        (frame) => subject(frame).state === "completed",
      ).tick;
    }
    atTick(tick) {
      const index = Math.max(
        0,
        Math.min(this.frames.length - 1, Math.round(tick)),
      );
      return clone(this.frames[index]);
    }
    atProgress(progress) {
      const points = [
        [0, 0],
        [0.2, 0],
        [0.39, 1],
        [0.44, this.failureTick],
        [0.58, this.failureTick + 1],
        [0.65, this.retryTick - 1],
        [0.69, this.retryTick],
        [0.8, this.completedTick],
        [0.86, this.frames.length - 1],
        [1, this.frames.length - 1],
      ];
      const p = Math.max(0, Math.min(1, progress));
      const end = points.findIndex((point) => point[0] >= p);
      if (end <= 0) return this.atTick(0);
      const [a, b] = [points[end - 1], points[end]];
      return this.atTick(a[1] + ((p - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    resume(tick) {
      const batch = new Batch(config);
      const target = this.atTick(tick).tick;
      while (batch.tick < target) batch.step();
      return batch;
    }
  }

  class Session {
    constructor(narrative = new Narrative()) {
      this.narrative = narrative;
      this.batch = new Batch(config);
      this.owned = false;
      this.selected = 3;
    }
    handoff(tick, { replace = false } = {}) {
      if (this.owned && !replace) return false;
      this.batch = this.narrative.resume(tick);
      this.selected = 3;
      this.owned = false;
      return true;
    }
    configure(options) {
      this.batch = new Batch(options);
      this.owned = true;
    }
    step() {
      if (this.batch.done) return;
      this.owned = true;
      this.batch.step();
    }
  }
  const api = { Narrative, Session, config };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PortfolioStory = api;
})(typeof window !== "undefined" ? window : globalThis);
