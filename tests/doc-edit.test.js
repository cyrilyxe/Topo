"use strict";

const test = require("node:test");
const assert = require("node:assert");
const jsyaml = require("js-yaml");
const DocEdit = require("../js/doc-edit.js");
const Model = require("../js/model.js");

const SAMPLE = `# top comment
title: Demo

nodes:
  # the platform
  - id: plat # trailing plat
    label: Plateforme
    children:
      - id: api # api comment
        label: API
      - id: db
        label: DB
        children:
          - id: cache
  - id: web
  - id: ext

links:
  - from: web # web link
    to: api
  - from: api
    to: cache
  - from: db
    to: ext
  - from: cache
    to: api
`;

const FR = `noeuds:
  - id: a # ca
    titre: A
    enfants:
      - id: b
  - id: c
liens:
  - de: b
    vers: c
`;

const load = (t) => jsyaml.load(t);
const ids = (t) => Model.parse(t).nodes.map((n) => n.id);
const parentOf = (t, id) => Model.parse(t).byId.get(id).parent;

function assertComments(text) {
  ["# top comment", "# the platform", "# trailing plat", "# api comment", "# web link"].forEach((c) => {
    assert.ok(text.includes(c), `commentaire perdu : ${c}`);
  });
}

test("addNode keeps comments, appends and inserts at index", () => {
  let t = DocEdit.addNode(SAMPLE, null, { id: "z", label: "Z" });
  assertComments(t);
  assert.deepStrictEqual(Model.parse(t).nodes.filter((n) => !n.parent).map((n) => n.id), ["plat", "web", "ext", "z"]);
  t = DocEdit.addNode(SAMPLE, "plat", { id: "mid" }, 1);
  assert.deepStrictEqual(Model.parse(t).byId.get("plat").children, ["api", "mid", "db"]);
  t = DocEdit.addNode(SAMPLE, "web", { id: "sub" });
  assert.strictEqual(parentOf(t, "sub"), "web");
  assert.throws(() => DocEdit.addNode(SAMPLE, null, { id: "web" }), /existe déjà/);
});

test("updateNode patches, null removes, meta merges", () => {
  let t = DocEdit.updateNode(SAMPLE, "api", { label: "API v2", type: "service", meta: { owner: "A" } });
  assertComments(t);
  const api = load(t).nodes[0].children[0];
  assert.deepStrictEqual([api.label, api.type, api.meta.owner], ["API v2", "service", "A"]);
  t = DocEdit.updateNode(t, "api", { type: null, meta: { owner: null, repo: "r" } });
  const api2 = load(t).nodes[0].children[0];
  assert.strictEqual(api2.type, undefined);
  assert.deepStrictEqual(api2.meta, { repo: "r" });
  assert.throws(() => DocEdit.updateNode(SAMPLE, "nope", { label: "x" }), /introuvable/);
});

test("french aliases are understood", () => {
  let t = DocEdit.updateNode(FR, "a", { label: "AA" });
  assert.ok(t.includes("titre: AA") && !t.includes("label:"));
  assert.ok(t.includes("# ca"));
  t = DocEdit.addNode(FR, "a", { id: "d" });
  assert.deepStrictEqual(Model.parse(t).byId.get("a").children, ["b", "d"]);
  assert.ok(t.includes("enfants:") && !t.includes("children:"));
  t = DocEdit.addLink(FR, { from: "a", to: "c" });
  assert.ok(t.includes("liens:") && !t.includes("links:"));
  assert.strictEqual(Model.parse(t).links.length, 2);
  const r = DocEdit.removeNodes(FR, ["b"], { relinkToParent: true });
  assert.deepStrictEqual(Model.parse(r.text).links.map((l) => [l.from, l.to]), [["a", "c"]]);
  assert.ok(!r.text.includes("enfants"));
  t = DocEdit.removeLinks(FR, [0]);
  assert.ok(!t.includes("liens"));
});

