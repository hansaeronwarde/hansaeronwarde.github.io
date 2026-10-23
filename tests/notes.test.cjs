const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Batch } = require("../assets/portfolio/queue-model.js");
const {
  sweep,
  sweepRows,
  statuses,
  claimRecord,
  readiness,
  LAYERS,
} = require("../notes/notes.js");

const read = (page) =>
  require("node:fs").readFileSync(require("node:path").join(__dirname, "../notes", page), "utf8");
const block = (html, id) => html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:tbody|ol|p)>`))[1];
const capRow = (markup) =>
  [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].findIndex((m) => m[1].includes('class="cap"')) + 1;

test("N1 sweep: every request finishes, and only workers past capacity fail or add calls", () => {
  for (const capacity of [1, 2, 5, 8]) {
    const rows = sweep(Batch, capacity);
    assert.deepEqual(rows.map((r) => r.workers), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of rows) {
      if (r.workers <= capacity) {
        assert.equal(r.failed, 0, `${r.workers} workers at capacity ${capacity}`);
        assert.equal(r.calls, 28, `${r.workers} workers at capacity ${capacity}`);
      } else assert.ok(r.calls > 28, `${r.workers} workers at capacity ${capacity}`);
    }
    for (let i = 1; i < capacity; i++) assert.ok(rows[i].tick <= rows[i - 1].tick);
  }
  assert.deepEqual(sweep(Batch, 5)[4], { workers: 5, tick: 19, failed: 0, calls: 28 });
  assert.deepEqual(sweep(Batch, 5), sweep(Batch, 5));
});

test("N1 rows: the CAP marker sits on row 5 at capacity 5 and moves to row 2 at capacity 2", () => {
  for (const [capacity, over] of [[5, 3], [2, 6]]) {
    const markup = sweepRows(sweep(Batch, capacity), capacity);
    assert.equal(capRow(markup), capacity);
    assert.equal(markup.match(/class="cap"/g).length, 1);
    assert.equal(markup.match(/ data-match/g).length, 1);
    assert.equal(markup.match(/ data-over/g).length, over);
    assert.match(markup, new RegExp(`<tr data-match><td>${capacity} <small class="cap">CAP</small></td>`));
  }
});

test("N1 rows: each bar is the row's calls out of 64, or of the most calls when retries pass 64", () => {
  const markup = sweepRows([{ workers: 3, tick: 30, failed: 0, calls: 16 }], 5);
  assert.equal(markup, '<tr><td>3</td><td>30</td><td>0</td><td><span class="bar" style="--w: 25%"></span>16</td></tr>');
  for (let capacity = 1; capacity <= 8; capacity++)
    for (const [, w] of sweepRows(sweep(Batch, capacity), capacity).matchAll(/--w: ([\d.]+)%/g))
      assert.ok(Number(w) <= 100, `capacity ${capacity}: bar ${w}%`);
});

test("N1 no-JS table is the model's sweep at capacity 5", () => {
  const html = read("bounded-concurrency.html");
  assert.match(html, /id="n1-capacity"[^>]*value="5"/);
  assert.equal(block(html, "n1-rows"), sweepRows(sweep(Batch, 5), 5));
});

test("N2 statuses: one record hides activation while logistics is down; two keep it", () => {
  assert.deepEqual(statuses("one", true).map((s) => s.slice(0, 2)), [["Order", "Complete"]]);
  assert.deepEqual(statuses("one", false).map((s) => s.slice(0, 2)), [["Order", "Pending"]]);
  assert.match(statuses("one", false)[0][2], /not recorded/);
  assert.deepEqual(statuses("two", false).map((s) => s.slice(0, 2)), [["Activation", "Activated"], ["Fulfillment", "Waiting"]]);
  assert.deepEqual(statuses("two", true).map((s) => s.slice(0, 2)), [["Activation", "Activated"], ["Fulfillment", "Delivered"]]);
  assert.deepEqual(statuses("two", false)[0], statuses("two", true)[0]);
});

test("N2 no-JS list shows two records with the provider down", () => {
  const items = [...block(read("independent-failure.html"), "n2-out").matchAll(/<li data-state="(\w+)"><span>(.*?)<\/span><strong>(.*?)<\/strong><small>(.*?)<\/small><\/li>/g)];
  assert.deepEqual(items.map((m) => m.slice(2)), statuses("two", false));
  assert.deepEqual(items.map((m) => m[1]), ["activated", "waiting"]);
});

test("N3 claim record: review catches the misread amount; routing directly passes it on", () => {
  const reviewed = claimRecord(true);
  assert.deepEqual(reviewed.map((r) => r[0]), ["Extracted", "Review required", "Reviewed", "Routed"]);
  assert.equal(reviewed.at(-1)[1], "Amount 100.00");
  const direct = claimRecord(false);
  assert.deepEqual(direct.map((r) => r[0]), ["Extracted", "Routed"]);
  assert.equal(direct.at(-1)[2], "routed_unchecked");
});

test("N3 no-JS table is the reviewed record", () => {
  const html = read("human-judgment.html");
  assert.match(html, /name="n3-review" value="review" checked/);
  const rows = [...block(html, "n3-rows").matchAll(/<tr data-event="(\w+)"><td>(\d+)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
  assert.deepEqual(rows.map((m) => [m[3], m[4].replace(/<[^>]+>/g, "")]), claimRecord(true));
  assert.deepEqual(rows.map((m) => m[2]), ["01", "02", "03", "04"]);
});

test("N4 readiness: cutover waits for all six layers and names the missing ones in order", () => {
  assert.equal(LAYERS.length, 6);
  assert.equal(readiness(LAYERS), "All six layers ready. Move the first workflow.");
  assert.equal(readiness([...LAYERS].reverse()), "All six layers ready. Move the first workflow.");
  assert.equal(readiness(LAYERS.slice(0, 5)), "Cutover blocked. Not ready: Operation.");
  assert.equal(readiness(["Operation", "Data"]), "Cutover blocked. Not ready: Interface, Service boundary, Infrastructure, Delivery.");
  assert.equal(readiness([]), `Cutover blocked. Not ready: ${LAYERS.join(", ")}.`);
});

test("N4 no-JS checklist is the model's layers, none ticked, and the gate is blocked", () => {
  const html = read("legacy-rebuild.html");
  const layers = html.slice(html.indexOf('id="n4-layers"'), html.indexOf('id="n4-out"'));
  const boxes = [...layers.matchAll(/<input type="checkbox" value="([^"]+)"( checked)?/g)];
  assert.deepEqual(boxes.map((m) => m[1]), LAYERS);
  assert.ok(boxes.every((m) => !m[2]));
  assert.equal(html.match(/id="n4-out" data-ready="false">([^<]*)</)[1], readiness([]));
});
