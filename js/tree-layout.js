"use strict";

// Outline layout: one row per visible leaf, in model order. Indentation is an internal left offset:
// the children of a group share one left edge = group left + padding + indent.
const TreeLayout = {
  MARGIN: 80,
  GAP: 12,

  // opts: { indent, kind(id) -> "leaf" | "group" | null (hidden), size(id) -> { w, h, left?, right? } (left/right: outside cards beside a leaf),
  //         group(id) -> { pad, border?, labelH, top?, bottom?, cardW? }, order?(parentId | "", ids) -> ids }
  // Returns { positions: { id: {x, y} } (leaf centres), widths: { id: w } (equalised leaves),
  //           minWidths: { id: w } (groups: content width incl. indent; Cytoscape adds the padding, the extra goes to the left) }.
  compute(model, opts) {
    const indent = Number(opts.indent) || 28;
    const positions = {};
    const widths = {};
    const minWidths = {};
    const order = (key, ids) => (opts.order ? opts.order(key, ids) : ids);
    let cursor = this.MARGIN;

    const place = (id, left) => {
      const { pad, border = 0, labelH, top = 0, bottom = 0, cardW = 0 } = opts.group(id);
      const items = order(id, model.byId.get(id).children.filter((child) => opts.kind(child)));
      const leaves = items.filter((child) => opts.kind(child) === "leaf").map((child) => opts.size(child));
      const leafWidth = Math.max(0, ...leaves.map((size) => size.w));
      const side = Math.max(0, ...leaves.map((size) => size.left || 0));
      const childLeft = left + pad + indent + side;
      let inner = Math.max(side + leafWidth + Math.max(0, ...leaves.map((size) => size.right || 0)), cardW);

      cursor += labelH + pad + top;

      items.forEach((child) => {
        if (opts.kind(child) === "leaf") {
          const { h } = opts.size(child);

          widths[child] = leafWidth;
          positions[child] = { x: childLeft + leafWidth / 2, y: cursor + h / 2 };
          cursor += h + this.GAP;
        } else {
          inner = Math.max(inner, side + place(child, childLeft));
        }
      });

      cursor += bottom + pad;
      minWidths[id] = indent + inner;

      return minWidths[id] + pad * 2 + border * 2;
    };

    const roots = order("", model.nodes.filter((node) => !node.parent).map((node) => node.id));

    roots.forEach((id) => {
      const kind = opts.kind(id);

      if (kind === "leaf") {
        const { w, h } = opts.size(id);

        positions[id] = { x: this.MARGIN + w / 2, y: cursor + h / 2 };
        cursor += h + this.GAP;
      } else if (kind) {
        place(id, this.MARGIN);
      }
    });

    return { positions, widths, minWidths };
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = TreeLayout;
}
