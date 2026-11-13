"use strict";

// Document tabs: several files / projects open at once. The live document stays in App; each tab
// keeps a record (text, name, file handle, dirty, view, history, project) refreshed when leaving it.
// The pure part (storage format, ordering) has no DOM dependency.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Tabs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const KEY = "topo:tabs";
  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  let counter = 0;

  const newId = () => `t${Date.now().toString(36)}${(counter += 1)}`;

  // What survives a reload: no file handle, no history, no project state.
  function storable(tab) {
    return {
      id: tab.id,
      name: tab.name || null,
      text: String(tab.text === undefined || tab.text === null ? "" : tab.text),
      dirty: Boolean(tab.dirty),
      view: isPlain(tab.view) ? tab.view : null
    };
  }

  function serialize(tabs, activeId) {
    return JSON.stringify({ version: 1, active: activeId, tabs: tabs.map(storable) });
  }

  // Returns { active, tabs } with fresh records, or null when nothing usable is stored.
  function parseStored(raw) {
    let data;

    try {
      data = JSON.parse(raw);
    } catch (error) {
      return null;
    }

    if (!isPlain(data) || !Array.isArray(data.tabs)) return null;

    const seen = new Set();
    const tabs = data.tabs.filter((item) => isPlain(item) && typeof item.text === "string").map((item) => {
      let id = typeof item.id === "string" && item.id ? item.id : newId();

      while (seen.has(id)) id = newId();
      seen.add(id);

      return {
        id,
        name: typeof item.name === "string" && item.name ? item.name : null,
        text: item.text,
        dirty: Boolean(item.dirty),
        view: isPlain(item.view) ? item.view : null,
        handle: null,
        history: null,
        project: null,
        savedText: item.dirty ? null : undefined
      };
    });

    if (!tabs.length) return null;
    return { active: tabs.some((tab) => tab.id === data.active) ? data.active : tabs[0].id, tabs };
  }

  // Tab to activate after closing `id`: the right neighbour, else the left one, else null.
  function neighborAfterClose(ids, id) {
    const index = ids.indexOf(id);

    if (index < 0 || ids.length < 2) return null;
    return ids[index + 1 !== ids.length ? index + 1 : index - 1];
  }

  function stepId(ids, id, delta) {
    if (!ids.length) return null;
    const index = ids.indexOf(id);

    return ids[(index + delta + ids.length * 2) % ids.length];
  }

  // Blank = no file, no unsaved change, still the starter text: a new document may replace it.
  function isBlank(state, starters) {
    const text = String(state.text || "").trimEnd();

    return !state.dirty && !state.name && !state.handle && !state.project && starters.some((s) => String(s).trimEnd() === text);
  }

  const api = { KEY, newId, storable, serialize, parseStored, neighborAfterClose, stepId, isBlank };

  // ---------- browser side ----------

  api.tabs = [];
  api.activeId = null;
  api.timer = null;
  api.lastHtml = "";
  api.els = {};

  api.active = function active() {
    return this.tabs.find((tab) => tab.id === this.activeId) || null;
  };

  api.init = function init() {
    this.els.bar = document.getElementById("doc-tabs");

    this.els.bar.addEventListener("click", (event) => {
      const row = event.target.closest(".doc-tab");

      if (event.target.closest("#doc-tab-new")) {
        this.newTab();
      } else if (row && event.target.closest(".doc-tab-close")) {
        this.close(row.dataset.id);
      } else if (row) {
        this.switchTo(row.dataset.id);
      }
    });
    this.els.bar.addEventListener("dblclick", (event) => {
      const row = event.target.closest(".doc-tab");

      if (row && !event.target.closest(".doc-tab-close") && row.dataset.id === this.activeId) {
        App.renameDocument();
      }
    });
    this.els.bar.addEventListener("auxclick", (event) => {
      const row = event.target.closest(".doc-tab");

      if (row && event.button === 1) {
        event.preventDefault();
        this.close(row.dataset.id);
      }
    });
    window.addEventListener("pagehide", () => this.flush());
  };

  // Registers the document currently loaded in App as the first tab.
  api.start = function start() {
    const tab = { id: newId(), name: null, text: "", dirty: false, view: null, handle: null, history: null, project: null };

    this.tabs = [tab];
    this.activeId = tab.id;
    this.captureActive();
    this.render();
  };

  // Rebuilds the tabs saved in localStorage; false when there are none.
  api.restore = function restore() {
    const stored = parseStored(App.read(KEY));

    if (!stored) return false;

    this.tabs = stored.tabs;
    this.activeId = stored.active;
    this.loadInto(this.active());
    this.render();
    return true;
  };

  api.captureActive = function captureActive() {
    const tab = this.active();

    if (!tab) return;

    tab.text = App.getText();
    tab.name = App.name;
    tab.handle = Files.current.handle || null;
    tab.dirty = App.dirty;
    tab.savedText = App.savedText;
    tab.history = History.snapshot();
    tab.project = Project.captureState();
    tab.layoutName = Layouts.active;

    if (App.model) {
      tab.view = Object.assign(App.getViewObject(false), { pinned: Graph.pinned });
    }
  };

  // Puts a tab record into App (no automatic layout: positions come from the stored view).
  api.loadInto = function loadInto(tab, options = {}) {
    if (!options.keepProject) Project.resetState();

    App.loadText(tab.text, { name: tab.name, handle: tab.handle, dirty: tab.dirty, view: tab.view });

    if (tab.savedText !== undefined) {
      App.savedText = tab.savedText;
      App.updateDirty();
    }

    History.restore(tab.history);
    Layouts.active = tab.layoutName || null;

    if (tab.project) {
      Project.applyState(tab.project);
    } else if (document.getElementById("pane-project") && document.getElementById("pane-project").classList.contains("active")) {
      App.showTab("editor");
    }

    Layouts.refresh();
    this.persistSoon();

    if (typeof FileWatch !== "undefined") FileWatch.onActivate();
  };

  api.switchTo = function switchTo(id) {
    const tab = this.tabs.find((item) => item.id === id);

    if (!tab || id === this.activeId) return;

    // An open link series is closed first (confirmation when drafts exist).
    if (typeof LinkSeries !== "undefined" && LinkSeries.isActive()) {
      LinkSeries.requestClose().then((closed) => { if (closed) this.switchTo(id); });
      return;
    }

    this.captureActive();
    this.activeId = id;
    this.loadInto(tab);
    this.render();
  };

  api.step = function step(delta) {
    const id = stepId(this.tabs.map((tab) => tab.id), this.activeId, delta);

    if (id) this.switchTo(id);
  };

  api.blankNow = function blankNow() {
    return isBlank({
      text: App.getText(), name: App.name, dirty: App.dirty, handle: Files.current.handle, project: Project.isOpen
    }, [App.NEW_DOCUMENT, Model.DEFAULT_YAML]);
  };

  // Loads a document in a new tab (or in the current one when it is blank and `reuse`).
  api.place = function place(fields, reuse) {
    const blank = reuse && this.blankNow();
    let tab = this.active();

    if (!blank || !tab) {
      this.captureActive();
      tab = { id: newId() };
      this.tabs.push(tab);
      this.activeId = tab.id;
    }

    Object.assign(tab, {
      name: null, handle: null, text: "", dirty: false, savedText: undefined, view: null, history: null, project: null, layoutName: null, watch: null
    }, fields);
    this.loadInto(tab, { keepProject: Boolean(fields.keepProject) });
    this.render();
    return tab;
  };

  api.newTab = function newTab() {
    this.place({ text: App.NEW_DOCUMENT, view: {} }, false);
  };

  // File > Open: a new tab, except when the current one is still blank.
  api.openDocument = function openDocument(text, options = {}) {
    this.place({
      text,
      name: options.name || null,
      handle: options.handle || null,
      watch: typeof FileWatch !== "undefined" ? FileWatch.fresh(options.sig) : null
    }, true);
  };

  // Project > Open: same, called once the folder is chosen and before the merged document loads.
  api.prepareNew = function prepareNew() {
    this.place({ text: App.NEW_DOCUMENT, view: {}, keepProject: true }, true);
  };

  api.canOpenProject = function canOpenProject() {
    const holder = Project.isOpen ? this.active() : this.tabs.find((tab) => tab.project);

    if (!holder) return true;

    App.showMessage("Un seul projet à la fois : fermez le projet ouvert (bouton « Fermer le projet » ou ✕ de son onglet) avant d’en ouvrir un autre.", "warning");
    return false;
  };

  api.askClose = function askClose(name) {
    return Forms.dialog({
      title: "Fermer l’onglet",
      okLabel: "Enregistrer",
      body: `<div class="forms-message">« ${escapeHtml(name)} » contient des modifications non enregistrées.</div>
        <button type="button" class="danger" data-discard="1">Ne pas enregistrer</button>`,
      setup: (form) => form.querySelector("[data-discard]").addEventListener("click", () => Forms.closeActive({ choice: "discard" })),
      collect: () => ({ choice: "save" })
    }).then((answer) => (answer ? answer.choice : null));
  };

  api.label = function label(tab) {
    const live = tab.id === this.activeId;
    const project = live ? Project.isOpen : tab.project;
    const name = live ? App.name : tab.name;

    if (project) return `${live ? Project.folder : tab.project.folder} (projet)`;
    return name || "Sans titre";
  };

  api.close = async function close(id) {
    const tab = this.tabs.find((item) => item.id === (id || this.activeId));

    if (!tab) return;

    const live = tab.id === this.activeId;

    if (live ? App.dirty : tab.dirty) {
      const choice = await this.askClose(this.label(tab));

      if (!choice) return;

      if (choice === "save") {
        this.switchTo(tab.id);
        await App.save(false);

        if (App.dirty) return;
      }
    }

    const ids = this.tabs.map((item) => item.id);
    const wasActive = tab.id === this.activeId;
    const next = neighborAfterClose(ids, tab.id);

    this.tabs = this.tabs.filter((item) => item.id !== tab.id);

    if (wasActive) {
      if (next) {
        this.activeId = next;
        this.loadInto(this.active());
      } else {
        const fresh = { id: newId(), name: null, handle: null, text: App.NEW_DOCUMENT, dirty: false, savedText: undefined, view: {}, history: null, project: null };

        this.tabs.push(fresh);
        this.activeId = fresh.id;
        this.loadInto(fresh);
      }
    }

    this.persistSoon();
    this.render();
  };

  api.anyDirty = function anyDirty() {
    return this.tabs.some((tab) => (tab.id === this.activeId ? App.dirty : tab.dirty));
  };

  api.render = function render() {
    const bar = this.els.bar;

    if (!bar || !this.tabs.length) return;

    const html = this.tabs.map((tab) => {
      const live = tab.id === this.activeId;
      const dirty = live ? App.dirty : tab.dirty;
      const name = this.label(tab);

      return `<div class="doc-tab${live ? " active" : ""}" role="tab" aria-selected="${live}" data-id="${escapeHtml(tab.id)}" title="${escapeHtml(name)}&#10;Double-clic : renommer">
        <span class="doc-tab-name">${escapeHtml(name)}</span>${dirty ? "<span class=\"doc-tab-dirty\" title=\"Modifications non enregistrées\">●</span>" : ""}${typeof FileWatch !== "undefined" ? FileWatch.staleMark(tab) : ""}
        <button type="button" class="doc-tab-close" title="Fermer l’onglet (Ctrl+W)" aria-label="Fermer l’onglet">✕</button>
      </div>`;
    }).join("") + "<button id=\"doc-tab-new\" type=\"button\" class=\"doc-tab-new\" title=\"Nouveau document dans un nouvel onglet\" aria-label=\"Nouvel onglet\">＋</button>";

    if (html !== this.lastHtml) {
      this.lastHtml = html;
      bar.innerHTML = html;
    }

    if (typeof FileWatch !== "undefined") FileWatch.render();
  };

  api.persistSoon = function persistSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  };

  api.flush = function flush() {
    clearTimeout(this.timer);

    if (!this.activeId || !this.active()) return;

    this.captureActive();
    App.store(KEY, serialize(this.tabs, this.activeId));
  };

  return api;
});
