"use strict";

// Named frozen layouts: `view.layouts: { <name>: { positions, collapsed, zoom, pan, layout, savedAt } }`.
// The pure part works on YAML text (comments elsewhere in the file are kept); the rest drives App / Graph.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../vendor/yaml.js"), require("./doc-edit.js"));
  } else {
    root.Layouts = factory(root.YAML, root.DocEdit);
  }
})(typeof self !== "undefined" ? self : this, function (YAML, DocEdit) {
  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const VIEW_KEYS = ["view", "vue"];
  const MAX_NAME = 60;

  // Raw `view` object of a document (empty when absent or when the YAML is invalid).
  function readView(text) {
    try {
      const data = YAML.parse(String(text));
      const key = isPlain(data) ? VIEW_KEYS.find((name) => isPlain(data[name])) : null;

      return key ? data[key] : {};
    } catch (error) {
      return {};
    }
  }

  function readAll(text) {
    const layouts = readView(text).layouts;

    return isPlain(layouts) ? layouts : {};
  }

  function list(text) {
    return Object.keys(readAll(text));
  }

  function cleanName(name) {
    const value = String(name === undefined || name === null ? "" : name).trim();

    if (!value) throw new Error("Le nom de la disposition est vide.");
    if (value.length > MAX_NAME) throw new Error(`Nom trop long (${MAX_NAME} caractères maximum).`);
    return value;
  }

  // Entry stored for the current view state (App.getViewObject(false)).
  function capture(view, now) {
    const entry = {
      positions: view.positions || {},
      collapsed: (view.collapsed || []).slice(),
      zoom: view.zoom,
      pan: view.pan,
      layout: view.layout,
      savedAt: (now || new Date()).toISOString()
    };

    Object.keys(entry).forEach((key) => { if (entry[key] === undefined || entry[key] === null) delete entry[key]; });
    return entry;
  }

  function write(text, layouts) {
    const view = Object.assign({}, readView(text));

    if (Object.keys(layouts).length) view.layouts = layouts;
    else delete view.layouts;
    return DocEdit.setTopLevel(text, "view", view);
  }

  function save(text, name, entry) {
    const key = cleanName(name);
    const layouts = Object.assign({}, readAll(text));

    layouts[key] = entry;
    return write(text, layouts);
  }

  function remove(text, name) {
    const layouts = Object.assign({}, readAll(text));

    if (!(name in layouts)) throw new Error(`Disposition « ${name} » introuvable.`);
    delete layouts[name];
    return write(text, layouts);
  }

  function rename(text, from, to) {
    const key = cleanName(to);
    const layouts = readAll(text);

    if (!(from in layouts)) throw new Error(`Disposition « ${from} » introuvable.`);
    if (key !== from && key in layouts) throw new Error(`Une disposition « ${key} » existe déjà.`);

    const next = {};

    Object.keys(layouts).forEach((name) => { next[name === from ? key : name] = layouts[name]; });
    // Dropped first so the renamed entry keeps its position in the list.
    return write(write(text, {}), next);
  }

  const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

  // True when the current state (positions, folds, layout) differs from the stored entry; zoom / pan are ignored.
  function differs(entry, view) {
    if (!isPlain(entry)) return true;
    if ((entry.layout || null) !== (view.layout || null)) return true;
    if (!sameSet((entry.collapsed || []).map(String), (view.collapsed || []).map(String))) return true;

    const saved = isPlain(entry.positions) ? entry.positions : {};
    const now = view.positions || {};
    const ids = new Set(Object.keys(saved).concat(Object.keys(now)));

    for (const id of ids) {
      const a = saved[id];
      const b = now[id];

      if (!a || !b || Math.round(a.x) !== Math.round(b.x) || Math.round(a.y) !== Math.round(b.y)) return true;
    }

    return false;
  }

  const api = { readAll, list, capture, save, remove, rename, differs, cleanName, active: null };

  // ---------- browser side ----------

  api.commit = function commit(label, fn) {
    if (typeof Project !== "undefined" && Project.shouldRoute()) {
      // The merged view has no brick file to hold a view block: edit the merged text directly.
      const before = App.getText();

      try {
        const next = fn(before);

        if (next === before) return false;
        History.push(before, label);
        App.replaceText(next);
        return true;
      } catch (error) {
        App.showMessage(error.message, "error");
        return false;
      }
    }

    return App.edit(label, fn);
  };

  api.ask = function ask(title, value, okLabel, taken) {
    return Forms.dialog({
      title,
      okLabel,
      body: `<label class="forms-field">Nom<input name="name" type="text" maxlength="${MAX_NAME}" value="${escapeHtml(value || "")}" autocomplete="off" /></label>`,
      validate: (form) => {
        const name = form.elements.name.value.trim();

        if (!name) return "Saisissez un nom.";
        return taken(name) ? `« ${name} » existe déjà.` : "";
      },
      collect: (form) => form.elements.name.value.trim()
    });
  };

  api.saveAs = async function saveAs() {
    if (!App.requireModel()) return;

    const existing = list(App.getText());
    const name = await this.ask("Enregistrer la disposition", `Disposition ${existing.length + 1}`, "Enregistrer", (n) => existing.includes(n));

    if (!name) return;
    this.write(name, `Disposition « ${name} » enregistrée.`);
  };

  api.write = function write_(name, message) {
    const entry = capture(App.getViewObject(false));

    if (this.commit(`Disposition « ${name} »`, (text) => save(text, name, entry))) {
      this.active = name;
      this.refresh();
      App.showMessage(message, "success");
    }
  };

  api.update = function update(name) {
    this.write(name, `Disposition « ${name} » mise à jour.`);
  };

  api.apply = function apply(name) {
    const entry = readAll(App.getText())[name];

    if (!isPlain(entry)) {
      App.showMessage(`Disposition « ${name} » introuvable.`, "warning");
      return false;
    }

    App.applyView(Object.assign({}, entry, { pinned: true }));
    this.active = name;
    this.refresh();
    App.showMessage(`Disposition « ${name} » appliquée.`, "info");
    return true;
  };

  api.applyNth = function applyNth(index) {
    const names = list(App.getText());

    if (names[index]) this.apply(names[index]);
  };

  api.renameTo = async function renameTo(name) {
    const existing = list(App.getText());
    const next = await this.ask("Renommer la disposition", name, "Renommer", (n) => n !== name && existing.includes(n));

    if (!next || next === name) return;
    if (this.commit(`Renommage de la disposition « ${name} »`, (text) => rename(text, name, next))) {
      if (this.active === name) this.active = next;
      this.refresh();
    }
  };

  api.removeNamed = async function removeNamed(name) {
    const answer = await Forms.confirm({
      title: "Supprimer la disposition",
      html: `Supprimer la disposition « ${escapeHtml(name)} » ?`,
      okLabel: "Supprimer",
      danger: true
    });

    if (!answer) return;
    if (this.commit(`Suppression de la disposition « ${name} »`, (text) => remove(text, name))) {
      if (this.active === name) this.active = null;
      this.refresh();
    }
  };

  // Status in the graph toolbar: active layout name, and whether the user moved things since.
  api.refresh = function refresh() {
    const badge = document.getElementById("layout-badge");
    const names = list(App.getText());

    if (this.active && !names.includes(this.active)) this.active = null;
    this.renderMenu(names);

    if (!badge) return;
    if (!this.active || !App.model) {
      badge.hidden = true;
      return;
    }

    const modified = differs(readAll(App.getText())[this.active], App.getViewObject(false));

    badge.hidden = false;
    badge.classList.toggle("modified", modified);
    badge.textContent = `Disposition : ${this.active}${modified ? " • modifiée" : ""}`;
    badge.title = modified ? "Vous avez bougé des briques depuis cette disposition (Vue > Dispositions > Mettre à jour pour l’écraser)." : "Disposition nommée active.";
  };

  api.renderMenu = function renderMenu(names) {
    const box = document.getElementById("layouts-menu");

    if (!box) return;

    const rows = names.map((name, index) => `
      <div class="layout-row${name === this.active ? " active" : ""}" data-name="${escapeHtml(name)}">
        <button type="button" role="menuitem" data-lay="apply" title="Appliquer${index < 9 ? ` (Ctrl+Alt+${index + 1})` : ""}">${escapeHtml(name)}${index < 9 ? `<kbd>Ctrl+Alt+${index + 1}</kbd>` : ""}</button>
        <button type="button" class="icon-btn" data-lay="update" title="Mettre à jour avec l’état courant" aria-label="Mettre à jour">⟳</button>
        <button type="button" class="icon-btn" data-lay="rename" title="Renommer" aria-label="Renommer">✎</button>
        <button type="button" class="icon-btn" data-lay="remove" title="Supprimer" aria-label="Supprimer">✕</button>
      </div>`).join("");

    box.innerHTML = `<button type="button" role="menuitem" data-lay="save" title="Mémorise les positions actuelles sous un nom, dans le document.">Enregistrer la disposition actuelle sous…</button>${rows || "<div class=\"menu-empty\">Aucune disposition enregistrée.</div>"}`;
  };

  api.init = function init() {
    const box = document.getElementById("layouts-menu");
    const toggle = document.getElementById("layouts-toggle");

    toggle.addEventListener("click", () => {
      this.refresh();
      box.hidden = !box.hidden;
      toggle.setAttribute("aria-expanded", String(!box.hidden));
    });

    box.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-lay]");

      if (!button) return;

      const row = button.closest(".layout-row");
      const name = row && row.dataset.name;

      App.closeDropdowns();
      ({
        save: () => this.saveAs(),
        apply: () => this.apply(name),
        update: () => this.update(name),
        rename: () => this.renameTo(name),
        remove: () => this.removeNamed(name)
      })[button.dataset.lay]();
    });

    document.addEventListener("keydown", (event) => {
      const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "");

      if (!match || !event.ctrlKey || !event.altKey || event.shiftKey || Forms.isOpen()) return;
      event.preventDefault();
      this.applyNth(Number(match[1]) - 1);
    });

    this.refresh();
  };

  return api;
});
