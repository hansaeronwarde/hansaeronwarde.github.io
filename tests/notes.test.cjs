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

// The notes publish these snippets as patterns to copy, so they run here exactly as printed.
const snippet = (page, start) => {
  const code = read(page).match(new RegExp(`<pre class="pattern"><code>(${start}[\\s\\S]*?)</code></pre>`))[1];
  return code.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
};

test("N2 pattern: a start that throws leaves the order pending, and redelivery starts it once", async () => {
  const handlers = [];
  const bus = { on: (_, handler) => handlers.push(handler) };
  const makeService = (failFirst) => {
    const rows = new Map();
    const started = [];
    return {
      rows,
      started,
      records: {
        insertIfAbsent: async (id, row) => { if (!rows.has(id)) rows.set(id, { ...row }); },
        get: async (id) => rows.get(id),
        update: async (id, patch) => Object.assign(rows.get(id), patch),
      },
      start: async (id) => {
        if (failFirst) { failFirst = false; throw new Error("provider down"); }
        started.push(id);
      },
    };
  };
  const activation = makeService(true);
  const fulfillment = makeService(false);
  new Function("bus", "activation", "fulfillment", snippet("independent-failure.html", "function subscribe"))(bus, activation, fulfillment);
  const deliver = () => Promise.allSettled(handlers.map((handle) => handle({ orderId: "SAMPLE-001" })));
  const [first] = await deliver();
  assert.equal(first.status, "rejected");
  assert.equal(activation.rows.get("SAMPLE-001").state, "pending");
  assert.deepEqual(fulfillment.started, ["SAMPLE-001"]);
  await deliver();
  await deliver();
  assert.deepEqual(activation.started, ["SAMPLE-001"]);
  assert.equal(activation.rows.get("SAMPLE-001").state, "started");
  assert.deepEqual(fulfillment.started, ["SAMPLE-001"]);
});

test("N3 pattern: unknown fields and non-strings are refused, and a claim routes only once every field's latest approval matches its value", () => {
  const { review, route } = new Function(`${snippet("human-judgment.html", "const rules")}; return { review, route };`)();
  const claim = { fields: { amount: "1O0.00" }, history: [] };
  for (const field of ["note", "hasOwnProperty", "__proto__"])
    assert.deepEqual(review(claim, field, "fine", "enc-1"), { ok: false, problem: "unknown_field" });
  assert.throws(() => route(claim), /amount/);
  assert.deepEqual(review(claim, "amount", "1O0.00", "enc-1"), { ok: false, problem: "not_a_number" });
  assert.deepEqual(review(claim, "amount", "100.00", "enc-1"), { ok: true });
  claim.fields.amount = "900.00";
  assert.throws(() => route(claim), /amount/);
  claim.fields.amount = "100.00";
  route(claim);
  assert.equal(claim.history.at(-1).event, "routed");

  assert.deepEqual(review(claim, "amount", ["1.00"], "enc-1"), { ok: false, problem: "not_a_number" });
  const superseded = { fields: { amount: "100.00" }, history: [] };
  review(superseded, "amount", "100.00", "enc-1");
  review(superseded, "amount", "900.00", "enc-2");
  superseded.fields.amount = "100.00";
  assert.throws(() => route(superseded), /amount/);
  assert.throws(() => route({ fields: { amount: "1.00", payee: "X" }, history: [{ event: "reviewed", field: "amount", after: "1.00" }] }), /payee/);
  assert.throws(() => route({ fields: {}, history: [] }), /amount/);
});
