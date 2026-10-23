const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  Order,
  Claim,
  Campaign,
  messages,
} = require("../assets/portfolio/studies.js");

const run = (order, limit = 20) => {
  for (let i = 0; i < limit && order.step(); i++);
  return order;
};
const events = (order, lane) =>
  order.history.filter((e) => e.lane === lane).map((e) => e.event);

test("order: activation finishes before fulfillment on the normal path", () => {
  const order = run(new Order());
  assert.equal(order.tick, 3);
  assert.deepEqual(events(order, "activation"), ["processing", "activated"]);
  assert.deepEqual(events(order, "fulfillment"), ["processing", "fulfilled"]);
  assert.equal(order.history.find((e) => e.event === "activated").tick, 2);
  assert.equal(order.step(), false);
});

test("order: an unavailable provider holds fulfillment without blocking activation", () => {
  const order = new Order();
  order.setAvailable(false);
  for (let i = 0; i < 10; i++) order.step();
  assert.equal(order.activation.state, "activated");
  assert.equal(order.fulfillment.state, "waiting");
  assert.equal(order.fulfillment.reason, "provider_unavailable");
  assert.equal(order.done, false);
  assert.deepEqual(events(order, "fulfillment"), ["waiting"]);

  order.setAvailable(true);
  run(order);
  assert.equal(order.fulfillment.state, "fulfilled");
  assert.equal("reason" in order.fulfillment, false);
  assert.equal(order.id, "SAMPLE-001");
  assert.deepEqual(events(order, "fulfillment"), [
    "waiting",
    "processing",
    "fulfilled",
  ]);
  assert.deepEqual(events(order, "dependency"), [
    "provider_unavailable",
    "provider_restored",
  ]);
});

test("order: an outage mid-fulfillment keeps the work already done", () => {
  const order = new Order();
  order.step();
  order.step();
  assert.equal(order.fulfillment.progress, 1);
  order.setAvailable(false);
  order.step();
  assert.equal(order.fulfillment.state, "waiting");
  order.setAvailable(true);
  order.step();
  assert.equal(order.fulfillment.state, "processing");
  order.step();
  assert.equal(order.fulfillment.state, "fulfilled");
  assert.equal(order.tick, 5);
  assert.equal(order.setAvailable(true), false);
});

test("order: a finished order ignores provider changes", () => {
  const order = run(new Order());
  const logged = order.history.length;
  assert.equal(order.setAvailable(false), false);
  assert.equal(order.available, true);
  assert.equal(order.history.length, logged);
});

test("claim: invalid review input stays in review with a specific error", () => {
  const claim = new Claim();
  const before = JSON.stringify(claim.history);
  for (const [value, error] of [
    ["1O0.00", "letter_o"],
    ["$100.00", "not_numeric"],
    ["1234567890.00", "too_long"],
    ["   ", "empty"],
    ["100", "format"],
    ["1,000.00", "not_numeric"],
    ["100.0", "format"],
  ]) {
    claim.edit(value);
    assert.equal(claim.approve(), false, value);
    assert.equal(claim.error, error, value);
    assert.ok(messages[error]);
    assert.equal(claim.state, "in_review");
  }
  assert.equal(JSON.stringify(claim.history), before);
  claim.edit("100.");
  assert.equal(claim.error, null);
});

test("claim: a corrected approval routes and records before and after", () => {
  const claim = new Claim();
  claim.edit(" 100.00 ");
  assert.equal(claim.approve(), true);
  assert.equal(claim.state, "routed");
  assert.deepEqual(claim.history.slice(-2), [
    {
      event: "reviewed",
      field: "amount",
      before: "1O0.00",
      after: "100.00",
      corrected: true,
    },
    { event: "routed" },
  ]);
  assert.equal(claim.edit("200.00"), false);
  assert.equal(claim.approve(), false);
  assert.equal(claim.reviewed, "100.00");
});

test("campaign: send is unavailable with no channels selected", () => {
  const campaign = new Campaign();
  ["sms", "ivr", "email"].forEach((c) => campaign.select(c, false));
  assert.equal(campaign.blocked, "no_channels");
  assert.equal(campaign.send(), false);
  assert.equal(campaign.sent, false);
  campaign.select("email", true);
  assert.equal(campaign.send(), true);
  assert.equal(campaign.channels.sms.state, "skipped");
  assert.deepEqual(campaign.channels.sms.attempts, []);
  assert.equal(campaign.select("sms", true), false);
  assert.equal(campaign.blocked, "sent");
});

