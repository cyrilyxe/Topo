"use strict";

const SettingsUI = {
  modal: null,
  dialog: null,
  list: null,
  lastFocus: null,

  BADGES: { default: "défaut", suggested: "suggéré", local: "local", document: "document" },

  init() {
    this.build();
    Settings.documentWriter = (obj) => {
      App.edit("Modification des réglages", (text) => DocEdit.setTopLevel(text, "settings", obj));
    };
    Settings.onChange(() => this.refresh());
  },

  build() {
    this.modal = document.createElement("div");
    this.modal.className = "float-win";
    this.modal.hidden = true;
    this.modal.setAttribute("role", "dialog");
    this.modal.setAttribute("aria-labelledby", "settings-title");
    this.modal.tabIndex = -1;
    this.modal.innerHTML = `
      <div class="float-win-header">
        <h2 id="settings-title">Réglages</h2>
        <button type="button" class="icon-btn" data-close="1" aria-label="Fermer les réglages">✕</button>
      </div>
      <div class="float-win-body">
        <div class="settings-list"></div>
        <div class="settings-actions">
          <button type="button" data-act="clean" title="Retire du YAML les réglages égaux aux défauts, les règles de style vides et les propriétés highlight/hidden à false.">Nettoyer le YAML</button>
          <button type="button" data-act="freeze" title="Écrit toutes les valeurs effectives dans le bloc settings: du document.">Figer la configuration dans le YAML</button>
        </div>
      </div>`;
    document.body.appendChild(this.modal);
    this.dialog = this.modal;
    this.list = this.modal.querySelector(".settings-list");
    this.renderRows();
    this.restoreGeometry();

    this.modal.addEventListener("click", (event) => {
      if (event.target.dataset && event.target.dataset.close) this.close();
      const act = event.target.dataset && event.target.dataset.act;
      if (act === "clean") this.clean();
      if (act === "freeze") this.freeze();
    });
    this.modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen() && document.activeElement === document.body) this.close();
    });
    this.bindDrag(this.modal.querySelector(".float-win-header"));
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => this.saveGeometry()).observe(this.modal);
    }
    const button = document.getElementById("btn-settings");
    if (button) button.addEventListener("click", () => (this.isOpen() ? this.close() : this.open()));
  },

  GEOMETRY_KEY: "topo:settings-win",

  readGeometry() {
    try {
      const geo = JSON.parse(localStorage.getItem(this.GEOMETRY_KEY) || "null");
      return geo && typeof geo === "object" ? geo : null;
    } catch (e) {
      return null;
    }
  },

  saveGeometry() {
    if (!this.isOpen()) return;
    const box = this.modal.getBoundingClientRect();
    try {
      localStorage.setItem(this.GEOMETRY_KEY, JSON.stringify({ x: Math.round(box.left), y: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) }));
    } catch (e) { /* storage unavailable */ }
  },

  // Keeps at least part of the title bar reachable.
  place(x, y) {
    const maxX = Math.max(0, window.innerWidth - 80);
    const maxY = Math.max(0, window.innerHeight - 40);
    this.modal.style.left = `${Math.min(maxX, Math.max(-this.modal.offsetWidth + 80, x))}px`;
    this.modal.style.top = `${Math.min(maxY, Math.max(0, y))}px`;
  },

  restoreGeometry() {
    const geo = this.readGeometry();
    if (geo && Number.isFinite(geo.w) && geo.w > 200) this.modal.style.width = `${geo.w}px`;
    if (geo && Number.isFinite(geo.h) && geo.h > 120) this.modal.style.height = `${geo.h}px`;
    this.modal.style.left = `${geo && Number.isFinite(geo.x) ? geo.x : Math.max(20, window.innerWidth - 640)}px`;
    this.modal.style.top = `${geo && Number.isFinite(geo.y) ? geo.y : 70}px`;
  },

  bindDrag(handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const box = this.modal.getBoundingClientRect();
      const dx = event.clientX - box.left;
      const dy = event.clientY - box.top;
      const move = (e) => this.place(e.clientX - dx, e.clientY - dy);
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        this.saveGeometry();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      event.preventDefault();
    });
  },

  isOpen() {
    return this.modal && !this.modal.hidden;
  },

  open() {
    this.refresh();
    this.lastFocus = document.activeElement;
    this.modal.hidden = false;
    this.place(this.modal.offsetLeft, this.modal.offsetTop);
    this.modal.focus();
  },

  close() {
    if (!this.isOpen()) return;
    this.modal.hidden = true;
    if (this.lastFocus && typeof this.lastFocus.focus === "function") this.lastFocus.focus();
  },

  renderRows() {
    this.list.innerHTML = Settings.SPEC.map((spec) => `
      <div class="settings-row" data-key="${escapeHtml(spec.key)}">
        <div class="settings-label">
          <strong>${escapeHtml(spec.label)}</strong> <code>${escapeHtml(spec.key)}</code>
          <div class="settings-help">${escapeHtml(spec.help)}</div>
        </div>
        <div class="settings-control">${this.control(spec)}</div>
        <span class="settings-badge"></span>
        <button type="button" class="settings-reset" title="Rétablir la valeur précédente" aria-label="Rétablir ${escapeHtml(spec.label)}">↺</button>
      </div>`).join("");

    this.list.querySelectorAll(".settings-row").forEach((row) => {
      const key = row.dataset.key;
      const input = row.querySelector("input, select");
      input.addEventListener("change", () => this.commit(key, input));
      if (input.type === "range") {
        input.addEventListener("input", () => {
          if (Settings.source(key) !== "document") this.commit(key, input);
        });
      }
      row.querySelector(".settings-reset").addEventListener("click", () => this.reset(key));
    });
  },

  control(spec) {
    if (spec.type === "boolean") return "<input type=\"checkbox\" />";
    if (spec.type === "enum") {
      return `<select>${spec.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select>`;
    }
    return `<input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" /> <output></output>`;
  },

  commit(key, input) {
    const spec = Settings.spec(key);
    const raw = spec.type === "boolean" ? input.checked : input.value;
    const scope = Settings.source(key) === "document" ? "document" : "local";
    try {
      Settings.set(key, spec.type === "number" ? Number(raw) : raw, scope);
    } catch (error) {
      App.showMessage(error.message, "error");
    }
    this.refresh();
  },

  reset(key) {
    const source = Settings.source(key);
    if (source === "local" || source === "document") Settings.unset(key, source);
  },

  refresh() {
    if (!this.list) return;
    this.list.querySelectorAll(".settings-row").forEach((row) => {
      const key = row.dataset.key;
      const spec = Settings.spec(key);
      const source = Settings.source(key);
      const value = Settings.get(key);
      const input = row.querySelector("input, select");

      if (document.activeElement !== input) {
        if (spec.type === "boolean") input.checked = value;
        else input.value = value;
      }
      const output = row.querySelector("output");
      if (output) output.textContent = String(value);

      const badge = row.querySelector(".settings-badge");
      badge.textContent = this.BADGES[source];
      badge.className = `settings-badge settings-badge-${source}`;
      row.querySelector(".settings-reset").hidden = source !== "local" && source !== "document";
    });
  },

  clean() {
    App.edit("Nettoyage du YAML", (text) => {
      const raw = jsyaml.load(text) || {};
      const cleaned = Settings.cleanup(raw, Settings.base());
      let next = text;
      Object.keys(cleaned).forEach((key) => {
        const names = [key, ...(Schema.ROOT_ALIASES[key] || []), ...(key === "settings" ? ["reglages"] : [])];
        const before = raw[names.find((n) => raw[n] !== undefined)];
        if (JSON.stringify(before) !== JSON.stringify(cleaned[key])) next = DocEdit.setTopLevel(next, key, cleaned[key]);
      });
      if (next === text) throw new Error("Rien à nettoyer.");
      return next;
    });
  },

  freeze() {
    App.edit("Configuration figée dans le YAML", (text) => DocEdit.setTopLevel(text, "settings", Settings.all()));
  }
};
