"use strict";

// Floating preview of the SVG export (Exporter > Aperçu…): same generator as the real export (Graph.exportSvg).
const ExportPreview = {
  KIND: "export-preview",
  DELAY: 500,
  panel: null,
  url: null,
  svg: "",
  timer: null,
  bound: null,
  auto: false,
  fit: true,

  open() {
    if (!App.requireModel()) {
      return;
    }

    if (this.panel) {
      this.panel.hidden = false;
      this.refresh();
      return;
    }

    const panel = document.createElement("div");

    panel.className = "float-win export-preview-win";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Aperçu de l’export SVG");
    panel.innerHTML = `
      <div class="float-win-header">
        <h2>Aperçu de l’export SVG</h2>
        <button type="button" class="icon-btn" data-ep="close" aria-label="Fermer l’aperçu">✕</button>
      </div>
      <div class="ep-toolbar">
        <button type="button" data-ep="refresh" title="Régénérer le SVG depuis le graphe actuel">Rafraîchir</button>
        <label class="ep-auto"><input type="checkbox" data-ep="auto" /> Rafraîchissement auto</label>
        <span class="ep-spacer"></span>
        <button type="button" data-ep="fit" aria-pressed="true" title="Ajuster à la fenêtre">Ajuster</button>
        <button type="button" data-ep="actual" aria-pressed="false" title="Taille réelle">100 %</button>
        <button type="button" class="primary" data-ep="download">Exporter SVG</button>
      </div>
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
      }
    });
    panel.addEventListener("change", (event) => {
      if (event.target.matches("[data-ep=auto]")) {
        this.auto = event.target.checked;

        if (this.auto) {
          this.refresh();
        }
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
      this.panel.querySelector("[data-ep-view]").classList.toggle("fit", fit);
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

  refresh() {
    if (!this.panel) {
      return;
    }

    clearTimeout(this.timer);
    this.bindGraph();

    const view = this.panel.querySelector("[data-ep-view]");
    const status = this.panel.querySelector("[data-ep-status]");

    try {
      this.svg = Graph.exportSvg();
    } catch (error) {
      this.svg = "";
      view.innerHTML = "<p class=\"ep-empty\"></p>";
      view.firstChild.textContent = `Aperçu impossible : ${error.message}`;
      status.textContent = "";
      return;
    }

    this.revoke();
    this.url = URL.createObjectURL(new Blob([this.svg], { type: "image/svg+xml" }));

    const img = document.createElement("img");

    img.alt = "Aperçu du SVG exporté";
    img.className = "ep-img";
    img.src = this.url;
    view.replaceChildren(img);
    status.textContent = `${(this.svg.length / 1024).toFixed(1)} Ko — généré à ${new Date().toLocaleTimeString()}`;
  },

  download() {
    if (!this.svg) {
      this.refresh();
    }

    if (this.svg) {
      Files.download(this.svg, `${App.slug()}.svg`, "image/svg+xml");
      App.showMessage("Export SVG téléchargé.", "success");
    }
  }
};
