"use strict";

const Graph = {
  cy: null,
  callbacks: {},
  saved: {},
  pinned: false,
  selectedId: null,
  focusSets: null,
  model: null,
  layoutName: "fcose",
  edgesPending: false,
  cards: [],
  treeOrder: {},
  mem: {},

  LAYOUTS: {
    tree: {},
    fcose: { quality: "proof", randomize: true, nodeSeparation: 90, idealEdgeLength: 110, nodeRepulsion: 6500, packComponents: true, tile: true },
    cose: { idealEdgeLength: 120, nodeOverlap: 35, randomize: true },
    breadthfirst: { directed: true, spacingFactor: 1.1 },
    grid: { condense: false },
    circle: {},
    concentric: { minNodeSpacing: 40 }
  },

  setting(key, fallback) {
    const value = typeof Settings !== "undefined" ? Settings.get(key) : undefined;

    return value ?? this.mem[key] ?? fallback;
  },

  writeSetting(key, value) {
    this.mem[key] = value;

    if (typeof Settings !== "undefined") {
      Settings.set(key, value);
    } else {
      this.applyTheme();
    }
  },

  EDGE_KEYS: ["curve-style", "source-endpoint", "target-endpoint", "taxi-direction", "taxi-turn", "control-point-distances", "control-point-weights", "segment-weights", "segment-distances", "segment-radius", "edge-distances"],
  SIDES: {
    right: { endpoint: "50% 0%" },
    left: { endpoint: "-50% 0%" },
    bottom: { endpoint: "0% 50%" },
    top: { endpoint: "0% -50%" }
  },
  SIDE_OFFSET: 28,

  // bezier = "auto": straight for a single link; the outline layout turns it into right-angle links.
  edgeMode() {
    const curve = this.setting("edges.curve", "bezier");
    const mode = this.layoutName === "tree" && curve === "bezier" ? "taxi" : curve;
    const chosen = this.setting("edges.side", "auto");
    const angled = mode === "taxi" || mode === "round-taxi" || mode === "curved";
    const side = chosen === "auto" ? (this.layoutName === "tree" && angled ? "right" : "auto") : (angled ? chosen : "auto");

    return { mode, side };
  },

  edgeCurveRules() {
    const { mode } = this.edgeMode();

    if (mode === "taxi" || mode === "round-taxi") {
      return { "curve-style": "taxi", "taxi-direction": "auto", "taxi-turn": "50%", "taxi-radius": mode === "round-taxi" ? 14 : 0 };
    }

    if (mode === "curved") {
      return { "curve-style": "unbundled-bezier", "control-point-distances": [40], "control-point-weights": [0.5] };
    }

    return { "curve-style": mode === "straight" ? "straight" : "bezier" };
  },

  // Anchor of a node side, in model coordinates.
  sideAnchor(node, side) {
    const p = node.position();
    const w = node.outerWidth() / 2;
    const h = node.outerHeight() / 2;

    return { right: { x: p.x + w, y: p.y }, left: { x: p.x - w, y: p.y }, bottom: { x: p.x, y: p.y + h }, top: { x: p.x, y: p.y - h } }[side];
  },

  // Per-edge geometry: leave and enter by `side`, going round the outside of the boxes.
  edgeGeometry(edge, mode, side) {
    const source = edge.source();
    const target = edge.target();

    if (source.id() === target.id()) {
      return null;
    }

    const sp = source.position();
    const tp = target.position();

    if (side === "auto") {
      const length = Math.hypot(tp.x - sp.x, tp.y - sp.y);

      return mode === "curved" && length > 1
        ? { "curve-style": "unbundled-bezier", "control-point-distances": [Math.min(90, Math.max(24, length * 0.25))], "control-point-weights": [0.5] }
        : null;
    }

    const a = this.sideAnchor(source, side);
    const b = this.sideAnchor(target, side);
    const info = this.SIDES[side];
    const horizontal = side === "right" || side === "left";
    const sign = side === "right" || side === "bottom" ? 1 : -1;
    const axis = horizontal ? "x" : "y";
    const turn = sign > 0 ? Math.max(a[axis], b[axis]) + this.SIDE_OFFSET : Math.min(a[axis], b[axis]) - this.SIDE_OFFSET;
    const css = { "source-endpoint": info.endpoint, "target-endpoint": info.endpoint, "edge-distances": "node-position" };
    const control = (point) => (horizontal ? { x: turn, y: point.y } : { x: point.x, y: turn });
    const vx = tp.x - sp.x;
    const vy = tp.y - sp.y;
    const length = Math.hypot(vx, vy);

    if (length < 1) {
      return null;
    }

    const project = (point) => ({
      w: ((point.x - sp.x) * vx + (point.y - sp.y) * vy) / (length * length),
      d: ((point.y - sp.y) * vx - (point.x - sp.x) * vy) / length
    });
    const points = [control(a), control(b)].map(project);
    const weights = points.map((point) => point.w);
    const distances = points.map((point) => point.d);

    if (mode === "curved") {
      return { ...css, "curve-style": "unbundled-bezier", "control-point-weights": weights, "control-point-distances": distances };
    }

    return {
      ...css,
      "curve-style": mode === "round-taxi" ? "round-segments" : "segments",
      "segment-weights": weights,
      "segment-distances": distances,
      "segment-radius": mode === "round-taxi" ? 14 : 0
    };
  },

  updateEdges() {
    if (!this.cy) {
      return;
    }

    const { mode, side } = this.edgeMode();
    const custom = side !== "auto" || mode === "curved";

    this.cy.batch(() => {
      this.cy.edges().forEach((edge) => {
        edge.removeStyle(this.EDGE_KEYS.join(" "));

        const css = custom ? this.edgeGeometry(edge, mode, side) : null;

        if (css) {
          edge.style(css);
        }
      });
    });
  },

  scheduleEdges() {
    if (this.edgesPending || typeof requestAnimationFrame === "undefined") {
      return;
    }

    this.edgesPending = true;
    requestAnimationFrame(() => {
      this.edgesPending = false;
      this.updateEdges();
    });
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

    const edgeOpacity = Math.min(1, Math.max(0.15, Number(this.setting("edges.opacity", 1)) || 1));
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
        selector: "node.meta-card",
        style: {
          label: "data(shown)",
          ...this.fill("--card-fill", "rgba(255,255,255,0.5)"),
          "border-color": "data(ownerColor)",
          "border-width": 1.5,
          "border-style": "solid",
          color: t("--card-text", "#1f2937"),
          "font-size": 10,
          "font-weight": 400,
          shape: "round-rectangle",
          width: "data(w)",
          height: "data(h)",
          padding: "6px",
          "text-wrap": "wrap",
          "text-max-width": "data(maxWidth)",
          "text-justification": "left",
          "text-valign": "center",
          "text-halign": "center",
          "z-index": 20
        }
      },
      { selector: "node.meta-card[?truncated][!expanded]", style: { "border-style": "dashed" } },
      {
        selector: "edge",
        style: {
          width: 2,
          ...this.edgeCurveRules(),
          opacity: edgeOpacity,
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.85,
          "z-index-compare": "manual",
          "z-index": 0,
          "line-color": t("--edge", "#8b98ad"),
          "target-arrow-color": t("--edge", "#8b98ad"),
          "source-arrow-color": t("--edge", "#8b98ad"),
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
      { selector: "node.collapsed[ruleColor]", style: { "background-opacity": 1 } },
      { selector: "node[ruleOpacity >= 0]", style: { opacity: "data(ruleOpacity)" } },
      { selector: "node[ruleBorderStyle]", style: { "border-style": "data(ruleBorderStyle)" } },
      { selector: "node[ruleShape]", style: { shape: "data(ruleShape)" } },
      { selector: "node[ruleBorderWidth >= 0]", style: { "border-width": "data(ruleBorderWidth)" } },
      { selector: "node[autoText]", style: { color: "data(autoText)" } },
      { selector: "node[ruleText]", style: { color: "data(ruleText)" } },
      { selector: "node[?ruleBold]", style: { "font-weight": "bold" } },
      { selector: "node[?ruleItalic]", style: { "font-style": "italic" } },
      { selector: "node[ruleTextBg]", style: { "text-background-color": "data(ruleTextBg)", "text-background-opacity": 1, "text-background-padding": 3, "text-background-shape": "round-rectangle" } },
      { selector: "edge[autoText]", style: { color: "data(autoText)" } },
      { selector: "edge[lsText]", style: { color: "data(lsText)" } },
      { selector: "edge[lsColor]", style: { "line-color": "data(lsColor)", "target-arrow-color": "data(lsColor)", "source-arrow-color": "data(lsColor)" } },
      { selector: "edge[lsWidth > 0]", style: { width: "data(lsWidth)" } },
      { selector: "edge[lsLine]", style: { "line-style": "data(lsLine)" } },
      { selector: "edge[lsArrow]", style: { "target-arrow-shape": "data(lsArrow)" } },
      { selector: "edge[lsSource]", style: { "source-arrow-shape": "data(lsSource)" } },
      { selector: "node.dim, node.focus-dim", style: { opacity: 0.18 } },
      { selector: "edge.dim, edge.focus-dim", style: { opacity: 0.08 * edgeOpacity } },
      {
        selector: "node.search-hit",
        style: { "border-color": t("--search", "#ec4899"), "border-width": 4 }
      },
      {
        selector: "node.highlighted",
        style: {
          "border-width": 4,
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
        selector: "node.selected-node, node:selected",
        style: { "overlay-color": t("--selection", "#7c3aed"), "overlay-opacity": 0.22, "overlay-padding": 7, "overlay-shape": "round-rectangle" }
      },
      {
        selector: "node.tool-hover, node.link-series",
        style: {
          "underlay-color": t("--hover-aura", "#38bdf8"),
          "underlay-opacity": 0.28,
          "underlay-padding": 7,
          "underlay-shape": "round-rectangle"
        }
      },
      {
        selector: "edge:selected",
        style: { "line-color": t("--select", "#7c3aed"), "target-arrow-color": t("--select", "#7c3aed"), width: 4, "z-index": 960 }
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
      style: this.buildStyle()
    });

    const cy = this.cy;
    const point = (event) => ({ x: event.originalEvent.clientX, y: event.originalEvent.clientY });

    cy.on("tap", "node", (event) => {
      const node = event.target;

      if (node.hasClass("meta-card")) {
        node.unselect();
        MetaCards.toggle(node);
        return;
      }

      this.callbacks.onNodeTap?.(node.id());

      if (this.layoutName === "tree" && this.selectToolActive() && (node.isParent() || node.hasClass("collapsed"))) {
        this.callbacks.onNodeDblTap?.(node.id());
      }
    });

    cy.on("dbltap", "node", (event) => {
      if (!event.target.hasClass("meta-card") && this.layoutName !== "tree" && (this.selectToolActive() || Tools.current === "move")) {
        this.callbacks.onNodeDblTap?.(event.target.id());
      }
    });
    cy.on("cxttap", "node", (event) => this.menuAllowed() && !event.target.hasClass("meta-card") && this.callbacks.onNodeMenu?.(event.target.id(), point(event)));
    cy.on("cxttap", "edge", (event) => this.menuAllowed() && this.callbacks.onEdgeMenu?.(event.target.id(), point(event)));

    cy.on("cxttap", (event) => {
      if (event.target === cy && this.menuAllowed()) {
        this.callbacks.onBackgroundMenu?.(point(event));
      }
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        this.callbacks.onBackgroundTap?.();
      }
    });

    cy.on("grab", "node", (event) => this.onGrab(event.target));
    cy.on("drag", "node", (event) => {
      this.lockTreeX(event.target);
      !event.target.hasClass("meta-card") && this.callbacks.onNodeMove?.(event.target.id());
    });
    cy.on("dragfree", "node", (event) => this.onDrop(event.target));
    cy.on("position", "node", (event) => !event.target.hasClass("meta-card") && this.scheduleEdges());

    cy.on("viewport", () => this.callbacks.onViewChange?.("viewport"));
    MetaCards.bind(cy);

    this.bindToolbar();

    if (typeof Settings !== "undefined" && Settings.onChange) {
      Settings.onChange((keys) => {
        this.syncToolbar();
        this.applyTheme();

        if (Array.isArray(keys) && keys.some((key) => key.startsWith("meta.card.")) && typeof App !== "undefined") {
          App.render();
        }
      });
    }

    return cy;
  },

  treeActive(node) {
    return this.layoutName === "tree" && !node.hasClass("meta-card");
  },

  onGrab(node) {
    if (node.hasClass("meta-card")) {
      return;
    }

    Repulsion.remember(node);
    node.scratch("_left", Repulsion.boxOf(node, false).x1);
  },

  // Outline layout: a dragged box only moves vertically.
  lockTreeX(node) {
    const left = node.scratch("_left");

    if (!this.treeActive(node) || left === undefined) {
      return;
    }

    const dx = Repulsion.boxOf(node, false).x1 - left;

    if (Math.abs(dx) > 0.01) {
      Repulsion.leavesOf(node).forEach((leaf) => leaf.position("x", leaf.position("x") - dx));
    }
  },

  onDrop(node) {
    this.pinned = true;
    this.callbacks.onViewChange?.("drag");

    if (this.treeActive(node)) {
      this.treeDrop(node);
      return;
    }

    // The move tool settles on its own after a release (and may have re-rendered the graph).
    const moveTool = typeof Tools !== "undefined" && Tools.current === "move";

    if (!moveTool && !node.removed() && this.setting("drop.repulsion", true) && typeof Repulsion !== "undefined") {
      Repulsion.apply(node,(moved, ok) => {
        if (!ok && typeof App !== "undefined" && App.showMessage) {
          App.showMessage("Pas de place libre ici", "warning");
        }

        moved && this.callbacks.onViewChange?.("drag");

        const parents = node.ancestors().map((item) => item.id());

        if (parents.length) {
          Repulsion.settle(parents);
        }
      });
    }
  },

  // Visual reordering: siblings are re-sorted by their vertical position, then the column is packed again.
  treeDrop(node) {
    const parent = node.data("parent") || "";
    const centre = (item) => {
      const box = Repulsion.boxOf(item, false);

      return box.y1 + box.y2;
    };
    const siblings = this.cy.nodes().filter((item) => !item.hasClass("meta-card") && (item.data("parent") || "") === parent);

    this.treeOrder[parent] = siblings.sort((a, b) => centre(a) - centre(b)).map((item) => item.id());
    this.runTree(false);
    this.callbacks.onViewChange?.("drag");
  },

  selectToolActive() {
    return typeof Tools === "undefined" || !Tools.cy || Tools.current === "select";
  },

  bindToolbar() {
    const opacity = document.getElementById("edge-opacity");
    const curve = document.getElementById("edge-curve");

    this.syncToolbar();

    opacity?.addEventListener("input", () => this.writeSetting("edges.opacity", Number(opacity.value)));
    curve?.addEventListener("change", () => {
      this.writeSetting("edges.curve", curve.value);
    });
  },

  syncToolbar() {
    const opacity = document.getElementById("edge-opacity");
    const curve = document.getElementById("edge-curve");

    if (opacity) {
      opacity.value = this.setting("edges.opacity", 1);
    }

    if (curve) {
      curve.value = this.setting("edges.curve", "bezier");
    }
  },

  applyTheme() {
    if (!this.cy) {
      return;
    }

    this.cy.style(this.buildStyle());
    this.applyStyle();

    if (this.layoutName === "tree" && this.model) {
      this.runTree(false);
    }

    this.updateEdges();
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
    const selection = !opts.initial && typeof Tools !== "undefined" ? Tools.snapshot() : null;

    this.model = model;

    if (opts.layout && opts.layout !== this.layoutName) {
      this.layoutName = opts.layout;
      cy.style(this.buildStyle());
    }

    if (!opts.initial) {
      cy.nodes().forEach((node) => {
        previous[node.id()] = { x: node.position("x"), y: node.position("y") };
      });
    }

    const known = Object.assign({}, this.saved, previous);

    this.decorate(elements);

    const styled = Style.apply(elements, model);
    const cards = MetaCards.inject(styled.elements, model, known);

    this.cards = cards;
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
    } else if (opts.layout === "tree") {
      this.runLayout("tree", { fit: false });
    }

    if (cards.length) {
      cy.add(cards);
      MetaCards.placeAll(cy);

      if (fullLayout && !opts.viewport) {
        cy.fit(undefined, 45);
      }
    }

    if (opts.viewport && Number.isFinite(opts.viewport.zoom) && opts.viewport.pan) {
      cy.viewport({ zoom: opts.viewport.zoom, pan: opts.viewport.pan });
    } else if (opts.initial && !fullLayout && leaves.length) {
      cy.fit(undefined, 45);
    }

    this.updateEdges();

    if (this.selectedId) {
      cy.getElementById(this.selectedId).addClass("selected-node");
    }

    if (selection) {
      Tools.restore(selection);
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

  runTree(fit) {
    const cy = this.cy;
    const model = this.model;

    if (!model) {
      return;
    }

    const reserve = (id) => {
      const card = this.cards.find((item) => item.data.owner === id && item.data.parent === id);

      return card ? MetaCards.reserve(card.data) : {};
    };
    const { positions, widths, minWidths } = TreeLayout.compute(model, {
      indent: this.setting("tree.indent", 28),
      kind: (id) => {
        const node = cy.getElementById(id);

        if (node.empty()) {
          return null;
        }

        return node.isParent() ? "group" : "leaf";
      },
      size: (id) => {
        const node = cy.getElementById(id);

        const card = this.cards.find((item) => item.data.owner === id && item.data.parent !== id && !item.data.free);

        return { w: node.outerWidth(), h: node.outerHeight(), ...(card ? MetaCards.beside(card.data) : {}) };
      },
      group: (id) => {
        const node = cy.getElementById(id);
        const font = node.numericStyle("font-size");
        const chars = String(node.data("display") || "").length;
        const lines = Math.max(1, Math.ceil((chars * font * 0.6) / 150));

        return { pad: node.numericStyle("padding"), border: node.numericStyle("border-width"), labelH: font * 1.4 * lines, ...reserve(id) };
      },
      order: (key, ids) => {
        const known = (this.treeOrder[key] || []).filter((id) => ids.includes(id));

        return known.concat(ids.filter((id) => !known.includes(id)));
      }
    });

    MetaCards.hold(() => cy.batch(() => {
      Object.entries(widths).forEach(([id, width]) => {
        const node = cy.getElementById(id);

        node.style("width", width - (node.outerWidth() - node.width()));
      });

      Object.entries(minWidths).forEach(([id, width]) => {
        cy.getElementById(id).style({ "min-width": width, "min-width-bias-left": "100%", "min-width-bias-right": "0%" });
      });

      Object.entries(positions).forEach(([id, point]) => cy.getElementById(id).position(point));
    }));

    MetaCards.placeAll(cy);
    this.updateEdges();

    if (fit) {
      cy.fit(undefined, 45);
    }
  },

  runLayout(name, options = {}) {
    if (name === "tree" && typeof TreeLayout !== "undefined") {
      this.runTree(options.fit !== false);
      return;
    }

    let base = this.LAYOUTS[name] ? name : "fcose";

    if (base === "fcose" && typeof cytoscapeFcose === "undefined") {
      base = "cose";
    }
    const layout = this.cy.layout(Object.assign(
      { name: base, animate: false, padding: 45, fit: options.fit !== false, eles: this.cy.elements().not(".meta-card") },
      this.LAYOUTS[base]
    ));

    MetaCards.hold(() => layout.run());
    MetaCards.placeAll(this.cy);
    this.updateEdges();
  },

  relayout(name) {
    if (name !== this.layoutName) {
      this.layoutName = name;
      this.cy.style(this.buildStyle());
      this.applyStyle();
    }

    this.saved = {};
    this.treeOrder = {};
    this.pinned = false;
    this.runLayout(name, { fit: true });
    MetaCards.placeAll(this.cy, { resetFree: true });
  },

  // A right-drag that panned the view must not open a context menu.
  menuAllowed() {
    return typeof Tools === "undefined" || !Tools.panned;
  },

  setData(node, key, value) {
    if (value === undefined || value === null) {
      node.removeData(key);
    } else {
      node.data(key, value);
    }
  },

  // Colour parsed to { r, g, b, a }; named / hsl colours are resolved through a canvas.
  resolveColor(value) {
    const parsed = Style.parseColor(value);

    if (parsed || !value) {
      return parsed;
    }

    try {
      this.colorContext = this.colorContext || document.createElement("canvas").getContext("2d");
      this.colorContext.fillStyle = "#000000";
      this.colorContext.fillStyle = String(value);

      return Style.parseColor(this.colorContext.fillStyle);
    } catch (error) {
      return null;
    }
  },

  // Effective background of a node (own fill composed over its parent / the canvas) and the theme text it would use.
  nodeBackground(node, memo, tok) {
    if (memo.has(node.id())) {
      return memo.get(node.id());
    }

    const rule = node.data("rule") || {};
    const parent = node.parent();
    const base = parent.nonempty() ? this.nodeBackground(parent, memo, tok).bg : this.resolveColor(tok("--canvas", "#ffffff"));
    const collapsed = node.hasClass("collapsed");
    const group = !collapsed && node.isParent();
    let fill;
    let text;

    if (collapsed) {
      fill = this.resolveColor(tok("--collapsed-fill", "rgba(124,58,237,0.16)"));
      text = tok("--collapsed-text", "#3b0764");
    } else if (group) {
      fill = this.resolveColor(tok(`--group-${Math.min(Number(node.data("depth")) || 0, 3)}-fill`, "rgba(37,99,235,0.06)"));
      text = tok("--group-text", "#1e3a8a");
    } else {
      fill = this.resolveColor(tok(`--node-${node.data("typeKey") || "default"}`, "#0369a1"));
      text = tok("--node-text", "#ffffff");
    }

    const own = rule.color ? this.resolveColor(rule.color) : null;
    const source = own ? { r: own.r, g: own.g, b: own.b, a: collapsed ? 1 : (fill ? fill.a : 1) } : fill;
    const bg = source && base ? Style.compose(source, base) : base;
    const result = { bg, text };

    memo.set(node.id(), result);

    return result;
  },

  // Auto contrast text colour of every node and edge label (recomputed on theme / rule change).
  applyTextContrast(tok) {
    const memo = new Map();
    const canvas = this.resolveColor(tok("--canvas", "#ffffff"));

    this.cy.nodes().not(".meta-card").forEach((node) => {
      const rule = node.data("rule") || {};
      const info = this.nodeBackground(node, memo, tok);
      const own = rule.textBackground ? this.resolveColor(rule.textBackground) : null;
      const behind = own ? Style.compose(own, info.bg || canvas) : info.bg;

      this.setData(node, "autoText", behind ? Style.autoText(behind, info.text) : undefined);
    });

    const labelBg = this.resolveColor(tok("--edge-label-bg", "#ffffff"));
    const labelBehind = labelBg && canvas ? Style.compose(labelBg, canvas, 0.92) : canvas;

    this.cy.edges().forEach((edge) => {
      const preferred = edge.hasClass("meta") ? tok("--meta-edge-text", "#92400e") : tok("--edge-text", "#475569");

      this.setData(edge, "autoText", labelBehind ? Style.autoText(labelBehind, preferred) : undefined);
    });
  },

  // Colour, border and opacity go through data mappers so that state classes keep priority.
  applyStyle() {
    const scale = Style.scale();
    const cache = new Map();
    const tok = (name, fallback) => {
      if (!cache.has(name)) {
        cache.set(name, this.token(name, fallback));
      }

      return cache.get(name);
    };

    this.cy.batch(() => {
      this.cy.edges().removeClass("hl-edge");

      this.cy.edges().forEach((edge) => {
        const link = edge.data("linkStyle") || {};

        this.setData(edge, "lsColor", link.color);
        this.setData(edge, "lsWidth", link.width);
        this.setData(edge, "lsLine", link.line);
        this.setData(edge, "lsArrow", link.arrow);
        this.setData(edge, "lsSource", link.sourceArrow);
        this.setData(edge, "lsText", link.textColor);
      });

      this.cy.nodes().not(".meta-card").forEach((node) => {
        const rule = node.data("rule") || {};
        const size = scale * (Number(rule.size) || 1);
        const isGroup = node.isParent();
        const styles = { "font-size": (isGroup ? 12 : 11) * size };

        node.removeStyle();
        this.setData(node, "ruleColor", rule.color);
        this.setData(node, "ruleBorder", rule.border);
        this.setData(node, "ruleOpacity", rule.opacity);
        this.setData(node, "ruleBorderStyle", rule.borderStyle);
        // Expanded compounds are always drawn as rectangles by Cytoscape: the shape only applies to leaves and collapsed groups.
        this.setData(node, "ruleShape", isGroup ? undefined : rule.shape);
        this.setData(node, "ruleBorderWidth", rule.borderWidth);
        this.setData(node, "ruleText", rule.textColor);
        this.setData(node, "ruleBold", rule.bold ? true : undefined);
        this.setData(node, "ruleItalic", rule.italic ? true : undefined);
        this.setData(node, "ruleTextBg", rule.textBackground);

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

      this.applyTextContrast(tok);
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

      this.cy.nodes().filter((node) => !sets.nodes.has(node.data("owner") || node.id())).addClass("focus-dim");
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

      if (!node.selected()) {
        this.cy.elements(":selected").unselect();
        node.select();
      }

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
      if (!node.isParent() && (!node.hasClass("meta-card") || node.data("free"))) {
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

    const matches = model.nodes.filter((node) => Style.matchSearch(criteria, node));

    const ids = new Set(matches.map((node) => node.id));

    this.cy.nodes().not(".meta-card").forEach((node) => {
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

  // Text / regex plus type:x role:y filters (see Style.parseSearch).
  parseSearch(text) {
    return Style.parseSearch(text);
  }
};
