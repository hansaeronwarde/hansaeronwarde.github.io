const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Batch } = require("../assets/portfolio/queue-model.js");

function finish(batch) {
  while (!batch.done && batch.tick < 500) {
    batch.step();
    const counts = batch.counts;
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b),
      batch.jobs.length,
    );
    assert.ok(counts.processing <= Math.min(batch.workers, batch.capacity));
    const slots = batch.jobs
      .filter((j) => j.worker !== null)
      .map((j) => j.worker);
    assert.equal(slots.length, new Set(slots).size);
  }
  assert.ok(batch.done, "batch must eventually terminate");
  return batch;
}

test("bounded FIFO dispatch preserves every request", () => {
  const batch = new Batch({ failures: false });
  batch.step();
  assert.deepEqual(
    batch.jobs.filter((j) => j.state === "processing").map((j) => j.id),
    [1, 2, 3, 4, 5],
  );
  finish(batch);
  assert.equal(batch.counts.completed, 24);
  assert.equal(batch.counts.failed, 0);
});

test("transient failures retain their history and recover", () => {
  const batch = finish(new Batch());
  const job = batch.jobs[2];
  assert.equal(job.attempts, 2);
  assert.equal(job.state, "completed");
  assert.deepEqual(
    job.history.map((e) => e.event),
    [
      "received",
      "processing",
      "dependency_timeout",
      "retry_scheduled",
      "requeued",
      "processing",
      "completed",
    ],
  );
});

test("excess workers produce backpressure and bounded retries", () => {
  const batch = finish(
    new Batch({ size: 48, workers: 8, capacity: 1, failures: false }),
  );
  assert.ok(batch.events.some((e) => e.event === "capacity_rejected"));
  assert.ok(batch.counts.failed > 0);
  assert.ok(batch.jobs.every((j) => j.attempts <= 3));
  assert.ok(
    batch.jobs
      .filter((j) => j.state === "failed")
      .every((j) => j.history.at(-1).event === "failed"),
  );
});

test("parallel work improves completion time within downstream capacity", () => {
  const serial = finish(new Batch({ workers: 1, failures: false }));
  const parallel = finish(new Batch({ workers: 5, failures: false }));
  assert.ok(parallel.tick < serial.tick);
});

test("all supported control combinations terminate without losing work", () => {
  for (const size of [12, 24, 48])
    for (const workers of [1, 5, 8])
      for (const capacity of [1, 5, 8])
        for (const failures of [false, true])
          finish(new Batch({ size, workers, capacity, failures }));
});

test("completed batches are stable; invalid controls are rejected", () => {
  const batch = finish(new Batch());
  const before = JSON.stringify(batch);
  batch.step();
  assert.equal(JSON.stringify(batch), before);
  assert.throws(() => new Batch({ workers: 0 }), RangeError);
  assert.throws(() => new Batch({ size: 999 }), RangeError);
});
