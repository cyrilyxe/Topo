"use strict";

const StyleUI = {
  content: null,
  targets: [],
  brush: null,
  painter: null,

  RECENT_KEY: "topo:recent-colors",
  TYPE_KEYS: ["service", "database", "application", "external", "queue", "default"],
  TYPE_DEFAULTS: { service: "#2563eb", database: "#0f766e", application: "#7c3aed", external: "#6b7280", queue: "#c2410c", default: "#0369a1" },
  TYPE_LABELS: { service: "Service", database: "Base de données", application: "Application", external: "Externe", queue: "File", default: "Autre" },
  BRUSH_KEYS: ["color", "border", "opacity", "size", "highlight"],

  get nodeId() {
    return this.targets[0] || null;
  },

  set nodeId(id) {
    this.targets = id ? [id] : [];
  },

  init() {
    this.content = document.getElementById("style-content");

    this.content.addEventListener("input", (event) => this.onInput(event));
    this.content.addEventListener("change", (event) => this.onInput(event));
    this.content.addEventListener("click", (event) => this.onClick(event));
    this.content.addEventListener("dblclick", (event) => {
      if (event.target.closest("button[data-act=\"brush\"]")) {
        this.startPainter(true);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.painter) {
        this.stopPainter();
      }
    });

    this.render();
  },

  onClick(event) {
    const button = event.target.closest("button[data-act]");

    if (!button) {
      return;
    }

    const { act, prop, id, color } = button.dataset;

    if (act === "delete-rule") {
      this.deleteRule(this.targets);
    } else if (act === "clear") {
      this.apply({ [prop]: null });
    } else if (act === "swatch") {
      this.pushRecent(color);
      this.apply({ [prop]: color });
    } else if (act === "brush") {
      this.toggleBrush(event.detail > 1);
    } else if (act === "select") {
      this.show(id);
    } else if (act === "delete-target") {
      this.deleteRule([id]);
    }
  },

  show(id) {
    this.setTargets(id ? [id] : []);
  },

  setTargets(ids) {
    this.targets = Array.isArray(ids) ? ids.filter(Boolean) : [];
    this.render();
  },

  refresh() {
    const model = App.getModel();

    this.targets = model ? this.targets.filter((id) => model.byId.has(id)) : [];
    this.render();
  },

  // ---- colours ----

  toHex(value) {
    const text = String(value || "").trim();

    if (/^#[0-9a-f]{6}$/i.test(text)) {
      return text.toLowerCase();
    }

    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
    }

    const match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);

    if (!match) {
      return null;
    }

    return `#${[1, 2, 3].map((i) => Math.round(Number(match[i])).toString(16).padStart(2, "0")).join("")}`;
  },

  recents() {
    try {
      const list = JSON.parse(localStorage.getItem(this.RECENT_KEY) || "[]");

      return Array.isArray(list) ? list.filter((item) => /^#[0-9a-f]{6}$/i.test(item)).slice(0, 8) : [];
    } catch (error) {
      return [];
    }
  },

  pushRecent(color) {
    const hex = this.toHex(color);

    if (!hex) {
      return;
    }

    const list = [hex, ...this.recents().filter((item) => item !== hex)].slice(0, 8);

    try {
      localStorage.setItem(this.RECENT_KEY, JSON.stringify(list));
    } catch (error) {
      // storage unavailable: palette just forgets
    }
  },

  palette() {
    const token = (name, fallback) => this.toHex(Graph.token(name, fallback)) || fallback;
    const items = [];

    this.TYPE_KEYS.forEach((key) => {
      items.push({ color: token(`--node-${key}`, this.TYPE_DEFAULTS[key]), title: `Type : ${this.TYPE_LABELS[key]}` });
    });

    for (let depth = 0; depth < 4; depth += 1) {
      items.push({ color: token(`--group-${depth}-border`, "#2563eb"), title: `Bordure, profondeur ${depth}` });
    }

    this.recents().forEach((color) => items.push({ color, title: "Récemment utilisée" }));

    return items.filter((item, index) => items.findIndex((other) => other.color === item.color && other.title === item.title) === index);
  },

  swatches(prop) {
    return `<div class="style-swatches">${this.palette().map((item) =>
      `<button type="button" class="style-swatch" data-act="swatch" data-prop="${prop}" data-color="${escapeHtml(item.color)}" title="${escapeHtml(item.title)} (${escapeHtml(item.color)})" style="background:${escapeHtml(item.color)}"></button>`
    ).join("")}</div>`;
  },

  // ---- effective style ----

  provenance(node, ruled, kind) {
    if (ruled) {
      return "règle";
    }

    if (!node) {
      return "hérité";
    }

    if (node.hasClass("collapsed")) {
      return "replié";
    }

    if (node.hasClass("group")) {
      return `profondeur ${Math.min(Number(node.data("depth")) || 0, 3)}`;
    }

    return kind === "color" ? `type : ${node.data("typeKey") || "default"}` : "hérité";
  },

  effective(id, model) {
    const rule = Style.ruleFor(id, model);
    const found = Graph.cy ? Graph.cy.getElementById(id) : null;
    const node = found && found.length ? found : null;
    // Transient state classes (selection, hover, search…) must not leak into the copied/displayed style.
    const TRANSIENT = ["selected-node", "link-hover", "hl-edge", "dim", "focus-dim", "highlighted"];
    const read = (name) => {
      if (!node) {
        return "";
      }

      const removed = TRANSIENT.filter((cls) => node.hasClass(cls));
      node.removeClass(removed.join(" "));
      const value = node.style(name);
      node.addClass(removed.join(" "));
      return value;
    };
    const typeKey = node ? node.data("typeKey") : "default";
    const fallback = this.toHex(Graph.token(`--node-${typeKey}`, this.TYPE_DEFAULTS[typeKey])) || "#0369a1";

    return {
      id,
      rule,
      color: this.toHex(read("background-color")) || fallback,
      colorFrom: this.provenance(node, rule.color !== undefined, "color"),
      border: this.toHex(read("border-color")) || "#ffffff",
      borderFrom: this.provenance(node, rule.border !== undefined, "border"),
      opacity: rule.opacity !== undefined ? Number(rule.opacity) : (node ? Number(read("opacity")) || 1 : 1),
      fill: node ? Number(read("background-opacity")) : 1,
      size: Number(rule.size) || 1
    };
  },

  merged(items, key) {
    const first = items[0][key];
    const mixed = items.some((item) => item[key] !== first);

    return { value: first, mixed };
  },

  mixedOr(field, text) {
    return field.mixed ? "valeurs mixtes" : text;
  },

  // ---- rendering ----

  render() {
    const model = App.getModel();

    if (!model) {
      this.content.innerHTML = "<p class=\"empty\">Aucun modèle valide.</p>";
      return;
    }

    const size = Number(model.style && model.style.size) || 1;
    const items = this.targets.filter((id) => model.byId.has(id)).map((id) => this.effective(id, model));

    this.content.innerHTML = `
      <div class="form-grid">
        <label>
          Taille globale des nœuds (fichier) : <span id="style-size-value">${size.toFixed(2)}×</span>
          <input id="style-size" type="range" min="0.6" max="1.6" step="0.05" value="${size}" />
        </label>
      </div>

      <h4>${items.length > 1 ? `${items.length} briques sélectionnées` : "Nœud sélectionné"}</h4>
      ${items.length ? this.renderTarget(items, model) : "<p class=\"empty\">Sélectionnez un nœud (clic dans le graphe ou dans le YAML, puis « Style » dans l’inspecteur).</p>"}

      <h4>Règles du fichier</h4>
      <div id="style-rules"></div>
    `;

    this.content.querySelectorAll("[data-mixed]").forEach((input) => {
      input.indeterminate = true;
    });

    this.renderRules();
  },

  renderTarget(items, model) {
    const color = this.merged(items, "color");
    const border = this.merged(items, "border");
    const opacity = this.merged(items, "opacity");
    const nodeSize = this.merged(items, "size");
    const label = this.merged(items.map((item) => ({ label: item.rule.label || "" })), "label");
    const highlight = this.merged(items.map((item) => ({ v: Boolean(item.rule.highlight) })), "v");
    const hidden = this.merged(items.map((item) => ({ v: Boolean(item.rule.hidden) })), "v");
    const first = items[0];
    const single = items.length === 1 ? model.byId.get(first.id) : null;
    const colorFrom = this.mixedOr(this.merged(items, "colorFrom"), first.colorFrom);
    const borderFrom = this.mixedOr(this.merged(items, "borderFrom"), first.borderFrom);
    const brushActive = this.painter ? " active" : "";

    return `
      <div class="style-target">
        ${single ? `<strong>${escapeHtml(single.label)}</strong><br /><span class="path">${escapeHtml(Model.pathLabel(single.id, model))}</span>` : `<strong>Style de ${items.length} briques</strong>`}
        <div class="style-preview" title="Aperçu du style effectif">
          <span class="style-chip" style="background:${escapeHtml(color.value)};border-color:${escapeHtml(border.value)};opacity:${opacity.value};--fill:${first.fill}"></span>
          <span class="style-chip-text">${escapeHtml(color.value)} / ${escapeHtml(border.value)} / ${Math.round(opacity.value * 100)} %</span>
          <button type="button" class="style-brush${brushActive}" data-act="brush" title="Copier le style de cette brique, puis cliquer d’autres briques pour l’appliquer (double-clic : mode persistant)">🖌 Copier le style</button>
        </div>
      </div>
      <div class="form-grid">
        <label>Étiquette
          <input id="style-label" type="text" placeholder="${label.mixed ? "valeurs mixtes" : "Identique au YAML"}" value="${label.mixed ? "" : escapeHtml(label.value)}" />
        </label>
        <div class="style-field">
          <span>Couleur de fond <small class="prov">${escapeHtml(colorFrom)}</small></span>
          <span class="style-row"><input id="style-color" type="color" value="${escapeHtml(color.value)}" /> <button type="button" data-act="clear" data-prop="color" title="Revenir à la valeur héritée">⟲</button></span>
          ${this.swatches("color")}
        </div>
        <div class="style-field">
          <span>Couleur de bordure <small class="prov">${escapeHtml(borderFrom)}</small></span>
          <span class="style-row"><input id="style-border" type="color" value="${escapeHtml(border.value)}" /> <button type="button" data-act="clear" data-prop="border" title="Revenir à la valeur héritée">⟲</button></span>
          ${this.swatches("border")}
        </div>
        <label>Opacité : <span id="style-opacity-value">${opacity.mixed ? "valeurs mixtes" : `${Math.round(opacity.value * 100)} %`}</span>
          <input id="style-opacity" type="range" min="0.1" max="1" step="0.05" value="${opacity.value}" />
        </label>
        <label>Taille : <span id="style-node-size-value">${nodeSize.mixed ? "valeurs mixtes" : `${nodeSize.value.toFixed(2)}×`}</span>
          <input id="style-node-size" type="range" min="0.6" max="1.6" step="0.05" value="${nodeSize.value}" />
        </label>
        <label class="inline"><input id="style-highlight" type="checkbox" ${highlight.value ? "checked" : ""} ${highlight.mixed ? "data-mixed" : ""} /> Mettre en avant</label>
        <label class="inline"><input id="style-hidden" type="checkbox" ${hidden.value ? "checked" : ""} ${hidden.mixed ? "data-mixed" : ""} /> Masquer dans cette vue</label>
        <div class="actions"><button type="button" data-act="delete-rule">Supprimer la règle</button></div>
      </div>`;
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

  // ---- input handling ----

  onInput(event) {
    const target = event.target;
    const done = event.type === "change";
    const text = (id, value) => {
      const element = document.getElementById(id);

      if (element) {
        element.textContent = value;
      }
    };

    switch (target.id) {
      case "style-size": {
        const size = Number(target.value);

        text("style-size-value", `${size.toFixed(2)}×`);

        if (done) {
          this.setGlobalSize(size);
        }
        break;
      }

      case "style-label":
        if (done) {
          this.apply({ label: target.value });
        }
        break;

      case "style-color":
      case "style-border":
        if (done) {
          this.pushRecent(target.value);
          this.apply({ [target.id === "style-color" ? "color" : "border"]: target.value });
        }
        break;

      case "style-opacity":
        text("style-opacity-value", `${Math.round(Number(target.value) * 100)} %`);

        if (done) {
          this.apply({ opacity: Number(target.value) });
        }
        break;

      case "style-node-size":
        text("style-node-size-value", `${Number(target.value).toFixed(2)}×`);

        if (done) {
          this.apply({ size: Number(target.value) });
        }
        break;

      case "style-highlight":
      case "style-hidden":
        if (done) {
          this.apply({ [target.id === "style-highlight" ? "highlight" : "hidden"]: target.checked });
        }
        break;

      default:
    }
  },

  // ---- mutations ----

  isDefault(property, value) {
    if (value === null || value === undefined || value === false || value === "") {
      return true;
    }

    return (property === "opacity" || property === "size") && Number(value) === 1;
  },

  // Sets (or removes, when null/default) properties on the rule of each id.
  patchRules(style, map, ids, props) {
    ids.forEach((id) => {
      const matching = style.rules.filter((item) => map.get(item.target) === id);

      Object.keys(props).forEach((property) => {
        matching.forEach((item) => {
          delete item[property];
        });

        if (this.isDefault(property, props[property])) {
          return;
        }

        let rule = matching[0];

        if (!rule) {
          rule = { target: id };
          style.rules.push(rule);
          matching.push(rule);
        }

        rule[property] = props[property];
      });
    });

    style.rules = style.rules.filter((item) => Object.keys(item).length > 1);
  },

  apply(props, ids) {
    this.applyTo(ids || this.targets, props);
  },

  applyTo(ids, props) {
    if (!ids.length) {
      return;
    }

    const label = ids.length > 1 ? `Style de ${ids.length} briques` : "Style de brique";

    this.mutate(label, (style, map) => this.patchRules(style, map, ids, props));
    this.render();
  },

  setGlobalSize(size) {
    this.mutate("Taille globale", (style) => {
      style.size = size === 1 ? undefined : size;
    });
    this.render();
  },

  deleteRule(ids) {
    const list = (ids || []).filter(Boolean);

    if (!list.length) {
      return;
    }

    this.mutate("Suppression de règle de style", (style, map) => {
      style.rules = style.rules.filter((item) => !list.includes(map.get(item.target)));
    });
    this.render();
  },

  // Kept for callers: applies one property to every target.
  setProperty(property, value) {
    this.apply({ [property]: value });
  },

  // Rewrites the top-level `style:` block through DocEdit (comments preserved, undoable).
  mutate(label, change) {
    App.edit(label, (text) => {
      const model = Model.parse(text);
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

      return DocEdit.setTopLevel(text, "style", Object.keys(block).length ? block : null);
    });
  },

  // ---- painter ----

  copyBrush() {
    const model = App.getModel();

    if (!model || !this.targets.length) {
      return null;
    }

    const info = this.effective(this.targets[0], model);
    const brush = {};
    const rule = info.rule;

    if (Object.keys(rule).some((key) => this.BRUSH_KEYS.includes(key))) {
      this.BRUSH_KEYS.forEach((key) => {
        brush[key] = rule[key] === undefined ? null : rule[key];
      });
      return brush;
    }

    return { color: info.color, border: info.border, opacity: info.opacity, size: info.size, highlight: null };
  },

  toggleBrush(second) {
    if (this.painter && !second) {
      this.stopPainter();
      return;
    }

    this.startPainter(false);
  },

  startPainter(persistent) {
    const brush = this.painter ? this.brush : this.copyBrush();

    if (!brush || !Graph.cy) {
      App.showMessage("Sélectionnez d’abord une brique à copier.", "info");
      return;
    }

    this.stopPainter();
    this.brush = brush;

    const handler = (event) => this.paint(event.target.id());

    Graph.cy.on("tap", "node", handler);
    this.painter = { persistent, handler, cy: Graph.cy, banner: this.makeBanner() };
    document.body.classList.add("painter-active");
    this.render();
  },

  makeBanner() {
    const banner = document.createElement("div");

    banner.id = "painter-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "Pinceau actif — cliquez des briques pour appliquer, Échap pour sortir";
    document.body.appendChild(banner);

    return banner;
  },

  stopPainter() {
    if (!this.painter) {
      return;
    }

    this.painter.cy.off("tap", "node", this.painter.handler);
    this.painter.banner.remove();
    this.painter = null;
    document.body.classList.remove("painter-active");
    this.render();
  },

  paint(id) {
    if (!this.painter || !this.brush) {
      return;
    }

    const persistent = this.painter.persistent;

    this.applyTo([id], this.brush);

    if (!persistent) {
      this.stopPainter();
    }
  }
};
