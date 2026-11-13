"use strict";

// Floating preview of an export (Exporter > Aperçu…): any registered format (Exporters), same builder as the real export.
// Image formats are shown as a picture, text formats in a scrollable <pre> with a Copy button.
const ExportPreview = {
  KIND: "export-preview",
  STORAGE_KEY: "topo:export-format",
  DELAY: 500,
  panel: null,
  url: null,
  content: null,
  timer: null,
  bound: null,
  auto: false,
  fit: true,
  format: null,

  loadFormat() {
    let saved = null;

    try {
      saved = localStorage.getItem(this.STORAGE_KEY);
    } catch { /* ignore */ }

    return Exporters.get(saved) ? saved : "svg";
  },

  saveFormat() {
    try {
      localStorage.setItem(this.STORAGE_KEY, this.format);
    } catch { /* ignore */ }
  },

  current() {
    return Exporters.get(this.format) || Exporters.get("svg");
  },

  open() {
    if (!App.requireModel()) {
      return;
    }

    if (this.panel) {
      this.panel.hidden = false;
      this.refresh();
      return;
    }

    this.format = this.loadFormat();

    const options = Exporters.list().map((f) => {
      const opt = document.createElement("option");

      opt.value = f.id;
      opt.textContent = `${f.label} (.${f.ext})`;
      if (f.id === this.format) {
        opt.setAttribute("selected", "");
      }

      return opt.outerHTML;
    }).join("");

    const panel = document.createElement("div");

    panel.className = "float-win export-preview-win";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Aperçu de l’export");
    panel.innerHTML = `
      <div class="float-win-header">
        <h2>Aperçu de l’export</h2>
        <button type="button" class="icon-btn" data-ep="close" aria-label="Fermer l’aperçu">✕</button>
      </div>
      <div class="ep-toolbar">
        <label class="ep-auto">Format <select data-ep="format" aria-label="Format d’export">${options}</select></label>
        <button type="button" data-ep="refresh" title="Régénérer depuis le graphe actuel">Rafraîchir</button>
        <label class="ep-auto"><input type="checkbox" data-ep="auto" /> Rafraîchissement auto</label>
        <span class="ep-spacer"></span>
        <button type="button" data-ep="fit" aria-pressed="true" title="Ajuster à la fenêtre">Ajuster</button>
        <button type="button" data-ep="actual" aria-pressed="false" title="Taille réelle">100 %</button>
        <button type="button" data-ep="copy" title="Copie le texte dans le presse-papiers" hidden>Copier</button>
        <button type="button" class="primary" data-ep="download">Exporter</button>
      </div>
      <div class="ep-note" data-ep-note hidden></div>
      <div class="ep-view fit" data-ep-view><p class="ep-empty">Génération…</p></div>
      <div class="ep-status" data-ep-status role="status"></div>`;
    document.body.appendChild(panel);
    this.panel = panel;

    Forms.bindMove(panel, this.KIND, panel, panel.querySelector(".float-win-header"));

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ep]");
      const act = button && button.dataset.ep;

      if (act === "close") {
        this.close();
      } else if (act === "refresh") {
        this.refresh();
      } else if (act === "fit" || act === "actual") {
        this.setFit(act === "fit");
      } else if (act === "download") {
        this.download();
      } else if (act === "copy") {
        this.copy();
      }
    });
    panel.addEventListener("change", (event) => {
      if (event.target.matches("[data-ep=auto]")) {
        this.auto = event.target.checked;

        if (this.auto) {
          this.refresh();
        }
      } else if (event.target.matches("[data-ep=format]")) {
        this.format = event.target.value;
        this.saveFormat();
        this.refresh();
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });

    this.refresh();
  },

  close() {
    clearTimeout(this.timer);

    if (this.panel) {
      this.panel.remove();
    }

    this.panel = null;
    this.revoke();
  },

  revoke() {
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  },

  setFit(fit) {
    this.fit = fit;

    if (this.panel) {
      this.panel.querySelector("[data-ep-view]").classList.toggle("fit", fit && this.current().kind === "image");
      this.panel.querySelector("[data-ep=fit]").setAttribute("aria-pressed", String(fit));
      this.panel.querySelector("[data-ep=actual]").setAttribute("aria-pressed", String(!fit));
    }
  },

  bindGraph() {
    const cy = typeof Graph !== "undefined" ? Graph.cy : null;

    if (cy && cy !== this.bound) {
      this.bound = cy;
      cy.on("layoutstop dragfree", () => this.notify());
    }
  },

  // Called after every render / layout / drag: regenerates (debounced) when auto-refresh is on.
  notify() {
    if (!this.panel || !this.auto) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), this.DELAY);
  },

  size(content) {
    const bytes = content instanceof Blob ? content.size : new Blob([content]).size;

    return `${(bytes / 1024).toFixed(1)} Ko`;
  },

  refresh() {
    if (!this.panel) {
      return;
    }

    clearTimeout(this.timer);
    this.bindGraph();

    const format = this.current();
    const isImage = format.kind === "image";
    const select = this.panel.querySelector("[data-ep=format]");

    // The select always shows the format actually previewed (the remembered one, or SVG as fallback).
    if (select && select.value !== format.id) {
      select.value = format.id;
    }

    const view = this.panel.querySelector("[data-ep-view]");
    const status = this.panel.querySelector("[data-ep-status]");
    const note = this.panel.querySelector("[data-ep-note]");

    this.panel.querySelector("[data-ep=fit]").hidden = !isImage;
    this.panel.querySelector("[data-ep=actual]").hidden = !isImage;
    this.panel.querySelector("[data-ep=copy]").hidden = isImage;
    this.panel.querySelector("[data-ep=download]").textContent = `Exporter .${format.ext}`;
    note.hidden = !format.note;
    note.textContent = format.note || "";
    view.classList.toggle("fit", isImage && this.fit);
    view.classList.toggle("text", !isImage);

    try {
      this.content = format.build(Exporters.context());
    } catch (error) {
      this.content = null;
      view.innerHTML = "<p class=\"ep-empty\"></p>";
      view.firstChild.textContent = `Aperçu impossible : ${error.message}`;
      status.textContent = "";
      return;
    }

    this.revoke();

    if (isImage) {
      const blob = this.content instanceof Blob ? this.content : new Blob([this.content], { type: format.mime });
      const img = document.createElement("img");

      this.url = URL.createObjectURL(blob);
      img.alt = `Aperçu de l’export ${format.label}`;
      img.className = "ep-img";
      img.src = this.url;
      view.replaceChildren(img);
    } else {
      const pre = document.createElement("pre");

      pre.className = "ep-text";
      pre.tabIndex = 0;
      pre.textContent = this.content;
      view.replaceChildren(pre);
    }

    status.textContent = `${this.size(this.content)} — généré à ${new Date().toLocaleTimeString()}`;
  },

  async copy() {
    if (typeof this.content !== "string") {
      return;
    }

    try {
      await navigator.clipboard.writeText(this.content);
    } catch {
      const area = document.createElement("textarea");

      area.value = this.content;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }

    App.showMessage(`Export ${this.current().label} copié.`, "success");
  },

  download() {
    if (this.content === null || this.content === undefined) {
      this.refresh();
    }

    if (this.content !== null && this.content !== undefined) {
      const format = this.current();

      Files.download(this.content, `${App.slug()}.${format.ext}`, format.mime);
      App.showMessage(`Export ${format.label} téléchargé.`, "success");
    }
  }
};