test("removeNodes without relink drops links and returns trash entries", () => {
  const { text, trashed } = DocEdit.removeNodes(SAMPLE, ["db"]);
  assert.deepStrictEqual(ids(text), ["plat", "api", "web", "ext"]);
  assert.deepStrictEqual(Model.parse(text).links.map((l) => `${l.from}>${l.to}`), ["web>api"]);
  assert.ok(text.includes("# web link") && text.includes("# api comment"));
  assert.strictEqual(trashed.length, 1);
  assert.strictEqual(trashed[0].parentId, "plat");
  assert.strictEqual(trashed[0].index, 1);
  assert.deepStrictEqual(trashed[0].ids, ["db", "cache"]);
  assert.strictEqual(trashed[0].links.length, 3);
});

test("removeNodes with relink: parent, drop on no ancestor or loop", () => {
  const { text } = DocEdit.removeNodes(SAMPLE, ["db"], { relinkToParent: true });
  const links = Model.parse(text).links.map((l) => `${l.from}>${l.to}`);
  assert.ok(links.includes("web>api"));
  assert.ok(links.includes("api>plat"));
  assert.ok(links.includes("plat>api"));
  assert.ok(!links.some((l) => l.includes("cache") || l.includes("db")));
  assert.ok(text.includes("relinkedFrom"));
  // db->ext becomes plat->ext
  assert.ok(links.includes("plat>ext"));
  // root node without ancestor: its links disappear
  const r = DocEdit.removeNodes(SAMPLE, ["ext"], { relinkToParent: true });
  assert.ok(!Model.parse(r.text).links.some((l) => l.to === "ext"));
  assert.strictEqual(r.trashed[0].links.length, 1);
  // loop: removing both ends under the same parent
  const loop = DocEdit.removeNodes(SAMPLE, ["api", "cache"], { relinkToParent: true });
  assert.ok(!Model.parse(loop.text).links.some((l) => l.from === l.to));
  assertComments(text);
});

test("removeNodes of several nodes, descendants collapse into the top-most", () => {
  const { text, trashed } = DocEdit.removeNodes(SAMPLE, ["db", "cache", "web"]);
  assert.strictEqual(trashed.length, 2);
  assert.deepStrictEqual(ids(text), ["plat", "api", "ext"]);
});

test("moveNode reparents, reorders, refuses own subtree", () => {
  let t = DocEdit.moveNode(SAMPLE, "cache", "web");
  assertComments(t);
  assert.strictEqual(parentOf(t, "cache"), "web");
  assert.strictEqual(parentOf(t, "db"), "plat");
  assert.ok(!load(t).nodes[0].children[1].children);
  t = DocEdit.moveNode(SAMPLE, "api", null, 0);
  assert.deepStrictEqual(Model.parse(t).nodes.filter((n) => !n.parent).map((n) => n.id), ["api", "plat", "web", "ext"]);
  assert.throws(() => DocEdit.moveNode(SAMPLE, "plat", "cache"), /sous-arbre/);
  assert.throws(() => DocEdit.moveNode(SAMPLE, "plat", "plat"), /sous-arbre/);
  assert.throws(() => DocEdit.moveNode(SAMPLE, "plat", "ghost"), /introuvable/);
});

test("reorder front/forward/backward/back among siblings", () => {
  const order = (t) => Model.parse(t).nodes.filter((n) => !n.parent).map((n) => n.id);
  assert.deepStrictEqual(order(DocEdit.reorder(SAMPLE, "plat", "front")), ["web", "ext", "plat"]);
  assert.deepStrictEqual(order(DocEdit.reorder(SAMPLE, "plat", "forward")), ["web", "plat", "ext"]);
  assert.deepStrictEqual(order(DocEdit.reorder(SAMPLE, "ext", "backward")), ["plat", "ext", "web"]);
  assert.deepStrictEqual(order(DocEdit.reorder(SAMPLE, "ext", "back")), ["ext", "plat", "web"]);
  assert.deepStrictEqual(order(DocEdit.reorder(SAMPLE, "ext", "front")), ["plat", "web", "ext"]);
  assertComments(DocEdit.reorder(SAMPLE, "web", "back"));
  assert.throws(() => DocEdit.reorder(SAMPLE, "web", "nope"), /inconnue/);
});

