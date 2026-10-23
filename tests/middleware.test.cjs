const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Batch } = require("../assets/portfolio/queue-model.js");

const FILE = path.join(__dirname, "../work/middleware.js");
const { views, opening } = require(FILE);
const ids = (markup) => [...markup.matchAll(/>(\d{3})</g)].map((m) => Number(m[1]));
const pad = (n) => String(n).padStart(3, "0");

test("work/middleware.js loads with require()", () => {
  require(FILE);
});

test("opening: tick 4 at the project's settings, every stage holds work and 003 waits to retry", () => {
  const batch = opening();
  assert.equal(batch.tick, 4);
  assert.equal(batch.workers, 5);
  assert.equal(batch.capacity, 5);
  const v = views(batch, 3);
  for (const stage of ["queued", "workers", "retrying", "done"]) assert.ok(ids(v[stage]).length, stage);
  assert.deepEqual(ids(v.retrying), [3]);
  assert.equal(batch.jobs[2].state, "retrying");
  assert.equal(v.recordLabel, "REQUEST 003 / RETRYING / 1 ATTEMPT");
  assert.notEqual(opening(), opening());
  assert.deepEqual(opening().jobs, batch.jobs);
});

test("views: every request appears in exactly one stage, and counts match the tokens", () => {
  const batch = new Batch();
  while (!batch.done) {
    const v = views(batch, 3);
    const seen = ["queued", "workers", "retrying", "done"].flatMap((stage) => ids(v[stage]));
    assert.deepEqual([...seen].sort((a, b) => a - b), batch.jobs.map((j) => j.id), `tick ${batch.tick}`);
    assert.equal(v.queuedCount, String(ids(v.queued).length));
    assert.equal(v.retryingCount, String(ids(v.retrying).length));
    const busy = ids(v.workers).length;
    assert.equal(v.workersCount, `${busy} / ${batch.workers}`);
    assert.equal(v.downstreamCount, `${busy} / ${batch.capacity}`);
    assert.equal((v.downstream.match(/<i/g) || []).length, batch.capacity);
    assert.equal((v.downstream.match(/data-used/g) || []).length, busy);
    assert.equal((v.workers.match(/<li>/g) || []).length, batch.workers);
    assert.equal(v.source, `SYNTHETIC STUDY / 5 WORKERS / 5 DOWNSTREAM / TICK ${pad(batch.tick)}`);
    batch.step();
  }
});

test("views: only the selected request is pressed, and its record is its history", () => {
  const batch = opening();
  for (const selected of [1, 3, 24]) {
    const v = views(batch, selected);
    const all = Object.values(v).join("");
    assert.equal((all.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(all, new RegExp(`data-request="${selected}"[^>]*aria-pressed="true" aria-label="Request ${pad(selected)}, ${batch.jobs[selected - 1].state}"`));
    const rows = [...v.record.matchAll(/<tr data-event="(\w+)"><td>(\d{3})<\/td><td>[^<]+<\/td><td>(\d+)<\/td><\/tr>/g)];
    assert.deepEqual(rows.map((m) => [m[1], Number(m[2]), Number(m[3])]), batch.jobs[selected - 1].history.map((e) => [e.event, e.tick, e.attempt]));
  }
});

test("views: the summary reads the batch state, and names every outcome once it is done", () => {
  const batch = opening();
  assert.equal(views(batch, 3).summary, `Tick 004. ${batch.pending.length} waiting, 5 in flight, 1 in retry wait.`);
  while (!batch.done) batch.step();
  const v = views(batch, 3);
  const completed = batch.jobs.filter((j) => j.state === "completed").length;
  const failed = batch.jobs.filter((j) => j.state === "failed").length;
  assert.equal(completed + failed, 24);
  assert.equal(v.summary, `Batch complete at tick ${pad(batch.tick)}. ${completed} completed, ${failed} failed. Every request kept its record.`);
  assert.equal(v.doneCount, `${completed} / ${failed}`);
  assert.equal(v.recordLabel, "REQUEST 003 / COMPLETED / 2 ATTEMPTS");
  assert.equal(ids(v.done).length, 24);
});

test("views: other settings show in the source and slot counts", () => {
  const batch = new Batch({ workers: 3, capacity: 2, failures: false });
  batch.step();
  const v = views(batch, 1);
  assert.equal(v.source, "SYNTHETIC STUDY / 3 WORKERS / 2 DOWNSTREAM / TICK 001");
  assert.equal((v.workers.match(/<li>/g) || []).length, 3);
  assert.equal((v.downstream.match(/<i/g) || []).length, 2);
});

test("no-JS markup is the opening snapshot for request 003", () => {
  const html = fs.readFileSync(path.join(__dirname, "../work/integration-middleware.html"), "utf8");
  const v = views(opening(), 3);
  const text = (id) => html.match(new RegExp(`id="mw-${id}"[^>]*>([^<]*)<`))[1];
  for (const key of ["source", "queuedCount", "workersCount", "downstreamCount", "retryingCount", "doneCount", "recordLabel"])
    assert.equal(text(key), v[key], key);
  const section = (id) => html.slice(html.indexOf(`id="mw-${id}"`), html.indexOf("\n", html.indexOf(`id="mw-${id}"`)));
  for (const key of ["queued", "workers", "retrying", "done"]) assert.deepEqual(ids(section(key)), ids(v[key]), key);
  assert.equal((section("downstream").match(/data-used/g) || []).length, 5);
  assert.equal(html.match(/<tbody id="mw-record">([\s\S]*?)<\/tbody>/)[1], v.record);
});
