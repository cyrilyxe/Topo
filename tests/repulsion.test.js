"use strict";

const test = require("node:test");
const assert = require("node:assert");
const Repulsion = require("../js/repulsion.js");

const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const free = (a, others) => Repulsion.findFreeShift(a, others, 16);

test("no overlap: no shift", () => {
  assert.deepStrictEqual(free(box(0, 0, 100, 50), [box(200, 0, 300, 50)]), { dx: 0, dy: 0 });
});

test("sibling on the right: pushed left or vertically by the minimal amount", () => {
  const shift = free(box(80, 0, 180, 50), [box(100, 0, 200, 50)]);

  assert.deepStrictEqual(shift, { dx: 0, dy: 66 - 0 });
});

test("group box with children against a sibling: minimal axis move", () => {
  const shift = free(box(0, 0, 300, 200), [box(250, 20, 400, 80)]);

  assert.strictEqual(shift.dy, 0);
  assert.strictEqual(shift.dx, -66);
});

test("surrounded: result is clear of every sibling with margin", () => {
  const others = [box(100, 0, 200, 50), box(0, 66, 100, 116), box(-116, 0, -16, 50), box(0, -66, 100, -16)];
  const a = box(10, 10, 110, 60);
  const shift = free(a, others);
  const moved = box(a.x1 + shift.dx, a.y1 + shift.dy, a.x2 + shift.dx, a.y2 + shift.dy);

  assert.ok(shift.dx || shift.dy);
  assert.ok(!others.some((other) => Repulsion.overlaps(moved, other, 16)));
});
