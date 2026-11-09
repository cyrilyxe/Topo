"use strict";

const test = require("node:test");
const assert = require("node:assert");
const Settings = require("../js/settings.js");

test("resolve: priority default < suggested < local < document", () => {
  const r = Settings.resolve({
    suggested: { "edges.curve": "taxi", "nodes.size": 1.2 },
    local: { "edges.curve": "straight" },
    document: { "edges.curve": "round-taxi" }
  });
  assert.strictEqual(r.values["edges.curve"], "round-taxi");
  assert.strictEqual(r.sources["edges.curve"], "document");
  assert.strictEqual(r.sources["nodes.size"], "suggested");
  assert.strictEqual(r.sources["tree.indent"], "default");
  const l = Settings.resolve({ suggested: { "edges.curve": "taxi" }, local: { "edges.curve": "straight" } });
  assert.strictEqual(l.sources["edges.curve"], "local");
});

test("invalid values are ignored, numbers clamped, nested keys flattened", () => {
  assert.strictEqual(Settings.coerce("edges.curve", "zigzag"), undefined);
  assert.strictEqual(Settings.coerce("nodes.size", 9), 1.6);
  assert.strictEqual(Settings.coerce("nodes.size", "1.2"), 1.2);
  assert.strictEqual(Settings.coerce("drop.repulsion", "yes"), undefined);
  assert.strictEqual(Settings.coerce("unknown", 1), undefined);
  assert.deepStrictEqual(Settings.flatten({ edges: { curve: "taxi", opacity: 0.5 }, "tree.indent": 40, bad: 1 }), { "edges.curve": "taxi", "edges.opacity": 0.5, "tree.indent": 40 });
});

test("documentSettings reads settings: and reglages:", () => {
  assert.deepStrictEqual(Settings.documentSettings("nodes: []\nsettings:\n  edges.curve: taxi\n"), { "edges.curve": "taxi" });
  assert.deepStrictEqual(Settings.documentSettings("reglages:\n  tree:\n    indent: 10\n"), { "tree.indent": 10 });
  assert.deepStrictEqual(Settings.documentSettings("nodes: []"), {});
});

test("store: get/set/unset/source/onChange", () => {
  const s = Settings.create();
  const events = [];
  s.onChange((keys) => events.push(keys));
  assert.strictEqual(s.get("edges.curve"), "bezier");
  s.setSuggested({ "edges.curve": "taxi" });
  assert.strictEqual(s.source("edges.curve"), "suggested");
  s.set("edges.curve", "straight");
  assert.strictEqual(s.get("edges.curve"), "straight");
  s.setDocument({ "edges.curve": "bezier" });
  assert.strictEqual(s.source("edges.curve"), "document");
  s.unset("edges.curve");
  assert.strictEqual(s.source("edges.curve"), "document");
  s.setDocument({});
  assert.strictEqual(s.get("edges.curve"), "taxi");
  assert.ok(events.length >= 4 && events.every((e) => e.includes("edges.curve")));
  assert.throws(() => s.set("edges.curve", "zigzag"), /invalide/);
  assert.strictEqual(s.all()["nodes.size"], 1);
});

test("document scope goes through the writer", () => {
  const s = Settings.create();
  let written = null;
  s.documentWriter = (obj) => { written = obj; };
  s.set("tree.indent", 40, "document");
  assert.deepStrictEqual(written, { "tree.indent": 40 });
  assert.strictEqual(s.get("tree.indent"), 28);
});

test("cleanup removes defaults, empty rules, false flags", () => {
  const raw = {
    settings: { "edges.curve": "bezier", "tree.indent": 40 },
    style: { size: 1, rules: [{ target: "a" }, { target: "b", highlight: false, color: "#fff" }, { cible: "c", masquer: false }] },
    view: { collapsed: [], layout: "fcose", zoom: 2 }
  };
  const c = Settings.cleanup(raw, Settings.defaults());
  assert.deepStrictEqual(c.settings, { "tree.indent": 40 });
  assert.deepStrictEqual(c.style, { rules: [{ target: "b", color: "#fff" }] });
  assert.deepStrictEqual(c.view, { zoom: 2 });
  assert.deepStrictEqual(Settings.cleanup({ nodes: [] }, Settings.defaults()), {});
});
