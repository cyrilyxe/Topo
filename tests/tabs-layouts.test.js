"use strict";

const test = require("node:test");
const assert = require("node:assert");
const YAML = require("../vendor/yaml.js");
const Layouts = require("../js/layouts.js");
const Tabs = require("../js/tabs.js");

const DOC = `# top comment
title: Demo

nodes:
  # the platform
  - id: plat # trailing
    label: Plateforme
    children:
      - id: api
  - id: web

view:
  zoom: 1.5
  layout: fcose
`;

const entry = (x) => Layouts.capture({ positions: { api: { x, y: 2 }, web: { x: 5, y: 6 } }, collapsed: ["plat"], zoom: 1, pan: { x: 3, y: 4 }, layout: "grid" }, new Date("2026-01-01T00:00:00Z"));

test("capture keeps the view fields and stamps savedAt", () => {
  const e = entry(1);
  assert.deepStrictEqual(e.collapsed, ["plat"]);
  assert.strictEqual(e.layout, "grid");
  assert.strictEqual(e.savedAt, "2026-01-01T00:00:00.000Z");
});

test("save creates view.layouts, keeps comments and other view keys", () => {
  const text = Layouts.save(DOC, "A", entry(1));
  assert.ok(text.includes("# top comment") && text.includes("# the platform") && text.includes("# trailing"));
  const view = YAML.parse(text).view;
  assert.strictEqual(view.zoom, 1.5);
  assert.strictEqual(view.layout, "fcose");
  assert.deepStrictEqual(Layouts.list(text), ["A"]);
  assert.deepStrictEqual(view.layouts.A.positions.api, { x: 1, y: 2 });
});

test("save creates the view block when missing, update overwrites", () => {
  const bare = "title: T\nnodes:\n  - id: a\n";
  let text = Layouts.save(bare, "A", entry(1));
  text = Layouts.save(text, "B", entry(2));
  text = Layouts.save(text, "A", entry(9));
  assert.deepStrictEqual(Layouts.list(text), ["A", "B"]);
  assert.strictEqual(Layouts.readAll(text).A.positions.api.x, 9);
});

test("rename keeps order and refuses duplicates", () => {
  let text = Layouts.save(Layouts.save(DOC, "A", entry(1)), "B", entry(2));
  text = Layouts.rename(text, "A", "Z");
  assert.deepStrictEqual(Layouts.list(text), ["Z", "B"]);
  assert.throws(() => Layouts.rename(text, "Z", "B"), /existe déjà/);
  assert.throws(() => Layouts.rename(text, "nope", "X"), /introuvable/);
  assert.throws(() => Layouts.save(text, "  ", entry(1)), /vide/);
});

test("remove deletes one layout, then the whole view block when it becomes empty", () => {
  const bare = "title: T\n\nnodes:\n  - id: a\n";
  let text = Layouts.save(Layouts.save(bare, "A", entry(1)), "B", entry(2));
  text = Layouts.remove(text, "A");
  assert.deepStrictEqual(Layouts.list(text), ["B"]);
  text = Layouts.remove(text, "B");
  assert.strictEqual(YAML.parse(text).view, undefined);
  assert.ok(text.includes("title: T"));
  const kept = Layouts.remove(Layouts.save(DOC, "A", entry(1)), "A");
  assert.strictEqual(YAML.parse(kept).view.zoom, 1.5);
  assert.strictEqual(YAML.parse(kept).view.layouts, undefined);
});

test("differs ignores zoom/pan but sees moves, folds and layout", () => {
  const e = entry(1);
  const same = { positions: { api: { x: 1, y: 2 }, web: { x: 5, y: 6 } }, collapsed: ["plat"], layout: "grid", zoom: 9 };
  assert.strictEqual(Layouts.differs(e, same), false);
  assert.strictEqual(Layouts.differs(e, { ...same, positions: { ...same.positions, api: { x: 50, y: 2 } } }), true);
  assert.strictEqual(Layouts.differs(e, { ...same, collapsed: [] }), true);
  assert.strictEqual(Layouts.differs(e, { ...same, layout: "fcose" }), true);
});

test("tab storage keeps name, text, dirty, view and drops handle / history", () => {
  const tabs = [
    { id: "a", name: "x.yaml", text: "title: X\n", dirty: true, view: { zoom: 2, positions: { a: { x: 1, y: 2 } } }, handle: { fake: 1 }, history: { past: [1] } },
    { id: "b", name: null, text: "title: Y\n", dirty: false, view: null }
  ];
  const raw = Tabs.serialize(tabs, "b");
  assert.ok(!raw.includes("fake") && !raw.includes("past"));
  const back = Tabs.parseStored(raw);
  assert.strictEqual(back.active, "b");
  assert.strictEqual(back.tabs.length, 2);
  assert.deepStrictEqual(back.tabs[0].view, tabs[0].view);
  assert.strictEqual(back.tabs[0].handle, null);
  assert.strictEqual(back.tabs[0].savedText, null);
  assert.strictEqual(back.tabs[1].savedText, undefined);
});

test("parseStored rejects garbage and repairs ids / active", () => {
  assert.strictEqual(Tabs.parseStored("nope"), null);
  assert.strictEqual(Tabs.parseStored(JSON.stringify({ tabs: [] })), null);
  const back = Tabs.parseStored(JSON.stringify({ active: "zzz", tabs: [{ id: "a", text: "t" }, { id: "a", text: "u" }, { text: 3 }] }));
  assert.strictEqual(back.tabs.length, 2);
  assert.notStrictEqual(back.tabs[0].id, back.tabs[1].id);
  assert.strictEqual(back.active, back.tabs[0].id);
});

test("tab ordering helpers and blank detection", () => {
  assert.strictEqual(Tabs.neighborAfterClose(["a", "b", "c"], "b"), "c");
  assert.strictEqual(Tabs.neighborAfterClose(["a", "b", "c"], "c"), "b");
  assert.strictEqual(Tabs.neighborAfterClose(["a"], "a"), null);
  assert.strictEqual(Tabs.stepId(["a", "b", "c"], "c", 1), "a");
  assert.strictEqual(Tabs.stepId(["a", "b", "c"], "a", -1), "c");
  const starters = ["title: N\n"];
  assert.strictEqual(Tabs.isBlank({ text: "title: N", dirty: false }, starters), true);
  assert.strictEqual(Tabs.isBlank({ text: "title: N", dirty: true }, starters), false);
  assert.strictEqual(Tabs.isBlank({ text: "title: N", name: "f.yaml" }, starters), false);
  assert.strictEqual(Tabs.isBlank({ text: "other" }, starters), false);
});
