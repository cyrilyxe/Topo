"use strict";

const Graph = {
  cy: null,
  callbacks: {},
  saved: {},
  pinned: false,
  selectedId: null,
  focusSets: null,

  LAYOUTS: {
    fcose: { quality: "proof", randomize: true, nodeSeparation: 90, idealEdgeLength: 110, nodeRepulsion: 6500, packComponents: true, tile: true },
    cose: { idealEdgeLength: 120, nodeOverlap: 35, randomize: true },
    breadthfirst: { directed: true, spacingFactor: 1.1 },
    grid: { condense: false },
    circle: {},
    concentric: { minNodeSpacing: 40 }
  },

  token(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    return value || fallback;
  },

  // Cytoscape ignores the alpha channel of rgba(): split it into colour + background-opacity.
  fill(name, fallback) {
    const value = this.token(name, fallback);
    const match = value.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);

    if (!match) {
      return { "background-color": value, "background-opacity": 1 };
    }

    return { "background-color": `rgb(${match[1]},${match[2]},${match[3]})`, "background-opacity": Number(match[4]) };
  },

  typeKey(type) {
    const value = String(type || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();

    if (/^(service|microservice|api)$/.test(value)) {
      return "service";
    }

    if (/^(database|db|bdd|datastore|base[- _]?de[- _]?donnees?|base)$/.test(value)) {
      return "database";
    }

    if (/^(application|app|frontend|client|ui)$/.test(value)) {
      return "application";
    }

    if (/^(external|externe|third-?party|tiers)$/.test(value)) {
      return "external";
    }

    if (/^(queue|file|broker|topic|bus|stream)$/.test(value)) {
      return "queue";
    }

    return "default";
  },

  buildStyle() {
    const t = (name, fallback) => this.token(name, fallback);
    const typeColors = {
      service: t("--node-service", "#2563eb"),
      database: t("--node-database", "#0f766e"),
      application: t("--node-application", "#7c3aed"),
      external: t("--node-external", "#6b7280"),
      queue: t("--node-queue", "#c2410c"),
      default: t("--node-default", "#0369a1")
    };

    const style = [
      {
        selector: "node",
        style: {
          label: "data(display)",
          "background-color": typeColors.default,
          color: t("--node-text", "#ffffff"),
          "font-size": 11,
          "font-weight": 600,
          width: 170,
          height: 42,
          padding: "12px",
          shape: "round-rectangle",
          "border-width": 2,
          "border-color": t("--node-border", "#ffffff"),
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          "text-max-width": 150,
          "z-index-compare": "manual",
          "z-index": 0
        }
      }
    ];

    Object.keys(typeColors).forEach((key) => {
      style.push({
        selector: `node[typeKey = "${key}"]`,
        style: { "background-color": typeColors[key] }
      });
    });

    for (let depth = 0; depth < 4; depth += 1) {
      style.push({
        selector: `node.group.d${depth}`,
        style: {
          ...this.fill(`--group-${depth}-fill`, "rgba(37,99,235,0.06)"),
          "border-color": t(`--group-${depth}-border`, "#2563eb"),
          "border-style": ["solid", "dashed", "dotted", "solid"][depth]
        }
      });
    }

    style.push(
      {
        selector: "node.group",
        style: {
          color: t("--group-text", "#1e3a8a"),
          "font-size": 12,
          "font-weight": 700,
          "text-valign": "top",
          "text-halign": "center",
          padding: "32px",
          "corner-radius": 10,
          "compound-sizing-wrt-labels": "include"
        }
      },
      {
        selector: "node.collapsed",
        style: {
          ...this.fill("--collapsed-fill", "rgba(124,58,237,0.16)"),
          "border-color": t("--collapsed-border", "#6d28d9"),
          "border-width": 3,
          "border-style": "double",
          color: t("--collapsed-text", "#3b0764"),
          "text-valign": "center",
          "text-halign": "center",
          "text-max-width": 190,
          width: 210,
          height: 56
        }
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.85,
          "z-index-compare": "manual",
          "z-index": 0,
          "line-color": t("--edge", "#8b98ad"),
          "target-arrow-color": t("--edge", "#8b98ad"),
          label: "data(label)",
          "font-size": 9,
          color: t("--edge-text", "#475569"),
          "text-background-color": t("--edge-label-bg", "#ffffff"),
          "text-background-opacity": 0.92,
          "text-background-padding": 2,
          "text-background-shape": "round-rectangle"
        }
      },
      {
        selector: "edge.meta",
        style: {
          "line-color": t("--meta-edge", "#d97706"),
          "target-arrow-color": t("--meta-edge", "#d97706"),
          "line-style": "dashed",
          width: 3,
          color: t("--meta-edge-text", "#92400e")
        }
      },
      { selector: "node[ruleColor]", style: { "background-color": "data(ruleColor)" } },
      { selector: "node[ruleBorder]", style: { "border-color": "data(ruleBorder)" } },
      { selector: "node[ruleOpacity >= 0]", style: { opacity: "data(ruleOpacity)" } },
      { selector: "node.dim, node.focus-dim", style: { opacity: 0.18 } },
      { selector: "edge.dim, edge.focus-dim", style: { opacity: 0.08 } },
      {
        selector: "node.search-hit",
        style: { "border-color": t("--search", "#ec4899"), "border-width": 4 }
      },
      {
        selector: "node.highlighted",
        style: {
          "border-color": t("--highlight", "#f59e0b"),
          "border-width": 4,
          "border-style": "solid",
          "underlay-color": t("--highlight", "#f59e0b"),
          "underlay-opacity": 0.35,
          "underlay-padding": 8,
          "z-index": 900,
          "z-compound-depth": "top"
        }
      },
      {
        selector: "edge.hl-edge",
        style: {
          "line-color": t("--highlight", "#f59e0b"),
          "target-arrow-color": t("--highlight", "#f59e0b"),
          "z-index": 899
        }
      },
      {
        selector: "node.selected-node",
        style: { "border-color": t("--select", "#7c3aed"), "border-width": 4, "border-style": "solid" }
      },
      {
        selector: "node.link-hover",
        style: {
          "border-color": t("--link-hover", "#0891b2"),
          "border-width": 4,
          "underlay-color": t("--link-hover", "#0891b2"),
          "underlay-opacity": 0.3,
          "underlay-padding": 8,
          "z-index": 950,
          "z-compound-depth": "top"
        }
      },
      {
        selector: "edge.link-hover",
        style: {
          "line-color": t("--link-hover", "#0891b2"),
          "target-arrow-color": t("--link-hover", "#0891b2"),
          width: 5,
          opacity: 1,
          "z-index": 951
        }
      }
    );

    return style;
  },

  init(container, callbacks) {
    this.callbacks = callbacks || {};

    this.cy = cytoscape({
      container,
      elements: [],
      style: this.buildStyle(),
      wheelSensitivity: 0.25
    });

    const cy = this.cy;
    const point = (event) => ({ x: event.originalEvent.clientX, y: event.originalEvent.clientY });

    cy.on("tap", "node", (event) => this.callbacks.onNodeTap?.(event.target.id()));
    cy.on("dbltap", "node", (event) => this.callbacks.onNodeDblTap?.(event.target.id()));
    cy.on("cxttap", "node", (event) => this.callbacks.onNodeMenu?.(event.target.id(), point(event)));
    cy.on("cxttap", "edge", (event) => this.callbacks.onEdgeMenu?.(event.target.id(), point(event)));

    cy.on("cxttap", (event) => {
      if (event.target === cy) {
        this.callbacks.onBackgroundMenu?.(point(event));
      }
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        this.callbacks.onBackgroundTap?.();
      }
    });

    cy.on("drag", "node", (event) => this.callbacks.onNodeMove?.(event.target.id()));

    cy.on("dragfree", "node", () => {
      this.pinned = true;
      this.callbacks.onViewChange?.("drag");
    });

    cy.on("viewport", () => this.callbacks.onViewChange?.("viewport"));

    return cy;
  },

  applyTheme() {
    if (!this.cy) {
      return;
    }

    this.cy.style(this.buildStyle());
    this.applyStyle();
  },

  clear() {
    this.cy.elements().remove();
  },

  decorate(elements) {
    elements.forEach((element) => {
      if (element.group !== "nodes") {
        return;
      }

      const data = element.data;
      const depth = Math.min(Number(data.depth) || 0, 3);
      const classes = Array.isArray(element.classes) ? element.classes.join(" ") : String(element.classes || "");
      const collapsed = / collapsed /.test(` ${classes} `) || Boolean(data.isCollapsed);

      data.typeKey = this.typeKey(data.type);
      data.display = collapsed ? `▸ ${data.label}` : data.label;
      element.classes = `${classes} d${depth}`.trim();
    });
  },

  // opts: { initial, viewport: {zoom, pan}, layout }
  refresh(elements, model, opts = {}) {
    const cy = this.cy;
    const previous = {};

    if (!opts.initial) {
      cy.nodes().forEach((node) => {
        previous[node.id()] = { x: node.position("x"), y: node.position("y") };
      });
    }

    const known = Object.assign({}, this.saved, previous);

    this.decorate(elements);

    const styled = Style.apply(elements, model);
    const nodes = styled.elements.filter((element) => element.group === "nodes");
    const parents = new Set(nodes.map((element) => element.data.parent).filter(Boolean));
    const parentOf = new Map(nodes.map((element) => [element.data.id, element.data.parent]));
    const leaves = nodes.filter((element) => !parents.has(element.data.id));
    const unknown = [];

    leaves.forEach((element) => {
      const position = known[element.data.id];

      if (position) {
        element.position = { x: position.x, y: position.y };
      } else {
        unknown.push(element);
      }
    });

    const fullLayout = leaves.length > 0 && unknown.length === leaves.length;

    if (!fullLayout && unknown.length) {
      this.placeNew(unknown, styled.elements, known, parentOf, leaves);
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(styled.elements);
    });

    this.applyStyle();

    if (fullLayout) {
      this.runLayout(opts.layout || "fcose", { fit: !opts.viewport });
    }

    if (opts.viewport && Number.isFinite(opts.viewport.zoom) && opts.viewport.pan) {
      cy.viewport({ zoom: opts.viewport.zoom, pan: opts.viewport.pan });
    } else if (opts.initial && !fullLayout && leaves.length) {
      cy.fit(undefined, 45);
    }

    if (this.selectedId) {
      cy.getElementById(this.selectedId).addClass("selected-node");
    }

    if (this.focusSets) {
      this.applyFocus();
    }

    return styled.obsolete;
  },

  placeNew(unknown, allElements, known, parentOf, leaves) {
    const placed = {};

    leaves.forEach((element) => {
      if (known[element.data.id]) {
        placed[element.data.id] = known[element.data.id];
      }
    });

    const xs = Object.values(placed).map((point) => point.x);
    const ys = Object.values(placed).map((point) => point.y);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const counters = new Map();
    let orphans = 0;

    unknown.forEach((element) => {
      const id = element.data.id;
      let anchor = known[id];
      let anchorKey = id;

      for (let parent = parentOf.get(id); !anchor && parent; parent = parentOf.get(parent)) {
        anchor = known[parent];
        anchorKey = parent;
      }

      if (!anchor) {
        const edge = allElements.find((item) => (
          item.group === "edges" &&
          ((item.data.source === id && placed[item.data.target]) || (item.data.target === id && placed[item.data.source]))
        ));

        if (edge) {
          anchor = placed[edge.data.source === id ? edge.data.target : edge.data.source];
          anchorKey = `edge:${anchor.x}:${anchor.y}`;
        }
      }

      if (!anchor) {
        element.position = { x: maxX + 220, y: minY + orphans * 80 };
        orphans += 1;
      } else {
        const index = counters.get(anchorKey) || 0;
        const angle = index * 2.4;
        const radius = index === 0 && known[id] ? 0 : 60 + 28 * Math.sqrt(index);

        counters.set(anchorKey, index + 1);
        element.position = {
          x: anchor.x + Math.cos(angle) * radius,
          y: anchor.y + Math.sin(angle) * radius
        };
      }

      placed[id] = element.position;
    });
  },

  runLayout(name, options = {}) {
    let base = this.LAYOUTS[name] ? name : "fcose";

    if (base === "fcose" && typeof cytoscapeFcose === "undefined") {
      base = "cose";
    }
    const layout = this.cy.layout(Object.assign(
      { name: base, animate: false, padding: 45, fit: options.fit !== false },
      this.LAYOUTS[base]
    ));

    layout.run();
  },

  relayout(name) {
    this.saved = {};
    this.pinned = false;
    this.runLayout(name, { fit: true });
  },

  setData(node, key, value) {
    if (value === undefined || value === null) {
      node.removeData(key);
    } else {
      node.data(key, value);
    }
  },

  // Colour, border and opacity go through data mappers so that state classes keep priority.
  applyStyle() {
    const scale = Style.scale();

    this.cy.batch(() => {
      this.cy.edges().removeClass("hl-edge");

      this.cy.nodes().forEach((node) => {
        const rule = node.data("rule") || {};
        const size = scale * (Number(rule.size) || 1);
        const isGroup = node.isParent();
        const styles = { "font-size": (isGroup ? 12 : 11) * size };

        node.removeStyle();
        this.setData(node, "ruleColor", rule.color);
        this.setData(node, "ruleBorder", rule.border);
        this.setData(node, "ruleOpacity", rule.opacity);

        if (isGroup) {
          styles.padding = `${32 * size}px`;
        } else if (node.hasClass("collapsed")) {
          styles.width = 210 * size;
          styles.height = 56 * size;
          styles.padding = `${12 * size}px`;
        } else {
          styles.width = 170 * size;
          styles.height = 42 * size;
          styles.padding = `${12 * size}px`;
        }

        node.style(styles);
        node.toggleClass("highlighted", Boolean(rule.highlight));

        if (rule.highlight) {
          node.connectedEdges().addClass("hl-edge");
        }
      });
    });
  },

  // ---- temporary focus and link hover (never persisted) ----

  setFocus(nodeIds, edgeIds) {
    this.focusSets = { nodes: new Set(nodeIds), edges: new Set(edgeIds) };
    this.applyFocus();
  },

  clearFocus() {
    this.focusSets = null;
    this.applyFocus();
  },

  applyFocus() {
    const sets = this.focusSets;

    this.cy.batch(() => {
      this.cy.elements().removeClass("focus-dim");

      if (!sets) {
        return;
      }

      this.cy.nodes().filter((node) => !sets.nodes.has(node.id())).addClass("focus-dim");
      this.cy.edges().filter((edge) => !sets.edges.has(edge.id())).addClass("focus-dim");
    });
  },

  fitFocus() {
    const sets = this.focusSets;
    const nodes = sets ? this.cy.nodes().filter((node) => sets.nodes.has(node.id())) : this.cy.collection();

    if (nodes.nonempty()) {
      this.cy.animate({ fit: { eles: nodes, padding: 60 } }, { duration: 300 });
    }
  },

  setViewport(viewport) {
    if (viewport && Number.isFinite(viewport.zoom) && viewport.pan) {
      this.cy.viewport({ zoom: viewport.zoom, pan: viewport.pan });
    }
  },

  setHover(edgeId, nodeIds) {
    this.clearHover();

    this.cy.getElementById(edgeId).addClass("link-hover");
    nodeIds.forEach((id) => this.cy.getElementById(id).addClass("link-hover"));
  },

  clearHover() {
    this.cy.elements().removeClass("link-hover");
  },

  centerOnEdge(id) {
    const edge = this.cy.getElementById(id);

    if (edge.nonempty()) {
      this.cy.animate({ center: { eles: edge } }, { duration: 350 });
    }
  },

  zoomIn() {
    this.cy.zoom({ level: this.cy.zoom() * 1.2, renderedPosition: this.center() });
  },

  zoomOut() {
    this.cy.zoom({ level: this.cy.zoom() / 1.2, renderedPosition: this.center() });
  },

  center() {
    return { x: this.cy.width() / 2, y: this.cy.height() / 2 };
  },

  fit() {
    this.cy.fit(undefined, 45);
  },

  centerOn(id) {
    const node = this.cy.getElementById(id);

    if (node.nonempty()) {
      this.cy.animate({
        center: { eles: node },
        zoom: Math.max(this.cy.zoom(), 1)
      }, { duration: 350 });
    }
  },

  select(id, center = true) {
    this.cy.nodes().removeClass("selected-node");
    this.selectedId = id;

    const node = this.cy.getElementById(id);

    if (node.nonempty()) {
      node.addClass("selected-node");

      if (center) {
        this.centerOn(id);
      }
    }
  },

  renderedBox(id) {
    const node = this.cy.getElementById(id);

    return node.nonempty() ? node.renderedBoundingBox() : null;
  },

  getPositions() {
    const positions = {};

    this.cy.nodes().forEach((node) => {
      if (!node.isParent()) {
        positions[node.id()] = {
          x: Math.round(node.position("x")),
          y: Math.round(node.position("y"))
        };
      }
    });

    return positions;
  },

  // Every node position, compound boxes included (their centre).
  getAllPositions() {
    const positions = {};

    this.cy.nodes().forEach((node) => {
      positions[node.id()] = { x: node.position("x"), y: node.position("y") };
    });

    return positions;
  },

  getViewport() {
    const pan = this.cy.pan();

    return {
      zoom: Math.round(this.cy.zoom() * 1000) / 1000,
      pan: { x: Math.round(pan.x), y: Math.round(pan.y) }
    };
  },

  background() {
    return this.token("--canvas", "#ffffff");
  },

  exportSvg() {
    if (typeof this.cy.svg !== "function") {
      throw new Error("Le module d’export SVG n’est pas chargé.");
    }

    return this.cy.svg({ full: true, scale: 1, bg: this.background() });
  },

  exportPng() {
    return this.cy.png({ full: true, scale: 2, bg: this.background(), output: "blob" });
  },

  search(text, model) {
    const criteria = this.parseSearch(text);

    this.cy.elements().removeClass("dim search-hit");

    if (!criteria) {
      return [];
    }

    if (criteria.error) {
      throw new Error(criteria.error);
    }

    const matches = model.nodes.filter((node) => {
      const target = [node.id, node.qualifiedId, node.label, node.type || "", JSON.stringify(node.meta || {})].join("\n");

      if (criteria.regex) {
        return criteria.regex.test(target);
      }

      return target.toLowerCase().includes(criteria.text.toLowerCase());
    });

    const ids = new Set(matches.map((node) => node.id));

    this.cy.nodes().forEach((node) => {
      if (ids.has(node.id())) {
        node.addClass("search-hit");
      } else {
        node.addClass("dim");
      }
    });

    this.cy.edges().forEach((edge) => {
      if (!ids.has(edge.source().id()) && !ids.has(edge.target().id())) {
        edge.addClass("dim");
      }
    });

    return matches;
  },

  parseSearch(text) {
    const value = String(text || "").trim();

    if (!value) {
      return null;
    }

    const delimited = value.match(/^\/(.*)\/([gimsuy]*)$/s);

    if (delimited) {
      try {
        return { regex: new RegExp(delimited[1], delimited[2].replace(/g|y/g, "")) };
      } catch (error) {
        return { error: `Expression régulière invalide : ${error.message}` };
      }
    }

    if (/[\\^$.*+?()[\]{}|]/.test(value)) {
      try {
        return { regex: new RegExp(value, "i") };
      } catch {
        return { text: value };
      }
    }

    return { text: value };
  }
};
