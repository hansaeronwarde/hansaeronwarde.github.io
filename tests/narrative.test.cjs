const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Batch } = require("../assets/portfolio/queue-model.js");
const {
  Narrative,
  Session,
  config,
} = require("../assets/portfolio/narrative.js");

test("opening states come from the queue model, including timeout and recovery", () => {
  const story = new Narrative();
  const batch = new Batch(config);
  for (const frame of story.frames) {
    assert.deepEqual(frame.jobs, batch.jobs);
    assert.deepEqual(frame.events, batch.events);
    assert.deepEqual(frame.counts, batch.counts);
    batch.step();
  }
  assert.equal(story.atProgress(0.54).jobs[2].state, "retrying");
  assert.equal(story.atProgress(1).jobs[2].state, "completed");
  assert.equal(story.atProgress(1).jobs[2].attempts, 2);
});
test("reverse seeking and edited snapshots do not mutate narrative history", () => {
  const story = new Narrative();
  const early = story.atProgress(0.33);
  story.atProgress(1).jobs[2].history.length = 0;
  assert.deepEqual(story.atProgress(0.33), early);
  assert.equal(story.atProgress(1).jobs[2].history.length, 7);
});
test("handoff reproduces every displayed model snapshot exactly", () => {
  const story = new Narrative();
  const session = new Session(story);
  for (const frame of story.frames) {
    assert.equal(session.handoff(frame.tick), true);
    assert.equal(session.selected, 3);
    assert.deepEqual(session.batch.jobs, frame.jobs);
    assert.deepEqual(session.batch.events, frame.events);
    assert.equal(session.batch.tick, frame.tick);
  }
});
test("narrative handoff preserves user-owned experiment until explicit replacement", () => {
  const session = new Session();
  session.configure({ ...config, workers: 2 });
  session.step();
  const before = JSON.stringify(session.batch);
  assert.equal(session.handoff(19), false);
  assert.equal(JSON.stringify(session.batch), before);
  assert.equal(session.handoff(19, { replace: true }), true);
  assert.equal(session.batch.workers, 5);
  assert.equal(session.batch.tick, 19);
  assert.equal(session.owned, false);
});
test("narrative endpoints clamp and manual stepping claims experiment ownership", () => {
  const story = new Narrative();
  assert.equal(story.atProgress(-1).tick, 0);
  assert.equal(story.atProgress(2).tick, story.frames.length - 1);
  const session = new Session(story);
  session.step();
  assert.equal(session.owned, true);
  assert.equal(session.handoff(10), false);
});
test("no-JS markup shows the model's final record for request 003", () => {
  const html = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../index.html"),
    "utf8",
  );
  const story = new Narrative();
  const job = story.atTick(story.frames.length - 1).jobs[2];
  const pad = (n) => String(n).padStart(3, "0");
  const block = (id) => html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:ol|tbody)>`))[1];
  const ticks = (markup) => [...markup.matchAll(/data-event="(\w+)"[\s\S]*?(\d{3})/g)].map((m) => `${m[2]} ${m[1]}`);
  const expected = job.history.map((e) => `${pad(e.tick)} ${e.event}`);
  assert.deepEqual(ticks(block("story-history")), expected);
  assert.deepEqual(ticks(block("trace-body")), expected);
  assert.match(html, new RegExp(`id="subject-state">${job.state.toUpperCase()}<`));
  assert.match(html, new RegExp(`id="trace-attempts">${job.attempts} attempts<`));
  assert.match(html, new RegExp(`id="subject-tick">TICK ${pad(story.frames.length - 1)}<`));
});
test("stepping a finished batch changes nothing and leaves Inspect available", () => {
  const story = new Narrative();
  const session = new Session(story);
  session.handoff(story.frames.length - 1);
  assert.equal(session.batch.done, true);
  const before = JSON.stringify(session.batch);
  session.step();
  assert.equal(JSON.stringify(session.batch), before);
  assert.equal(session.owned, false);
  assert.equal(session.handoff(story.frames.length - 1), true);
});
