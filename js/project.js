"use strict";

const Project = {
  OUTPUT: "architecture.yaml",
  SKIP_DIRS: new Set(["node_modules", ".git"]),
  isOpen: false,
  root: null,
  readOnly: false,
  folder: "",
  bricks: [],
  anomalies: [],
  mode: null,
  sourcePath: null,
  known: new Map(),
  snapshot: new Map(),
  lastScan: 0,
  timer: null,
  busy: false,
  working: false,
  undoStack: [],
  redoStack: [],
  els: {},

  // ---- lifecycle ----

  init() {
    this.els = {
      tab: document.getElementById("tab-project"),
      content: document.getElementById("project-content"),
      banner: document.getElementById("project-banner"),
      button: document.getElementById("btn-open-project")
    };

    this.els.button.addEventListener("click", () => {
      App.closeDropdowns();
      this.open();
    });
    this.els.content.addEventListener("click", (event) => this.onClick(event));
    this.els.banner.addEventListener("click", (event) => this.onClick(event));
    window.addEventListener("keydown", (event) => this.onUndoKey(event), true);
  },

  STATE_KEYS: ["isOpen", "root", "readOnly", "folder", "bricks", "anomalies", "mode", "sourcePath", "known", "snapshot", "lastScan", "undoStack", "redoStack", "pendingFiles"],

  // Document tabs: a project lives in one tab at a time; these swap its state in and out.
  captureState() {
    if (!this.isOpen) {
      return null;
    }

    const state = { hook: App.saveHook };

    this.STATE_KEYS.forEach((key) => { state[key] = this[key]; });
    return state;
  },

  resetState() {
    clearInterval(this.timer);
    this.timer = null;
    Object.assign(this, {
      isOpen: false, root: null, readOnly: false, folder: "", bricks: [], anomalies: [], mode: null, sourcePath: null,
      known: new Map(), snapshot: new Map(), undoStack: [], redoStack: [], pendingFiles: null
    });
    App.onSave(null);

    if (this.els.tab) {
      this.els.tab.hidden = true;
      this.els.banner.hidden = true;
      this.els.content.innerHTML = "";
    }
  },

  applyState(state) {
    this.STATE_KEYS.forEach((key) => { this[key] = state[key]; });
    this.els.tab.hidden = false;
    this.render();
    App.saveHook = state.hook || null;
    this.startPolling();
  },

  async open() {
    if (typeof Tabs !== "undefined" && !Tabs.canOpenProject()) {
      return;
    }

    try {
      const loaded = typeof window.showDirectoryPicker === "function"
        ? await this.pickWithApi()
        : await this.pickWithInput();

      if (!loaded) {
        return;
      }

      if (typeof Tabs !== "undefined") {
        Tabs.prepareNew();
      }

      this.isOpen = true;
      this.undoStack = [];
      this.redoStack = [];
      this.mode = "merged";
      this.els.tab.hidden = false;
      await this.rebuild({ force: true, first: true });
      App.showTab("project");
      this.startPolling();
    } catch (error) {
      App.showMessage(`Ouverture du projet impossible : ${error.message}`, "error");
    }
  },

  async pickWithApi() {
    let dir;

    try {
      dir = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error.name === "AbortError") {
        return false;
      }

      throw error;
    }

    this.root = dir;
    this.readOnly = false;
    this.folder = dir.name;
    this.bricks = [];
    return true;
  },

  pickWithInput() {
    return new Promise((resolve) => {
      const input = document.createElement("input");

      input.type = "file";
      input.webkitdirectory = true;
      input.addEventListener("change", () => {
        const files = Array.from(input.files || []);

        if (!files.length) {
          resolve(false);
          return;
        }

        this.root = null;
        this.readOnly = true;
        this.folder = files[0].webkitRelativePath.split("/")[0] || "projet";
        this.pendingFiles = files;
        resolve(true);
      });
      input.addEventListener("cancel", () => resolve(false));
      input.click();
    });
  },

  async closeProject() {
    if (!App.confirmDiscard()) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    App.onSave(null);
    this.isOpen = false;
    this.mode = null;
    this.sourcePath = null;
    this.undoStack = [];
    this.redoStack = [];
    this.root = null;
    this.bricks = [];
    this.anomalies = [];
    this.pendingFiles = null;
    this.els.tab.hidden = true;
    this.els.banner.hidden = true;
    this.els.content.innerHTML = "";
    App.showTab("editor");
    App.updateHistoryMenu(History.state());
    App.showMessage("Projet fermé.", "info");
  },

  // ---- scanning ----

  async listFiles() {
    if (this.readOnly) {
      return (this.pendingFiles || []).map((file) => ({
        path: file.webkitRelativePath.split("/").slice(1).join("/"),
        file,
        lastModified: file.lastModified
      })).filter((entry) => this.isCandidate(entry.path));
    }

    const out = [];

    await this.walk(this.root, "", out);
    return out;
  },

  isCandidate(path) {
    const parts = path.split("/");

    return path !== this.OUTPUT
      && parts.every((part, i) => i === parts.length - 1 || (!part.startsWith(".") && !this.SKIP_DIRS.has(part)))
      && Merge.isBrickFile(path);
  },

  async walk(dir, prefix, out) {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix + name;

      if (handle.kind === "directory") {
        if (!name.startsWith(".") && !this.SKIP_DIRS.has(name)) {
          await this.walk(handle, `${path}/`, out);
        }
      } else if (this.isCandidate(path)) {
        out.push({ path, handle, lastModified: (await handle.getFile()).lastModified });
      }
    }
  },

  async readBricks() {
    const entries = await this.listFiles();

    this.bricks = await Promise.all(entries.map(async (entry) => {
      const file = entry.file || await entry.handle.getFile();

      return { path: entry.path, handle: entry.handle || null, text: await file.text(), lastModified: file.lastModified };
    }));
    this.bricks.sort((a, b) => a.path.localeCompare(b.path));
    this.known = new Map(this.bricks.map((brick) => [brick.path, brick.lastModified]));
    this.snapshot = new Map(this.known);
    this.lastScan = Date.now();
  },

  // ---- merge ----

  mergedName() {
    return `${this.folder}/${this.OUTPUT} (fusionné)`;
  },

  async rebuild(options = {}) {
    if (!options.force && !App.confirmDiscard()) {
      return;
    }

    await this.readBricks();

    const result = Merge.mergeProject(
      this.bricks.map((brick) => ({ path: brick.path, text: brick.text })),
      { output: this.OUTPUT }
    );

    this.anomalies = result.anomalies || [];
    this.mode = "merged";
    this.sourcePath = null;

    if (!options.first && App.name === this.mergedName()) {
      App.persistView();
    }

    App.onSave((text) => this.saveMerged(text));
    App.loadText(Merge.toYaml(result.document), { name: this.mergedName(), dirty: false });
    this.render();
  },

  async saveMerged(text) {
    await this.writeProjectFile(this.OUTPUT, text);
    App.showMessage(`« ${this.OUTPUT} » enregistré dans « ${this.folder} ».`, "success");
  },

  async writeProjectFile(path, text, handle) {
    if (this.readOnly) {
      Files.download(text, path.split("/").pop(), "text/yaml");
      return;
    }

    const target = handle || await this.root.getFileHandle(path, { create: true });
    const writable = await target.createWritable();

    await writable.write(text);
    await writable.close();
  },

  async saveMergedYaml() {
    try {
      const text = App.getText();

      await this.saveMerged(text);
    } catch (error) {
      App.showMessage(`Enregistrement impossible : ${error.message}`, "error");
    }
  },

  // ---- fixes ----

  async applyFix(fix) {
    const brick = this.bricks.find((item) => item.path === fix.file);

    if (!brick) {
      App.showMessage(`Fichier « ${fix.file} » introuvable dans le projet.`, "error");
      return;
    }

    try {
      if (brick.handle) {
        brick.text = await (await brick.handle.getFile()).text();
      }

      const next = Merge.applyFix(brick.text, fix);

      if (next === brick.text) {
        App.showMessage(`Aucun changement dans « ${fix.file} » (référence introuvable).`, "warning");
        return;
      }

      brick.text = next;
      await this.writeProjectFile(brick.path, next, brick.handle);
      await this.rebuild({ force: false });
      App.showMessage(
        this.readOnly
          ? `Correctif téléchargé pour « ${fix.file} » (à copier dans le dossier).`
          : `« ${fix.file} » corrigé : « ${fix.oldRef} » remplacé par « ${fix.newRef} ».`,
        "success"
      );
    } catch (error) {
      App.showMessage(`Correctif impossible : ${error.message}`, "error");
    }
  },

  // ---- source editing ----

  canEditSource(node) {
    return Boolean(this.isOpen && this.mode === "merged" && node && node.meta && node.meta.source
      && this.bricks.some((brick) => brick.path === node.meta.source));
  },

  async editSource(path) {
    const brick = this.bricks.find((item) => item.path === path);

    if (!brick || !App.confirmDiscard()) {
      return;
    }

    try {
      if (brick.handle) {
        brick.text = await (await brick.handle.getFile()).text();
      }

      if (this.mode === "merged") {
        App.persistView();
      }

      this.mode = "source";
      this.sourcePath = path;
      App.onSave((text) => this.saveSource(brick, text));
      App.loadText(brick.text, { name: `${this.folder}/${path}`, dirty: false });
      this.render();
      App.showTab("editor");
    } catch (error) {
      App.showMessage(`Lecture de la source impossible : ${error.message}`, "error");
    }
  },

  async saveSource(brick, text) {
    await this.writeProjectFile(brick.path, text, brick.handle);
    brick.text = text;
    App.showMessage(`« ${brick.path} » enregistré. Reconstruction du fusionné…`, "success");
    setTimeout(() => this.rebuild({ force: true }).catch((error) => {
      App.showMessage(`Reconstruction impossible : ${error.message}`, "error");
    }), 0);
  },

  async backToMerged() {
    if (this.mode !== "source" || !App.confirmDiscard()) {
      return;
    }

    try {
      await this.rebuild({ force: true });
    } catch (error) {
      App.showMessage(`Reconstruction impossible : ${error.message}`, "error");
    }
  },

  // ---- graphical edits routed to the brick files ----

  shouldRoute() {
    return Boolean(this.isOpen && this.mode === "merged" && !this.readOnly);
  },

  brickFiles() {
    return this.bricks.map((brick) => ({ path: brick.path, text: brick.text }));
  },

  // Called by App.edit in merged view: translates the edit into brick-file edits (or refuses it).
  routeEdit(label, fn) {
    if (this.working) {
      App.showMessage("Écriture du projet en cours, réessayez dans un instant.", "warning");
      return false;
    }

    let result;

    try {
      const before = App.getText();
      const next = fn(before);

      if (typeof next !== "string" || next === before) {
        return false;
      }

      result = ProjectSync.translate(this.brickFiles(), before, next);
    } catch (error) {
      App.showMessage(error.message, error.refusal ? "warning" : "error");
      return false;
    }

    if (!Object.keys(result.files).length) {
      return false;
    }

    this.run(() => this.commit(label, result.files));
    return true;
  },

  run(task) {
    this.working = true;
    return task().catch((error) => App.showMessage(`Écriture du projet impossible : ${error.message}`, "error")).finally(() => {
      this.working = false;
      this.refreshHistory();
    });
  },

  async diskText(path) {
    const brick = this.bricks.find((item) => item.path === path);

    if (!brick) {
      return null;
    }

    return brick.handle ? (await (await brick.handle.getFile()).text()) : brick.text;
  },

  async assertUntouched(expected) {
    for (const path of Object.keys(expected)) {
      const current = await this.diskText(path);

      if (current !== expected[path]) {
        throw new Error(`« ${path} » a été modifié en dehors de Topo : reconstruisez le projet avant de continuer.`);
      }
    }
  },

  async writeAll(texts) {
    for (const path of Object.keys(texts)) {
      const brick = this.bricks.find((item) => item.path === path);

      if (texts[path] === null) {
        await this.root.removeEntry(path.split("/").pop());
      } else {
        await this.writeProjectFile(path, texts[path], brick && brick.handle);
      }
    }
  },

  async commit(label, files) {
    const before = {};
    const known = {};

    for (const path of Object.keys(files)) {
      const brick = this.bricks.find((item) => item.path === path);

      before[path] = brick ? brick.text : null;
      known[path] = before[path];
    }

    await this.assertUntouched(known);
    await this.writeAll(files);
    this.undoStack.push({ label, before, after: files });
    this.redoStack = [];
    await this.rebuild({ force: true });
    App.showMessage(`${label} : ${Object.keys(files).join(", ")} mis à jour.`, "success");
  },

  historyState() {
    const top = (stack) => (stack.length ? stack[stack.length - 1].label : null);

    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: top(this.undoStack),
      redoLabel: top(this.redoStack)
    };
  },

  refreshHistory() {
    App.updateHistoryMenu(this.shouldRoute() ? this.historyState() : History.state());
  },

  undo() {
    return this.step(this.undoStack, this.redoStack, "before", "after", "Annulé");
  },

  redo() {
    return this.step(this.redoStack, this.undoStack, "after", "before", "Rétabli");
  },

  // Moves one entry between stacks, writing the `target` snapshot of its files.
  step(from, to, target, current, verb) {
    const entry = from[from.length - 1];

    if (!entry || this.working) {
      return null;
    }

    this.run(async () => {
      await this.assertUntouched(entry[current]);
      await this.writeAll(entry[target]);
      from.pop();
      to.push(entry);
      await this.rebuild({ force: true });
      App.showMessage(`${verb} : ${entry.label}.`, "info");
    });
    return entry.label;
  },

  onUndoKey(event) {
    if (!this.shouldRoute() || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }

    const target = event.target;
    const key = event.key.toLowerCase();

    if ((key !== "z" && key !== "y") || (target && target.closest && target.closest(".CodeMirror, input, textarea, select, [contenteditable=\"true\"]"))) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (key === "y" || event.shiftKey) {
      App.redo();
    } else {
      App.undo();
    }
  },

  // ---- change detection ----

  startPolling() {
    clearInterval(this.timer);

    if (!this.readOnly) {
      this.timer = setInterval(() => this.tick(), 3000);
    }
  },

  async tick() {
    if (this.busy || !this.isOpen) {
      return;
    }

    this.busy = true;

    try {
      if (Date.now() - this.lastScan >= 10000) {
        const entries = await this.listFiles();

        this.snapshot = new Map(entries.map((entry) => [entry.path, entry.lastModified]));
        this.lastScan = Date.now();
      } else {
        await this.refreshKnown();
      }

      this.renderBanner();
    } catch {
      /* folder temporarily unreadable: retry on next tick */
    } finally {
      this.busy = false;
    }
  },

  async refreshKnown() {
    for (const brick of this.bricks) {
      if (this.snapshot.has(brick.path) && brick.handle) {
        try {
          this.snapshot.set(brick.path, (await brick.handle.getFile()).lastModified);
        } catch {
          this.snapshot.delete(brick.path);
        }
      }
    }
  },

  changedCount() {
    let count = 0;

    this.snapshot.forEach((time, path) => {
      if (this.known.get(path) !== time) {
        count += 1;
      }
    });
    this.known.forEach((time, path) => {
      if (!this.snapshot.has(path)) {
        count += 1;
      }
    });
    return count;
  },

  // ---- rendering ----

  render() {
    this.renderPanel();
    this.renderBanner();
    this.refreshHistory();
  },

  renderBanner() {
    if (!this.isOpen) {
      this.els.banner.hidden = true;
      return;
    }

    const changed = this.changedCount();
    const notes = [];

    if (this.readOnly) {
      notes.push("Mode lecture seule (navigateur sans accès aux dossiers) : correctifs et enregistrements sont téléchargés, pas écrits.");
    }

    if (this.mode === "merged") {
      notes.push("Vue fusionnée : les éditions graphiques sont écrites dans les petits YAML sources (Ctrl+Z les annule) ; les actions sur un dossier entier sont refusées. Ctrl+S écrit " + this.OUTPUT + ".");
    } else if (this.mode === "source") {
      notes.push(`Édition de la source « ${this.sourcePath} » : Ctrl+S l’enregistre puis reconstruit le fusionné.`);
    }

    const alert = changed
      ? `<div class="project-banner-alert">${escapeHtml(changed)} fichier(s) source modifié(s) — <button type="button" data-act="rebuild">Reconstruire</button> <button type="button" data-act="ignore">Ignorer</button></div>`
      : "";

    this.els.banner.innerHTML = alert + notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("");
    this.els.banner.hidden = false;
  },

  titleFor(path) {
    const model = App.getModel();

    if (!model || this.mode !== "merged") {
      return "";
    }

    for (const node of model.byId.values()) {
      if (node.meta && node.meta.source === path) {
        return node.label || node.id;
      }
    }

    return "";
  },

  nodeFor(path) {
    const model = App.getModel();

    for (const node of model ? model.byId.values() : []) {
      if (node.meta && node.meta.source === path) {
        return node.id;
      }
    }

    return null;
  },

  renderPanel() {
    const bricks = this.bricks.map((brick, index) => {
      const title = this.titleFor(brick.path);
      const depth = brick.path.split("/").length - 1;

      return `<li style="padding-left:${depth * 12}px">
        <button type="button" class="link-node" data-act="goto" data-index="${index}">${escapeHtml(brick.path)}</button>
        ${title ? `<span class="path">→ ${escapeHtml(title)}</span>` : ""}
        <button type="button" class="project-edit" data-act="source" data-index="${index}" title="Éditer la source">✎</button>
      </li>`;
    }).join("");

    this.els.content.innerHTML = `
      <h3>${escapeHtml(this.folder)}</h3>
      <p class="path">${escapeHtml(this.bricks.length)} brique(s)${this.readOnly ? " · lecture seule" : ""}</p>
      <div class="actions project-actions">
        <button type="button" data-act="rebuild">Reconstruire</button>
        <button type="button" data-act="save-merged">Enregistrer le YAML fusionné</button>
        ${this.mode === "source" ? "<button type=\"button\" data-act=\"back\">← Retour au fusionné</button>" : ""}
        <button type="button" data-act="close">Fermer le projet</button>
      </div>
      <h4>Briques</h4>
      <ul class="project-tree">${bricks || "<li class=\"empty\">Aucune brique trouvée.</li>"}</ul>
      <h4>Anomalies de fusion (${escapeHtml(this.anomalies.length)})</h4>
      ${this.anomalies.length ? this.anomalies.map((item, index) => this.anomalyHtml(item, index)).join("") : "<p class=\"empty\">Aucune anomalie.</p>"}
    `;
  },

  anomalyHtml(anomaly, index) {
    const level = anomaly.level === "error" ? "error" : "warning";
    const fixes = Array.isArray(anomaly.fixes) ? anomaly.fixes : [];

    return `
      <div class="anomaly ${level}">
        <div class="anomaly-head">
          <span class="anomaly-icon">${level === "error" ? "✖" : "⚠"}</span>
          <div>
            <div>${escapeHtml(anomaly.message)}</div>
            <div class="anomaly-code">${escapeHtml(anomaly.code || "")}${anomaly.file ? ` · ${escapeHtml(anomaly.file)}` : ""}</div>
          </div>
        </div>
        <div class="anomaly-actions">
          ${fixes.map((fix, fixIndex) => `<button type="button" data-act="fix" data-index="${index}" data-fix="${fixIndex}">Remplacer par <code>${escapeHtml(fix.newRef)}</code></button>`).join("")}
        </div>
      </div>`;
  },

  // ---- events ----

  onClick(event) {
    const button = event.target.closest("button[data-act]");

    if (!button || !this.isOpen) {
      return;
    }

    const index = Number(button.dataset.index);
    const run = {
      rebuild: () => this.rebuild(),
      ignore: () => {
        this.known = new Map(this.snapshot);
        this.renderBanner();
      },
      "save-merged": () => this.saveMergedYaml(),
      back: () => this.backToMerged(),
      close: () => this.closeProject(),
      goto: () => this.gotoBrick(this.bricks[index]),
      source: () => this.editSource(this.bricks[index] && this.bricks[index].path),
      fix: () => {
        const anomaly = this.anomalies[index];
        const fix = anomaly && anomaly.fixes && anomaly.fixes[Number(button.dataset.fix)];

        return fix && this.applyFix(fix);
      }
    }[button.dataset.act];

    Promise.resolve(run && run()).catch((error) => App.showMessage(error.message, "error"));
  },

  gotoBrick(brick) {
    const id = brick && this.mode === "merged" ? this.nodeFor(brick.path) : null;

    if (id) {
      App.inspectNode(id);
    } else if (brick) {
      App.showMessage("Revenez au fusionné pour centrer ce nœud.", "info");
    }
  }
};

Project.init();
