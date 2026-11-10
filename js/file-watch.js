"use strict";

// File reload & watch: detects a file changed by another program (signature = lastModified + size)
// and reloads it from disk. The pure part (signatures, banner/auto-reload decision) has no DOM
// dependency; the browser part drives the banner, the tab marker and the "Recharger" command.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FileWatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MISSING = "missing";
  const POLL_MS = 2000;

  function signatureOf(file) {
    return file ? { lastModified: file.lastModified, size: file.size } : null;
  }

  function sameSignature(a, b) {
    return Boolean(a) && Boolean(b) && a.lastModified === b.lastModified && a.size === b.size;
  }

  // known: signature at last load/save; current: signature on disk (null = missing);
  // ignored: signature (or MISSING) the user chose to ignore.
  // -> { status: "ok" | "changed" | "missing", banner, reload }
  function decide({ known, current, ignored, dirty, autoReload }) {
    if (!known) return { status: "ok", banner: false, reload: false };
    if (current === null || current === undefined) return { status: "missing", banner: ignored !== MISSING, reload: false };
    if (sameSignature(known, current)) return { status: "ok", banner: false, reload: false };

    const reload = Boolean(autoReload) && !dirty;

    return { status: "changed", banner: !reload && !sameSignature(ignored, current), reload };
  }

  function bannerText(name, status, dirty) {
    const label = `« ${name || "Sans titre"} »`;

    if (status === "missing") return `${label} est introuvable sur le disque.`;
    return `${label} a été modifié par un autre programme.${dirty ? " (vos modifications non enregistrées seraient perdues)" : ""}`;
  }

  const api = { MISSING, signatureOf, sameSignature, decide, bannerText };

  // ---------- browser side ----------

  api.busy = false;
  api.reloading = false;
  api.timer = null;
  api.lastBanner = null;
  api.els = {};

  // Watch state kept on the tab record: { sig, current, ignored, status, fails, checked }.
  api.fresh = function fresh(sig) {
    return sig ? { sig, current: sig, ignored: null, status: "ok", fails: 0, checked: true } : null;
  };

  api.watching = function watching() {
    return Settings.get("files.watch") !== false;
  };

  api.handleOf = function handleOf(tab) {
    if (!tab) return null;
    return (tab.id === Tabs.activeId ? Files.current.handle : tab.handle) || null;
  };

  api.readSignature = async function readSignature(handle) {
    try {
      return signatureOf(await handle.getFile());
    } catch (error) {
      if (error && error.name === "NotFoundError") return null;
      throw error;
    }
  };

  api.init = function init() {
    this.els.banner = document.getElementById("file-banner");
    this.els.banner.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-fw]");

      if (!button) return;

      if (button.dataset.fw === "reload") this.reload();
      else if (button.dataset.fw === "ignore") this.ignore();
      else if (button.dataset.fw === "close") Tabs.close();
    });
    window.addEventListener("focus", () => this.check());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.check();
    });
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible") this.check();
    }, POLL_MS);
    Settings.onChange((keys) => {
      if (keys.some((key) => key.startsWith("files."))) {
        this.check();
        Tabs.render();
      }
    });
  };

  api.onActivate = function onActivate() {
    this.render();
    this.check();
  };

  // Compares the active file with its remembered signature (single-file documents only;
  // project mode is polled by Project.tick).
  api.check = async function check() {
    const tab = Tabs.active();

    if (!tab || this.busy || this.reloading || (typeof Project !== "undefined" && Project.isOpen)) return;

    const handle = this.handleOf(tab);

    if (!handle) {
      if (tab.watch) {
        tab.watch = null;
        Tabs.render();
      }

      return;
    }

    if (!this.watching()) return;

    this.busy = true;

    try {
      let current;

      try {
        current = await this.readSignature(handle);

        if (tab.watch) tab.watch.fails = 0;
      } catch (error) {
        // A transient read error (file locked while another program saves) is not "missing".
        if (!tab.watch) return;

        tab.watch.fails += 1;

        if (tab.watch.fails < 2) return;
        current = null;
      }

      if (tab !== Tabs.active() || handle !== Files.current.handle || this.reloading) return;

      if (!tab.watch) {
        tab.watch = this.fresh(current);
        return;
      }

      const watch = tab.watch;
      const result = decide({ known: watch.sig, current, ignored: watch.ignored, dirty: App.dirty, autoReload: Settings.get("files.autoReload") === true });

      watch.current = current;
      watch.status = result.status;
      watch.checked = true;

      if (result.reload) {
        await this.reload({ auto: true });
      }
    } finally {
      this.busy = false;
      Tabs.render();
    }
  };

  api.ignore = function ignore() {
    const tab = Tabs.active();

    if (tab && tab.watch) {
      tab.watch.ignored = tab.watch.current === null ? MISSING : tab.watch.current;
      Tabs.render();
    }
  };

  // Called after every save done by Topo: the new disk signature becomes the reference.
  api.markSaved = async function markSaved() {
    const tab = Tabs.active();

    if (!tab) return;

    const handle = Files.current.handle;

    try {
      tab.watch = handle && !Project.isOpen ? this.fresh(await this.readSignature(handle)) : null;
    } catch (error) {
      tab.watch = null;
    }

    Tabs.render();
  };

  // Marker in the document tab (also used for the project tab).
  api.stale = function stale(tab) {
    if (!this.watching()) return false;

    if (tab.id === Tabs.activeId && Project.isOpen) {
      try {
        return Project.changedCount() > 0;
      } catch (error) {
        return false;
      }
    }

    return Boolean(tab.watch && tab.watch.checked && tab.watch.status !== "ok" && this.handleOf(tab));
  };

  api.staleMark = function staleMark(tab) {
    if (!this.stale(tab)) return "";

    const missing = tab.watch && tab.watch.status === "missing" && !(tab.id === Tabs.activeId && Project.isOpen);

    return `<span class="doc-tab-stale" title="${missing ? "Fichier introuvable sur le disque" : "Le fichier a changé sur le disque"}">${missing ? "⚠" : "⟳"}</span>`;
  };

  api.reloadReason = function reloadReason() {
    if (Project.isOpen) return Project.readOnly ? "Dossier ouvert en lecture seule (navigateur sans accès aux dossiers) : rien à relire sur le disque." : "";
    if (!Files.hasPicker()) return "Ce navigateur ne permet pas de relire un fichier sur le disque (API File System Access indisponible).";
    return "Ce document n’est lié à aucun fichier du disque (nouveau, exemple, ou ouvert sans accès direct au fichier) : ouvrez-le avec « Ouvrir… » dans un navigateur compatible.";
  };

  api.canReload = function canReload() {
    return Project.isOpen ? !Project.readOnly : Boolean(Files.current.handle);
  };

  api.updateMenu = function updateMenu() {
    const button = document.getElementById("menu-reload");

    if (!button) return;

    const ok = this.canReload();

    button.disabled = !ok;
    button.title = ok ? "Relire le fichier depuis le disque (Alt+R)" : this.reloadReason();
  };

  api.render = function render() {
    this.updateMenu();

    const box = this.els.banner || document.getElementById("file-banner");

    if (!box) return;

    const tab = Tabs.active();
    const watch = tab && tab.watch;
    let html = "";

    if (watch && watch.checked && !Project.isOpen && this.handleOf(tab) && this.watching()) {
      const result = decide({ known: watch.sig, current: watch.current, ignored: watch.ignored, dirty: App.dirty, autoReload: false });

      if (result.banner) {
        const buttons = result.status === "missing"
          ? "<button type=\"button\" data-fw=\"close\">Fermer</button>"
          : "<button type=\"button\" data-fw=\"reload\">Recharger</button><button type=\"button\" data-fw=\"ignore\">Ignorer</button>";

        html = `<span class="file-banner-text">${escapeHtml(bannerText(App.name, result.status, App.dirty))}</span>${buttons}`;
      }
    }

    if (html !== this.lastBanner) {
      this.lastBanner = html;
      box.innerHTML = html;
      box.hidden = !html;
    }
  };

  api.askDiscard = function askDiscard() {
    return Forms.confirm({
      title: "Recharger depuis le disque",
      html: "Recharger et perdre les modifications non enregistrées ?",
      okLabel: "Recharger",
      danger: true
    });
  };

  // File > Reload from disk, banner button, auto-reload. One history entry (Ctrl+Z restores the previous text).
  api.reload = async function reload(options = {}) {
    if (this.reloading) return false;

    if (!this.canReload()) {
      App.showMessage(this.reloadReason(), "warning");
      return false;
    }

    this.reloading = true;

    try {
      if (App.dirty && !options.auto && options.confirm !== false && !(await this.askDiscard())) return false;

      if (Project.isOpen) {
        await Project.reload();
        App.showMessage("Rechargé depuis le disque.", "info");
        return true;
      }

      const tab = Tabs.active();
      const handle = Files.current.handle;
      const file = await handle.getFile();
      const text = await file.text();

      if (tab !== Tabs.active() || handle !== Files.current.handle) return false;

      App.edit("Recharger depuis le disque", () => text);
      App.savedText = Editor.getValue();
      App.updateDirty();
      tab.watch = this.fresh(signatureOf(file));

      if (!App.els.message.classList.contains("error")) App.showMessage("Rechargé depuis le disque.", "info");
      return true;
    } catch (error) {
      App.showMessage(`Rechargement impossible : ${error.message}`, "error");
      return false;
    } finally {
      this.reloading = false;
      Tabs.render();
    }
  };

  // Project mode: Project.tick already compares the brick files; here only the auto-reload and the tab marker.
  api.onProjectTick = function onProjectTick() {
    Tabs.render();

    if (this.watching() && Settings.get("files.autoReload") === true && !App.dirty && !Project.working && Project.changedCount() > 0) {
      this.reload({ auto: true });
    }
  };

  // Before overwriting the file: "overwrite" | "reload" | "cancel".
  api.confirmOverwrite = async function confirmOverwrite() {
    const tab = Tabs.active();
    const handle = Files.current.handle;

    if (!tab || !tab.watch || !handle) return "overwrite";

    let current;

    try {
      current = await this.readSignature(handle);
    } catch (error) {
      return "overwrite";
    }

    if (current === null || sameSignature(tab.watch.sig, current)) return "overwrite";

    const answer = await Forms.dialog({
      title: "Enregistrer",
      okLabel: "Écraser",
      danger: true,
      body: `<div class="forms-message">Le fichier a été modifié par un autre programme. Écraser ?</div>
        <button type="button" data-reload="1" title="Relire le fichier ; vos modifications non enregistrées sont perdues">Recharger</button>`,
      setup: (form) => form.querySelector("[data-reload]").addEventListener("click", () => Forms.closeActive({ choice: "reload" })),
      collect: () => ({ choice: "overwrite" })
    });

    if (!answer) return "cancel";

    if (answer.choice === "reload") {
      await this.reload({ confirm: false });
      return "reload";
    }

    return "overwrite";
  };

  return api;
});
