"use strict";

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Returns the URL when it is http(s) or mailto, otherwise null.
function safeUrl(value) {
  try {
    const url = new URL(String(value).trim());

    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const App = {
  SCRATCH: "__scratch__",
  LAYOUTS: ["fcose", "cose", "breadthfirst", "grid", "circle", "concentric", "tree"],
  LAYOUT_HELP: {
    fcose: "Force dirigée optimisée pour les groupes imbriqués (recommandé).",
    cose: "Force dirigée classique, plus lente, peut faire chevaucher les groupes.",
    breadthfirst: "Arbre hiérarchique par niveaux, suit le sens des liens.",
    grid: "Grille régulière.",
    circle: "Nœuds sur un cercle.",
    concentric: "Cercles concentriques, les nœuds les plus connectés au centre.",
    tree: "Arbre : briques empilées en colonne, indentées par niveau, dans l'ordre du YAML ; clic = déplier/replier un niveau."
  },
  NEW_DOCUMENT: "title: Nouveau diagramme\nnodes:\n  - id: exemple\n    label: Exemple\n    type: service\n",

  model: null,
  collapsed: new Set(),
  treeSeen: new Set(),
  focus: null,
  name: null,
  savedText: null,
  dirty: false,
  loading: false,
  layout: "fcose",
  saveHook: null,
  applyTimer: null,
  viewTimer: null,
  cardFor: null,
  lastCursorNode: null,
  els: {},

  // ---- public API ----

  getText() {
    return Editor.getValue();
  },

  getModel() {
    return this.model;
  },

  onSave(hook) {
    this.saveHook = typeof hook === "function" ? hook : null;
  },

  showMessage(text, level = "info") {
    if (!this.els.message) {
      console.warn(text);
      return;
    }

    this.els.message.textContent = text;
    this.els.message.className = `message ${level}`;
  },

  loadText(text, options = {}) {
    clearTimeout(this.applyTimer);

    if (typeof LinkSeries !== "undefined" && LinkSeries.isActive()) {
      LinkSeries.finish();
    }

    this.name = options.name || null;
    Files.current = { name: this.name, handle: options.handle || null };
    this.viewOverride = options.view || null;

    if (typeof Layouts !== "undefined") {
      Layouts.active = null;
    }

    this.loading = true;
    Editor.setValue(String(text));
    this.loading = false;

    this.savedText = options.dirty ? null : Editor.getValue();
    this.collapsed = new Set();
    this.dropFocus();
    Graph.saved = {};
    Graph.pinned = false;
    Graph.selectedId = null;
    this.closeCard();
    Inspector.clear();
    StyleUI.nodeId = null;

    History.clear();
    this.updateHeader();
    this.applyNow(true, { initial: true });
    this.updateDirty();
  },

  // Replaces the editor text programmatically and applies it right away.
  replaceText(text) {
    clearTimeout(this.applyTimer);
    this.loading = true;
    Editor.setValuePreserve(text);
    this.loading = false;
    this.updateDirty();
    this.applyNow(false);
  },

  // Single entry point for graphical actions: fn(text) -> newText, undoable.
  edit(label, fn) {
    if (typeof Project !== "undefined" && Project.shouldRoute()) {
      return Project.routeEdit(label, fn);
    }

    const before = this.getText();

    try {
      const next = fn(before);

      if (typeof next !== "string" || next === before) {
        return false;
      }

      History.push(before, label);
      this.replaceText(next);
      return true;
    } catch (error) {
      this.showMessage(error.message, "error");
      return false;
    }
  },

  undo() {
    if (typeof Project !== "undefined" && Project.shouldRoute()) {
      Project.undo();
      return;
    }

    const label = History.undo();

    if (label) {
      this.showMessage(`Annulé : ${label}.`, "info");
    }
  },

  redo() {
    if (typeof Project !== "undefined" && Project.shouldRoute()) {
      Project.redo();
      return;
    }

    const label = History.redo();

    if (label) {
      this.showMessage(`Rétabli : ${label}.`, "info");
    }
  },

  updateHistoryMenu(state) {
    [["menu-undo", "Annuler", state.canUndo, state.undoLabel], ["menu-redo", "Rétablir", state.canRedo, state.redoLabel]].forEach(([id, name, can, label]) => {
      const button = document.getElementById(id);
      const kbd = button.querySelector("kbd");

      button.disabled = !can;
      button.firstChild.textContent = label ? `${name} : ${label}` : name;
      button.title = label || "";

      if (kbd) {
        button.appendChild(kbd);
      }
    });
  },

  showTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.tab === name;

      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll(".pane").forEach((pane) => {
      const active = pane.id === `pane-${name}`;

      pane.classList.toggle("active", active);
      pane.hidden = !active;
    });

    if (name === "editor") {
      Editor.refresh();
    }

    this.updateSelectionHeader();
  },

  // ---- storage ----

  store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch { /* quota or disabled storage */ }
  },

  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  docKey() {
    return this.name || this.SCRATCH;
  },

  persistText() {
    const key = this.docKey();

    this.store(`topo:text:${key}`, Editor.getValue());
    this.store(`topo:dirty:${key}`, this.dirty ? "1" : "0");
    this.store("topo:last", key);

    if (typeof Tabs !== "undefined") {
      Tabs.persistSoon();
    }
  },

  loadLocalView() {
    try {
      return JSON.parse(this.read(`topo:view:${this.docKey()}`) || "null");
    } catch {
      return null;
    }
  },

  schedulePersistView() {
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => this.persistView(), 400);
  },

  persistView() {
    if (!this.model) {
      return;
    }

    const view = this.getViewObject(false);

    view.pinned = Graph.pinned;
    this.store(`topo:view:${this.docKey()}`, JSON.stringify(view));

    if (typeof Layouts !== "undefined") {
      Layouts.refresh();
    }

    if (typeof Tabs !== "undefined") {
      Tabs.persistSoon();
    }
  },

  // forFile: only write positions when the user pinned nodes by dragging.
  getViewObject(forFile) {
    const focus = this.focus;
    const viewport = focus ? focus.viewport : Graph.getViewport();
    const view = {
      collapsed: Array.from(focus ? focus.collapsed : this.collapsed),
      zoom: viewport.zoom,
      pan: viewport.pan,
      layout: this.layout
    };

    if (!forFile || Graph.pinned) {
      const positions = Graph.getPositions();

      if (Object.keys(positions).length) {
        view.positions = positions;
      }
    }

    return view;
  },

  hasViewData(view) {
    return Boolean(view) && (
      (Array.isArray(view.collapsed) && view.collapsed.length > 0) ||
      Number.isFinite(Number(view.zoom)) && view.zoom !== null ||
      Boolean(view.pan) ||
      Boolean(view.layout) ||
      (view.positions && Object.keys(view.positions).length > 0)
    );
  },

  resolveRef(ref) {
    if (!this.model) {
      return null;
    }

    const text = String(ref);

    // Meta cards are derived nodes ("card:<owner>"): keep their saved positions as-is.
    if (text.startsWith("card:")) {
      return text;
    }

    if (this.model.byId.has(text)) {
      return text;
    }

    const byQualified = this.model.nodes.find((node) => node.qualifiedId === text);

    if (byQualified) {
      return byQualified.id;
    }

    const byLocal = this.model.nodes.filter((node) => node.localId === text);

    return byLocal.length === 1 ? byLocal[0].id : null;
  },

  updateLayoutHelp() {
    const text = this.LAYOUT_HELP[this.els.layoutSelect.value] || "";
    const help = document.getElementById("layout-help");

    help.title = text;
    help.setAttribute("aria-label", text);
  },

  // ---- parse and render ----

  applyNow(manual, options = {}) {
    clearTimeout(this.applyTimer);

    const raw = Editor.getValue();
    const text = Editor.normalizeTabs(raw);

    if (text !== raw) {
      this.loading = true;
      Editor.setValuePreserve(text);
      this.loading = false;
      this.updateDirty();
    }

    this.persistText();

    let model;

    try {
      model = Model.parse(text);
    } catch (error) {
      this.showMessage(`Erreur YAML : ${error.message}`, "error");

      if (options.initial) {
        this.model = null;
        Graph.clear();
        Anomalies.render([]);
        StyleUI.refresh();
      }

      return false;
    }

    this.dropFocus();
    this.model = model;
    Style.setModel(model);
    Settings.setDocumentFromText(text);

    let viewport = null;

    if (options.initial) {
      viewport = this.restoreView(model);
    }

    this.render({ initial: Boolean(options.initial), viewport, manual });

    return true;
  },

  restoreView(model) {
    const override = this.viewOverride;

    this.viewOverride = null;

    const fromFile = !override && this.hasViewData(model.view);
    const view = override || (fromFile ? model.view : this.loadLocalView()) || {};

    return this.applyViewObject(view, fromFile);
  },

  // Applies a view object (tab state, named layout) without replaying any automatic layout.
  applyView(view) {
    if (!this.model) {
      return false;
    }

    this.dropFocus();

    const viewport = this.applyViewObject(view, false);

    this.render({ initial: true, viewport });
    this.schedulePersistView();

    return true;
  },

  applyViewObject(view, fromFile) {
    this.layout = this.LAYOUTS.includes(view.layout) ? view.layout : "fcose";
    this.els.layoutSelect.value = this.layout;
    this.updateLayoutHelp();

    this.collapsed = new Set();

    (Array.isArray(view.collapsed) ? view.collapsed : []).forEach((ref) => {
      const id = this.resolveRef(ref);

      if (id) {
        this.collapsed.add(id);
      }
    });

    Graph.saved = {};

    Object.entries(view.positions || {}).forEach(([ref, point]) => {
      const id = this.resolveRef(ref);

      if (id && point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
        Graph.saved[id] = { x: Number(point.x), y: Number(point.y) };
      }
    });

    Graph.pinned = fromFile ? Object.keys(Graph.saved).length > 0 : Boolean(view.pinned);

    const zoom = Number(view.zoom);
    const pan = view.pan;

    if (view.zoom !== null && view.zoom !== undefined && Number.isFinite(zoom) && zoom > 0 &&
        pan && Number.isFinite(Number(pan.x)) && Number.isFinite(Number(pan.y))) {
      return { zoom, pan: { x: Number(pan.x), y: Number(pan.y) } };
    }

    return null;
  },

  render(options = {}) {
    const model = this.model;

    if (!model) {
      return;
    }

    this.collapsed.forEach((id) => {
      const node = model.byId.get(id);

      if (!node || node.children.length === 0) {
        this.collapsed.delete(id);
      }
    });

    const elements = Model.buildElements(model, this.collapsed);
    const obsolete = Graph.refresh(elements, model, {
      initial: options.initial,
      viewport: options.viewport,
      layout: this.layout
    });

    this.closeCard();
    this.updateHeader();
    Anomalies.render(model.anomalies);
    StyleUI.refresh();
    Trash.refresh();
    this.syncEditorFolds();

    if (Graph.selectedId && model.byId.has(Graph.selectedId)) {
      Inspector.showNode(Graph.selectedId, model, this.collapsed);
    } else if (Graph.selectedId) {
      Graph.selectedId = null;
      Inspector.clear();
    }

    this.onSelectionChange(false);

    if (this.els.search.value.trim()) {
      this.runSearch(false);
    }

    const anomalyCount = model.anomalies.length;
    const suffix = anomalyCount ? ` ${anomalyCount} anomalie(s).` : "";

    if (obsolete.length) {
      this.showMessage(`Modèle appliqué. Règles de style ignorées (cible inconnue) : ${obsolete.join(", ")}.${suffix}`, "warning");
    } else if (options.manual) {
      this.showMessage(`Modèle appliqué : ${model.nodes.length} nœuds et ${model.links.length} liens.${suffix}`, anomalyCount ? "warning" : "success");
    } else if (anomalyCount) {
      this.showMessage(`${anomalyCount} anomalie(s) détectée(s).`, "warning");
    } else {
      this.showMessage("");
    }

    if (!options.initial) {
      this.schedulePersistView();
    }
  },

  scheduleApply() {
    clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => this.applyNow(false), 600);
  },

  // ---- header and dirty state ----

  updateDirty() {
    this.dirty = this.savedText === null || this.savedText !== Editor.getValue();
    this.els.dirty.hidden = !this.dirty;
    this.store(`topo:dirty:${this.docKey()}`, this.dirty ? "1" : "0");
    this.updateHeader();
  },

  updateHeader() {
    const name = this.name || "Sans titre";

    this.els.docName.textContent = name;
    this.els.docTitle.textContent = this.model && this.model.title ? this.model.title : "";
    this.els.dirty.hidden = !this.dirty;
    document.title = `${this.dirty ? "● " : ""}${name} — Topo`;

    if (typeof Tabs !== "undefined") {
      Tabs.render();
    }
  },

  confirmDiscard() {
    return !this.dirty || window.confirm("Des modifications ne sont pas enregistrées. Continuer et les perdre ?");
  },

  // ---- collapse ----

  toggleCollapse(id) {
    const node = this.model && this.model.byId.get(id);

    if (!node || !node.children.length) {
      return;
    }

    this.dropFocus();

    if (this.collapsed.has(id)) {
      this.collapsed.delete(id);
    } else {
      this.collapsed.add(id);
    }

    this.render();

    if (!this.collapsed.has(id)) {
      Repulsion.settle([id]);
    }
  },

  // First switch to the outline layout for a document: keep only level 1 expanded.
  enterTree() {
    const key = this.docKey();

    if (!this.model || this.treeSeen.has(key)) {
      return;
    }

    this.treeSeen.add(key);
    this.dropFocus();
    this.model.nodes.filter((node) => node.children.length > 0 && node.parent).forEach((node) => this.collapsed.add(node.id));
    this.render();
  },

  collapseAll() {
    if (!this.model) {
      return;
    }

    this.dropFocus();
    this.model.nodes.filter((node) => node.children.length > 0).forEach((node) => this.collapsed.add(node.id));
    this.render();
  },

  expandAll() {
    this.dropFocus();
    const groups = [...this.collapsed];

    this.collapsed.clear();
    this.render();
    Repulsion.settle(groups);
  },

  // ---- temporary focus on links (never persisted) ----

  // Restores the pre-focus collapse state without rendering.
  dropFocus() {
    if (!this.focus) {
      return;
    }

    this.collapsed = this.focus.collapsed;
    this.focus = null;
    Inspector.focusKey = null;
    Graph.clearFocus();
  },

  focusLinks(key, entries) {
    if (!this.model || !entries.length) {
      return;
    }

    if (this.focus && this.focus.key === key) {
      this.exitFocus();
      return;
    }

    const base = this.focus || {
      collapsed: new Set(this.collapsed),
      viewport: Graph.getViewport(),
      positions: Graph.getAllPositions()
    };
    const expanded = new Set(base.collapsed);
    const keep = new Set();

    entries.forEach(({ link }) => {
      [link.from, link.to].forEach((end) => {
        for (let node = this.model.byId.get(end); node; node = this.model.byId.get(node.parent)) {
          keep.add(node.id);

          if (node.id !== end) {
            expanded.delete(node.id);
          }
        }
      });
    });

    this.focus = { key, collapsed: base.collapsed, viewport: base.viewport, positions: base.positions };
    this.collapsed = expanded;
    Inspector.focusKey = key;
    this.render();

    const edges = entries.map(({ link }) => (
      `${Model.visibleAncestor(link.from, this.model, expanded)}=>${Model.visibleAncestor(link.to, this.model, expanded)}`
    ));

    Graph.setFocus(keep, edges);
    Graph.fitFocus();
  },

  exitFocus() {
    const focus = this.focus;

    if (!focus) {
      return;
    }

    Object.assign(Graph.saved, focus.positions);
    this.dropFocus();
    this.render();
    Graph.setViewport(focus.viewport);
  },

  focusAll(id) {
    this.focusLinks(`all:${id}`, Inspector.indirectLinks(id, this.model));
  },

  focusLink(index) {
    const link = this.model && this.model.links[Number(index)];
    const nodeId = Graph.selectedId;
    const entry = link && nodeId && Inspector.indirectLinks(nodeId, this.model).find((item) => item.index === Number(index));

    if (entry) {
      this.focusLinks(`link:${index}`, [entry]);
    }
  },

  linkEdgeId(from, to) {
    const source = Model.visibleAncestor(from, this.model, this.collapsed);
    const target = Model.visibleAncestor(to, this.model, this.collapsed);

    return { id: `${source}=>${target}`, ends: [source, target] };
  },

  hoverLink(from, to) {
    if (this.model) {
      const edge = this.linkEdgeId(from, to);

      Graph.setHover(edge.id, edge.ends);
    }
  },

  centerOnLink(from, to) {
    if (this.model) {
      Graph.centerOnEdge(this.linkEdgeId(from, to).id);
    }
  },

  // ---- selection and inspection ----

  inspectNode(id, options = {}) {
    if (!this.model || !this.model.byId.has(id)) {
      return;
    }

    Inspector.showNode(id, this.model, this.collapsed);
    StyleUI.show(id);
    Graph.select(id, options.center !== false);

    const tab = options.tab === true ? Settings.get("selection.tab") : options.tab;

    if (tab === "inspector" || tab === "style") {
      this.showTab(tab);
    }
  },

  onCursorLine(lineIndex) {
    if (this.loading || !this.model) {
      return;
    }

    const context = Editor.analyzeLine(lineIndex, this.model);

    if (context.type === "node") {
      this.inspectNode(context.id, { center: context.id !== this.lastCursorNode });
      this.lastCursorNode = context.id;
      this.markFromEditor();
    } else if (context.type === "link" && context.link) {
      Inspector.showLink(context.link, this.model);
    }
  },

  // The next selection change comes from the editor: no highlight or scroll back into it.
  markFromEditor() {
    this.fromEditor = true;
    setTimeout(() => {
      this.fromEditor = false;
    }, 0);
  },

  // Text selection covering node blocks selects these nodes in the graph (without taking focus).
  onEditorSelection(ranges) {
    if (this.loading || !this.model || !Graph.cy) {
      return;
    }

    const ids = Editor.nodesInRanges(ranges, this.model).filter((id) => Graph.cy.getElementById(id).nonempty());

    if (!ids.length) {
      this.onCursorLine(Editor.cm.getCursor().line);
      return;
    }

    const current = Tools.selection();
    const same = !current.edges.length && current.nodes.length === ids.length && ids.every((id) => current.nodes.includes(id));

    if (!same && ids.length === 1) {
      this.inspectNode(ids[0], { center: false });
    } else if (!same) {
      Graph.cy.elements().unselect();
      Graph.select(ids[0], false);
      ids.slice(1).forEach((id) => Graph.cy.getElementById(id).select());
    }

    this.markFromEditor();
  },

  // ---- shared selection header, multi-selection, editor sync ----

  scheduleSelectionChange() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => this.onSelectionChange(true), 0);
  },

  selectedEdges() {
    return Tools.selection().edges.map((id) => {
      const edge = Graph.cy.getElementById(id);

      return { id, source: edge.source().id(), target: edge.target().id(), label: edge.data("label"), isMeta: Boolean(edge.data("isMeta")) };
    });
  },

  onSelectionChange(scroll) {
    if (!this.model || !Graph.cy) {
      return;
    }

    const nodes = Tools.selection().nodes;
    const edges = this.selectedEdges();

    if (nodes.length + edges.length > 1) {
      Inspector.showMany({ nodes, edges }, this.model, this.collapsed);
    } else if (Inspector.multi) {
      if (nodes.length === 1) {
        Inspector.showNode(nodes[0], this.model, this.collapsed);
      } else {
        Inspector.clear();
      }
    }

    this.updateSelectionHeader();
    this.syncEditorSelection(scroll && !this.fromEditor, nodes, edges);
  },

  syncEditorSelection(scroll, nodeIds, edges) {
    if (!Editor.cm || !this.model) {
      return;
    }

    if (this.fromEditor || nodeIds.length + edges.length === 0) {
      Editor.clearHighlight();
      return;
    }

    const edgeIds = new Set(edges.map((edge) => edge.id));
    const nodes = nodeIds.map((id) => this.model.byId.get(id)).filter(Boolean);
    const links = this.model.links.filter((link) => edgeIds.has(this.linkEdgeId(link.from, link.to).id));

    Editor.highlightSelection(nodes, links, scroll);
  },

  selectionHeaderHtml(nodes, edges, model) {
    const total = nodes.length + edges.length;
    const label = (id) => (model.byId.get(id) ? model.byId.get(id).label : id);

    if (total === 1 && nodes.length) {
      return `<h3>${escapeHtml(label(nodes[0]))}</h3><p class="path">${escapeHtml(Model.pathLabel(nodes[0], model))}</p>`;
    }

    if (total === 1) {
      const edge = edges[0];

      return `<h3>Lien : ${escapeHtml(label(edge.source))} → ${escapeHtml(label(edge.target))}</h3><p class="path">${escapeHtml(Model.pathLabel(edge.source, model))} → ${escapeHtml(Model.pathLabel(edge.target, model))}</p>`;
    }

    const names = nodes.map((id) => `<button type="button" class="sel-name" data-sel-node="${escapeHtml(id)}" title="Réduire la sélection à cet élément">${escapeHtml(label(id))}</button>`)
      .concat(edges.map((edge) => `<button type="button" class="sel-name" data-sel-edge="${escapeHtml(edge.id)}" title="Réduire la sélection à ce lien">${escapeHtml(label(edge.source))} → ${escapeHtml(label(edge.target))}</button>`));
    const rest = names.length - Inspector.MULTI_LIMIT;

    return `<h3>Sélection de ${total} éléments</h3>
      <div class="sel-names">${names.slice(0, Inspector.MULTI_LIMIT).join("")}${rest > 0 ? `<span class="sel-more">… et ${rest} autres</span>` : ""}</div>`;
  },

  updateSelectionHeader() {
    const header = document.getElementById("selection-header");
    const tab = document.querySelector(".tab.active");
    const name = tab ? tab.dataset.tab : "editor";

    if (!header) {
      return;
    }

    const ready = Boolean(this.model && Graph.cy);
    const nodes = ready ? Tools.selection().nodes.filter((id) => this.model.byId.has(id)) : [];
    const edges = ready ? this.selectedEdges() : [];

    header.classList.toggle("compact", name === "editor");

    if (this.linkHeader) {
      this.renderLinkHeader(header);
      return;
    }

    const linkTool = ready && Tools.current === "link";

    if (!nodes.length && !edges.length) {
      header.innerHTML = linkTool ? `<h3>Mode Lien</h3>${this.linkMultiHtml()}` : "";
      header.hidden = !linkTool || !["editor", "inspector", "style"].includes(name);
      return;
    }

    header.innerHTML = this.selectionHeaderHtml(nodes, edges, this.model) + (linkTool ? this.linkMultiHtml() : "");
    header.hidden = !["editor", "inspector", "style"].includes(name);
  },

  // Link tool: while a link is being drawn, the header shows source -> hovered target.
  setLinkHeader(info) {
    this.linkHeader = info;
    this.updateSelectionHeader();
  },

  renderLinkHeader(header) {
    const { from, to } = this.linkHeader;
    const model = this.model;
    const name = (id) => (id && model.byId.has(id) ? model.byId.get(id).label : "…");
    const path = (id) => (id && model.byId.has(id) ? Model.pathLabel(id, model) : "…");

    header.innerHTML = `<h3>Lien : ${escapeHtml(name(from))} → ${escapeHtml(name(to))}</h3><p class="path">${escapeHtml(path(from))} → ${escapeHtml(path(to))}</p>${this.linkMultiHtml()}`;
    header.hidden = false;
  },

  // "Liens multiples" checkbox of the Link tool header (setting links.multi).
  linkMultiHtml() {
    return `<label class="link-multi" title="Les liens tracés forment une série brouillon (panneau « Série de liens ») créée d’un coup ; Ctrl pendant le tracé fait de même."><input type="checkbox" data-link-multi="1"${Settings.get("links.multi") ? " checked" : ""} /> Liens multiples</label>`;
  },

  reduceSelection(nodeId, edgeId) {
    Graph.cy.elements().unselect();

    if (nodeId) {
      this.inspectNode(nodeId, { center: false });
    } else {
      Graph.cy.getElementById(edgeId).select();
    }
  },

  syncEditorFolds() {
    if (Settings.get("editor.foldSync") !== "off" && Editor.cm && this.model) {
      Editor.syncFolds(this.collapsed, this.model);
    }
  },

  // Fold/unfold in the editor gutter: collapses/expands the group in the graph (mode "both").
  onEditorFold(kind, line) {
    if (Settings.get("editor.foldSync") !== "both" || !this.model || this.loading) {
      return;
    }

    const context = Editor.analyzeLine(line, this.model);
    const node = context.type === "node" ? this.model.byId.get(context.id) : null;
    const folded = kind === "fold";

    if (!node || !node.children.length || this.collapsed.has(node.id) === folded) {
      return;
    }

    this.dropFocus();

    if (folded) {
      this.collapsed.add(node.id);
      Editor.lastFolds.add(node.id);
    } else {
      this.collapsed.delete(node.id);
      Editor.lastFolds.delete(node.id);
    }

    this.render();

    if (!folded) {
      Repulsion.settle([node.id]);
    }
  },

  viewInYaml(id) {
    const node = this.model && this.model.byId.get(id);
    const index = node ? Editor.findNodeDeclaration(node) : -1;

    this.showTab("editor");

    if (index >= 0) {
      Editor.goToLine(index);
    }
  },

  runSearch(announce = true) {
    if (!this.model) {
      return;
    }

    try {
      const results = Graph.search(this.els.search.value, this.model);

      if (announce) {
        this.showMessage(
          this.els.search.value.trim() ? `${results.length} nœud(s) correspondent à la recherche.` : "Recherche effacée."
        );
      }
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  },

  // ---- meta card ----

  showCard(id) {
    const node = this.model && this.model.byId.get(id);
    const box = Graph.renderedBox(id);

    if (!node || !box) {
      return;
    }

    const hidden = ["show", "afficher", "links", "liens"];
    const entries = Object.entries(node.meta || {}).filter(([key]) => !hidden.includes(key));
    const rawLinks = node.meta && (node.meta.links || node.meta.liens);
    const links = (Array.isArray(rawLinks) ? rawLinks : []).filter((item) => item && safeUrl(item.url));

    this.els.card.innerHTML = `
      <div class="meta-card-header">
        <strong>${escapeHtml(node.label)}</strong>
        <button id="btn-close-card" type="button" aria-label="Fermer la fiche">✕</button>
      </div>
      <div class="meta-card-body">
        ${entries.length ? `<ul>${entries.map(([key, value]) => `
          <li><strong>${escapeHtml(key)}</strong> : ${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</li>
        `).join("")}</ul>` : "<p class=\"empty\">Aucune métadonnée.</p>"}
        ${links.length ? `<div class="meta-links">${links.map((item) => `
          <a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label || item.url)}</a>
        `).join("")}</div>` : ""}
      </div>
    `;

    this.cardFor = id;
    this.els.card.hidden = false;
    this.moveCard();
    document.getElementById("btn-close-card").addEventListener("click", () => this.closeCard());
  },

  moveCard() {
    if (!this.cardFor) {
      return;
    }

    const box = Graph.renderedBox(this.cardFor);

    if (!box) {
      this.closeCard();
      return;
    }

    const margin = 14;
    const card = this.els.card;

    card.style.left = `${box.x1 + margin}px`;
    card.style.top = `${box.y1 + margin}px`;
    card.style.width = `${Math.max(180, box.w - margin * 2)}px`;
    card.style.height = `${Math.max(90, box.h - margin * 2)}px`;
  },

  closeCard() {
    this.cardFor = null;

    if (this.els.card) {
      this.els.card.hidden = true;
    }
  },

  // ---- context menus ----

  openMenu(position, title, actions) {
    const menu = this.els.contextMenu;

    menu.innerHTML = `
      <div class="menu-title">${escapeHtml(title)}</div>
      ${actions.map((action, index) => `${action.separator ? "<hr />" : ""}<button type="button" data-index="${index}">${escapeHtml(action.label)}</button>`).join("")}
    `;

    menu.querySelectorAll("button[data-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = actions[Number(button.dataset.index)];

        this.closeMenu();
        action.run?.();
      });
    });

    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(position.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(0, Math.min(position.y, window.innerHeight - menu.offsetHeight - 8))}px`;
  },

  closeMenu() {
    this.els.contextMenu.hidden = true;
  },

  nodeMenu(id, position) {
    const node = this.model && this.model.byId.get(id);

    if (!node) {
      return;
    }

    const isGroup = node.children.length > 0;
    const rawLinks = node.meta && (node.meta.links || node.meta.liens);
    const links = (Array.isArray(rawLinks) ? rawLinks : []).filter((item) => item && safeUrl(item.url));
    const actions = [];

    if (isGroup) {
      actions.push({ label: this.collapsed.has(id) ? "Déplier" : "Replier", run: () => this.toggleCollapse(id) });

      const hiddenKids = StyleUI.hiddenIds(this.model, new Set(Inspector.descendants(id, this.model).keys()));

      if (hiddenKids.length) {
        actions.push({ label: `Réafficher les enfants masqués (${hiddenKids.length})`, run: () => StyleUI.unhide(hiddenKids) });
      }
    }

    actions.push(
      { label: "Modifier…", run: () => Tools.editNode(id) },
      { label: "Copier", run: () => Clipboard.copy(this.menuTargets(id)) },
      { label: "Couper", run: () => Clipboard.cut(this.menuTargets(id)) },
      { label: `Coller dans « ${node.label || id} »`, run: () => Clipboard.paste(id) },
      { label: "Ajouter un enfant…", run: () => Tools.addBrick(id, Tools.menuPoint) },
      { label: "Afficher la fiche", run: () => this.showCard(id) },
      { label: "Inspecter", run: () => this.inspectNode(id, { tab: "inspector" }) },
      {
        label: "Style",
        run: () => {
          this.inspectNode(id);
          this.showTab("style");
        }
      },
      { label: "Recentrer", run: () => Graph.select(id) },
      { label: "Voir dans le YAML", run: () => this.viewInYaml(id) }
    );

    if (Project.canEditSource(node)) {
      actions.push({ label: "Éditer la source", run: () => Project.editSource(node.meta.source) });
    }

    links.forEach((item) => {
      actions.push({
        label: `Ouvrir : ${item.label || item.url}`,
        run: () => window.open(safeUrl(item.url), "_blank", "noopener,noreferrer")
      });
    });

    actions.push(...Tools.planActions(id, position));
    actions.push({ separator: true, label: "Supprimer…", run: () => Tools.requestDelete(Tools.selection().nodes.includes(id) ? undefined : [id]) });

    this.openMenu(position, node.label || id, actions);
  },

  // Nodes a context-menu copy/cut applies to: the whole selection when the clicked node belongs to it.
  menuTargets(id) {
    return Tools.selection().nodes.includes(id) ? Tools.selection().nodes : [id];
  },

  edgeMenu(edgeId, position) {
    const edge = Graph.cy.getElementById(edgeId);

    if (edge.empty()) {
      return;
    }

    const source = edge.source().id();
    const target = edge.target().id();

    const actions = [
      { label: "Voir l’origine", run: () => Graph.select(source) },
      { label: "Voir la cible", run: () => Graph.select(target) },
      { label: "Inspecter l’origine", run: () => this.inspectNode(source, { tab: true }) },
      { label: "Inspecter la cible", run: () => this.inspectNode(target, { tab: true }) }
    ];

    if (!edge.data("isMeta")) {
      actions.push({ separator: true, label: "Modifier le lien…", run: () => Tools.editLink(edgeId) });
    }

    actions.push({
      separator: edge.data("isMeta"),
      label: edge.data("isMeta") ? "Supprimer les liens réels…" : "Supprimer le lien…",
      run: () => (edge.selected() ? Tools.requestDelete() : Tools.requestDelete([], [edgeId]))
    });

    this.openMenu(position, "Lien", actions);
  },

  backgroundMenu(position) {
    this.openMenu(position, "Diagramme", [
      { label: "Nouvelle brique racine…", run: () => Tools.addBrick(null, Tools.menuPoint) },
      { label: "Coller à la racine", run: () => Clipboard.paste(null) },
      { separator: true, label: "Zoom avant", run: () => Graph.zoomIn() },
      { label: "Zoom arrière", run: () => Graph.zoomOut() },
      { label: "Ajuster la vue", run: () => Graph.fit() },
      { separator: true, label: "Tout replier", run: () => this.collapseAll() },
      { label: "Tout déplier", run: () => this.expandAll() }
    ]);
  },

  // ---- files ----

  suggestedName() {
    if (this.name) {
      return this.name;
    }

    return `${this.slug()}.yaml`;
  },

  slug() {
    const base = this.name
      ? this.name.replace(/\.[^.]+$/, "")
      : String((this.model && this.model.title) || "architecture");

    return base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "architecture";
  },

  withView(text) {
    if (!this.els.saveView.checked || !this.model) {
      return text;
    }

    try {
      const view = this.getViewObject(true);
      const layouts = Layouts.readAll(text);

      if (Object.keys(layouts).length) {
        view.layouts = layouts;
      }

      return Model.replaceTopLevelBlock(text, "view", view);
    } catch (error) {
      console.warn("Bloc view non écrit :", error);
      return text;
    }
  },

  async newDocument() {
    Tabs.newTab();
  },

  async openFile() {
    try {
      const result = await Files.open();

      if (result) {
        Tabs.openDocument(result.text, { name: result.name, handle: result.handle });
        this.showMessage(`« ${result.name} » ouvert.`, "success");
      }
    } catch (error) {
      this.showMessage(`Ouverture impossible : ${error.message}`, "error");
    }
  },

  async save(asNew) {
    clearTimeout(this.applyTimer);

    const text = this.withView(Editor.getValue());

    try {
      let result;

      if (this.saveHook) {
        await this.saveHook(text, { name: this.name });
        result = { name: this.name, handle: Files.current.handle };
      } else if (asNew) {
        result = await Files.saveAs(text, this.suggestedName());
      } else {
        Files.current = { name: this.name, handle: Files.current.handle };
        result = await Files.save(text);
      }

      if (!result) {
        return;
      }

      const renamed = result.name !== this.name;
      const previousKey = this.docKey();

      this.name = result.name || null;
      Files.current = { name: this.name, handle: result.handle || null };

      if (text !== Editor.getValue()) {
        this.loading = true;
        Editor.setValuePreserve(text);
        this.loading = false;
      }

      this.savedText = Editor.getValue();

      if (renamed && previousKey === this.SCRATCH) {
        try {
          localStorage.removeItem(`topo:text:${this.SCRATCH}`);
        } catch { /* ignore */ }
      }

      this.persistText();
      this.persistView();
      this.updateDirty();
      this.showMessage(`« ${this.name || "document"} » enregistré.`, "success");
    } catch (error) {
      this.showMessage(`Enregistrement impossible : ${error.message}`, "error");
    }
  },

  // ---- exports ----

  requireModel() {
    if (!this.model) {
      this.showMessage("Appliquez d’abord un modèle YAML valide.", "error");
      return false;
    }

    return true;
  },

  exportAs(kind) {
    if (!this.requireModel()) {
      return;
    }

    const base = this.slug();

    try {
      if (kind === "svg") {
        Files.download(Graph.exportSvg(), `${base}.svg`, "image/svg+xml");
      } else if (kind === "png") {
        Files.download(Graph.exportPng(), `${base}.png`, "image/png");
      } else if (kind === "json") {
        const json = JSON.stringify(this.model, (key, value) => (value instanceof Map ? undefined : value), 2);

        Files.download(json, `${base}.json`, "application/json");
      } else if (kind === "mermaid") {
        Files.download(Model.toMermaid(this.model), `${base}.mmd`, "text/plain");
      }

      this.showMessage(`Export ${kind.toUpperCase()} téléchargé.`, "success");
    } catch (error) {
      this.showMessage(`Export impossible : ${error.message}`, "error");
    }
  },

  // ---- commands ----

  commands() {
    return {
      "new": () => this.newDocument(),
      "open": () => this.openFile(),
      "save": () => this.save(false),
      "save-as": () => this.save(true),
      "import-json": () => this.openFile(),
      "close-tab": () => Tabs.close(),
      "next-tab": () => Tabs.step(1),
      "prev-tab": () => Tabs.step(-1),
      "reset": () => {
        if (this.confirmDiscard()) {
          this.loadText(Model.DEFAULT_YAML, { name: null, dirty: false });
        }
      },
      "export-svg": () => this.exportAs("svg"),
      "export-png": () => this.exportAs("png"),
      "export-json": () => this.exportAs("json"),
      "export-mermaid": () => this.exportAs("mermaid"),
      "apply": () => this.applyNow(true),
      "undo": () => this.undo(),
      "redo": () => this.redo(),
      "settings": () => SettingsUI.open(),
      "fullscreen": () => ViewUi.toggleFullscreen(),
      "relayout": () => {
        Graph.relayout(this.layout);
        this.schedulePersistView();
      },
      "reset-view": () => {
        this.dropFocus();
        this.collapsed.clear();
        this.layout = "fcose";
        this.els.layoutSelect.value = "fcose";
        this.updateLayoutHelp();
        Graph.saved = {};
        Graph.pinned = false;
        this.render();
        Graph.relayout(this.layout);
        this.schedulePersistView();
      }
    };
  },

  closeDropdowns() {
    document.querySelectorAll(".dropdown-panel").forEach((panel) => {
      panel.hidden = true;
    });

    document.querySelectorAll(".dropdown-toggle").forEach((toggle) => {
      toggle.setAttribute("aria-expanded", "false");
    });
  },

  // ---- theme ----

  setTheme(theme, persist = true) {
    document.documentElement.setAttribute("data-theme", theme);

    if (persist) {
      this.store("topo:theme", theme);
    }

    if (Graph.cy) {
      Graph.applyTheme();
    }
  },

  // ---- init ----

  initSplitter() {
    const splitter = document.getElementById("splitter");
    const layout = document.querySelector(".app-layout");
    const stored = this.read("topo:editor-width");
    let dragging = false;

    if (stored) {
      layout.style.setProperty("--editor-width", `${stored}%`);
    }

    splitter.addEventListener("mousedown", (event) => {
      event.preventDefault();
      dragging = true;
      splitter.classList.add("active");
      document.body.style.cursor = "col-resize";
    });

    document.addEventListener("mousemove", (event) => {
      if (!dragging) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      const percent = Math.min(75, Math.max(25, ((event.clientX - rect.left - 10) / (rect.width - 20)) * 100));

      layout.style.setProperty("--editor-width", `${percent}%`);
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) {
        return;
      }

      dragging = false;
      splitter.classList.remove("active");
      document.body.style.cursor = "";
      this.store("topo:editor-width", layout.style.getPropertyValue("--editor-width").replace("%", ""));
      Editor.refresh();
      Graph.cy.resize();
    });

    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => Graph.cy && Graph.cy.resize()).observe(document.getElementById("cy"));
    }
  },

  bindUi() {
    const commands = this.commands();

    document.querySelectorAll(".dropdown-toggle").forEach((toggle) => {
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();

        const panel = toggle.nextElementSibling;
        const wasHidden = panel.hidden;

        this.closeDropdowns();
        panel.hidden = !wasHidden;
        toggle.setAttribute("aria-expanded", String(wasHidden));
      });
    });

    document.querySelectorAll("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => {
        this.closeDropdowns();
        commands[button.dataset.cmd]?.();
      });
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => this.showTab(tab.dataset.tab));
    });

    document.getElementById("btn-help").addEventListener("click", () => Help.open());
    document.getElementById("btn-theme").addEventListener("click", () => {
      this.setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });

    document.getElementById("btn-zoom-in").addEventListener("click", () => Graph.zoomIn());
    document.getElementById("btn-zoom-out").addEventListener("click", () => Graph.zoomOut());
    document.getElementById("btn-fit").addEventListener("click", () => Graph.fit());
    document.getElementById("btn-collapse-all").addEventListener("click", () => this.collapseAll());
    document.getElementById("btn-expand-all").addEventListener("click", () => this.expandAll());

    // Replaying the layout: button, or re-selecting the already active option.
    const replayLayout = () => {
      this.layout = this.els.layoutSelect.value;

      if (this.layout === "tree") {
        this.enterTree();
      }

      Graph.relayout(this.layout);
      this.schedulePersistView();
    };

    let layoutBefore = null;
    let layoutChanged = false;

    document.getElementById("btn-relayout").addEventListener("click", replayLayout);
    ["focus", "mousedown"].forEach((name) => {
      this.els.layoutSelect.addEventListener(name, () => {
        layoutBefore = this.els.layoutSelect.value;
        layoutChanged = false;
      });
    });
    this.els.layoutSelect.addEventListener("click", () => {
      const select = this.els.layoutSelect;

      if (select.dataset.open === "1") {
        select.dataset.open = "0";

        if (layoutBefore !== null && !layoutChanged && select.value === layoutBefore) {
          replayLayout();
        }
      } else if (!layoutChanged) {
        select.dataset.open = "1";
      }
    });
    this.els.layoutSelect.addEventListener("blur", () => {
      this.els.layoutSelect.dataset.open = "0";
    });
    this.els.layoutSelect.addEventListener("keyup", (event) => {
      if (event.key === "Enter" && !layoutChanged && this.els.layoutSelect.value === layoutBefore) {
        replayLayout();
      }

      layoutChanged = false;
    });

    this.els.layoutSelect.addEventListener("change", () => {
      layoutChanged = true;
      layoutBefore = this.els.layoutSelect.value;
      this.els.layoutSelect.dataset.open = "0";
      this.layout = this.els.layoutSelect.value;
      this.updateLayoutHelp();

      if (this.layout === "tree") {
        this.enterTree();
      }

      Graph.relayout(this.layout);
      this.schedulePersistView();
    });

    this.updateLayoutHelp();

    const sizeInput = document.getElementById("node-size");

    const applySize = () => {
      sizeInput.value = Settings.get("nodes.size");
      Style.setUserScale(sizeInput.value);
      Graph.applyStyle();
    };

    sizeInput.value = Settings.get("nodes.size");
    Style.setUserScale(sizeInput.value);

    // Live preview while dragging (no storage write); committed on release.
    sizeInput.addEventListener("input", () => {
      if (Settings.source("nodes.size") === "document") {
        return;
      }

      Style.setUserScale(sizeInput.value);
      Graph.applyStyle();
    });

    sizeInput.addEventListener("change", () => {
      Settings.set("nodes.size", sizeInput.value);

      if (Settings.source("nodes.size") === "document") {
        this.showMessage("La taille est imposée par le document (Vue > Réglages).", "warning");
      }

      applySize();
      Repulsion.settle([]);
    });

    Settings.onChange((keys) => {
      if (keys.includes("nodes.size")) {
        applySize();
      }
    });

    this.els.search.addEventListener("input", () => this.runSearch(true));

    const saveView = this.read("topo:save-view");

    this.els.saveView.checked = saveView === null ? true : saveView === "1";
    this.els.saveView.addEventListener("change", () => {
      this.store("topo:save-view", this.els.saveView.checked ? "1" : "0");
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".dropdown")) {
        this.closeDropdowns();
      }

      if (!this.els.contextMenu.contains(event.target)) {
        this.closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "s") {
        event.preventDefault();
        this.save(event.shiftKey);
      } else if (mod && key === "o") {
        event.preventDefault();
        this.openFile();
      } else if (mod && key === "w" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        Tabs.close();
      } else if (event.ctrlKey && key === "tab") {
        event.preventDefault();
        Tabs.step(event.shiftKey ? -1 : 1);
      } else if (event.key === "F1") {
        event.preventDefault();
        Help.open();
      } else if (event.key === "Escape") {
        this.exitFocus();
        this.closeDropdowns();
        this.closeMenu();
        this.closeCard();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      Tabs.flush();

      if (this.dirty || Tabs.anyDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
        if (!this.read("topo:theme")) {
          this.setTheme(event.matches ? "dark" : "light", false);
        }
      });
    }
  },

  init() {
    const ids = {
      message: "message",
      search: "search",
      contextMenu: "context-menu",
      card: "meta-card",
      docName: "doc-name",
      docTitle: "doc-title",
      dirty: "dirty-marker",
      layoutSelect: "layout-select",
      saveView: "opt-save-view"
    };

    Object.entries(ids).forEach(([key, id]) => {
      this.els[key] = document.getElementById(id);
    });

    if (typeof Model === "undefined" || typeof Schema === "undefined") {
      this.showMessage("js/model.js ou js/schema.js introuvable : impossible de démarrer.", "error");
      return;
    }

    Editor.init(
      document.getElementById("yaml-editor"),
      () => {
        if (this.loading) {
          return;
        }

        this.updateDirty();
        this.persistText();
        this.scheduleApply();
      },
      (line) => this.onCursorLine(line),
      (ranges) => this.onEditorSelection(ranges)
    );
    Editor.onFold = (kind, line) => this.onEditorFold(kind, line);

    Graph.init(document.getElementById("cy"), {
      onNodeTap: (id) => !Tools.onNodeTap() && this.inspectNode(id, { tab: true, center: false }),
      onNodeDblTap: (id) => this.toggleCollapse(id),
      onBackgroundTap: () => this.exitFocus(),
      onNodeMenu: (id, position) => this.nodeMenu(id, position),
      onEdgeMenu: (id, position) => this.edgeMenu(id, position),
      onBackgroundMenu: (position) => this.backgroundMenu(position),
      onNodeMove: (id) => {
        if (this.cardFor === id) {
          this.moveCard();
        }
      },
      onViewChange: () => this.schedulePersistView()
    });

    Graph.cy.on("render", () => this.moveCard());
    Graph.cy.on("select unselect", () => this.scheduleSelectionChange());
    document.getElementById("selection-header").addEventListener("change", (event) => {
      if (event.target.matches("input[data-link-multi]")) {
        const checked = event.target.checked;
        const apply = () => Settings.set("links.multi", checked, Settings.source("links.multi") === "document" ? "document" : "local");

        // Unchecking while a series is open = closing it (with confirmation when drafts exist).
        if (!checked && LinkSeries.isActive()) {
          LinkSeries.requestClose().then((closed) => (closed ? apply() : this.updateSelectionHeader()));
        } else {
          apply();
        }
      }
    });
    Settings.onChange((keys) => {
      if (keys.includes("links.multi")) {
        this.updateSelectionHeader();
      }
    });
    document.getElementById("selection-header").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-sel-node], button[data-sel-edge]");

      if (button) {
        this.reduceSelection(button.dataset.selNode, button.dataset.selEdge);
      }
    });
    Trash.init();
    Tools.init();

    Inspector.init({
      center: (id) => this.inspectNode(id),
      collapse: (id) => this.toggleCollapse(id),
      expand: (id) => this.toggleCollapse(id),
      card: (id) => this.showCard(id),
      style: (id) => {
        StyleUI.show(id);
        this.showTab("style");
      },
      "focus-all": (id) => this.focusAll(id),
      "focus-link": (index) => this.focusLink(index),
      "link-hover": (from, to) => this.hoverLink(from, to),
      "link-unhover": () => Graph.clearHover(),
      "link-center": (from, to) => this.centerOnLink(from, to),
      "view-yaml": (id) => this.viewInYaml(id),
      "edit-source": (id) => {
        const node = this.model && this.model.byId.get(id);

        if (node && Project.canEditSource(node)) {
          Project.editSource(node.meta.source);
        }
      }
    });

    Settings.init();
    Settings.onChange((keys) => {
      if (keys.includes("editor.foldSync") && Editor.lastFolds) {
        Editor.lastFolds = new Set();
        this.syncEditorFolds();
      }
    });
    History.bind({ get: () => this.getText(), set: (text) => this.replaceText(text) });
    History.onChange((state) => this.updateHistoryMenu(state));
    History.installShortcuts();

    StyleUI.init();
    Anomalies.init();
    Help.init();
    SettingsUI.init();
    this.initSplitter();
    this.bindUi();
    Layouts.init();
    ViewUi.init();
    Tabs.init();

    if (Tabs.restore()) {
      return;
    }

    const last = this.read("topo:last");
    const text = last ? this.read(`topo:text:${last}`) : null;

    if (text) {
      this.loadText(text, {
        name: last === this.SCRATCH ? null : last,
        dirty: this.read(`topo:dirty:${last}`) === "1"
      });
    } else {
      this.loadText(Model.DEFAULT_YAML, { name: null, dirty: false });
    }

    Tabs.start();
  }
};

App.init();
