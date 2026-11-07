"use strict";

// Graphical editing tools (selection, hand, brick, link), deletion and layer order.
// Every change goes through App.edit -> DocEdit, so the YAML stays the source of truth.
const Tools = {
  STORE_KEY: "topo:tool",
  DELETE_KEY: "delete.relinkToParent",
  TOOLS: [
    { id: "select", key: "V", name: "Sélection", icon: "<path d=\"M5 3l14 8-6 2-3 6z\" />" },
    { id: "hand", key: "H", name: "Main", icon: "<path d=\"M8 12V6a1.5 1.5 0 013 0v5m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L8 14\" />" },
    { id: "brick", key: "B", name: "Brique", icon: "<rect x=\"4\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\" /><path d=\"M19 3v6M16 6h6\" />" },
    { id: "link", key: "L", name: "Lien", icon: "<circle cx=\"5\" cy=\"18\" r=\"2.5\" /><circle cx=\"19\" cy=\"6\" r=\"2.5\" /><path d=\"M7 16.5L17 7.5\" stroke-dasharray=\"3 2\" />" }
  ],
  HELP: {
    select: "Sélection : clic = sélectionner (Maj/Ctrl pour ajouter), glissez le fond pour un rectangle, glissez une brique pour la déplacer — Suppr pour supprimer",
    hand: "Main : glissez pour déplacer la vue — Échap pour revenir à la sélection",
    brick: "Brique : cliquez une brique pour lui ajouter un enfant, ou le fond pour une brique racine — Échap pour revenir à la sélection",
    link: "Lien : glissez d’une brique à une autre pour les relier — Échap pour annuler"
  },
  PLAN: [["front", "Premier plan"], ["forward", "Avancer"], ["backward", "Reculer"], ["back", "Arrière-plan"]],

  tool: "select",
  spaceDown: false,
  mod: false,
  muted: false,
  linkDrag: null,
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
    svg.hidden = true;
    wrap.appendChild(svg);
    this.els.overlay = svg;
    this.els.line = svg.querySelector("line");
  },

  setTool(id) {
    if (!this.TOOLS.some((tool) => tool.id === id)) {
      return;
    }

    this.cancelLink();
    this.tool = id;
    App.store(this.STORE_KEY, id);
    this.applyTool();
  },

  applyTool() {
    const cy = this.cy;
    const current = this.current;

    cy.userPanningEnabled(current !== "select");
    cy.boxSelectionEnabled(current === "select");
    cy.autoungrabify(current !== "select");
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
      nodes: this.cy.nodes(":selected").map((node) => node.id()),
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
      if (this.current !== "brick") {
        return;
      }

      this.addBrick(event.target === cy ? null : event.target.id());
    });

    cy.on("mousedown", (event) => this.linkStart(event));
    window.addEventListener("mousemove", (event) => this.linkMove(event));
    window.addEventListener("mouseup", (event) => this.linkEnd(event));
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

    this.linkDrag = { source };
    this.cy.userPanningEnabled(false);
    this.drawLine(event.renderedPosition);
  },

  // Deepest (smallest) node under a client point, or null.
  nodeAt(clientX, clientY) {
    const rect = this.cy.container().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let area = Infinity;

    this.cy.nodes().forEach((node) => {
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

    const rect = this.cy.container().getBoundingClientRect();
    const hover = this.nodeAt(event.clientX, event.clientY);

    this.drawLine({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    this.cy.nodes().removeClass("link-hover");

    if (hover && hover !== this.linkDrag.source) {
      hover.addClass("link-hover");
    }
  },

  drawLine(point) {
    const from = this.linkDrag.source.renderedPosition();

    this.els.line.setAttribute("x1", from.x);
    this.els.line.setAttribute("y1", from.y);
    this.els.line.setAttribute("x2", point.x);
    this.els.line.setAttribute("y2", point.y);
    this.els.overlay.hidden = false;
  },

  cancelLink() {
    if (!this.linkDrag) {
      return;
    }

    this.linkDrag = null;
    this.applyTool();
    this.els.overlay.hidden = true;
    this.cy.nodes().removeClass("link-hover");
  },

  linkEnd(event) {
    const drag = this.linkDrag;

    if (!drag) {
      return;
    }

    const target = this.nodeAt(event.clientX, event.clientY);

    this.cancelLink();

    if (!target) {
      return;
    }

    if (target.id() === drag.source.id()) {
      App.showMessage("Un lien vers soi-même est refusé.", "warning");
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

  // ---- bricks ----

  async addBrick(parentId) {
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

    if (App.edit(`Ajout de « ${values.label} »`, (text) => DocEdit.addNode(text, parentId, obj))) {
      this.selectIds([values.id]);
    } else if (wasCollapsed) {
      App.collapsed.add(parentId);
    }
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

    if (Object.keys(patch).length) {
      App.edit(`Modification de « ${node.label} »`, (text) => DocEdit.updateNode(text, id, patch));
    }
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
    } else if (this.tool !== "select") {
      this.setTool("select");
    } else {
      this.cy.elements().unselect();
    }
  }
};
