"use strict";

const test = require("node:test");
const assert = require("node:assert");
const DocEdit = require("../js/doc-edit.js");
const Model = require("../js/model.js");

const SAMPLE = `title: Demo
nodes:
  - id: a
  - id: b
  - id: c
links:
  - { from: a, to: b, type: sync }
  - { from: c, to: b }
`;

test("DocEdit.updateLink writes fromSide / toSide, then removes them with null", () => {
  const written = DocEdit.updateLink(SAMPLE, 0, { fromSide: "top", toSide: "left" });
  const model = Model.parse(written);

  assert.equal(model.links[0].fromSide, "top");
  assert.equal(model.links[0].toSide, "left");
  assert.equal(model.links[1].fromSide, undefined);

  const cleared = DocEdit.updateLink(written, 0, { fromSide: null, toSide: null });

  assert.ok(!/fromSide|toSide/.test(cleared));
  assert.equal(Model.parse(cleared).links[0].fromSide, undefined);
});

test("an invalid or auto side is ignored by the model", () => {
  const text = SAMPLE.replace("type: sync }", "type: sync, fromSide: auto, toSide: diagonal }");
  const link = Model.parse(text).links[0];

  assert.equal(link.fromSide, undefined);
  assert.equal(link.toSide, undefined);
});

test("Model.buildElements carries the anchors on the edge data", () => {
  const model = Model.parse(DocEdit.updateLink(SAMPLE, 1, { toSide: "bottom" }));
  const edge = Model.buildElements(model, new Set()).find((e) => e.group === "edges" && e.data.id === "c=>b");

  assert.equal(edge.data.toSide, "bottom");
  assert.equal(edge.data.fromSide, "");
});

test("Model.sideEndpoint maps a side to a Cytoscape endpoint", () => {
  assert.equal(Model.sideEndpoint("top"), "0% -50%");
  assert.equal(Model.sideEndpoint("bottom"), "0% 50%");
  assert.equal(Model.sideEndpoint("left"), "-50% 0%");
  assert.equal(Model.sideEndpoint("right"), "50% 0%");
  assert.equal(Model.sideEndpoint("top", 0.25), "25% -50%");
  assert.equal(Model.sideEndpoint("left", -0.25), "-50% -25%");
  assert.equal(Model.sideEndpoint("auto"), null);
  assert.equal(Model.sideEndpoint(undefined), null);
});

test("Model.spreadOffsets gives distinct, centred, evenly spaced points", () => {
  assert.deepEqual(Model.spreadOffsets(0), []);
  assert.deepEqual(Model.spreadOffsets(1), [0]);

  const three = Model.spreadOffsets(3);

  assert.equal(new Set(three).size, 3);
  assert.ok(Math.abs(three[0] + three[2]) < 1e-9);
  assert.ok(three.every((x) => Math.abs(x) <= 0.5));
});

test("DocEdit.addLinks perLink keeps the style on the link instead of style.links[type]", () => {
  const text = DocEdit.addLinks(SAMPLE, [{ from: "a", to: "c" }], { type: "sync", label: "x", style: { width: 4 }, perLink: true });
  const model = Model.parse(text);

  assert.equal(model.links[2].style.width, 4);
  assert.ok(!(model.style && model.style.links && model.style.links.sync));
});