test("addLink / updateLink / removeLinks", () => {
  let t = DocEdit.addLink(SAMPLE, { from: "web", to: "ext", label: "x" });
  assertComments(t);
  assert.strictEqual(load(t).links.length, 5);
  t = DocEdit.updateLink(t, 4, { label: "y", to: "db" });
  assert.deepStrictEqual(load(t).links[4], { from: "web", to: "db", label: "y" });
  t = DocEdit.removeLinks(t, [0, 4]);
  assert.strictEqual(load(t).links.length, 3);
  const none = DocEdit.removeLinks(SAMPLE, [0, 1, 2, 3]);
  assert.ok(!none.includes("links:"));
  assert.ok(none.includes("# top comment"));
  const fresh = DocEdit.addLink("nodes:\n  - id: a\n  - id: b\n", { from: "a", to: "b" });
  assert.strictEqual(load(fresh).links.length, 1);
});

test("setTopLevel replaces, syncs and removes", () => {
  let t = DocEdit.setTopLevel(SAMPLE, "settings", { "edges.curve": "taxi" });
  assertComments(t);
  assert.deepStrictEqual(load(t).settings, { "edges.curve": "taxi" });
  t = DocEdit.setTopLevel(t, "settings", { "edges.curve": "bezier", "nodes.size": 1.2 });
  assert.deepStrictEqual(load(t).settings, { "edges.curve": "bezier", "nodes.size": 1.2 });
  t = DocEdit.setTopLevel(t, "settings", { "nodes.size": 1.2 });
  assert.deepStrictEqual(load(t).settings, { "nodes.size": 1.2 });
  t = DocEdit.setTopLevel(t, "settings", null);
  assert.strictEqual(load(t).settings, undefined);
  t = DocEdit.setTopLevel(FR, "style", { size: 2 });
  assert.strictEqual(load(t).style.size, 2);
});

test("trash push / restore puts node and links back", () => {
  const { text, trashed } = DocEdit.removeNodes(SAMPLE, ["db"]);
  const pushed = DocEdit.trashPush(text, trashed);
  assertComments(pushed);
  assert.strictEqual(load(pushed).trash.length, 1);
  assert.deepStrictEqual(ids(pushed), ["plat", "api", "web", "ext"]);
  const back = DocEdit.trashRestore(pushed, 0);
  assert.strictEqual(load(back).trash, undefined);
  assert.deepStrictEqual(ids(back), ["plat", "api", "db", "cache", "web", "ext"]);
  assert.deepStrictEqual(load(back).links, load(SAMPLE).links);
  assertComments(back);
});

test("trash restore undoes relinking and falls back to root", () => {
  const { text, trashed } = DocEdit.removeNodes(SAMPLE, ["db"], { relinkToParent: true });
  const pushed = DocEdit.trashPush(text, trashed);
  const back = DocEdit.trashRestore(pushed, 0);
  assert.deepStrictEqual(load(back).links, load(SAMPLE).links);
  assert.ok(!back.includes("relinkedFrom"));
  const both = DocEdit.removeNodes(SAMPLE, ["plat"]);
  const gone = DocEdit.trashPush(both.text, both.trashed);
  const entry = load(gone);
  assert.strictEqual(entry.trash[0].node.id, "plat");
  const orphan = DocEdit.removeNodes(SAMPLE, ["cache"]);
  const withoutParent = DocEdit.removeNodes(DocEdit.trashPush(orphan.text, orphan.trashed), ["plat"]).text;
  const restored = DocEdit.trashRestore(withoutParent, 0);
  assert.strictEqual(parentOf(restored, "cache"), null);
  assert.throws(() => DocEdit.trashRestore(SAMPLE, 0), /corbeille/);
});
