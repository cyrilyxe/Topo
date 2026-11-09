"use strict";

// Graphical editing tools (selection, hand, brick, link, move), deletion and layer order.
// Every change goes through App.edit -> DocEdit, so the YAML stays the source of truth.
const Tools = {
  STORE_KEY: "topo:tool",
  DELETE_KEY: "delete.relinkToParent",
  TOOLS: [
    { id: "select", key: "V", name: "Sélection", icon: "<path d=\"M5 3l14 8-6 2-3 6z\" />" },
    { id: "hand", key: "H", name: "Main", icon: "<path d=\"M8 12V6a1.5 1.5 0 013 0v5m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L8 14\" />" },
    { id: "brick", key: "B", name: "Brique", icon: "<rect x=\"4\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\" /><path d=\"M19 3v6M16 6h6\" />" },
    { id: "link", key: "L", name: "Lien", icon: "<circle cx=\"5\" cy=\"18\" r=\"2.5\" /><circle cx=\"19\" cy=\"6\" r=\"2.5\" /><path d=\"M7 16.5L17 7.5\" stroke-dasharray=\"3 2\" />" },
    { id: "move", key: "M", name: "Déplacer dans…", icon: "<rect x=\"3\" y=\"12\" width=\"18\" height=\"9\" rx=\"2\" /><path d=\"M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5\" />" }
  ],
  HELP: {
    select: "Sélection : clic = sélectionner (Maj/Ctrl pour ajouter), glissez le fond pour un rectangle, glissez une brique pour la déplacer — clic droit/milieu = déplacer la vue, molette = zoom — Suppr pour supprimer",
    hand: "Main : clic gauche maintenu = déplacer la vue (ou clic droit/milieu), molette = zoom — Échap pour revenir à la sélection",
    brick: "Brique : cliquez une brique pour lui ajouter un enfant, ou le fond pour une brique racine — clic droit/milieu = déplacer la vue, molette = zoom — Échap : sélection",
    link: "Lien : glissez d’une brique à une autre pour les relier, clic = inspecter — clic droit/milieu = déplacer la vue, molette = zoom — Échap pour annuler",
    move: "Glissez une brique sur une autre pour l’y ranger, ou sur le fond pour la sortir à la racine — clic droit/milieu = déplacer la vue, molette = zoom — Échap annule"
  },
  PLAN: [["front", "Premier plan"], ["forward", "Avancer"], ["backward", "Reculer"], ["back", "Arrière-plan"]],

  tool: "select",
  spaceDown: false,
  mod: false,
  muted: false,
  linkDrag: null,
  panDrag: null,
  panned: false,
  hovered: null,
  moveDrag: null,
  els: {},
  changeTimer: null,

  // ---- setup ----

  init() {
    const wrap = document.querySelector(".graph-wrap");

    this.cy = Graph.cy;
    this.els.wrap = wrap;
    this.els.bar = document.getElementById("tools-bar");
    this.els.help = document.getElementById("tools-help");
    this.buildBar();
    this.buildOverlay(wrap);
    this.buildTip(wrap);
    this.bindCy();
    this.bindKeys();

    const saved = App.read(this.STORE_KEY);

    this.setTool(this.TOOLS.some((tool) => tool.id === saved) ? saved : "select");
  },

  get current() {
    return this.spaceDown ? "hand" : this.tool;
  },

  buildBar() {
    this.els.bar.innerHTML = this.TOOLS.map((tool) => `
      <button type="button" class="tool-btn" data-tool="${tool.id}" title="${tool.name} (${tool.key})" aria-label="${tool.name}" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${tool.icon}</svg>
      </button>`).join("");

    this.els.bar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tool]");

      if (button) {
        this.setTool(button.dataset.tool);
      }
    });
  },

  buildOverlay(wrap) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    svg.setAttribute("class", "tools-overlay");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = "<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"0\" />";
    svg.setAttribute("hidden", "");
    wrap.appendChild(svg);
    this.els.overlay = svg;
    this.els.line = svg.querySelector("line");
  },

  buildTip(wrap) {
    const tip = document.createElement("div");

    tip.className = "tools-tip";
    tip.hidden = true;
    wrap.appendChild(tip);
    this.els.tip = tip;
  },

  setTool(id) {
    if (!this.TOOLS.some((tool) => tool.id === id)) {
      return;
    }

    this.cancelLink();
    this.cancelMove();
    this.clearHover();
    this.tool = id;
    App.store(this.STORE_KEY, id);
    this.applyTool();
  },

  applyTool() {
    const cy = this.cy;
    const current = this.current;

    cy.userPanningEnabled(current === "brick" || current === "link");
    cy.boxSelectionEnabled(current === "select");
    cy.userZoomingEnabled(true);
    cy.autoungrabify(current !== "select" && current !== "move");
    cy.autounselectify(current === "hand");

    this.els.wrap.dataset.tool = current;
    this.els.help.textContent = this.HELP[current];
    this.els.bar.querySelectorAll("[data-tool]").forEach((button) => {
      const active = button.dataset.tool === this.tool;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  },

  // ---- selection ----

  selection() {
    return {
      nodes: this.cy.nodes(":selected").not(".meta-card").map((node) => node.id()),
      edges: this.cy.edges(":selected").map((edge) => edge.id())
    };
  },

  snapshot() {
    return this.cy ? this.selection() : null;
  },

  restore(snapshot) {
    if (!snapshot) {
      return;
    }

    this.muted = true;
    snapshot.nodes.concat(snapshot.edges).forEach((id) => this.cy.getElementById(id).select());
    this.muted = false;
    this.syncSelection();
  },

  syncSelection() {
    if (typeof StyleUI !== "undefined" && typeof StyleUI.setTargets === "function") {
      StyleUI.setTargets(this.selection().nodes);
    }
  },

  selectIds(ids) {
    this.cy.elements().unselect();
    ids.forEach((id) => this.cy.getElementById(id).select());

    if (ids.length === 1 && App.getModel() && App.getModel().byId.has(ids[0])) {
      App.inspectNode(ids[0], { center: false });
    }
  },

  // Returns true when the tap must not trigger the usual inspection.
  onNodeTap() {
    return this.current !== "select" || this.mod;
  },

  // ---- cytoscape events ----

  bindCy() {
    const cy = this.cy;

    cy.on("select unselect", () => {
      if (!this.muted) {
        clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => this.syncSelection(), 0);
      }
    });

    cy.on("mousedown", (event) => {
      const original = event.originalEvent || {};

      this.mod = Boolean(original.shiftKey || original.ctrlKey || original.metaKey);
      cy.selectionType(this.mod ? "additive" : "single");
    });

    cy.on("tap", (event) => {
      if (this.current !== "brick" || (event.target !== cy && event.target.hasClass("meta-card"))) {
        return;
      }

      this.addBrick(event.target === cy ? null : event.target.id(), event.position && { x: event.position.x, y: event.position.y });
    });

    cy.on("cxttap", (event) => {
      this.menuPoint = event.position ? { x: event.position.x, y: event.position.y } : null;
    });

    cy.on("mousedown", (event) => this.linkStart(event));
    cy.on("grab", "node", (event) => this.moveStart(event.target));
    cy.on("drag", "node", () => this.moveKeep());
    cy.on("free", "node", (event) => this.moveEnd(event.target));
    window.addEventListener("mousemove", (event) => this.moveTrack(event));
    window.addEventListener("mousemove", (event) => this.linkMove(event));
    window.addEventListener("mouseup", (event) => this.linkEnd(event));
    window.addEventListener("blur", () => this.cancelLink());
    this.bindPan();
    this.bindHover();
  },

  // ---- right / middle button pan (every tool) ----

  bindPan() {
    const container = this.cy.container();

    container.addEventListener("mousedown", (event) => this.panStart(event), true);
    container.addEventListener("auxclick", (event) => event.preventDefault());
    container.addEventListener("wheel", (event) => this.wheelZoom(event), { passive: false, capture: true });
    window.addEventListener("mousemove", (event) => this.panMove(event));
    window.addEventListener("mouseup", () => {
      this.panDrag = null;
    });
    window.addEventListener("blur", () => {
      this.panDrag = null;
    });
  },

  // Cytoscape only zooms with the wheel while its own user panning is on (brick and link tools).
  wheelZoom(event) {
    if (this.cy.userPanningEnabled()) {
      return;
    }

    const rect = this.cy.container().getBoundingClientRect();

    event.preventDefault();
    event.stopPropagation();
    this.cy.zoom({
      level: this.cy.zoom() * Math.pow(2, -event.deltaY / 300),
      renderedPosition: { x: event.clientX - rect.left, y: event.clientY - rect.top }
    });
  },

  panStart(event) {
    this.panned = Boolean(this.linkDrag) && event.button === 2;

    if (event.button === 1 || event.button === 2 || (event.button === 0 && this.current === "hand")) {
      this.panDrag = { x: event.clientX, y: event.clientY, last: { x: event.clientX, y: event.clientY }, moved: false };
      this.clearHover();

      if (event.button === 1) {
        event.preventDefault();
      }
    }
  },

  panMove(event) {
    const drag = this.panDrag;

    if (!drag) {
      return;
    }

    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) {
      return;
    }

    drag.moved = true;
    this.panned = true;
    this.cy.panBy({ x: event.clientX - drag.last.x, y: event.clientY - drag.last.y });
    drag.last = { x: event.clientX, y: event.clientY };
  },

  // ---- hover aura and tooltip (brick and link tools) ----

  bindHover() {
    const container = this.cy.container();

    container.addEventListener("mousemove", (event) => this.hoverMove(event));
    container.addEventListener("mouseleave", () => this.clearHover());
    this.els.wrap.addEventListener("dragstart", (event) => event.preventDefault());
  },

  hoverMove(event) {
    const current = this.current;

    if (this.panDrag || this.moveDrag || this.linkDrag || (current !== "brick" && current !== "link")) {
      return;
    }

    const node = this.nodeAt(event.clientX, event.clientY);

    this.setHover(node);

    if (current === "brick") {
      this.showTip(event, node ? `Ajouter dans « ${this.labelOf(node.id())} »` : "Ajouter à la racine");
    } else {
      this.els.tip.hidden = true;
    }
  },

  labelOf(id) {
    const model = App.getModel();
    const item = model && model.byId.get(id);

    return item ? item.label : id;
  },

  setHover(node) {
    if (node === this.hovered) {
      return;
    }

    this.cy.nodes().removeClass("tool-hover");
    this.hovered = node;

    if (node) {
      node.addClass("tool-hover");
    }
  },

  showTip(event, text) {
    const tip = this.els.tip;

    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${event.clientX + 14}px`;
    tip.style.top = `${event.clientY + 18}px`;
  },

  clearHover() {
    this.hovered = null;

    if (this.cy) {
      this.cy.nodes().removeClass("tool-hover");
    }

    if (this.els.tip) {
      this.els.tip.hidden = true;
    }
  },

  // ---- link tool ----

  linkStart(event) {
    const original = event.originalEvent || {};

    if (this.current !== "link" || (original.button || 0) !== 0) {
      return;
    }

    const source = this.nodeAt(original.clientX, original.clientY);

    if (!source) {
      return;
    }

    this.linkDrag = { source, shown: null };
    this.els.tip.hidden = true;
    this.cy.userPanningEnabled(false);
    this.drawLine(event.renderedPosition);
    this.showHovered(null);
  },

  // Deepest (smallest) node under a client point, or null.
  nodeAt(clientX, clientY) {
    const rect = this.cy.container().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let area = Infinity;

    this.cy.nodes().not(".meta-card").forEach((node) => {
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });

      if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2 && box.w * box.h < area) {
        best = node;
        area = box.w * box.h;
      }
    });

    return best;
  },

  linkMove(event) {
    if (!this.linkDrag) {
      return;
    }

    if (!(event.buttons & 1)) {
      this.cancelLink();
      return;
    }

    const rect = this.cy.container().getBoundingClientRect();
    const hover = this.nodeAt(event.clientX, event.clientY);

    this.setHover(hover);
    this.showHovered(hover);

    this.drawLine({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    this.cy.nodes().removeClass("link-hover");

    if (hover && hover !== this.linkDrag.source) {
      hover.addClass("link-hover");
    }
  },

  // While dragging a link, the inspector follows the hovered box (it cannot be clicked).
  showHovered(hover) {
    const id = hover ? hover.id() : this.linkDrag.source.id();

    if (id === this.linkDrag.shown || !App.getModel() || !App.getModel().byId.has(id)) {
      return;
    }

    this.linkDrag.shown = id;
    App.setLinkHeader({ from: this.linkDrag.source.id(), to: hover && hover !== this.linkDrag.source ? id : null });
    Inspector.showNode(id, App.getModel(), App.collapsed);

    if (typeof App.showTab === "function") {
      App.showTab("inspector");
    }
  },

  drawLine(point) {
    const from = this.linkDrag.source.renderedPosition();

    this.els.line.setAttribute("x1", from.x);
    this.els.line.setAttribute("y1", from.y);
    this.els.line.setAttribute("x2", point.x);
    this.els.line.setAttribute("y2", point.y);
    this.els.overlay.removeAttribute("hidden");
  },

  cancelLink() {
    if (!this.linkDrag) {
      return;
    }

    this.linkDrag = null;
    App.setLinkHeader(null);
    this.applyTool();
    this.hideLine();
    this.cy.nodes().removeClass("link-hover");
    this.clearHover();
  },

  hideLine() {
    this.els.overlay.setAttribute("hidden", "");
    ["x1", "y1", "x2", "y2"].forEach((name) => this.els.line.setAttribute(name, 0));
  },

  linkEnd(event) {
    const drag = this.linkDrag;

    if (!drag || event.button !== 0) {
      return;
    }

    const target = this.nodeAt(event.clientX, event.clientY);

    this.cancelLink();

    if (!target) {
      return;
    }

    if (target.id() === drag.source.id()) {
      App.inspectNode(target.id(), { tab: "inspector", center: false });
      return;
    }

    this.addLink(drag.source.id(), target.id());
  },

  async addLink(from, to) {
    const values = await Forms.link({ from, to });

    if (values && App.edit(`Ajout du lien ${from} → ${to}`, (text) => DocEdit.addLink(text, values))) {
      App.showMessage(`Lien ajouté : ${values.from} → ${values.to}.`, "success");
    }
  },

  // ---- move tool ("Déplacer dans…") ----

  ensureMoveStyles() {
    const style = this.cy.style();

    if (style.json().some((rule) => rule.selector === "node.drop-target")) {
      return;
    }

    const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

    style
      .selector("node.floating").style({ opacity: 0.55, "z-index": 9999, "z-index-compare": "manual" })
      .selector("node.drop-target").style({
        "border-color": token("--drop-target", "#16a34a"),
        "underlay-color": token("--drop-target", "#16a34a"),
        "underlay-opacity": 0.25,
        "underlay-padding": 8
      })
      .update();
  },

  isMovable(id) {
    const model = App.getModel();

    return Boolean(model && model.byId.has(id) && !id.startsWith("card:"));
  },

  moveBoxes(dragId) {
    const model = App.getModel();
    const banned = new Set([dragId, ...this.descendants(model, dragId)]);
    const boxes = [];

    this.cy.nodes().forEach((node) => {
      const id = node.id();

      if (banned.has(id) || !this.isMovable(id)) {
        return;
      }

      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });

      boxes.push({ id, x1: box.x1, x2: box.x2, y1: box.y1, y2: box.y2, area: box.w * box.h });
    });

    return boxes;
  },

  // Deepest box (frozen at grab time, so the parent does not stretch with the dragged brick) under a client point.
  moveTargetAt(clientX, clientY) {
    const rect = this.cy.container().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;

    this.moveDrag.boxes.forEach((box) => {
      if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2 && (!best || box.area < best.area)) {
        best = box;
      }
    });

    return best ? best.id : null;
  },

  movePositions(node) {
    const out = {};

    node.union(node.descendants()).nodes().filter((item) => !item.isParent()).forEach((item) => {
      out[item.id()] = { ...item.position() };
    });

    return out;
  },

  moveStart(node) {
    if (this.current !== "move" || this.moveDrag) {
      return;
    }

    if (!this.isMovable(node.id())) {
      node.ungrabify();
      setTimeout(() => node.grabify(), 0);
      return;
    }

    this.ensureMoveStyles();
    this.moveDrag = {
      id: node.id(),
      parent: App.getModel().byId.get(node.id()).parent || null,
      origin: this.movePositions(node),
      boxes: this.moveBoxes(node.id()),
      target: App.getModel().byId.get(node.id()).parent || null,
      cancelled: false,
      node,
      started: false
    };
  },

  // The drag really starts on the first movement, so that clicks and double-clicks (expand/collapse) still reach the brick.
  moveBegin() {
    const drag = this.moveDrag;

    if (!drag || drag.started) {
      return;
    }

    drag.started = true;
    drag.node.addClass("floating");
    this.moveFreezeStart(drag.node);
  },

  // ---- frozen ancestor borders while a brick is dragged ----

  FREEZE_STYLES: ["min-width", "min-height", "min-width-bias-left", "min-width-bias-right", "min-height-bias-top", "min-height-bias-bottom"],

  // The real brick is hidden (so that it does not stretch its parents) and a root silhouette follows it;
  // every ancestor keeps its original box, except the host (deepest original box holding the silhouette's centre) and above, which stretch.
  moveFreezeStart(node) {
    const drag = this.moveDrag;

    if (!drag || App.layout === "tree" || !this.cy) {
      return;
    }

    const list = node.ancestors().toArray().sort((a, b) => b.ancestors().length - a.ancestors().length);
    const box = Repulsion.boxOf(node, false);
    const first = Repulsion.leavesOf(node)[0] || node;
    const ghost = this.cy.add({
      group: "nodes",
      data: { id: "__ghost", label: String(node.data("display") || node.data("label") || "") },
      position: { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 },
      classes: "floating",
      grabbable: false,
      selectable: false
    });

    ghost.style({
      width: node.width(),
      height: node.height(),
      padding: node.style("padding"),
      shape: node.style("shape"),
      "background-color": node.style("background-color"),
      "border-width": node.style("border-width"),
      "border-color": node.style("border-color"),
      "font-size": node.style("font-size"),
      color: node.style("color"),
      "text-valign": "center",
      events: "no"
    });

    drag.freeze = {
      node,
      ghost,
      list,
      leaf: first,
      leafStart: { ...first.position() },
      start: { ...ghost.position() },
      origin: Object.fromEntries(list.map((item) => [item.id(), Repulsion.boxOf(item, false)]))
    };
    node.style("display", "none");
    // Ancestors are frozen once, deepest first: no stretching while dragging (the drop target is shown by its aura).
    list.forEach((item) => this.freezeBox(item, drag.freeze.origin[item.id()]));
    this.moveFreezeUpdate();
  },

  freezeBox(item, want) {
    const px = (value) => `${Math.max(0, value)}px`;

    item.style({ "min-width": 0, "min-height": 0 });

    const cur = Repulsion.boxOf(item, false);
    const w = want.x2 - want.x1;
    const h = want.y2 - want.y1;
    const extraW = w - (cur.x2 - cur.x1);
    const extraH = h - (cur.y2 - cur.y1);
    const left = extraW > 0.5 ? Math.min(1, Math.max(0, (cur.x1 - want.x1) / extraW)) : 0.5;
    const top = extraH > 0.5 ? Math.min(1, Math.max(0, (cur.y1 - want.y1) / extraH)) : 0.5;
    const set = (mw, mh) => item.style({
      "min-width": px(mw),
      "min-height": px(mh),
      "min-width-bias-left": `${left * 100}%`,
      "min-width-bias-right": `${(1 - left) * 100}%`,
      "min-height-bias-top": `${top * 100}%`,
      "min-height-bias-bottom": `${(1 - top) * 100}%`
    });

    set(extraW > 0.5 ? w : 0, extraH > 0.5 ? h : 0);

    const got = Repulsion.boxOf(item, false);
    const fixW = extraW > 0.5 ? w + (w - (got.x2 - got.x1)) : 0;
    const fixH = extraH > 0.5 ? h + (h - (got.y2 - got.y1)) : 0;

    if (Math.abs(fixW - w) > 1 || Math.abs(fixH - h) > 1) {
      set(fixW, fixH);
    }
  },

  moveFreezeUpdate() {
    const drag = this.moveDrag;
    const fz = drag && drag.freeze;

    if (!fz) {
      return;
    }

    fz.ghost.position({ x: fz.start.x + fz.leaf.position("x") - fz.leafStart.x, y: fz.start.y + fz.leaf.position("y") - fz.leafStart.y });
  },

  moveFreezeEnd() {
    const drag = this.moveDrag;
    const fz = drag && drag.freeze;

    if (!fz) {
      return;
    }

    drag.freeze = null;
    fz.ghost.remove();
    fz.list.forEach((item) => item.removeStyle(this.FREEZE_STYLES.join(" ")));
    fz.node.removeStyle("display");
  },

  moveTrack(event) {
    const drag = this.moveDrag;

    if (!drag || !drag.started || drag.cancelled) {
      return;
    }

    const target = this.moveTargetAt(event.clientX, event.clientY);

    drag.pointer = { x: event.clientX, y: event.clientY };
    drag.target = target;
    this.cy.nodes().removeClass("drop-target");

    if (target !== null && target !== drag.parent) {
      this.cy.getElementById(target).addClass("drop-target");
    }
  },

  // After Escape the brick stays pinned to its origin until the mouse is released.
  moveKeep() {
    if (this.moveDrag && this.moveDrag.cancelled) {
      this.restorePositions(this.moveDrag);
    } else {
      this.moveBegin();
      this.moveFreezeUpdate();
    }
  },

  restorePositions(drag) {
    Object.keys(drag.origin).forEach((id) => this.cy.getElementById(id).position(drag.origin[id]));
  },

  clearMoveClasses() {
    this.cy.nodes().removeClass("floating drop-target");
  },

  cancelMove() {
    const drag = this.moveDrag;

    if (!drag || drag.cancelled) {
      return;
    }

    drag.cancelled = true;
    this.moveFreezeEnd();
    this.restorePositions(drag);
    this.clearMoveClasses();
    App.showMessage("Déplacement annulé.", "info");
  },

  moveEnd() {
    const drag = this.moveDrag;

    if (!drag) {
      return;
    }

    const ancestors = drag.freeze ? drag.freeze.list.map((item) => item.id()) : [];

    this.moveFreezeEnd();
    this.moveDrag = null;
    this.clearMoveClasses();

    if (!drag.started || drag.cancelled || !App.getModel().byId.has(drag.id)) {
      return;
    }

    if (drag.target === drag.parent) {
      Repulsion.settle([drag.id, ...ancestors]);
      return;
    }

    this.reparent(drag);
  },

  reparent(drag) {
    const model = App.getModel();
    const node = model.byId.get(drag.id);
    const target = drag.target === null ? null : model.byId.get(drag.target);
    const where = target ? `dans « ${target.label} »` : "à la racine";
    const wasCollapsed = Boolean(target) && App.collapsed.has(target.id);

    if (wasCollapsed) {
      App.collapsed.delete(target.id);
    }

    const moved = (text) => this.followIds(text, DocEdit.moveNode(text, drag.id, target ? target.id : null), drag.id);

    if (App.edit(`Déplacement de « ${node.label} » ${where}`, moved)) {
      App.showMessage(`« ${node.label} » déplacé ${where}.`, "success");
      Repulsion.settle([drag.id]);
      return;
    }

    if (wasCollapsed) {
      App.collapsed.add(target.id);
    }

    this.restorePositions(drag);
  },

  // ---- bricks ----

  async addBrick(parentId, point = null) {
    const values = await Forms.brick({ parentId });

    if (!values) {
      return;
    }

    const wasCollapsed = Boolean(parentId) && App.collapsed.has(parentId);
    const obj = { id: values.id, label: values.label };

    ["type", "role"].forEach((key) => {
      if (values[key]) {
        obj[key] = values[key];
      }
    });

    if (Object.keys(values.meta).length) {
      obj.meta = values.meta;
    }

    App.collapsed.delete(parentId);
    const fresh = this.newStyleKinds(values);

    if (App.edit(`Ajout de « ${values.label} »`, (text) => DocEdit.addNode(text, parentId, obj))) {
      const atClick = point && (!parentId || Settings.get("create.placement") === "click");

      if (!(atClick && this.placeAtPoint([values.id], point))) {
        this.placeBricks([values.id]);
      }

      Repulsion.settle([values.id], { newIds: [values.id] });
      this.selectIds([values.id]);
      this.offerStyleEditor(fresh, values.id);
    } else if (wasCollapsed) {
      App.collapsed.add(parentId);
    }
  },

  // A role/type never seen before (no brick, no style entry, not built-in) gets its style editor opened.
  newStyleKinds(values) {
    const model = App.getModel();
    const builtIn = ["service", "database", "application", "external", "queue", "group"];
    const fresh = [];

    [["role", "roles"], ["type", "types"]].forEach(([kind, key]) => {
      const value = values[kind];
      const known = model && (model.nodes.some((n) => n[kind] === value) || (model.style && model.style[key] && model.style[key][value]));

      if (value && !known && !(kind === "type" && builtIn.includes(String(value).toLowerCase()))) {
        fresh.push({ kind, value });
      }
    });

    return fresh;
  },

  offerStyleEditor(fresh, id) {
    if (!fresh.length || typeof Legend === "undefined" || typeof Legend.openStyleEditor !== "function") {
      return;
    }

    const anchor = document.querySelector(".legend, #legend") || document.getElementById("cy");
    setTimeout(() => Legend.openStyleEditor(fresh[0].kind, fresh[0].value, anchor), 50);
    App.showMessage(`Nouveau ${fresh[0].kind === "role" ? "rôle" : "type"} « ${fresh[0].value} » : définissez son style (il s'appliquera aux suivants).`, "info");
  },

  nodePatch(node, values) {
    const patch = {};
    const before = Forms.scalarMeta(node);
    const meta = {};

    if (values.label && values.label !== node.label) {
      patch.label = values.label;
    }

    if (values.type && values.type !== node.type) {
      patch.type = values.type;
    }

    if (values.role !== (node.role || "")) {
      patch.role = values.role || null;
    }

    Object.keys(values.meta).forEach((key) => {
      if (values.meta[key] !== before[key]) {
        meta[key] = values.meta[key];
      }
    });

    Object.keys(before).forEach((key) => {
      if (!(key in values.meta)) {
        meta[key] = null;
      }
    });

    if (Object.keys(meta).length) {
      patch.meta = meta;
    }

    return patch;
  },

  async editNode(id) {
    const node = App.getModel().byId.get(id);
    const values = node && await Forms.brick({ node });

    if (!values) {
      return;
    }

    const patch = this.nodePatch(node, values);
    const newId = values.id && values.id !== node.localId ? values.id : null;

    if (!Object.keys(patch).length && !newId) {
      return;
    }

    App.edit(`Modification de « ${node.label} »`, (text) => {
      let next = Object.keys(patch).length ? DocEdit.updateNode(text, id, patch) : text;

      if (newId) {
        next = DocEdit.renameId(next, id, newId);
      } else if (patch.label || patch.type) {
        next = this.followIds(text, next, id);
      }

      return next;
    });
  },

  // ---- placement of new bricks ----

  PLACE_GAP: 24,
  PLACE_COLS: 4,

  // Pure. First free spot for `box` among its siblings: right of the row of the last sibling, else a new row below.
  // Returns the { dx, dy } to apply to `box`; `others` are the boxes it must not overlap.
  slotFor(box, siblings, others, gap = this.PLACE_GAP, cols = this.PLACE_COLS) {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    const fit = (x1, y1) => {
      const wanted = { x1, y1, x2: x1 + w, y2: y1 + h };
      const shift = Repulsion.findFreeShift(wanted, others, gap);
      const moved = { x1: wanted.x1 + shift.dx, y1: wanted.y1 + shift.dy, x2: wanted.x2 + shift.dx, y2: wanted.y2 + shift.dy };

      return others.some((other) => Repulsion.overlaps(moved, other)) ? null : { dx: moved.x1 - box.x1, dy: moved.y1 - box.y1 };
    };

    if (!siblings.length) {
      return fit(box.x1, box.y1) || { dx: 0, dy: 0 };
    }

    const last = siblings[siblings.length - 1];
    const row = siblings.filter((item) => Math.min(item.y2, last.y2) - Math.max(item.y1, last.y1) > Math.min(item.y2 - item.y1, last.y2 - last.y1) / 2);
    const left = Math.min(...siblings.map((item) => item.x1));
    const below = Math.max(...siblings.map((item) => item.y2)) + gap;
    const tries = [];

    if (row.length < cols) {
      tries.push(() => fit(Math.max(...row.map((item) => item.x2)) + gap, (last.y1 + last.y2) / 2 - h / 2));
    }

    tries.push(() => fit(left, below));

    for (const attempt of tries) {
      const slot = attempt();

      if (slot) {
        return slot;
      }
    }

    const bottom = Math.max(below, ...others.map((item) => item.y2 + gap));

    return { dx: left - box.x1, dy: bottom - box.y1 };
  },

  // Moves each newly created brick (and its subtree) to a free slot in its parent, then keeps it as a manual position.
  placeBricks(ids) {
    const cy = this.cy;

    if (!cy || App.layout === "tree") {
      return false;
    }

    const roots = ids.map((id) => cy.getElementById(id)).filter((node) => node.nonempty());
    const waiting = new Set();

    roots.forEach((node) => {
      waiting.add(node.id());
      node.descendants().forEach((child) => waiting.add(child.id()));
    });

    let moved = false;

    roots.forEach((node) => {
      waiting.delete(node.id());
      node.descendants().forEach((child) => waiting.delete(child.id()));

      const parent = node.parent().nonempty() ? node.parent() : null;

      if (node.isParent()) {
        this.arrangeSubtree(node);
      }

      const lineage = new Set([node.id(), ...node.descendants().map((item) => item.id()), ...node.ancestors().map((item) => item.id())]);
      const real = cy.nodes().filter((item) => !item.hasClass("meta-card") && !waiting.has(item.id()));
      const siblings = real.filter((item) => item.id() !== node.id() && (parent ? item.parent().id() === parent.id() : item.parent().empty()));
      const others = real.filter((item) => !lineage.has(item.id()));
      const delta = this.slotFor(
        Repulsion.boxOf(node),
        siblings.map((item) => Repulsion.boxOf(item)),
        others.map((item) => Repulsion.boxOf(item))
      );

      this.shiftLeaves(node, delta);

      const clear = Repulsion.resolve(Repulsion.snapshot(cy), node.id(), { margin: Repulsion.MARGIN });

      if (clear.ok) {
        this.shiftLeaves(node, clear);
      }

      moved = true;
    });

    if (moved) {
      Graph.pinned = true;
      App.schedulePersistView();
    }

    return moved;
  },

  // Puts the top-left corner of the first brick (and its subtree) at a model point; the other ones take a free slot.
  placeAtPoint(ids, point) {
    const cy = this.cy;

    if (!cy || App.layout === "tree" || !point) {
      return false;
    }

    const node = cy.getElementById(ids[0]);

    if (node.empty()) {
      return false;
    }

    if (node.isParent()) {
      this.arrangeSubtree(node);
    }

    const box = Repulsion.boxOf(node);

    this.shiftLeaves(node, { dx: point.x - box.x1, dy: point.y - box.y1 });

    if (ids.length > 1) {
      this.placeBricks(ids.slice(1));
    }

    Graph.pinned = true;
    App.schedulePersistView();

    return true;
  },

  // A pasted group arrives with its leaves stacked around one point: lay its children out in rows, recursively.
  arrangeSubtree(root) {
    const gap = this.PLACE_GAP;
    const cols = this.PLACE_COLS;

    const measure = (node) => {
      const kids = node.children().not(".meta-card");

      if (kids.empty()) {
        const box = Repulsion.boxOf(node);

        return { node, w: box.x2 - box.x1, h: box.y2 - box.y1, kids: [] };
      }

      const blocks = kids.map(measure);
      let x = 0;
      let y = 0;
      let rowH = 0;
      let width = 0;

      blocks.forEach((block, index) => {
        if (index && index % cols === 0) {
          y += rowH + gap;
          x = 0;
          rowH = 0;
        }

        block.x = x;
        block.y = y;
        x += block.w + gap;
        rowH = Math.max(rowH, block.h);
        width = Math.max(width, x - gap);
      });

      const pad = (node.numericStyle("padding") || 0) + 32;

      return { node, w: width + pad * 2, h: y + rowH + pad * 2, kids: blocks, pad };
    };

    const place = (block, left, top) => {
      if (!block.kids.length) {
        block.node.position({ x: left + block.w / 2, y: top + block.h / 2 });
        return;
      }

      block.kids.forEach((kid) => place(kid, left + block.pad + kid.x, top + block.pad + kid.y));
    };
    const origin = Repulsion.boxOf(root);

    place(measure(root), origin.x1, origin.y1);
  },

  shiftLeaves(node, delta) {
    if (!delta.dx && !delta.dy) {
      return;
    }

    Repulsion.leavesOf(node).forEach((leaf) => leaf.position({ x: leaf.position("x") + delta.dx, y: leaf.position("y") + delta.dy }));
  },

  // ---- ids that follow the label / the parent ----

  followIds(before, after, id) {
    return Settings.get("ids.followMove") ? DocEdit.followId(before, after, id, Settings.get("ids.scheme")) : after;
  },

  // ---- links ----

  // Raw index (in the YAML links list) of each model link, replaying the parser's filtering.
  rawLinkIndexes(model, text) {
    const raw = Schema.normalize(jsyaml.load(text));
    const out = [];

    (raw.links || []).forEach((link, index) => {
      const from = Model.resolveRef(link.from, model);
      const to = Model.resolveRef(link.to, model);

      if (!from.error && !to.error && from.id !== to.id) {
        out.push(index);
      }
    });

    return out;
  },

  // Real links carried by a drawn edge (several when it is a meta edge or merged duplicates).
  linksOfEdge(edge) {
    const model = App.getModel();
    const source = edge.data("source");
    const target = edge.data("target");
    const indexes = this.rawLinkIndexes(model, App.getText());

    return model.links
      .map((link, k) => ({ link, index: indexes[k] }))
      .filter(({ link }) => (
        Model.visibleAncestor(link.from, model, App.collapsed) === source &&
        Model.visibleAncestor(link.to, model, App.collapsed) === target
      ));
  },

  async editLink(edgeId) {
    const edge = this.cy.getElementById(edgeId);
    const found = edge.empty() || edge.data("isMeta") ? [] : this.linksOfEdge(edge);

    if (!found.length) {
      App.showMessage("Ce lien ne peut pas être modifié (lien groupé ou introuvable).", "warning");
      return;
    }

    const { link, index } = found[0];
    const values = await Forms.link({ from: link.from, to: link.to, label: link.label, editing: true });

    if (!values) {
      return;
    }

    const patch = { from: values.from, to: values.to, label: values.label || null };

    App.edit("Modification d’un lien", (text) => DocEdit.updateLink(text, index, patch));
  },

  // ---- deletion ----

  descendants(model, id) {
    const out = [];
    const walk = (current) => model.byId.get(current).children.forEach((child) => {
      out.push(child);
      walk(child);
    });

    walk(id);

    return out;
  },

  topMost(model, ids) {
    const set = new Set(ids);

    return ids.filter((id) => {
      for (let parent = model.byId.get(id).parent; parent; parent = model.byId.get(parent).parent) {
        if (set.has(parent)) {
          return false;
        }
      }

      return true;
    });
  },

  deletionPlan(nodeIds, edgeIds) {
    const model = App.getModel();
    const roots = this.topMost(model, nodeIds.filter((id) => model.byId.has(id)));
    const removed = new Set(roots);

    roots.forEach((id) => this.descendants(model, id).forEach((child) => removed.add(child)));

    const touching = model.links.filter((link) => removed.has(link.from) || removed.has(link.to));
    const edgeLinks = new Map();

    edgeIds.forEach((edgeId) => {
      const edge = this.cy.getElementById(edgeId);

      if (edge.nonempty()) {
        this.linksOfEdge(edge).forEach((item) => {
          if (!removed.has(item.link.from) && !removed.has(item.link.to)) {
            edgeLinks.set(item.index, item.link);
          }
        });
      }
    });

    return { model, roots, removedCount: removed.size, touching: touching.length, edgeLinks };
  },

  describePlan(plan) {
    const { model, roots, removedCount, touching, edgeLinks } = plan;
    const items = [];

    if (roots.length) {
      const names = roots.slice(0, 6).map((id) => `« ${escapeHtml(model.byId.get(id).label)} »`).join(", ");
      const extra = removedCount - roots.length;

      items.push(`<li>${roots.length} brique(s) : ${names}${roots.length > 6 ? "…" : ""}${extra ? ` (avec ${extra} descendante(s))` : ""}</li>`);
      items.push(`<li>${touching} lien(s) rattaché(s) à ces briques</li>`);
    }

    if (edgeLinks.size) {
      items.push(`<li>${edgeLinks.size} lien(s) sélectionné(s)${roots.length ? " en plus" : ""}</li>`);
    }

    return `<p>Seront supprimés :</p><ul>${items.join("")}</ul>${roots.length ? "<p class=\"forms-hint\">Les briques vont dans la corbeille ; Ctrl+Z annule.</p>" : ""}`;
  },

  async requestDelete(nodeIds, edgeIds) {
    const selection = this.selection();
    const nodes = nodeIds || selection.nodes;
    const edges = edgeIds || (nodeIds ? [] : selection.edges);
    const plan = this.deletionPlan(nodes, edges);

    if (!plan.roots.length && !plan.edgeLinks.size) {
      return;
    }

    const answer = await Forms.confirm({
      title: "Supprimer la sélection",
      html: this.describePlan(plan),
      okLabel: "Supprimer",
      danger: true,
      checkbox: plan.roots.length ? { label: "Rattacher les liens au parent", checked: Boolean(Settings.get(this.DELETE_KEY)) } : null
    });

    if (answer) {
      this.applyDelete(plan, answer.checked);
    }
  },

  applyDelete(plan, relinkToParent) {
    const { model, roots, edgeLinks } = plan;
    const total = plan.removedCount + edgeLinks.size;
    const label = roots.length === 1 && !edgeLinks.size ? `Suppression de « ${model.byId.get(roots[0]).label} »` : `Suppression de ${total} élément(s)`;

    if (roots.length) {
      Settings.set(this.DELETE_KEY, relinkToParent);
    }

    App.edit(label, (text) => {
      let next = text;

      if (edgeLinks.size) {
        next = DocEdit.removeLinks(next, [...edgeLinks.keys()]);
      }

      if (roots.length) {
        const result = DocEdit.removeNodes(next, roots, { relinkToParent });

        next = DocEdit.trashPush(result.text, result.trashed);
      }

      return next;
    });
  },

  // ---- layer order ----

  center() {
    const rect = this.cy.container().getBoundingClientRect();

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },

  planActions(id, position) {
    const node = App.getModel().byId.get(id);
    const actions = this.PLAN.map(([op, name], index) => ({
      separator: index === 0,
      label: `Plan : ${name}`,
      run: () => this.reorder([id], op, position)
    }));

    if (node && node.parent) {
      const parent = App.getModel().byId.get(node.parent);

      actions.push({ label: `Plan du parent (${parent.label}) ▸`, run: () => setTimeout(() => this.parentPlanMenu(parent.id, position), 0) });
    }

    return actions;
  },

  parentPlanMenu(parentId, position) {
    const parent = App.getModel().byId.get(parentId);

    App.openMenu(position || this.center(), `Plan de « ${parent.label} »`, this.PLAN.map(([op, name]) => ({
      label: name,
      run: () => this.reorder([parentId], op, position)
    })));
  },

  reorder(ids, op, position) {
    const text = App.getText();
    const name = this.PLAN.find(([key]) => key === op)[1];
    let next = text;

    try {
      ids.forEach((id) => {
        next = DocEdit.reorder(next, id, op);
      });
    } catch (error) {
      App.showMessage(error.message, "error");
      return;
    }

    if (next === text) {
      this.offerParent(ids[0], op, position);
    } else {
      App.edit(`Plan : ${name}`, () => next);
    }
  },

  offerParent(id, op, position) {
    const model = App.getModel();
    const node = model.byId.get(id);
    const frontSide = op === "front" || op === "forward";
    const where = frontSide ? "au premier plan" : "à l’arrière-plan";

    if (!node || !node.parent) {
      App.showMessage(`« ${node ? node.label : id} » est déjà ${where}.`, "info");
      return;
    }

    const parent = model.byId.get(node.parent);

    setTimeout(() => App.openMenu(position || this.center(), `Déjà ${where} de son niveau`, [
      { label: `Appliquer au parent (${parent.label})`, run: () => this.reorder([parent.id], op, position) }
    ]), 0);
  },

  reorderSelection(op) {
    const ids = this.selection().nodes;
    const single = ids.length ? ids : Graph.selectedId ? [Graph.selectedId] : [];

    if (single.length) {
      this.reorder(single, op);
    }
  },

  // ---- keyboard ----

  typing(event) {
    return Boolean(event.target && event.target.closest && event.target.closest(".CodeMirror, input, textarea, select, [contenteditable='true']"));
  },

  bindKeys() {
    document.addEventListener("keydown", (event) => this.onKeyDown(event));
    document.addEventListener("keyup", (event) => {
      if (event.key === " " && this.spaceDown) {
        this.spaceDown = false;
        this.applyTool();
      }
    });
    window.addEventListener("blur", () => {
      this.spaceDown = false;
      this.applyTool();
    });
  },

  onKeyDown(event) {
    if (Forms.isOpen() || (typeof Help !== "undefined" && Help.isOpen()) || this.typing(event)) {
      return;
    }

    const mod = event.ctrlKey || event.metaKey;

    if (mod) {
      this.onModKey(event);
    } else if (!event.altKey) {
      this.onPlainKey(event);
    }
  },

  onModKey(event) {
    const code = event.code;
    const clip = !event.shiftKey && !event.altKey && ["c", "x", "v"].includes(event.key.toLowerCase());

    if (clip && typeof Clipboard !== "undefined") {
      const key = event.key.toLowerCase();

      if (key !== "v" && String(window.getSelection()).length) {
        return;
      }

      event.preventDefault();
      Clipboard[{ c: "copy", x: "cut", v: "paste" }[key]]();
      return;
    }

    const forward = event.key === "]" || event.key === "}" || code === "BracketRight";
    const backward = event.key === "[" || event.key === "{" || code === "BracketLeft";

    if (forward || backward) {
      event.preventDefault();
      this.reorderSelection(forward ? (event.shiftKey ? "front" : "forward") : (event.shiftKey ? "back" : "backward"));
    }
  },

  onPlainKey(event) {
    const key = event.key.toLowerCase();
    const tool = this.TOOLS.find((item) => item.key.toLowerCase() === key);

    if (tool && !event.shiftKey) {
      this.setTool(tool.id);
    } else if (event.key === " " && !event.target.closest("button, a, summary")) {
      event.preventDefault();

      if (!this.spaceDown) {
        this.spaceDown = true;
        this.applyTool();
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.requestDelete();
    } else if (event.key === "Escape") {
      this.onEscape();
    }
  },

  onEscape() {
    if (this.linkDrag) {
      this.cancelLink();
    } else if (this.moveDrag) {
      this.cancelMove();
    } else if (this.tool !== "select") {
      this.setTool("select");
    } else {
      this.cy.elements().unselect();
    }
  }
};
