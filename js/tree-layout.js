"use strict";

// Outline layout: one row per visible leaf, indented by depth, in model order.
const TreeLayout = {
  MARGIN: 80,
  GAP: 12,

  // opts: { indent, kind(id) -> "leaf" | "group" | null (hidden), size(id) -> { w, h },
  //         group(id) -> { pad, labelH } }
  // Returns { positions: { id: {x, y} } (leaf centres), widths: { id: w } (equalised per group) }.
  compute(model, opts) {
    const indent = Number(opts.indent) || 28;
    const positions = {};
    const widths = {};
    let cursor = this.MARGIN;

    const place = (id, left) => {
      const kind = opts.kind(id);

      if (!kind) {
        return;
      }

      if (kind === "leaf") {
        return;
      }

      const { pad, labelH } = opts.group(id);
      const items = model.byId.get(id).children.filter((child) => opts.kind(child));
      const width = Math.max(0, ...items.filter((child) => opts.kind(child) === "leaf").map((child) => opts.size(child).w));

      cursor += labelH + pad;

      items.forEach((child) => {
        if (opts.kind(child) === "leaf") {
          const { h } = opts.size(child);

          widths[child] = width;
          positions[child] = { x: left + indent + width / 2, y: cursor + h / 2 };
          cursor += h + this.GAP;
        } else {
          place(child, left + indent);
        }
      });

      cursor += pad;
    };

    model.nodes.filter((node) => !node.parent).forEach((node) => {
      if (opts.kind(node.id) === "leaf") {
        const { w, h } = opts.size(node.id);

        positions[node.id] = { x: this.MARGIN + w / 2, y: cursor + h / 2 };
        cursor += h + this.GAP;
      } else {
        place(node.id, this.MARGIN);
      }
    });

    return { positions, widths };
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = TreeLayout;
}
