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

const leaf = (id, parent, x1, y1, x2, y2) => ({ id, parent, box: box(x1, y1, x2, y2) });
const group = (id, parent, pad = 32, ex = { t: 20 }) => ({ id, parent, pad, ex });

// Mirrors Repulsion.resolve to check the final geometry.
const finalBoxes = (nodes, id, shift) => {
  const moved = nodes.map((n) => (n.box && (n.id === id || n.parent === id) ? { ...n, box: box(n.box.x1 + shift.dx, n.box.y1 + shift.dy, n.box.x2 + shift.dx, n.box.y2 + shift.dy) } : n));
  const kids = (gid) => moved.filter((n) => n.parent === gid);
  const boxOf = (n) => {
    if (n.box) {
      return n.box;
    }

    const inner = Repulsion.union(kids(n.id).map(boxOf));
    const ex = n.ex || {};

    return box(inner.x1 - n.pad - (ex.l || 0), inner.y1 - n.pad - (ex.t || 0), inner.x2 + n.pad + (ex.r || 0), inner.y2 + n.pad + (ex.b || 0));
  };

  return new Map(moved.map((n) => [n.id, boxOf(n)]));
};

test("resolve: leaf dropped on a root group of another branch leaves it, ancestors included", () => {
  const nodes = [
    group("P", null), leaf("p1", "P", 0, 0, 100, 50), leaf("exe", "P", 20, 300, 120, 350),
    group("Q", null), leaf("q1", "Q", 0, 300, 140, 350)
  ];
  const result = Repulsion.resolve(nodes, "exe", { margin: 16 });
  const boxes = finalBoxes(nodes, "exe", result);

  assert.ok(result.ok);
  assert.ok(!Repulsion.overlaps(boxes.get("P"), boxes.get("Q")));
  assert.ok(!Repulsion.overlaps(boxes.get("exe"), boxes.get("q1")));
});

test("resolve: no conflict leaves the node in place", () => {
  const nodes = [group("P", null), leaf("a", "P", 0, 0, 100, 50), leaf("b", "P", 0, 80, 100, 130), leaf("z", null, 400, 0, 500, 50)];

  assert.deepStrictEqual(Repulsion.resolve(nodes, "b"), { dx: 0, dy: 0, ok: true });
});

test("resolve: a dropped group clears roots at any level", () => {
  const nodes = [
    group("A", null), leaf("a1", "A", 0, 0, 100, 50),
    group("B", null), group("B1", "B", 20), leaf("b1", "B1", 300, 0, 400, 50),
    leaf("a2", "A", 305, 10, 395, 40)
  ];
  const result = Repulsion.resolve(nodes, "a2", { margin: 16 });
  const boxes = finalBoxes(nodes, "a2", result);

  assert.ok(result.ok);
  assert.ok(!Repulsion.overlaps(boxes.get("A"), boxes.get("B")));
});

test("resolve: impossible drop reports failure", () => {
  const nodes = [leaf("d", null, 0, 0, 100, 50), leaf("w", null, -1000, -1000, 1000, 1000)];
  const result = Repulsion.resolve(nodes, "d", { margin: 16 });

  assert.ok(result.ok || (!result.dx && !result.dy));
});
