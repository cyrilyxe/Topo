"use strict";

const Style = {
  userScale: 1,
  modelSize: 1,

  setUserScale(value) {
    const number = Number(value);

    this.userScale = Number.isFinite(number) && number > 0 ? number : 1;
  },

  setModel(model) {
    const number = Number(model && model.style && model.style.size);

    this.modelSize = Number.isFinite(number) && number > 0 ? number : 1;
  },

  scale() {
    return this.userScale * this.modelSize;
  },

  rules(model) {
    return model && model.style && Array.isArray(model.style.rules) ? model.style.rules : [];
  },

  // Map of every accepted reference (qualified id, key, unique local id) to node key.
  lookup(model) {
    const map = new Map();
    const localCount = new Map();

    model.nodes.forEach((node) => {
      localCount.set(node.localId, (localCount.get(node.localId) || 0) + 1);
    });

    model.nodes.forEach((node) => {
      if (node.localId && localCount.get(node.localId) === 1) {
        map.set(node.localId, node.id);
      }
    });

    model.nodes.forEach((node) => {
      map.set(node.qualifiedId, node.id);
      map.set(node.id, node.id);
    });

    return map;
  },

  // Merged rule properties applying to a node key.
  ruleFor(nodeId, model) {
    const map = this.lookup(model);
    const merged = {};

    this.rules(model).forEach((rule) => {
      if (map.get(rule.target) !== nodeId) {
        return;
      }

      ["label", "color", "border", "opacity", "size", "highlight", "hidden"].forEach((key) => {
        if (rule[key] !== undefined && rule[key] !== null) {
          merged[key] = rule[key];
        }
      });
    });

    return merged;
  },

  clean(rule) {
    const result = {};

    if (rule.label !== undefined) {
      result.label = String(rule.label);
    }

    if (rule.color) {
      result.color = String(rule.color);
    }

    if (rule.border) {
      result.border = String(rule.border);
    }

    const opacity = Number(rule.opacity);

    if (rule.opacity !== undefined && opacity >= 0 && opacity <= 1) {
      result.opacity = opacity;
    }

    const size = Number(rule.size);

    if (rule.size !== undefined && size > 0) {
      result.size = size;
    }

    if (rule.highlight) {
      result.highlight = true;
    }

    if (rule.hidden) {
      result.hidden = true;
    }

    return result;
  },

  // Attaches rule data to node elements and drops hidden nodes.
  apply(elements, model) {
    this.setModel(model);

    const map = this.lookup(model);
    const obsolete = [];
    const perNode = new Map();

    this.rules(model).forEach((rule) => {
      const nodeId = map.get(rule.target);

      if (!nodeId) {
        obsolete.push(rule.target);
        return;
      }

      perNode.set(nodeId, Object.assign(perNode.get(nodeId) || {}, this.clean(rule)));
    });

    const hidden = new Set();

    elements.forEach((element) => {
      if (element.group === "nodes" && perNode.get(element.data.id)?.hidden) {
        hidden.add(element.data.id);
      }
    });

    let grew = hidden.size > 0;

    while (grew) {
      grew = false;

      elements.forEach((element) => {
        if (element.group === "nodes" && element.data.parent && hidden.has(element.data.parent) && !hidden.has(element.data.id)) {
          hidden.add(element.data.id);
          grew = true;
        }
      });
    }

    const result = elements.filter((element) => {
      if (element.group === "nodes") {
        return !hidden.has(element.data.id);
      }

      return !hidden.has(element.data.source) && !hidden.has(element.data.target);
    });

    result.forEach((element) => {
      if (element.group !== "nodes") {
        return;
      }

      const rule = perNode.get(element.data.id);

      if (rule) {
        element.data.rule = rule;

        if (rule.label !== undefined) {
          element.data.display = rule.label;
        }
      }
    });

    return { elements: result, obsolete };
  }
};
