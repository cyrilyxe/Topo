"use strict";

const test = require("node:test");
const assert = require("node:assert");
const DocEdit = require("../js/doc-edit.js");
const Model = require("../js/model.js");
const Clipboard = require("../js/clipboard.js");

const SAMPLE = `# top comment
title: Demo

nodes:
  - id: api # api comment
    label: API
  - id: cache # cache comment
    label: Cache
    children:
      - id: warm
        label: Warm
  - id: workers
    label: Workers
    type: group
    children:
      - id: job
        label: Job

links:
  - from: api
    to: cache # link comment
  - de: warm
    vers: api
  - from: api
    to: workers
  - from: workers
    to: job

style:
  rules:
    - target: cache
      color: "#ff0000"

view:
  collapsed: [cache]
  positions:
    cache: { x: 1, y: 2 }
    api: { x: 5, y: 6 }
  layouts:
    wide:
      collapsed: [cache]
      positions:
        cache: { x: 9, y: 9 }

trash:
  - parent: cache
    index: 0
    node: { id: gone }
    links:
      - index: 0
        link: { from: gone, to: cache }
`;

test("renameId rewrites the node and every reference", () => {
  const out = DocEdit.renameId(SAMPLE, "cache", "cache-redis");
  const model = Model.parse(out);

  assert.ok(model.byId.has("cache-redis"));
  assert.ok(!model.byId.has("cache"));
  assert.strictEqual(model.anomalies.length, 0);
  assert.ok(model.links.some((l) => l.from === "api" && l.to === "cache-redis"));
  assert.strictEqual(model.style.rules[0].target, "cache-redis");
  assert.deepStrictEqual(model.view.collapsed, ["cache-redis"]);
  assert.ok(model.view.positions["cache-redis"]);
  assert.match(out, /layouts:\n {4}wide:\n {6}collapsed: \[ ?cache-redis ?\]/);
  assert.match(out, /cache-redis: \{ x: 9, y: 9 \}/);
  assert.match(out, /parent: cache-redis/);
  assert.match(out, /to: cache-redis # link comment/);
});

test("renameId keeps comments and refuses duplicates", () => {
  const out = DocEdit.renameId(SAMPLE, "cache", "cache-redis");

  assert.match(out, /# top comment/);
  assert.match(out, /# api comment/);
  assert.match(out, /id: cache-redis # cache comment/);
  assert.match(out, /# link comment/);
  assert.throws(() => DocEdit.renameId(SAMPLE, "cache", "api"), /existe déjà/);
  assert.throws(() => DocEdit.renameId(SAMPLE, "cache", "bad id"), /invalide/);
  assert.strictEqual(DocEdit.renameId(SAMPLE, "cache", "cache"), SAMPLE);
});

test("renameId follows alias references and leaves others untouched", () => {
  const out = DocEdit.renameId(SAMPLE, "api", "gateway");

  assert.match(out, /vers: gateway/);
  assert.match(out, /from: gateway/);
  assert.match(out, /gateway: \{ x: 5, y: 6 \}/);
  assert.strictEqual(Model.parse(out).anomalies.length, 0);
});

test("renameRefs fixes references to an id renamed by hand", () => {
  const hand = SAMPLE.replace("id: cache # cache comment", "id: cache-redis # cache comment");
  const before = Model.parse(hand);

  assert.ok(before.anomalies.some((a) => a.code === "unknown-ref" && a.ref === "cache"));

  const out = DocEdit.renameRefs(hand, "cache", "cache-redis");

  assert.strictEqual(Model.parse(out).anomalies.filter((a) => a.code === "unknown-ref").length, 0);
});

test("autoId: the three schemes, with unique suffixes", () => {
  const taken = new Set(["api", "service-1", "service-2", "parent-api"]);

  assert.strictEqual(DocEdit.autoId("slug", { label: "Passerelle Été" }, taken), "passerelle-ete");
  assert.strictEqual(DocEdit.autoId("slug", { label: "API" }, taken), "api-2");
  assert.strictEqual(DocEdit.autoId("slug", { label: "API" }, new Set(["api", "api-2"])), "api-3");
  assert.strictEqual(DocEdit.autoId("slug", { label: "" }, new Set()), "brique");
  assert.strictEqual(DocEdit.autoId("parent-slug", { label: "API", parent: "parent" }, taken), "parent-api-2");
  assert.strictEqual(DocEdit.autoId("parent-slug", { label: "API", parent: null }, new Set()), "api");
  assert.strictEqual(DocEdit.autoId("type-n", { label: "x", type: "service" }, taken), "service-3");
  assert.strictEqual(DocEdit.autoId("type-n", { label: "x", type: "Base de données" }, new Set()), "base-de-donnees-1");
});

test("isAutoId recognises generated ids only", () => {
  assert.ok(DocEdit.isAutoId("slug", { label: "Mon API" }, "mon-api"));
  assert.ok(DocEdit.isAutoId("slug", { label: "Mon API" }, "mon-api-3"));
  assert.ok(!DocEdit.isAutoId("slug", { label: "Mon API" }, "gateway"));
  assert.ok(DocEdit.isAutoId("type-n", { type: "service" }, "service-12"));
});

test("followId regenerates an automatic id after a label change, references included", () => {
  const text = `nodes:
  - id: ancien-nom
    label: Ancien nom
  - id: autre
    label: Autre
links:
  - from: ancien-nom
    to: autre
`;
  const edited = DocEdit.updateNode(text, "ancien-nom", { label: "Nouveau nom" });
  const out = DocEdit.followId(text, edited, "ancien-nom", "slug");
  const model = Model.parse(out);

  assert.ok(model.byId.has("nouveau-nom"));
  assert.strictEqual(model.links[0].from, "nouveau-nom");

  const custom = text.replace(/ancien-nom/g, "mon-id");
  const kept = DocEdit.followId(custom, DocEdit.updateNode(custom, "mon-id", { label: "Nouveau nom" }), "mon-id", "slug");

  assert.ok(Model.parse(kept).byId.has("mon-id"));
});

test("clipboard: subtree, internal links and id remap", () => {
  const payload = DocEdit.exportNodes(SAMPLE, ["workers"]);

  assert.strictEqual(payload.nodes.length, 1);
  assert.strictEqual(payload.nodes[0].children[0].id, "job");
  assert.deepStrictEqual(payload.links, [{ from: "workers", to: "workers.job" }]);

  const roundTrip = Clipboard.parse(Clipboard.serialize(payload));

  assert.deepStrictEqual(roundTrip, payload);
  assert.strictEqual(Clipboard.parse("title: x\nnodes: []"), null);

  const model = Model.parse(SAMPLE);
  const taken = new Set();
  model.nodes.forEach((n) => [n.id, n.localId, n.qualifiedId].forEach((v) => taken.add(v)));
  const mapped = Clipboard.remap(roundTrip, { taken, scheme: "slug", parent: null });

  assert.deepStrictEqual(mapped.rootIds, ["workers-2"]);
  assert.strictEqual(mapped.nodes[0].children[0].id, "job-2");
  assert.deepStrictEqual(mapped.links, [{ from: "workers-2", to: "job-2" }]);
  assert.strictEqual(mapped.nodes[0].type, "group");

  let text = SAMPLE;
  mapped.nodes.forEach((n) => { text = DocEdit.addNode(text, null, n); });
  mapped.links.forEach((l) => { text = DocEdit.addLink(text, l); });

  const after = Model.parse(text);

  assert.strictEqual(after.anomalies.length, 0);
  assert.ok(after.links.some((l) => l.from === "workers-2" && l.to === "job-2"));
  assert.strictEqual(after.byId.get("job-2").parent, "workers-2");
});

test("clipboard: ids kept when free, other schemes, links to outside dropped", () => {
  const payload = DocEdit.exportNodes(SAMPLE, ["api", "cache"]);

  assert.strictEqual(payload.links.length, 2);
  assert.deepStrictEqual(payload.links[0], { from: "api", to: "cache" });
  assert.deepStrictEqual(payload.links[1], { de: "cache.warm", vers: "api" });

  const free = Clipboard.remap(payload, { taken: new Set(["x"]), scheme: "slug", parent: null });

  assert.deepStrictEqual(free.rootIds, ["api", "cache"]);

  const typed = Clipboard.remap(payload, { taken: new Set(["api", "cache", "warm", "service-1"]), scheme: "type-n", parent: null });

  assert.strictEqual(typed.nodes[0].id, "brique-1");
  assert.ok(typed.links[0].from === typed.nodes[0].id && typed.links[0].to === typed.nodes[1].id && typed.links[1].de === typed.nodes[1].children[0].id);

  const nested = Clipboard.remap(payload, { taken: new Set(["api"]), scheme: "parent-slug", parent: "workers" });

  assert.strictEqual(nested.nodes[0].id, "workers-api");
});