test("campaign: retrying a failed SMS leaves earlier receipts intact", () => {
  const campaign = new Campaign();
  campaign.setSmsAvailable(false);
  campaign.send();
  assert.equal(campaign.channels.sms.state, "failed");
  const others = JSON.stringify([
    campaign.channels.ivr,
    campaign.channels.email,
  ]);
  assert.equal(campaign.retry("ivr"), false);

  campaign.retry("sms");
  assert.deepEqual(campaign.channels.sms.attempts.map((a) => a.result), [
    "failed",
    "failed",
  ]);
  campaign.setSmsAvailable(true);
  assert.equal(campaign.retry("sms"), true);
  assert.equal(campaign.channels.sms.state, "sent");
  assert.equal(campaign.channels.sms.attempts.length, 3);
  assert.equal(campaign.retry("sms"), false);
  assert.equal(
    JSON.stringify([campaign.channels.ivr, campaign.channels.email]),
    others,
  );
  assert.deepEqual(
    campaign.history.map((e) => [e.event, e.channel, e.attempt]),
    [
      ["composed", undefined, undefined],
      ["provider_unavailable", "sms", undefined],
      ["scheduled", undefined, undefined],
      ["failed", "sms", 1],
      ["sent", "ivr", 1],
      ["sent", "email", 1],
      ["failed", "sms", 2],
      ["provider_restored", "sms", undefined],
      ["sent", "sms", 3],
    ],
  );
  assert.equal(campaign.setSmsAvailable(true), false);
  assert.equal(campaign.history.length, 9);
});

test("reset: a new instance shares no state with a used one", () => {
  const used = [new Order(), new Claim(), new Campaign()];
  run(used[0]);
  used[1].edit("100.00");
  used[1].approve();
  used[2].select("ivr", false);
  used[2].send();
  assert.deepEqual(new Order().history, [
    { tick: 0, lane: "order", event: "received" },
  ]);
  assert.equal(new Claim().state, "in_review");
  assert.equal(new Claim().history.length, 3);
  const fresh = new Campaign();
  assert.equal(fresh.channels.ivr.selected, true);
  assert.deepEqual(fresh.channels.sms.attempts, []);
});

// Each case page carries one study, and its markup is that model's final record.
const STUDY_PAGES = {
  tel: "work/sim-activation.html",
  clm: "work/claims-intake.html",
  cmp: "work/campaign-delivery.html",
};
const read = (page) =>
  require("node:fs").readFileSync(require("node:path").join(__dirname, "..", page), "utf8");

test("no-JS markup on each case page shows its model's final record", () => {
  const views = require("../assets/portfolio/studies-ui.js");
  const order = new Order();
  order.setAvailable(false);
  order.step();
  order.step();
  order.setAvailable(true);
  run(order);
  const claim = new Claim();
  claim.edit("100.00");
  claim.approve();
  const campaign = new Campaign();
  campaign.setSmsAvailable(false);
  campaign.send();
  campaign.retry("sms");
  campaign.setSmsAvailable(true);
  campaign.retry("sms");
  for (const [prefix, model, record] of [
    ["tel", order, views.telRecord],
    ["clm", claim, views.clmRecord],
    ["cmp", campaign, views.cmpRecord],
  ]) {
    const html = read(STUDY_PAGES[prefix]);
    const authored = (id) =>
      html.match(new RegExp(`id="${id}">([\\s\\S]*?)</(?:tbody|span)>`))[1];
    assert.equal(authored(`${prefix}-record`), record(model), prefix);
    assert.equal(authored(`${prefix}-count`), views.events(model.history.length), prefix);
    if (prefix === "tel") assert.notEqual(authored("tel-record"), views.telRecord(new Order()));
  }
});

test("each case page holds only its own study", () => {
  const roots = { tel: "tel-lanes", clm: "clm-review", cmp: "cmp-branches" };
  for (const page of ["index.html", "cases.html", ...Object.values(STUDY_PAGES)]) {
    const html = read(page);
    for (const [prefix, id] of Object.entries(roots))
      assert.equal(html.includes(`id="${id}"`), STUDY_PAGES[prefix] === page, `${page} #${id}`);
  }
});

test("studies-ui.js does nothing for studies absent from the page", () => {
  const vm = require("node:vm");
  const S = require("../assets/portfolio/studies.js");
  const revealed = [{ hidden: true }];
  const fallbacks = [{ hidden: false }];
  const queried = [];
  const document = {
    getElementById: (id) => (queried.push(id), null),
    querySelectorAll: (sel) => (sel === "[data-enhance]" ? revealed : sel === "[data-nojs]" ? fallbacks : []),
    body: { classList: { contains: () => false } },
  };
  const window = { PortfolioStudies: S, document, matchMedia: () => ({ matches: false }) };
  window.window = window;
  vm.runInNewContext(
    require("node:fs").readFileSync(require.resolve("../assets/portfolio/studies-ui.js"), "utf8"),
    window,
  );
  assert.deepEqual(queried, ["tel-lanes", "clm-review", "cmp-branches"]);
  assert.equal(revealed[0].hidden, false);
  assert.equal(fallbacks[0].hidden, true);
  assert.equal(typeof window.SupportingViews.telRecord, "function");
});

test("claim record and diff escape markup in reviewed values", () => {
  const views = require("../assets/portfolio/studies-ui.js");
  const claim = new Claim();
  claim.history.push({ event: "reviewed", field: "amount", before: "1O0.00", after: "<img src=x>", corrected: true });
  assert.doesNotMatch(views.clmRecord(claim), /<img/);
  assert.doesNotMatch(views.clmDiff("<b>", "<i>").join(""), /<[bi]>/);
});
