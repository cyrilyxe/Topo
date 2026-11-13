"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Style = require("../js/style.js");
const Settings = require("../js/settings.js");

global.Style = Style;
global.escapeHtml = (s) => String(s);

const Forms = require("../js/forms.js");
const Model = require("../js/model.js");

const YAML_TEXT = `
nodes:
  - id: a
    meta: { owner: Ana, status: en cours, show: [owner], source: x.yaml }
  - id: b
    meta: { status: en cours, owner: Bob }
  - id: c
    meta: { status: à confirmer, custom: 1 }
links:
  - { from: a, to: b, type: async, label: events }
  - { from: a, to: c, type: async, label: events, style: { width: 4 } }
  - { from: b, to: c, type: sync }
style:
  links:
    async: { color: "#7c3aed", line: dotted, width: 2 }
    legacy: { color: "#111111" }
`;

test("link type is parsed and style.links kept by the model", () => {
  const model = Model.parse(YAML_TEXT);

  assert.deepEqual(model.links.map((l) => l.type), ["async", "async", "sync"]);
  assert.equal(model.style.links.async.line, "dotted");
});

test("linkStyle merges default < style.links[type] < links[].style", () => {
  const model = Model.parse(YAML_TEXT);

  assert.deepEqual(Style.linkStyle(model.links[0], model.style), { color: "#7c3aed", line: "dotted", width: 2 });
  assert.deepEqual(Style.linkStyle(model.links[1], model.style), { color: "#7c3aed", line: "dotted", width: 4 });
  assert.deepEqual(Style.linkStyle(model.links[2], model.style), {});
  assert.deepEqual(Style.linkStyle({ from: "a", to: "b", style: { color: "#fff" } }, model.style), { color: "#fff" });
  assert.deepEqual(Style.linkStyle({ type: "constructor" }, { links: {} }), {});
  assert.deepEqual(Style.linkStyle({ type: "async" }, { links: { async: { width: 99, color: "nope", arrow: "vee" } } }), { arrow: "vee" });
});

test("applyLinkStyles puts the merged style on the edge", () => {
  global.Model = Model;

  const model = Model.parse(YAML_TEXT);
  const elements = Model.buildElements(model, new Set());

  {
    Style.applyLinkStyles(elements, model);
    const edge = elements.find((e) => e.group === "edges" && e.data.source === "a" && e.data.target === "b");

    assert.equal(edge.data.linkStyle.color, "#7c3aed");
  }
});

test("linkTypes counts used types, most used first", () => {
  assert.deepEqual(Style.linkTypes(Model.parse(YAML_TEXT)), [{ name: "async", count: 2 }, { name: "sync", count: 1 }]);
});

test("metaSuggestions: project keys by frequency, then presets, no reserved keys", () => {
  const model = Model.parse(YAML_TEXT);
  const s = Forms.metaSuggestions(model, ["owner", "repo", "show", "doc", "links", "card", "sourceId"]);

  assert.deepEqual(s.keys, ["status", "owner", "custom", "repo", "doc"]);
  assert.deepEqual(s.values.status, ["en cours", "à confirmer"]);
  assert.deepEqual(s.values.owner, ["Ana", "Bob"]);
  assert.equal(s.values.show, undefined);
});

test("metaSuggestions falls back to the meta.keys default and handles an empty model", () => {
  global.Settings = Settings;

  const s = Forms.metaSuggestions({ nodes: [] });

  assert.deepEqual(s.keys, ["owner", "status", "path", "repo", "version", "environment", "todo", "doc"]);
  assert.deepEqual(Forms.metaSuggestions(null, []).keys, []);
});

test("linkSuggestions: used types then styled-only types, labels by frequency", () => {
  const s = Forms.linkSuggestions(Model.parse(YAML_TEXT));

  assert.deepEqual(s.types, ["async", "sync", "legacy"]);
  assert.deepEqual(s.labels, ["events"]);
});

test("settings meta.keys and links.multi: defaults, coercion, document override", () => {
  assert.equal(Settings.defaults()["links.multi"], false);
  assert.deepEqual(Settings.coerce("meta.keys", "a, b,a,, c"), ["a", "b", "c"]);
  assert.equal(Settings.coerce("meta.keys", 5), undefined);

  const { values, sources } = Settings.resolve({ document: Settings.flatten({ "meta.keys": ["x"], "links.multi": true }) });

  assert.deepEqual(values["meta.keys"], ["x"]);
  assert.equal(values["links.multi"], true);
  assert.equal(sources["meta.keys"], "document");
});

const DocEdit = require("../js/doc-edit.js");

const BASE = "# carte\nnodes:\n  - id: a\n  - id: b\n  - id: c\nlinks:\n  - { from: a, to: b }\n";

test("addLinks: pairs with type, label and style going into style.links[type]", () => {
  const next = DocEdit.addLinks(BASE, [{ from: "a", to: "c" }, { from: "b", to: "c" }, { from: "a", to: "c" }], { type: "async", label: "ev", style: { line: "dotted", color: "#ff0000" } });
  const model = Model.parse(next);

  assert.ok(next.startsWith("# carte"));
  assert.equal(model.links.length, 3);
  assert.ok(model.links.slice(1).every((l) => l.type === "async" && l.label === "ev" && Object.keys(l.style).length === 0));
  assert.deepEqual(model.style.links.async, { line: "dotted", color: "#ff0000" });
});

test("addLinks: without type the style goes on each link; without style no style block", () => {
  const styled = Model.parse(DocEdit.addLinks(BASE, [{ from: "a", to: "c" }, { from: "b", to: "c" }], { style: { width: 4 } }));

  assert.deepEqual(styled.links.slice(1).map((l) => l.style), [{ width: 4 }, { width: 4 }]);
  assert.equal(styled.style.links, undefined);

  const plain = DocEdit.addLinks(BASE, [{ from: "a", to: "c" }], {});

  assert.ok(!/style:/.test(plain));
  assert.equal(DocEdit.addLinks(BASE, [], {}), BASE);
});

test("addLinks: merges with an existing style.links entry and keeps other style blocks", () => {
  const text = `${BASE}style:\n  roles:\n    r: { color: "#111111" }\n  links:\n    async: { width: 3 }\n`;
  const model = Model.parse(DocEdit.addLinks(text, [{ from: "a", to: "c" }], { type: "async", style: { line: "dashed" } }));

  assert.deepEqual(model.style.links.async, { width: 3, line: "dashed" });
  assert.equal(model.style.roles.r.color, "#111111");
});
