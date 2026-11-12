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

  buildEditing() {
    return `
      <h3>Édition graphique</h3>
      <ul>
        <li><strong>Outils</strong> (barre à gauche du graphe) : Sélection (<kbd>V</kbd>), Main (<kbd>H</kbd> ou <kbd>Espace</kbd> maintenu), Brique (<kbd>B</kbd> : clic sur une brique = nouvel enfant, sur le fond = brique racine), Lien (<kbd>L</kbd> : glisser d’une brique à une autre), Déplacer dans… (<kbd>M</kbd> : glisser une brique sur une autre pour l’y ranger, sur le fond pour la sortir à la racine, <kbd>Échap</kbd> annule).</li>
        <li><strong>Navigation</strong> (tous les outils) : clic droit ou clic du milieu maintenu + glisser = déplacer la vue ; molette = zoom ; clic droit sans bouger = menu contextuel.</li>
        <li><strong>Sélection</strong> : clic, <kbd>Maj</kbd>/<kbd>Ctrl</kbd>+clic pour ajouter ou retirer, glisser sur le fond pour un rectangle. Le style s’applique à toute la sélection.</li>
        <li><strong>Placement &amp; répulsion</strong> : une nouvelle brique est posée au point cliqué (réglage <code>create.placement</code>) ; après un ajout, un collage, un changement de taille ou un dépli, les boîtes qui se chevauchent sont écartées (la plus légère bouge, sens réglable par <code>repulsion.direction</code>).</li>
        <li><strong>Suppression</strong> :<kbd>Suppr</kbd> ou menu contextuel. Les briques vont dans l’onglet <em>Corbeille</em> (bloc <code>trash:</code> du YAML) d’où on peut les restaurer.</li>
        <li><strong>Plans</strong> : menu contextuel d’une brique, <kbd>Ctrl+]</kbd> / <kbd>Ctrl+[</kbd> (avancer/reculer), avec <kbd>Maj</kbd> pour premier plan / arrière-plan. Une brique ne passe jamais sous son parent : l’action propose alors de l’appliquer au parent.</li>
        <li><strong>Modifier</strong> : menu contextuel d’une brique ou d’un lien (« Modifier… »).</li>
        <li><strong>Copier / couper / coller</strong> : <kbd>Ctrl+C</kbd> / <kbd>Ctrl+X</kbd> / <kbd>Ctrl+V</kbd> (ou menu contextuel) sur la sélection : les briques avec leurs sous-arbres et les liens internes sont copiés en YAML (<code>topo-clipboard</code>), donc collables dans un autre onglet ou projet. Le collage va dans la brique sélectionnée (sinon à la racine), régénère les identifiants en conflit et place les nouvelles briques dans un emplacement libre. Couper envoie les briques à la corbeille.</li>
        <li><strong>Identifiants</strong> : proposés automatiquement selon le réglage <code>ids.scheme</code> (<code>slug</code>, <code>parent-slug</code>, <code>type-n</code>) avec suffixe -2, -3… en cas de doublon. « Modifier… » permet de renommer l’id : toutes les références (liens, règles de style, vue, corbeille) sont réécrites. Avec <code>ids.followMove</code>, un id encore automatique suit le déplacement et le libellé. Renommé à la main dans l’éditeur, l’onglet Anomalies propose « Renommer les références ».</li>
        <li><strong>Annuler / rétablir</strong> : <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> pour chaque action graphique.</li>
      </ul>`;
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

    html += this.buildEditing();
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
