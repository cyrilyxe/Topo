"use strict";

// "Corbeille" tab: lists the `trash:` block of the document, restores or empties it.
const Trash = {
  els: {},

  init() {
    this.els = {
      tab: document.getElementById("tab-trash"),
      badge: document.getElementById("trash-badge"),
      content: document.getElementById("trash-content")
    };

    this.els.content.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");

      if (!button) {
        return;
      }

      if (button.dataset.act === "restore") {
        this.restore(Number(button.dataset.index));
      } else if (button.dataset.act === "empty") {
        this.empty();
      }
    });
  },

  entries(text) {
    try {
      const raw = jsyaml.load(text);

      return raw && Array.isArray(raw.trash) ? raw.trash.filter((item) => item && typeof item === "object") : [];
    } catch {
      return [];
    }
  },

  countNodes(node) {
    const children = node && (node.children || node.enfants);

    return 1 + (Array.isArray(children) ? children.reduce((sum, child) => sum + this.countNodes(child), 0) : 0);
  },

  formatDate(value) {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? "date inconnue" : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  },

  labelOf(entry) {
    const node = entry.node || {};

    return String(node.label || node.titre || node.id || "(sans nom)");
  },

  refresh() {
    if (!this.els.tab) {
      return;
    }

    const entries = this.entries(App.getText());
    const active = this.els.tab.classList.contains("active");

    this.els.tab.hidden = entries.length === 0;
    this.els.badge.hidden = entries.length === 0;
    this.els.badge.textContent = String(entries.length);

    if (!entries.length && active) {
      App.showTab("editor");
    }

    this.els.content.innerHTML = entries.length ? this.build(entries) : "<p class=\"empty\">La corbeille est vide.</p>";
  },

  build(entries) {
    const items = entries.map((entry, index) => {
      const count = this.countNodes(entry.node);
      const links = Array.isArray(entry.links) ? entry.links.length : 0;
      const detail = `${this.formatDate(entry.deletedAt)} · ${count} brique(s) · ${links} lien(s)`;

      return `<li class="trash-item">
        <div class="trash-info"><strong>${escapeHtml(this.labelOf(entry))}</strong><small>${escapeHtml(detail)}</small></div>
        <button type="button" data-act="restore" data-index="${index}">Restaurer</button>
      </li>`;
    }).join("");

    return `<h3>Corbeille</h3>
      <ul class="trash-list">${items}</ul>
      <button type="button" class="danger" data-act="empty">Vider la corbeille</button>`;
  },

  restore(index) {
    const entry = this.entries(App.getText())[index];

    if (entry && App.edit(`Restauration de « ${this.labelOf(entry)} »`, (text) => DocEdit.trashRestore(text, index))) {
      App.showMessage(`« ${this.labelOf(entry)} » restauré.`, "success");
    }
  },

  async empty() {
    const count = this.entries(App.getText()).length;
    const answer = await Forms.confirm({
      title: "Vider la corbeille",
      html: `<p>Supprimer définitivement ${count} élément(s) de la corbeille ? (Annulable avec Ctrl+Z.)</p>`,
      okLabel: "Vider",
      danger: true
    });

    if (answer) {
      App.edit("Corbeille vidée", (text) => DocEdit.setTopLevel(text, "trash", null));
    }
  }
};
