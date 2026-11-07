"use strict";

const Help = {
  modal: null,
  dialog: null,
  body: null,
  lastFocus: null,

  init() {
    this.modal = document.getElementById("help-modal");
    this.dialog = this.modal.querySelector(".modal-dialog");
    this.body = document.getElementById("help-body");

    this.modal.addEventListener("click", (event) => {
      if (event.target.dataset && event.target.dataset.close) {
        this.close();
      }
    });

    document.getElementById("btn-help-close").addEventListener("click", () => this.close());

    this.modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      } else if (event.key === "Tab") {
        this.trapFocus(event);
      }
    });
  },

  isOpen() {
    return this.modal && !this.modal.hidden;
  },

  open() {
    this.body.innerHTML = this.build();
    this.lastFocus = document.activeElement;
    this.modal.hidden = false;
    this.dialog.focus();
  },

  close() {
    if (!this.isOpen()) {
      return;
    }

    this.modal.hidden = true;

    if (this.lastFocus && typeof this.lastFocus.focus === "function") {
      this.lastFocus.focus();
    }
  },

  trapFocus(event) {
    const focusable = Array.from(this.dialog.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter((element) => !element.disabled);

    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  build() {
    const schema = typeof Schema !== "undefined" ? Schema : null;
    let html = "";

    if (schema && Array.isArray(schema.HELP)) {
      const sections = new Map();

      schema.HELP.forEach((entry) => {
        const name = entry.section || "Général";

        if (!sections.has(name)) {
          sections.set(name, []);
        }

        sections.get(name).push(entry);
      });

      sections.forEach((entries, name) => {
        html += `
          <h3>${escapeHtml(name)}</h3>
          <table class="help-table">
            <thead><tr><th>Clé</th><th>Alias</th><th>Type</th><th>Effet</th><th>Exemple</th></tr></thead>
            <tbody>
              ${entries.map((entry) => `
                <tr>
                  <td><code>${escapeHtml(entry.key)}</code></td>
                  <td>${(entry.aliases || []).map((alias) => `<code>${escapeHtml(alias)}</code>`).join(" ") || "—"}</td>
                  <td>${escapeHtml(entry.type || "")}</td>
                  <td>${escapeHtml(entry.description || "")}</td>
                  <td>${entry.example ? `<pre>${escapeHtml(entry.example)}</pre>` : ""}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>`;
      });
    } else {
      html += "<p class=\"empty\">L’aide détaillée du schéma est indisponible (js/schema.js non chargé).</p>";
    }

    html += "<h3>Raccourcis clavier</h3>";

    if (schema && Array.isArray(schema.SHORTCUTS)) {
      html += `<table class="help-table"><tbody>${schema.SHORTCUTS.map((shortcut) => `
        <tr><td><kbd>${escapeHtml(shortcut.keys)}</kbd></td><td>${escapeHtml(shortcut.description)}</td></tr>
      `).join("")}</tbody></table>`;
    } else {
      html += "<p class=\"empty\">Ctrl+S enregistrer, Ctrl+Maj+S enregistrer sous, Ctrl+O ouvrir, F1 aide, Échap fermer.</p>";
    }

    html += `
      <h3>Projet de briques &amp; CLI</h3>
      <p>Un projet est un dossier de petits fichiers <code>brick.yaml</code> (ou <code>nom.brick.yaml</code>) fusionnés en un seul YAML.</p>
      <pre>node tools/topo.js build &lt;dossier&gt; [-o architecture.yaml]   # fusionne et écrit le YAML
node tools/topo.js check &lt;dossier&gt;                          # affiche seulement les anomalies
node tools/topo.js fix &lt;dossier&gt; [--yes]                    # corrige interactivement les références
node tools/topo.js serve [dossier] [-p 8080]                # sert l’application en local</pre>
      <p>Format d’un fichier brique :</p>
      <pre>id: resources-js          # optionnel (défaut : nom du dossier)
title: Artefact           # libellé de la brique
type: group               # optionnel
role: domain              # optionnel
meta: { owner: equipe-a } # optionnel
nodes: [ ... ]            # nœuds internes (même schéma)
links:                    # références résolues depuis cette brique
  - from: api
    to: ressources</pre>
      <p>Voir <code>docs/SPEC.md</code> pour le détail.</p>`;

    return html;
  }
};
