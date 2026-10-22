(function (root) {
  "use strict";

  // Deterministic teaching model. Ticks are virtual units, not production time.
  class Batch {
    constructor({
      size = 24,
      workers = 5,
      capacity = 5,
      failures = true,
    } = {}) {
      if (![12, 24, 48].includes(size))
        throw new RangeError("Unsupported batch size");
      for (const value of [workers, capacity])
        if (!Number.isInteger(value) || value < 1 || value > 8)
          throw new RangeError("Concurrency must be between 1 and 8");
      this.workers = workers;
      this.capacity = capacity;
      this.failures = failures;
      this.tick = 0;
      this.events = [];
      this.jobs = Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        state: "queued",
        attempts: 0,
        worker: null,
        until: 0,
        history: [],
      }));
      this.pending = this.jobs.map((job) => job.id);
      this.jobs.forEach((job) => this.record(job, "received"));
    }

    record(job, event) {
      const entry = {
        tick: this.tick,
        id: job.id,
        event,
        attempt: job.attempts,
      };
      job.history.push(entry);
      this.events.push(entry);
    }

    get done() {
      return this.jobs.every((job) =>
        ["completed", "failed"].includes(job.state),
      );
    }

    get counts() {
      const counts = {
        queued: 0,
        processing: 0,
        retrying: 0,
        completed: 0,
        failed: 0,
      };
      this.jobs.forEach((job) => counts[job.state]++);
      return counts;
    }

    step() {
      if (this.done) return;
      this.tick++;
      // Finish work and make due retries eligible before dispatching FIFO work.
      this.jobs.forEach((job) => {
        if (job.state === "processing" && job.until <= this.tick) {
          job.worker = null;
          if (this.failures && job.id % 7 === 3 && job.attempts === 1)
            this.retry(job, "dependency_timeout");
          else {
            job.state = "completed";
            this.record(job, "completed");
          }
        } else if (job.state === "retrying" && job.until <= this.tick) {
          job.state = "queued";
          this.pending.push(job.id);
          this.record(job, "requeued");
        }
      });
      for (let slot = 1; slot <= this.workers && this.pending.length; slot++) {
        if (
          this.jobs.some(
            (job) => job.state === "processing" && job.worker === slot,
          )
        )
          continue;
        const job = this.jobs[this.pending.shift() - 1];
        job.attempts++;
        if (this.counts.processing >= this.capacity) {
          this.retry(job, "capacity_rejected");
          continue;
        }
        job.state = "processing";
        job.worker = slot;
        job.until = this.tick + 2 + (job.id % 3);
        this.record(job, "processing");
      }
    }

    retry(job, reason) {
      this.record(job, reason);
      job.worker = null;
      if (job.attempts >= 3) {
        job.state = "failed";
        this.record(job, "failed");
      } else {
        job.state = "retrying";
        job.until = this.tick + 2 ** job.attempts;
        this.record(job, "retry_scheduled");
      }
    }
  }

  if (typeof module !== "undefined" && module.exports)
    module.exports = { Batch };
  else root.PortfolioQueue = { Batch };
})(typeof window !== "undefined" ? window : globalThis);
