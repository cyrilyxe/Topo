"use strict";

const StyleUI = {
  content: null,
  nodeId: null,
  busy: false,

  init() {
    this.content = document.getElementById("style-content");

    this.content.addEventListener("input", (event) => this.onInput(event));
    this.content.addEventListener("change", (event) => this.onInput(event));

    this.content.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");

      if (!button) {
        return;
      }

      const act = button.dataset.act;

      if (act === "delete-rule") {
        this.deleteRule(this.nodeId);
      } else if (act === "clear") {
        this.setProperty(button.dataset.prop, null);
        this.render();
      } else if (act === "select") {
        this.show(button.dataset.id);
      } else if (act === "delete-target") {
        this.deleteRule(button.dataset.id);
      }
    });

    this.render();
  },

  show(id) {
    this.nodeId = id;
    this.render();
  },

  refresh() {
    if (this.busy) {
      return;
    }

    const model = App.getModel();

    if (this.nodeId && (!model || !model.byId.has(this.nodeId))) {
      this.nodeId = null;
    }

    this.render();
  },

  hex(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  },

  render() {
    const model = App.getModel();

    if (!model) {
      this.content.innerHTML = "<p class=\"empty\">Aucun modèle valide.</p>";
      return;
    }

    const size = Number(model.style && model.style.size) || 1;
    const node = this.nodeId ? model.byId.get(this.nodeId) : null;
    const rule = node ? Style.ruleFor(node.id, model) : {};

    this.content.innerHTML = `
      <div class="form-grid">
        <label>
          Taille globale des nœuds (fichier) : <span id="style-size-value">${size.toFixed(2)}×</span>
          <input id="style-size" type="range" min="0.6" max="1.6" step="0.05" value="${size}" />
        </label>
      </div>

      <h4>Nœud sélectionné</h4>
      ${node ? `
        <div class="style-target"><strong>${escapeHtml(node.label)}</strong><br /><span class="path">${escapeHtml(Model.pathLabel(node.id, model))}</span></div>
        <div class="form-grid">
          <label>Étiquette
            <input id="style-label" type="text" placeholder="Identique au YAML" value="${escapeHtml(rule.label || "")}" />
          </label>
          <label>Couleur de fond
            <span><input id="style-color" type="color" value="${escapeHtml(this.hex(rule.color, "#0ea5e9"))}" /> <button type="button" data-act="clear" data-prop="color">Retirer</button></span>
          </label>
          <label>Couleur de bordure
            <span><input id="style-border" type="color" value="${escapeHtml(this.hex(rule.border, "#2563eb"))}" /> <button type="button" data-act="clear" data-prop="border">Retirer</button></span>
          </label>
          <label>Opacité : <span id="style-opacity-value">${Math.round((rule.opacity ?? 1) * 100)} %</span>
            <input id="style-opacity" type="range" min="0.1" max="1" step="0.05" value="${rule.opacity ?? 1}" />
          </label>
          <label>Taille : <span id="style-node-size-value">${(Number(rule.size) || 1).toFixed(2)}×</span>
            <input id="style-node-size" type="range" min="0.6" max="1.6" step="0.05" value="${Number(rule.size) || 1}" />
          </label>
          <label class="inline"><input id="style-highlight" type="checkbox" ${rule.highlight ? "checked" : ""} /> Mettre en avant</label>
          <label class="inline"><input id="style-hidden" type="checkbox" ${rule.hidden ? "checked" : ""} /> Masquer dans cette vue</label>
          <div class="actions"><button type="button" data-act="delete-rule">Supprimer la règle</button></div>
        </div>
      ` : "<p class=\"empty\">Sélectionnez un nœud (clic dans le graphe ou dans le YAML, puis « Style » dans l’inspecteur).</p>"}

      <h4>Règles du fichier</h4>
      <div id="style-rules"></div>
    `;

    this.renderRules();
  },

  renderRules() {
    const container = document.getElementById("style-rules");
    const model = App.getModel();

    if (!container || !model) {
      return;
    }

    const rules = (model.style && model.style.rules) || [];
    const map = Style.lookup(model);

    container.innerHTML = rules.length ? `
      <ul class="rule-list">
        ${rules.map((rule) => {
          const id = map.get(rule.target);

          return `<li>
            <code>${escapeHtml(rule.target)}</code>
            ${id ? `<button type="button" data-act="select" data-id="${escapeHtml(id)}">Éditer</button>` : "<em class=\"empty\">introuvable</em>"}
            ${id ? `<button type="button" data-act="delete-target" data-id="${escapeHtml(id)}">Supprimer</button>` : ""}
          </li>`;
        }).join("")}
      </ul>` : "<p class=\"empty\">Aucune règle.</p>";
  },

  onInput(event) {
    const target = event.target;
    const value = (id) => document.getElementById(id);

    switch (target.id) {
      case "style-size": {
        const size = Number(target.value);

        value("style-size-value").textContent = `${size.toFixed(2)}×`;
        this.mutate((style) => {
          style.size = size === 1 ? undefined : size;
        });
        break;
      }

      case "style-label":
        this.setProperty("label", target.value || null);
        break;

      case "style-color":
        this.setProperty("color", target.value);
        break;

      case "style-border":
        this.setProperty("border", target.value);
        break;

      case "style-opacity":
        value("style-opacity-value").textContent = `${Math.round(Number(target.value) * 100)} %`;
        this.setProperty("opacity", Number(target.value) === 1 ? null : Number(target.value));
        break;

      case "style-node-size":
        value("style-node-size-value").textContent = `${Number(target.value).toFixed(2)}×`;
        this.setProperty("size", Number(target.value) === 1 ? null : Number(target.value));
        break;

      case "style-highlight":
        this.setProperty("highlight", target.checked ? true : null);
        break;

      case "style-hidden":
        this.setProperty("hidden", target.checked ? true : null);
        break;

      default:
    }
  },

  setProperty(property, value) {
    const model = App.getModel();

    if (!this.nodeId || !model) {
      return;
    }

    const nodeId = this.nodeId;

    this.mutate((style, map) => {
      const matching = style.rules.filter((item) => map.get(item.target) === nodeId);

      if (value === null) {
        matching.forEach((rule) => {
          delete rule[property];
        });
        style.rules = style.rules.filter((item) => Object.keys(item).length > 1 || !matching.includes(item));
        return;
      }

      let rule = matching[0];

      if (!rule) {
        rule = { target: nodeId };
        style.rules.push(rule);
      }

      matching.forEach((item) => {
        delete item[property];
      });
      rule[property] = value;
    });
  },

  deleteRule(id) {
    const model = App.getModel();

    if (!id || !model) {
      return;
    }

    this.mutate((style, map) => {
      style.rules = style.rules.filter((item) => map.get(item.target) !== id);
    });
    this.render();
  },

  // Rewrites the canonical top-level `style:` block of the editor text.
  mutate(change) {
    const text = App.getText();
    let model;

    try {
      model = Model.parse(text);
    } catch (error) {
      App.showMessage(`Impossible de modifier le style : YAML invalide (${error.message}).`, "error");
      return;
    }

    const style = {
      size: model.style && model.style.size,
      rules: ((model.style && model.style.rules) || []).map((rule) => Object.assign({}, rule))
    };

    change(style, Style.lookup(model));

    const block = {};

    if (style.size !== undefined && style.size !== null && Number(style.size) !== 1) {
      block.size = style.size;
    }

    if (style.rules.length) {
      block.rules = style.rules;
    }

    let updated = text;

    try {
      updated = Model.replaceTopLevelBlock(text, "style", Object.keys(block).length ? block : null);
    } catch (error) {
      App.showMessage(`Impossible de modifier le style : ${error.message}`, "error");
      return;
    }

    if (updated !== text) {
      this.busy = true;

      try {
        App.replaceText(updated);
      } finally {
        this.busy = false;
      }
    }

    this.renderRules();
  }
};
