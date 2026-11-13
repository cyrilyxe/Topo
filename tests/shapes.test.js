"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Shapes = require("../js/shapes.js");
const Style = require("../js/style.js");
const Exporters = require("../js/exporters.js");

const EXPECTED = ["file", "folder", "cloud", "document", "cylinder-h", "arrow", "chevron", "shield", "speech", "ticket", "house"];

test("registry lists the custom shapes", () => {
  EXPECTED.forEach((name) => {
    assert.ok(Shapes.names().includes(name), name);
    assert.ok(Shapes.isCustom(name));
    assert.ok(Shapes.label(name));
  });
  assert.equal(Shapes.isCustom("hexagon"), false);
  assert.equal(Shapes.isCustom("toString"), false);
});

test("points are valid pairs within -1..1 with at least 3 points", () => {
  Shapes.names().forEach((name) => {
    const nums = Shapes.points(name).split(" ").map(Number);

    assert.ok(nums.every((n) => Number.isFinite(n) && n >= -1 && n <= 1), name);
    assert.equal(nums.length % 2, 0, name);
    assert.ok(nums.length / 2 >= 3, name);
  });
  assert.ok(Shapes.points("cloud").split(" ").length / 2 >= 30);
  assert.equal(Shapes.points("hexagon"), null);
});

test("cytoscapeStyle: polygon for custom shapes, passthrough for native ones", () => {
  const custom = Shapes.cytoscapeStyle("cloud");

  assert.equal(custom.shape, "polygon");
  assert.equal(custom["shape-polygon-points"], Shapes.points("cloud"));
  assert.deepEqual(Shapes.cytoscapeStyle("hexagon"), { shape: "hexagon" });
});

test("drawio mapping", () => {
  assert.match(Shapes.drawio("cloud"), /shape=cloud/);
  assert.match(Shapes.drawio("document"), /shape=document/);
  assert.match(Shapes.drawio("file"), /shape=note/);
  assert.match(Shapes.drawio("folder"), /shape=folder/);
  assert.match(Shapes.drawio("cylinder-h"), /shape=cylinder3;direction=south/);
  assert.match(Shapes.drawio("arrow"), /shape=singleArrow/);
  assert.match(Shapes.drawio("chevron"), /shape=step/);
  assert.match(Shapes.drawio("speech"), /shape=callout/);
  assert.match(Shapes.drawio("house"), /rounded=1/);
  assert.equal(Shapes.drawio("hexagon"), null);
});

test("Style accepts custom shapes and ignores unknown ones", () => {
  assert.equal(Style.clean({ shape: "cloud" }).shape, "cloud");
  assert.equal(Style.clean({ shape: "blob" }).shape, undefined);
});

test("svg preview is generated from the points", () => {
  assert.match(Shapes.svg("folder"), /<polygon points="/);
  assert.match(Shapes.pickerHtml("cloud"), /data-shape-pick="cloud"/);
});

test("drawio export of a cloud brick, plantuml and mermaid mapping", () => {
  const scene = {
    nodes: [{ id: "x", label: "Ext", type: "external", role: "", parent: null, group: false, collapsed: false, x: 0, y: 0, w: 170, h: 42, fill: "#2563eb", fillAlpha: 1, stroke: "", strokeWidth: 0, text: "#fff", dashed: false, shape: "cloud", opacity: 1 }],
    edges: []
  };

  assert.match(Exporters.toDrawio(scene, { title: "t" }), /ellipse;shape=cloud/);
  assert.match(Exporters.toPlantUml(scene, {}), /cloud "Ext" as/);
  assert.match(Exporters.toMermaid(scene), /\(\["Ext"\]\)/);
});
