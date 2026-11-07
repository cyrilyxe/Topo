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

  union(boxes) {
    return {
      x1: Math.min(...boxes.map((b) => b.x1)),
      y1: Math.min(...boxes.map((b) => b.y1)),
      x2: Math.max(...boxes.map((b) => b.x2)),
      y2: Math.max(...boxes.map((b) => b.y2))
    };
  },

  // Pure. nodes: [{ id, parent, box? (leaf), pad?, ex? { l, t, r, b } (group extras: label, indent) }].
  // Returns the shift of `id` (with its descendants) so that it and each ancestor clear every node outside their lineage.
  resolve(nodes, id, options = {}) {
    const margin = options.margin ?? this.MARGIN;
    const maxIter = options.maxIter ?? 8;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const kids = new Map();

    nodes.forEach((node) => {
      if (node.parent && byId.has(node.parent)) {
        kids.set(node.parent, (kids.get(node.parent) || []).concat(node.id));
      }
    });

    if (!byId.has(id)) {
      return { dx: 0, dy: 0, ok: true };
    }

    const descendants = (root) => (kids.get(root) || []).flatMap((child) => [child, ...descendants(child)]);
    const ancestors = (node) => (byId.has(byId.get(node).parent) ? [byId.get(node).parent, ...ancestors(byId.get(node).parent)] : []);
    const moving = new Set([id, ...descendants(id)]);
    const chain = [id, ...ancestors(id)];
    const boxesFor = (sx, sy) => {
      const boxes = new Map();
      const boxOf = (nodeId) => {
        if (boxes.has(nodeId)) {
          return boxes.get(nodeId);
        }

        const node = byId.get(nodeId);
        const children = (kids.get(nodeId) || []).map(boxOf);
        let box;

        if (children.length) {
          const pad = node.pad || 0;
          const ex = node.ex || {};
          const inner = this.union(children);

          box = { x1: inner.x1 - pad - (ex.l || 0), y1: inner.y1 - pad - (ex.t || 0), x2: inner.x2 + pad + (ex.r || 0), y2: inner.y2 + pad + (ex.b || 0) };
        } else {
          const own = node.box;
          const move = moving.has(nodeId);

          box = { x1: own.x1 + (move ? sx : 0), y1: own.y1 + (move ? sy : 0), x2: own.x2 + (move ? sx : 0), y2: own.y2 + (move ? sy : 0) };
        }

        boxes.set(nodeId, box);

        return box;
      };

      nodes.forEach((node) => boxOf(node.id));

      return boxes;
    };
    const levels = chain.map((level) => {
      const lineage = new Set([level, ...ancestors(level), ...descendants(level)]);

      return { level, others: nodes.filter((node) => !lineage.has(node.id)).map((node) => node.id) };
    });
    const count = (boxes) => levels.reduce((sum, { level, others }) => (
      sum + others.filter((other) => this.overlaps(boxes.get(level), boxes.get(other))).length
    ), 0);
    const candidates = (boxes) => levels.flatMap(({ level, others }) => others.flatMap((other) => {
      const box = boxes.get(level);
      const target = boxes.get(other);

      return [
        { dx: target.x2 + margin - box.x1, dy: 0 },
        { dx: target.x1 - margin - box.x2, dy: 0 },
        { dx: 0, dy: target.y2 + margin - box.y1 },
        { dx: 0, dy: target.y1 - margin - box.y2 }
      ];
    }));
    let sx = 0;
    let sy = 0;

    for (let iteration = 0; iteration < maxIter; iteration += 1) {
      const boxes = boxesFor(sx, sy);
      const current = count(boxes);

      if (!current) {
        return { dx: sx, dy: sy, ok: true };
      }

      const best = candidates(boxes)
        .filter((shift) => shift.dx || shift.dy)
        .map((shift) => ({ shift, left: count(boxesFor(sx + shift.dx, sy + shift.dy)) }))
        .sort((p, q) => p.left - q.left || Math.hypot(p.shift.dx, p.shift.dy) - Math.hypot(q.shift.dx, q.shift.dy))[0];

      if (!best || best.left >= current) {
        break;
      }

      sx += best.shift.dx;
      sy += best.shift.dy;
    }

    return count(boxesFor(sx, sy)) ? { dx: 0, dy: 0, ok: false } : { dx: sx, dy: sy, ok: true };
  },

  boxOf(node, labels = true) {
    const box = node.boundingBox({ includeLabels: labels, includeOverlays: false, includeEdges: false });

    return { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
  },

  // Flat list for resolve(): leaves carry their box, groups their padding and measured extras.
  snapshot(cy) {
    const nodes = cy.nodes().filter((node) => !node.hasClass("meta-card") || node.data("free"));
    const included = new Set(nodes.map((node) => node.id()));

    return nodes.map((node) => {
      const parent = node.data("parent");
      const item = { id: node.id(), parent: included.has(parent) ? parent : null };
      const kids = node.children().filter((child) => included.has(child.id()));

      if (kids.empty()) {
        item.box = this.boxOf(node);

        return item;
      }

      const inner = this.union(kids.map((child) => this.boxOf(child)));
      const own = this.boxOf(node);

      item.pad = node.numericStyle("padding") || 0;
      item.ex = {
        l: inner.x1 - item.pad - own.x1,
        t: inner.y1 - item.pad - own.y1,
        r: own.x2 - inner.x2 - item.pad,
        b: own.y2 - inner.y2 - item.pad
      };

      return item;
    });
  },

  leavesOf(node) {
    return node.isParent() ? node.descendants().filter((item) => !item.isParent()) : node;
  },

  slide(leaves, delta, onDone) {
    let pending = leaves.length;

    leaves.forEach((leaf) => {
      leaf.animate(
        { position: { x: leaf.position("x") + delta.dx, y: leaf.position("y") + delta.dy } },
        {
          duration: this.DURATION,
          complete: () => {
            pending -= 1;

            if (pending === 0) {
              onDone?.();
            }
          }
        }
      );
    });
  },

  // Remembers where a drag began so that an unresolved drop can be undone.
  remember(node) {
    const start = {};

    this.leavesOf(node).forEach((leaf) => {
      start[leaf.id()] = { x: leaf.position("x"), y: leaf.position("y") };
    });
    node.scratch("_dragStart", start);
  },

  // Moves `node` (and its descendants) clear of every node outside its lineage and of the siblings of its ancestors.
  // onDone(moved, ok) is called when finished.
  apply(node, onDone) {
    if (node.hasClass("meta-card") && !node.data("free")) {
      onDone?.(false, true);
      return;
    }

    const result = this.resolve(this.snapshot(node.cy()), node.id(), { margin: this.MARGIN });
    const leaves = this.leavesOf(node);

    if (!result.ok) {
      const start = node.scratch("_dragStart") || {};
      const first = leaves[0];
      const origin = first && start[first.id()];

      if (!origin) {
        onDone?.(false, false);
        return;
      }

      this.slide(leaves, { dx: origin.x - first.position("x"), dy: origin.y - first.position("y") }, () => onDone?.(true, false));
      return;
    }

    if (!result.dx && !result.dy) {
      onDone?.(false, true);
      return;
    }

    this.slide(leaves, result, () => onDone?.(true, true));
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = Repulsion;
}
