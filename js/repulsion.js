"use strict";

// Drop repulsion: a dropped box slides to the nearest free spot among its siblings.
const Repulsion = {
  MARGIN: 16,
  DURATION: 150,

  // Boxes are { x1, y1, x2, y2 }.
  overlaps(a, b, margin = 0) {
    const eps = 0.01;

    return a.x1 < b.x2 + margin - eps && a.x2 > b.x1 - margin + eps &&
      a.y1 < b.y2 + margin - eps && a.y2 > b.y1 - margin + eps;
  },

  // Pure: returns the smallest { dx, dy } that frees `box` from `others` (zero when nothing overlaps).
  findFreeShift(box, others, margin = this.MARGIN) {
    if (!others.some((other) => this.overlaps(box, other))) {
      return { dx: 0, dy: 0 };
    }

    const candidates = [];

    others.forEach((other) => {
      candidates.push(
        { dx: other.x2 + margin - box.x1, dy: 0 },
        { dx: other.x1 - margin - box.x2, dy: 0 },
        { dx: 0, dy: other.y2 + margin - box.y1 },
        { dx: 0, dy: other.y1 - margin - box.y2 }
      );
    });

    const free = candidates
      .filter((shift) => {
        const moved = { x1: box.x1 + shift.dx, x2: box.x2 + shift.dx, y1: box.y1 + shift.dy, y2: box.y2 + shift.dy };

        return !others.some((other) => this.overlaps(moved, other, margin));
      })
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));

    return free[0] || { dx: 0, dy: 0 };
  },

  boxOf(node) {
    const box = node.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });

    return { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
  },

  // Moves `node` (and its descendants) clear of its siblings; calls onDone(moved) when finished.
  apply(node, onDone) {
    if (node.hasClass("meta-card") && !node.data("free")) {
      onDone?.(false);
      return;
    }

    const parent = node.data("parent") || null;
    const others = node.cy().nodes()
      .filter((item) => item.id() !== node.id() && !item.hasClass("meta-card") && (item.data("parent") || null) === parent)
      .map((item) => this.boxOf(item));

    const shift = this.findFreeShift(this.boxOf(node), others, this.MARGIN);

    if (!shift.dx && !shift.dy) {
      onDone?.(false);
      return;
    }

    const leaves = node.isParent() ? node.descendants().filter((item) => !item.isParent()) : node;
    let pending = leaves.length;

    leaves.forEach((leaf) => {
      leaf.animate(
        { position: { x: leaf.position("x") + shift.dx, y: leaf.position("y") + shift.dy } },
        {
          duration: this.DURATION,
          complete: () => {
            pending -= 1;

            if (pending === 0) {
              onDone?.(true);
            }
          }
        }
      );
    });
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = Repulsion;
}
