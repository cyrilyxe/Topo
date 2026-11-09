"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Schema = require("../js/schema.js");
const Model = require("../js/model.js");
const Merge = require("../js/merge.js");

const LEGACY = `titre: Ancien
noeuds:
  - id: p
    titre: Plateforme
    meta:
      afficher: [r]
      r: Équipe
    enfants:
      - id: api
      - id: db
  - id: web
liens:
  - de: web
    vers: api
    label: http
  - de: api
    vers: db
presentation:
  taille: 2
  regles:
    - cible: api
      couleur: "#f00"
      masquer: true
    - cible: ghost
vue:
  replies: [p]
`;

function demoFiles() {
  const root = path.join(__dirname, "..", "examples", "demo-project");
  const out = [];
  const walk = (abs, rel) => {
    fs.readdirSync(abs, { withFileTypes: true }).forEach((e) => {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), p);
      else if (Merge.isBrickFile(p)) out.push({ path: p, text: fs.readFileSync(path.join(abs, e.name), "utf8") });
    });
  };
  walk(root, "");
  return out;
}

test("normalize converts French keys at every level", () => {
  const n = Schema.normalize(require("js-yaml").load(LEGACY));
  assert.equal(n.title, "Ancien");
  assert.equal(n.nodes[0].label, "Plateforme");
  assert.deepEqual(n.nodes[0].meta.show, ["r"]);
  assert.equal(n.nodes[0].children.length, 2);
  assert.equal(n.links[0].from, "web");
  assert.equal(n.style.size, 2);
  assert.equal(n.style.rules[0].target, "api");
  assert.equal(n.style.rules[0].hidden, true);
  assert.deepEqual(n.view.collapsed, ["p"]);
});

test("parse accepts legacy French YAML and old default-like content", () => {
  const m = Model.parse(LEGACY);
  assert.equal(m.nodes.length, 4);
  assert.equal(m.links.length, 2);
  assert.deepEqual(m.view.collapsed, ["p"]);
  assert.equal(m.style.rules.length, 1);
  assert.ok(m.anomalies.some((a) => a.code === "obsolete-style-rule"));
  assert.equal(m.byId.get("api").parent, "p");
});

test("DEFAULT_YAML parses without anomalies", () => {
  const m = Model.parse(Model.DEFAULT_YAML);
  assert.equal(m.anomalies.length, 0);
  assert.equal(m.links.length, 6);
  assert.equal(Model.pathLabel("api", m), "Plateforme › Exécution › API");
});

test("parse throws only on syntax problems", () => {
  assert.throws(() => Model.parse("nodes:\n\t- id: a"), /Tabulation/);
  assert.throws(() => Model.parse("title: x"), /nodes/);
});

test("resolveRef: qualified, suffix, ambiguous, unknown", () => {
  const m = Model.parse(`nodes:
  - id: a
    children:
      - id: resources
      - id: x
  - id: b
    children:
      - id: resources
      - id: y
        children: [{ id: leaf }]
`);
  assert.equal(Model.resolveRef("a.resources", m).id, "a.resources");
  assert.equal(Model.resolveRef("y.leaf", m).id, "leaf");
  assert.equal(Model.resolveRef("leaf", m).id, "leaf");
  assert.equal(Model.resolveRef("resources", m, "x").id, "a.resources");
  const amb = Model.resolveRef("resources", m);
  assert.equal(amb.error, "ambiguous");
  assert.deepEqual(amb.candidates.sort(), ["a.resources", "b.resources"]);
  const unk = Model.resolveRef("leef", m);
  assert.equal(unk.error, "unknown");
  assert.deepEqual(unk.candidates, ["b.y.leaf"]);
});

