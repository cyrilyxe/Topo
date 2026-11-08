"use strict";

const test = require("node:test");
const assert = require("node:assert");
const Repulsion = require("../js/repulsion.js");

const leaf = (id, x1, y1, x2, y2, parent = null) => ({ id, parent, box: { x1, y1, x2, y2 } });
const group = (id, parent = null) => ({ id, parent, pad: 10, ex: { l: 0, t: 20, r: 0, b: 0 } });

test("settle: new brick at the click against a lighter leaf moves the other one", () => {
  const tree = [leaf("a", 0, 0, 100, 50), leaf("fresh", 90, 0, 190, 50)];
  const out = Repulsion.settleBoxes(tree, ["fresh"], { newIds: ["fresh"] });

  assert.deepStrictEqual(Object.keys(out), ["a"]);
});

test("settle: new brick moves itself when the other box is heavier", () => {
  const tree = [group("g"), leaf("c1", 0, 0, 100, 50, "g"), leaf("c2", 0, 100, 100, 150, "g"), leaf("fresh", 90, 0, 190, 50)];
  const out = Repulsion.settleBoxes(tree, ["fresh"], { newIds: ["fresh"] });

  assert.deepStrictEqual(Object.keys(out), ["fresh"]);
});

test("settle: heavy group that grew pushes the lighter leaf", () => {
  const tree = [group("g"), leaf("c1", 0, 0, 100, 50, "g"), leaf("c2", 0, 70, 100, 120, "g"), leaf("x", 100, 0, 200, 50)];
  const out = Repulsion.settleBoxes(tree, ["g"]);

  assert.deepStrictEqual(Object.keys(out), ["x"]);
  assert.ok(!Repulsion.settleBoxes(tree.map((n) => (n.id === "x" ? { ...n, box: { x1: out.x.dx + 100, y1: out.x.dy, x2: out.x.dx + 200, y2: out.x.dy + 50 } } : n)), ["g"]).x);
});

test("settle: chain of three propagates", () => {
  const tree = [leaf("a", 0, 0, 100, 50), leaf("b", 100, 0, 200, 50), leaf("c", 220, 0, 320, 50), leaf("d", 340, 0, 440, 50)];
  const out = Repulsion.settleBoxes(tree, ["a"], { direction: "right" });

  assert.ok(out.b && out.c && out.d);
  assert.ok(out.b.dx > 0 && out.c.dx > 0 && out.d.dx > 0);
  assert.ok(!out.a);
});

test("settle: forced direction right", () => {
  const tree = [leaf("a", 0, 0, 100, 50), leaf("b", 90, 40, 190, 90)];
  const out = Repulsion.settleBoxes(tree, ["a"], { direction: "right" });

  assert.strictEqual(out.b.dy, 0);
  assert.strictEqual(out.b.dx, 100 + 16 - 90);
});

test("settle: no overlap, no move", () => {
  const tree = [leaf("a", 0, 0, 100, 50), leaf("b", 200, 0, 300, 50)];

  assert.deepStrictEqual(Repulsion.settleBoxes(tree, ["a"]), {});
});