test("buildElements collapses into meta edges with counts", () => {
  const m = Model.parse(Model.DEFAULT_YAML);
  const els = Model.buildElements(m, new Set(["donnees"]));
  assert.ok(!els.some((e) => e.data.id === "cache"));
  const edge = els.find((e) => e.group === "edges" && e.data.target === "donnees");
  assert.equal(edge.data.count, 2);
  assert.equal(edge.data.isMeta, true);
  assert.match(edge.data.label, /×2/);
  assert.equal(edge.classes, "meta");
  const g = els.find((e) => e.data.id === "donnees");
  assert.match(g.classes, /group collapsed/);
});

test("toMermaid uses subgraphs", () => {
  const out = Model.toMermaid(Model.parse(Model.DEFAULT_YAML));
  assert.match(out, /subgraph n_plateforme/);
  assert.match(out, /n_web -->\|"requêtes HTTPS"\| n_api/);
});

test("replaceTopLevelBlock replaces, adds and removes", () => {
  const text = "# top\ntitle: T\n\nnodes:\n  - id: a # keep\n\nvue:\n  replies: [a]\n# tail\nlinks: []\n";
  const replaced = Model.replaceTopLevelBlock(text, "view", { collapsed: ["a"], zoom: 2 });
  assert.match(replaced, /^# top\ntitle: T/);
  assert.match(replaced, /- id: a # keep/);
  assert.match(replaced, /view:\n {2}collapsed:\n {4}- a\n {2}zoom: 2\n# tail\nlinks: \[\]/);
  assert.ok(!/vue:/.test(replaced));
  const added = Model.replaceTopLevelBlock("title: T\nnodes: []\n", "view", { zoom: 1 });
  assert.equal(added, "title: T\nnodes: []\n\nview:\n  zoom: 1\n");
  const removed = Model.replaceTopLevelBlock(replaced, "view", null);
  assert.ok(!/view:/.test(removed));
  assert.match(removed, /# tail/);
  assert.equal(Model.findNodeLine(text, "a"), 4);
  assert.equal(Model.findNodeLine(text, "zzz"), -1);
});

test("mergeProject on demo project", () => {
  const { document, anomalies } = Merge.mergeProject(demoFiles());
  assert.equal(document.title, "Architecture de démonstration");
  const model = Model.parse(Merge.toYaml(document));
  const art = model.byId.get("resources-js");
  assert.equal(art.label, "Artefact");
  assert.equal(art.meta.source, "resources-js/brick.yaml");
  assert.ok(model.byId.has("platform.data.resources"));
  assert.ok(model.byId.has("clients.resources"));
  assert.equal(model.byId.get("api").meta.source, "platform/execution/brick.yaml");

  const amb = anomalies.find((a) => a.code === "ambiguous-ref");
  assert.ok(amb);
  assert.ok(amb.candidates.length >= 2 && amb.candidates.length <= 3);
  assert.equal(amb.candidates[0], "platform.data.resources");
  assert.equal(amb.fixes[0].file, "platform/execution/brick.yaml");
  assert.match(amb.message, /ambigu/);

  const unk = anomalies.find((a) => a.code === "unknown-ref");
  assert.ok(unk);
  assert.equal(unk.candidates[0], "platform.data.database");
  assert.equal(model.anomalies.filter((a) => a.level === "error").length, 0);
});

test("applyFix preserves comments, quotes and French keys", () => {
  const text = `links:
  - from: api # who
    to: "resources"  # keep me
  - de: web
    vers: 'resources'
  - { from: a, to: resources }
`;
  const a = Merge.applyFix(text, { key: "to", oldRef: "resources", newRef: "x.resources" });
  assert.match(a, /to: "x.resources"  # keep me/);
  assert.match(a, /vers: 'x.resources'/);
  assert.match(a, /to: x.resources }/);
  assert.match(a, /from: api # who/);
  const b = Merge.applyFix(text, { key: "from", oldRef: "web", newRef: "clients.web" });
  assert.match(b, /de: clients.web/);
  assert.equal(Merge.applyFix(text, { key: "to", oldRef: "nope", newRef: "z" }), text);
});
