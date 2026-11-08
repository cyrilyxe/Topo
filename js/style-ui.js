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
  BRUSH_KEYS: ["color", "border", "opacity", "size", "highlight", "textColor", "bold", "italic", "textBackground", "borderStyle", "borderWidth", "shape"],
  PRESET_NODE_KEYS: ["color", "border", "opacity", "size", "highlight", "textColor", "bold", "italic", "textBackground", "borderStyle", "borderWidth", "shape"],
  LINK_KEYS: ["color", "width", "line", "arrow", "sourceArrow", "textColor"],
  RECENT_LINKS_KEY: "topo:recent-link-styles",
  // Colour fields: input id -> where the value goes.
  COLOR_FIELDS: {
    "style-color": { kind: "node", prop: "color" },
    "style-border": { kind: "node", prop: "border" },
    "style-text": { kind: "node", prop: "textColor" },
    "style-textbg": { kind: "node", prop: "textBackground" },
    "link-color": { kind: "link", prop: "color" },
    "link-text": { kind: "link", prop: "textColor" }
  },
  LINK_DATA: { color: "lsColor", width: "lsWidth", line: "lsLine", arrow: "lsArrow", sourceArrow: "lsSource", textColor: "lsText" },
  nameForm: null,
  graphBound: null,

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
    this.content.addEventListener("keydown", (event) => {
      if (event.target.id !== "preset-name") {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        this.submitNameForm();
      } else if (event.key === "Escape") {
        event.stopPropagation();
        this.nameForm = null;
        this.render();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.painter) {
        this.stopPainter();
      }
    });

    this.bindHiddenIndicator();
    this.bindGraph();

    if (typeof Legend !== "undefined") {
      Legend.init();
    }

    this.render();
  },

  // Re-renders when edges get (un)selected, and jumps to the Style tab on an edge click.
  bindGraph() {
    const cy = typeof Graph !== "undefined" ? Graph.cy : null;

    if (!cy || this.graphBound === cy) {
      return;
    }

    this.graphBound = cy;
    cy.on("select unselect", "edge", () => {
      clearTimeout(this.edgeTimer);
      this.edgeTimer = setTimeout(() => this.render(), 0);
    });
    cy.on("tap", "edge", () => {
      const tab = document.querySelector(".tab[data-tab=\"style\"]");

      if (tab && !tab.classList.contains("active")) {
        tab.click();
      }
    });
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
    } else if (act === "link-clear") {
      this.applyLink({ [prop]: null });
    } else if (act === "link-default") {
      this.applyLink(null, true);
    } else if (act === "link-recent") {
      this.applyLink(this.recentLinks()[Number(button.dataset.index)], true);
    } else if (act === "preset-new") {
      this.nameForm = { mode: "save", kind: button.dataset.kind };
      this.render();
      this.focusNameForm();
    } else if (act === "preset-rename") {
      this.nameForm = { mode: "rename", kind: button.dataset.kind, old: button.dataset.name };
      this.render();
      this.focusNameForm();
    } else if (act === "preset-ok") {
      this.submitNameForm();
    } else if (act === "preset-cancel") {
      this.nameForm = null;
      this.render();
    } else if (act === "preset-apply") {
      this.applyPreset(button.dataset.kind, button.dataset.name, button.dataset.source);
    } else if (act === "preset-delete") {
      this.deletePreset(button.dataset.kind, button.dataset.name, button.dataset.source);
    } else if (act === "preset-export") {
      this.exportPresets();
    } else if (act === "brush") {
      this.toggleBrush(event.detail > 1);
    } else if (act === "select") {
      this.focusRuleTarget(id);
    } else if (act === "expand-ancestor") {
      App.toggleCollapse(id);
      setTimeout(() => this.focusRuleTarget(this.notice ? this.notice.id : null), 150);
    } else if (act === "unhide-focus") {
      this.unhide([id]);
      setTimeout(() => this.focusRuleTarget(id), 150);
    } else if (act === "delete-target") {
      this.deleteRule([id]);
    } else if (act === "unhide") {
      this.unhide([id]);
    } else if (act === "unhide-all") {
      this.unhide();
    } else if (act === "level-edit") {
      Legend.openStyleEditor(button.dataset.kind, button.dataset.value, button);
    } else if (act === "level-reset") {
      Legend.resetStyle(button.dataset.kind, button.dataset.value);
    }
  },

  // Selects the brick targeted by a rule (stays on the Style tab) and brings it into view.
  focusRuleTarget(id) {
    const model = App.getModel();

    this.notice = id && model && model.byId.has(id) ? { id } : null;

    if (this.notice && !this.noticeInfo(model)) {
      App.inspectNode(id, { center: false });
      this.centerIfOffscreen(id);
    }

    this.render();
  },

  // Why the brick cannot be selected in the graph, or null.
  noticeInfo(model) {
    const id = this.notice && this.notice.id;

    if (!id || !model.byId.has(id)) {
      return null;
    }

    if (this.hiddenIds(model).includes(id)) {
      return { text: "brique masquée", act: "unhide-focus", target: id, button: "Réafficher" };
    }

    const visible = Model.visibleAncestor(id, model, App.collapsed);

    if (visible !== id) {
      const group = model.byId.get(visible);

      return { text: `dans « ${group ? group.label : visible} » replié`, act: "expand-ancestor", target: visible, button: "Déplier" };
    }

    return null;
  },

  centerIfOffscreen(id) {
    const node = Graph.cy && Graph.cy.getElementById(id);

    if (!node || node.empty()) {
      return;
    }

    const box = node.renderedBoundingBox();

    if (box.x1 < 0 || box.y1 < 0 || box.x2 > Graph.cy.width() || box.y2 > Graph.cy.height()) {
      Graph.cy.animate({ center: { eles: node } }, { duration: 250 });
    }
  },

  noticeHtml(model) {
    const info = this.noticeInfo(model);
    const node = info && model.byId.get(this.notice.id);

    return info ? `<p class="rule-notice"><strong>${escapeHtml(node.label)}</strong> : ${escapeHtml(info.text)}
      <button type="button" data-act="${info.act}" data-id="${escapeHtml(info.target)}">${info.button}</button></p>` : "";
  },

  // ---- hidden bricks ----

  // Ids of the bricks hidden by a style rule (optionally restricted to a Set of ids).
  hiddenIds(model, within) {
    const map = Style.lookup(model);
    const ids = [];

    ((model.style && model.style.rules) || []).forEach((rule) => {
      const id = map.get(rule.target);

      if (id && rule.hidden && !ids.includes(id) && (!within || within.has(id))) {
        ids.push(id);
      }
    });

    return ids;
  },

  // Removes the `hidden` key (empty rules are dropped); no argument: every hidden brick.
  unhide(ids) {
    const model = App.getModel();
    const list = ids || (model ? this.hiddenIds(model) : []);

    if (!list.length) {
      return;
    }

    this.mutate(list.length > 1 ? `Réaffichage de ${list.length} briques` : "Réaffichage d’une brique", (style, map) => this.patchRules(style, map, list, { hidden: null }));
    this.render();
  },

  hiddenRows(ids, model) {
    return ids.map((id) => {
      const node = model.byId.get(id);

      return `<li><span class="hidden-name" title="${escapeHtml(Model.pathLabel(id, model))}">${escapeHtml(node.label)}</span>
        <button type="button" data-act="unhide" data-id="${escapeHtml(id)}">Réafficher</button></li>`;
    }).join("");
  },

  hiddenSection(ids, model) {
    if (!ids.length) {
      return "";
    }

    return `
      <h4>Briques masquées (${ids.length})</h4>
      <ul class="hidden-rows">${this.hiddenRows(ids, model)}</ul>
      <div class="actions"><button type="button" data-act="unhide-all">Tout réafficher</button></div>`;
  },

  renderHiddenIndicator(ids, model) {
    const button = document.getElementById("hidden-indicator");
    const list = document.getElementById("hidden-list");

    if (!button || !list) {
      return;
    }

    button.hidden = !ids.length;
    button.textContent = `👁 ${ids.length} masquée${ids.length > 1 ? "s" : ""}`;
    list.innerHTML = `<ul class="hidden-rows">${this.hiddenRows(ids, model)}</ul>
      <div class="actions"><button type="button" data-act="unhide-all">Tout réafficher</button></div>`;

    if (!ids.length) {
      this.toggleHiddenList(false);
    }
  },

  toggleHiddenList(open) {
    const button = document.getElementById("hidden-indicator");
    const list = document.getElementById("hidden-list");

    if (button && list) {
      list.hidden = !open;
      button.setAttribute("aria-expanded", String(Boolean(open)));
    }
  },

  bindHiddenIndicator() {
    const button = document.getElementById("hidden-indicator");
    const list = document.getElementById("hidden-list");

    if (!button || !list) {
      return;
    }

    button.addEventListener("click", () => this.toggleHiddenList(list.hidden));
    list.addEventListener("click", (event) => this.onClick(event));
    document.addEventListener("mousedown", (event) => {
      if (!list.hidden && !event.target.closest(".hidden-box")) {
        this.toggleHiddenList(false);
      }
    });
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

    const level = this.levelFrom(node, kind);

    if (level) {
      return level;
    }

    if (node.hasClass("collapsed")) {
      return "replié";
    }

    if (node.hasClass("group")) {
      return `profondeur ${Math.min(Number(node.data("depth")) || 0, 3)}`;
    }

    return kind === "color" ? `type : ${node.data("typeKey") || "default"}` : "hérité";
  },

  // "rôle : user" / "type : service (fichier)" when style.roles / style.types supply `prop` for the node.
  levelFrom(node, prop) {
    const levels = node && node.data("levels");

    if (!levels || !prop) {
      return null;
    }

    if (levels.role && levels.role[prop] !== undefined) {
      return `rôle : ${node.data("role")}`;
    }

    if (levels.type && levels.type[prop] !== undefined) {
      return `type : ${node.data("type")} (fichier)`;
    }

    return null;
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
      size: Number(rule.size) || 1,
      text: this.toHex(read("color")) || "#000000",
      textFrom: rule.textColor !== undefined ? "règle" : (this.levelFrom(node, "textColor") || "auto (contraste)"),
      shape: (node && node.data("rule") && node.data("rule").shape) || "round-rectangle",
      shapeFrom: rule.shape !== undefined ? "règle" : (this.levelFrom(node, "shape") || (node && node.isParent() ? "groupe déplié : rectangle" : "défaut")),
      textBg: rule.textBackground || "",
      borderStyle: rule.borderStyle || (node ? read("border-style") : "") || "solid",
      borderWidth: rule.borderWidth !== undefined ? Number(rule.borderWidth) : (node ? Number(read("border-width")) || 0 : 2)
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

    this.bindGraph();

    const size = Number(model.style && model.style.size) || 1;
    const items = this.targets.filter((id) => model.byId.has(id)).map((id) => this.effective(id, model));
    const hiddenIds = this.hiddenIds(model);
    const links = this.linkSelection();

    this.nameForm = this.nameForm && (this.nameForm.kind === "link" ? links.length : items.length) ? this.nameForm : null;

    this.renderHiddenIndicator(hiddenIds, model);

    if (typeof Legend !== "undefined") {
      Legend.render(model);
    }

    this.content.innerHTML = `
      ${this.hiddenSection(hiddenIds, model)}
      <div class="form-grid">
        <label>
          Taille globale des nœuds (fichier) : <span id="style-size-value">${size.toFixed(2)}×</span>
          <input id="style-size" type="range" min="0.6" max="1.6" step="0.05" value="${size}" />
        </label>
      </div>

      ${links.length ? this.renderLinkEditor(links) : ""}
      <h4>${items.length > 1 ? `${items.length} briques sélectionnées` : "Nœud sélectionné"}</h4>
      ${items.length ? this.renderTarget(items, model) : "<p class=\"empty\">Sélectionnez un nœud (clic dans le graphe ou dans le YAML, puis « Style » dans l’inspecteur) ou un lien.</p>"}
      ${items.length === 1 ? this.levelBlock(model.byId.get(items[0].id)) : ""}
      ${items.length ? this.presetSection("node", model) : ""}

      <h4>Règles du fichier</h4>
      ${this.noticeHtml(model)}
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
    const text = this.merged(items, "text");
    const textFrom = this.mixedOr(this.merged(items, "textFrom"), items[0].textFrom);
    const textBg = this.merged(items, "textBg");
    const bold = this.merged(items.map((item) => ({ v: Boolean(item.rule.bold) })), "v");
    const italic = this.merged(items.map((item) => ({ v: Boolean(item.rule.italic) })), "v");
    const borderStyle = this.merged(items, "borderStyle");
    const borderWidth = this.merged(items, "borderWidth");
    const first = items[0];
    const single = items.length === 1 ? model.byId.get(first.id) : null;
    const colorFrom = this.mixedOr(this.merged(items, "colorFrom"), first.colorFrom);
    const borderFrom = this.mixedOr(this.merged(items, "borderFrom"), first.borderFrom);
    const brushActive = this.painter ? " active" : "";
    const shape = this.merged(items, "shape");
    const shapeFrom = this.mixedOr(this.merged(items, "shapeFrom"), first.shapeFrom);

    return `
      <div class="style-target">
        ${single ? "" : `<strong>Style de ${items.length} briques</strong>`}
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
          ${this.colorField("style-color", color.value, "clear", "color")}
          ${this.swatches("color")}
        </div>
        <div class="style-field">
          <span>Couleur de bordure <small class="prov">${escapeHtml(borderFrom)}</small></span>
          ${this.colorField("style-border", border.value, "clear", "border")}
          ${this.swatches("border")}
        </div>
        <div class="style-field">
          <span>Style de bordure</span>
          <span class="style-row">
            <select id="style-border-style">${Style.BORDER_STYLES.map((name) => `<option value="${name}" ${!borderStyle.mixed && borderStyle.value === name ? "selected" : ""}>${name}</option>`).join("")}${borderStyle.mixed ? "<option value=\"\" selected>valeurs mixtes</option>" : ""}</select>
            <button type="button" data-act="clear" data-prop="borderStyle" title="Revenir à la valeur héritée">⟲</button>
          </span>
        </div>
        <div class="style-field">
          <span>Forme <small class="prov">${escapeHtml(shapeFrom)}</small></span>
          <span class="style-row">
            <select id="style-shape">${Style.SHAPES.map((name) => `<option value="${name}" ${!shape.mixed && shape.value === name ? "selected" : ""}>${name}</option>`).join("")}${shape.mixed ? "<option value=\"\" selected>valeurs mixtes</option>" : ""}</select>
            <button type="button" data-act="clear" data-prop="shape" title="Revenir à la valeur héritée">⟲</button>
          </span>
        </div>
        <label>Épaisseur de bordure : <span id="style-border-width-value">${borderWidth.mixed ? "valeurs mixtes" : `${borderWidth.value} px`}</span>
          <input id="style-border-width" type="range" min="0" max="8" step="1" value="${borderWidth.value}" />
        </label>
        <div class="style-field">
          <span>Couleur du texte <small class="prov">${escapeHtml(textFrom)}</small></span>
          ${this.colorField("style-text", text.value, "clear", "textColor")}
        </div>
        <div class="style-field">
          <span>Fond du texte <small class="prov">${textBg.mixed ? "valeurs mixtes" : (textBg.value ? "règle" : "aucun")}</small></span>
          ${this.colorField("style-textbg", textBg.value || "#ffffff", "clear", "textBackground")}
        </div>
        <label class="inline"><input id="style-bold" type="checkbox" ${bold.value ? "checked" : ""} ${bold.mixed ? "data-mixed" : ""} /> Gras</label>
        <label class="inline"><input id="style-italic" type="checkbox" ${italic.value ? "checked" : ""} ${italic.mixed ? "data-mixed" : ""} /> Italique</label>
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

  // Role / type style entries of the selected brick: edit or go back to the default.
  levelBlock(node) {
    if (!node || typeof Legend === "undefined") {
      return "";
    }

    const row = (kind, value, label) => {
      const defined = Legend.hasStyle(kind, value);

      return `<li><span>${label} « ${escapeHtml(value)} » <small class="prov">${defined ? "style défini dans le fichier" : "pas de style"}</small></span>
        <button type="button" data-act="level-edit" data-kind="${kind}" data-value="${escapeHtml(value)}">Éditer</button>
        ${defined ? `<button type="button" data-act="level-reset" data-kind="${kind}" data-value="${escapeHtml(value)}" title="Supprime le style de ce ${kind === "role" ? "rôle" : "type"} du fichier">Revenir au défaut</button>` : ""}</li>`;
    };
    const rows = [node.role ? row("role", node.role, "Rôle") : "", node.type ? row("type", node.type, "Type") : ""].join("");

    return rows ? `<h4>Styles partagés</h4><ul class="level-rows">${rows}</ul>` : "";
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
            ${id ? `<button type="button" class="link-node" data-act="select" data-id="${escapeHtml(id)}"><code>${escapeHtml(rule.target)}</code></button>` : `<code>${escapeHtml(rule.target)}</code>`}
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

    if (target.classList && target.classList.contains("hex-input")) {
      this.onHex(event);
      return;
    }

    if (this.COLOR_FIELDS[target.id]) {
      const hex = this.toHex(target.value);
      const hexInput = document.getElementById(`${target.id}-hex`);

      if (hexInput && hex) {
        hexInput.value = hex;
      }

      this.colorChanged(target.id, hex, done);
      return;
    }

    if (target.id && target.id.startsWith("link-")) {
      this.onLinkInput(target, done);
      return;
    }

    switch (target.id) {
      case "style-size": {
        const size = Number(target.value);

        text("style-size-value", `${size.toFixed(2)}×`);

        if (done) {
          this.setGlobalSize(size);
          this.clearPreview();
        } else {
          this.preview({ globalSize: size });
        }
        break;
      }

      case "style-label":
        if (done) {
          this.apply({ label: target.value });
        }
        break;

      case "style-border-style":
        if (done && target.value) {
          this.apply({ borderStyle: target.value });
        } else if (target.value) {
          this.preview({ borderStyle: target.value });
        }
        break;

      case "style-shape":
        if (done && target.value) {
          this.apply({ shape: target.value });
        }
        break;

      case "style-border-width":
        text("style-border-width-value", `${target.value} px`);

        if (done) {
          this.apply({ borderWidth: Number(target.value) });
          this.clearPreview();
        } else {
          this.preview({ borderWidth: Number(target.value) });
        }
        break;

      case "style-bold":
      case "style-italic":
        if (done) {
          this.apply({ [target.id === "style-bold" ? "bold" : "italic"]: target.checked });
        }
        break;

      case "style-opacity":
        text("style-opacity-value", `${Math.round(Number(target.value) * 100)} %`);

        if (done) {
          this.apply({ opacity: Number(target.value) });
          this.clearPreview();
        } else {
          this.preview({ opacity: Number(target.value) });
        }
        break;

      case "style-node-size":
        text("style-node-size-value", `${Number(target.value).toFixed(2)}×`);

        if (done) {
          this.apply({ size: Number(target.value) });
          this.clearPreview();
        } else {
          this.preview({ size: Number(target.value) });
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

  // ---- live preview (temporary Cytoscape bypass, never persisted) ----

  preview(props) {
    const cy = typeof Graph !== "undefined" ? Graph.cy : null;

    if (!cy) {
      return;
    }

    const scale = Style.scale();

    cy.batch(() => {
      if (props.globalSize !== undefined) {
        cy.nodes().not(".meta-card").forEach((node) => {
          const rule = node.data("rule") || {};

          this.previewSize(node, Style.userScale * props.globalSize * (Number(rule.size) || 1));
        });
        return;
      }

      this.targets.forEach((id) => {
        const node = cy.getElementById(id);

        if (!node.length) {
          return;
        }

        if (props.opacity !== undefined) {
          node.style("opacity", props.opacity);
        }

        if (props.color !== undefined) {
          node.style("background-color", props.color);
        }

        if (props.border !== undefined) {
          node.style("border-color", props.border);
        }

        if (props.textColor !== undefined) {
          node.data("ruleText", props.textColor);
        }

        if (props.textBackground !== undefined) {
          node.data("ruleTextBg", props.textBackground);
        }

        if (props.borderStyle !== undefined) {
          node.style("border-style", props.borderStyle);
        }

        if (props.borderWidth !== undefined) {
          node.style("border-width", props.borderWidth);
        }

        if (props.color !== undefined) {
          const fill = Graph.resolveColor(props.color);

          if (fill) {
            node.data("autoText", Style.autoText(fill, null));
          }
        }

        if (props.size !== undefined) {
          this.previewSize(node, scale * props.size);
        }
      });
    });
  },

  previewSize(node, size) {
    const styles = { "font-size": (node.isParent() ? 12 : 11) * size };

    if (node.isParent()) {
      styles.padding = `${32 * size}px`;
    } else if (node.hasClass("collapsed")) {
      styles.width = 210 * size;
      styles.height = 56 * size;
      styles.padding = `${12 * size}px`;
    } else {
      styles.width = 170 * size;
      styles.height = 42 * size;
      styles.padding = `${12 * size}px`;
    }

    node.style(styles);
  },

  // Restores the normal rendering (also when the commit changed nothing and no re-render happened).
  clearPreview() {
    if (typeof Graph !== "undefined" && Graph.cy) {
      Graph.applyStyle();
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

      // Blocks owned by other features are carried over untouched.
      ["presets", "roles", "types"].forEach((key) => {
        if (model.style && model.style[key] !== undefined) {
          style[key] = JSON.parse(JSON.stringify(model.style[key]));
        }
      });

      change(style, Style.lookup(model));

      const block = {};

      if (style.size !== undefined && style.size !== null && Number(style.size) !== 1) {
        block.size = style.size;
      }

      if (style.rules.length) {
        block.rules = style.rules;
      }

      ["presets", "roles", "types"].forEach((key) => {
        if (style[key] && Object.keys(style[key]).length) {
          block[key] = style[key];
        }
      });

      return DocEdit.setTopLevel(text, "style", Object.keys(block).length ? block : null);
    });
  },

  // ---- colour fields (picker + hex input) ----

  colorField(id, value, clearAct, prop) {
    const hex = escapeHtml(this.toHex(value) || "#000000");

    return `<span class="style-row"><input id="${id}" type="color" value="${hex}" /><input id="${id}-hex" class="hex-input" type="text" maxlength="9" spellcheck="false" autocomplete="off" value="${hex}" aria-label="Valeur hexadécimale" title="#rgb ou #rrggbb (collage accepté)" /> <button type="button" data-act="${clearAct}" data-prop="${prop}" title="Revenir à la valeur héritée">⟲</button></span>`;
  },

  // "ff8800", "#f80" or "#FF8800" -> "#rrggbb", otherwise null.
  hexFrom(text) {
    let value = String(text || "").trim();

    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      value = `#${value}`;
    }

    return Style.normalizeHex(value);
  },

  onHex(event) {
    const input = event.target;
    const base = input.id.replace(/-hex$/, "");
    const picker = document.getElementById(base);
    const hex = this.hexFrom(input.value);

    if (event.type === "input") {
      input.classList.toggle("invalid", !hex && input.value.trim() !== "");

      if (hex) {
        if (picker) {
          picker.value = hex;
        }

        this.colorChanged(base, hex, false);
      }

      return;
    }

    input.classList.remove("invalid");

    if (!hex) {
      input.value = picker ? picker.value : "";
      this.clearPreview();
      return;
    }

    input.value = hex;

    if (picker) {
      picker.value = hex;
    }

    this.colorChanged(base, hex, true);
  },

  colorChanged(id, hex, done) {
    const field = this.COLOR_FIELDS[id];

    if (!field || !hex) {
      return;
    }

    if (field.kind === "node") {
      if (done) {
        this.pushRecent(hex);
        this.apply({ [field.prop]: hex });
        this.clearPreview();
      } else {
        this.preview({ [field.prop]: hex });
      }
    } else if (done) {
      this.pushRecent(hex);
      this.applyLink({ [field.prop]: hex });
    } else {
      this.previewLink({ [field.prop]: hex });
    }
  },

  // ---- link styles ----

  // Selected edges with the real links they carry: [{ edge, items: [{ link, index }] }].
  linkSelection() {
    const cy = typeof Graph !== "undefined" ? Graph.cy : null;

    if (!cy || typeof Tools === "undefined" || !App.getModel()) {
      return [];
    }

    try {
      return cy.edges(":selected").toArray()
        .map((edge) => ({ edge, items: Tools.linksOfEdge(edge) }))
        .filter((entry) => entry.items.length);
    } catch (error) {
      return [];
    }
  },

  uniqueLinks(entries) {
    const seen = new Map();

    entries.forEach((entry) => entry.items.forEach((item) => seen.set(item.index, item)));

    return [...seen.values()];
  },

  // Style shown in the editor: explicit link style over the defaults of the first edge.
  linkEffective(entries) {
    const edge = entries[0].edge;
    const meta = Boolean(edge.data("isMeta"));
    const own = Style.cleanLink(this.uniqueLinks(entries)[0].link.style);

    return {
      own,
      color: this.toHex(own.color) || this.toHex(Graph.token(meta ? "--meta-edge" : "--edge", "#8b98ad")) || "#8b98ad",
      width: own.width || (meta ? 3 : 2),
      line: own.line || (meta ? "dashed" : "solid"),
      arrow: own.arrow || "triangle",
      sourceArrow: own.sourceArrow || "none",
      textColor: this.toHex(own.textColor) || this.toHex(edge.data("autoText")) || "#475569"
    };
  },

  recentLinks() {
    try {
      const list = JSON.parse(localStorage.getItem(this.RECENT_LINKS_KEY) || "[]");

      return Array.isArray(list) ? list.map((item) => Style.cleanLink(item)).filter((item) => Object.keys(item).length).slice(0, 5) : [];
    } catch (error) {
      return [];
    }
  },

  pushRecentLink(style) {
    const clean = Style.cleanLink(style);

    if (!Object.keys(clean).length) {
      return;
    }

    const key = JSON.stringify(clean);
    const list = [clean, ...this.recentLinks().filter((item) => JSON.stringify(item) !== key)].slice(0, 5);

    try {
      localStorage.setItem(this.RECENT_LINKS_KEY, JSON.stringify(list));
    } catch (error) {
      // storage unavailable: history just forgets
    }
  },

  linkPreviewHtml(style) {
    const color = this.toHex(style.color) || this.toHex(Graph.token("--edge", "#8b98ad")) || "#8b98ad";

    return `<span class="lr-line" style="border-top:${Math.max(1, Number(style.width) || 2)}px ${style.line || "solid"} ${escapeHtml(color)}"></span>`;
  },

  select(id, options, value, label) {
    return `<select id="${id}" aria-label="${label}">${options.map((name) => `<option value="${name}" ${name === value ? "selected" : ""}>${name}</option>`).join("")}</select>`;
  },

  renderLinkEditor(entries) {
    const model = App.getModel();
    const all = this.uniqueLinks(entries);
    const eff = this.linkEffective(entries);
    const name = (id) => (model.byId.get(id) ? model.byId.get(id).label : id);
    const title = all.length === 1 ? `${name(all[0].link.from)} → ${name(all[0].link.to)}` : `${all.length} liens (${entries.length} flèche${entries.length > 1 ? "s" : ""})`;
    const mixed = new Set(all.map((item) => JSON.stringify(Style.cleanLink(item.link.style)))).size > 1;
    const recents = this.recentLinks();

    return `
      <h4>${all.length > 1 ? "Liens sélectionnés" : "Lien sélectionné"}</h4>
      <div class="style-target link-editor">
        <strong>${escapeHtml(title)}</strong>${mixed ? " <small class=\"prov\">styles différents : le premier est affiché</small>" : ""}
      </div>
      <div class="form-grid">
        <div class="style-field">
          <span>Couleur du lien <small class="prov">${eff.own.color ? "lien" : "par défaut"}</small></span>
          ${this.colorField("link-color", eff.color, "link-clear", "color")}
        </div>
        <label>Épaisseur : <span id="link-width-value">${eff.width} px</span>
          <input id="link-width" type="range" min="1" max="8" step="1" value="${eff.width}" />
        </label>
        <div class="style-field"><span>Trait</span>${this.select("link-line", Style.LINK_LINES, eff.line, "Type de trait")}</div>
        <div class="style-field"><span>Flèche (cible)</span>${this.select("link-arrow", Style.LINK_ARROWS, eff.arrow, "Flèche côté cible")}</div>
        <div class="style-field"><span>Flèche (source)</span>${this.select("link-source", Style.LINK_ARROWS, eff.sourceArrow, "Flèche côté source")}</div>
        <div class="style-field">
          <span>Couleur de l’étiquette <small class="prov">${eff.own.textColor ? "lien" : "auto (contraste)"}</small></span>
          ${this.colorField("link-text", eff.textColor, "link-clear", "textColor")}
        </div>
        <div class="actions"><button type="button" data-act="link-default" title="Retire le style du lien (retour au style par défaut)">Par défaut</button></div>
      </div>
      ${recents.length ? `<h4>Derniers styles de lien</h4>
      <div class="link-recents">${recents.map((item, index) => `<button type="button" class="link-recent" data-act="link-recent" data-index="${index}" title="${escapeHtml(JSON.stringify(item))}">${this.linkPreviewHtml(item)} <small>${escapeHtml(item.arrow || "")}</small></button>`).join("")}</div>` : ""}
      ${this.presetSection("link", model)}`;
  },

  onLinkInput(target, done) {
    const props = { "link-width": "width", "link-line": "line", "link-arrow": "arrow", "link-source": "sourceArrow" };
    const prop = props[target.id];

    if (!prop) {
      return;
    }

    const value = prop === "width" ? Number(target.value) : target.value;

    if (prop === "width") {
      const label = document.getElementById("link-width-value");

      if (label) {
        label.textContent = `${value} px`;
      }
    }

    if (done) {
      this.applyLink({ [prop]: value });
    } else {
      this.previewLink({ [prop]: value });
    }
  },

  // Temporary preview through edge data (restored by Graph.applyStyle).
  previewLink(props) {
    this.linkSelection().forEach((entry) => {
      Object.keys(props).forEach((key) => Graph.setData(entry.edge, this.LINK_DATA[key], props[key]));
    });
  },

  // patch: keys to set (null/"" removes); replace: start from an empty style (patch === null: remove the whole style).
  applyLink(patch, replace) {
    const targets = this.uniqueLinks(this.linkSelection());

    if (!targets.length) {
      return;
    }

    let last = null;

    App.edit(targets.length > 1 ? `Style de ${targets.length} liens` : "Style de lien", (text) => {
      let next = text;

      targets.forEach(({ link, index }, position) => {
        const old = link.style && typeof link.style === "object" ? link.style : {};
        const merged = replace ? {} : Style.cleanLink(old);

        Object.keys(patch || {}).forEach((key) => {
          if (patch[key] === null || patch[key] === undefined || patch[key] === "") {
            delete merged[key];
          } else {
            merged[key] = patch[key];
          }
        });

        const clean = Style.cleanLink(merged);
        const style = {};

        Object.keys(old).forEach((key) => {
          if (clean[key] === undefined) {
            style[key] = null;
          }
        });
        Object.assign(style, clean);

        if (position === 0) {
          last = clean;
        }

        next = DocEdit.updateLink(next, index, { style: Object.keys(clean).length ? style : null });
      });

      return next;
    });

    this.pushRecentLink(last);
    this.clearPreview();
    this.render();
  },

  // ---- named styles (presets) ----

  isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  },

  presetBucket(kind) {
    return kind === "link" ? "links" : "nodes";
  },

  localPresets() {
    const value = typeof Settings !== "undefined" ? Settings.get("style.presets") : null;

    return {
      nodes: Object.assign({}, this.isPlainObject(value) && this.isPlainObject(value.nodes) ? value.nodes : {}),
      links: Object.assign({}, this.isPlainObject(value) && this.isPlainObject(value.links) ? value.links : {})
    };
  },

  filePresets(model) {
    const value = model && model.style ? model.style.presets : null;

    return {
      nodes: this.isPlainObject(value) && this.isPlainObject(value.nodes) ? value.nodes : {},
      links: this.isPlainObject(value) && this.isPlainObject(value.links) ? value.links : {}
    };
  },

  presetList(kind, model) {
    const bucket = this.presetBucket(kind);
    const local = this.localPresets()[bucket];
    const file = this.filePresets(model)[bucket];
    const out = [];

    Object.keys(local).forEach((name) => out.push({ name, source: "local", preset: local[name] }));
    Object.keys(file).forEach((name) => out.push({ name, source: "file", preset: file[name] }));

    return out;
  },

  presetChip(kind, preset) {
    if (kind === "link") {
      return this.linkPreviewHtml(Style.cleanLink(preset));
    }

    const rule = Style.clean(preset || {});
    const color = this.toHex(rule.color) || "#94a3b8";
    const border = this.toHex(rule.border) || "#ffffff";

    return `<span class="preset-chip" style="background:${escapeHtml(color)};border:${rule.borderWidth === undefined ? 2 : Math.max(1, rule.borderWidth)}px ${rule.borderStyle || "solid"} ${escapeHtml(border)};color:${escapeHtml(rule.textColor || Style.autoText(color, null))}${rule.bold ? ";font-weight:700" : ""}${rule.italic ? ";font-style:italic" : ""}">Aa</span>`;
  },

  presetSection(kind, model) {
    const list = this.presetList(kind, model);
    const form = this.nameForm && this.nameForm.kind === kind ? `
      <div class="preset-form">
        <input id="preset-name" type="text" maxlength="60" placeholder="Nom du style" value="${escapeHtml(this.nameForm.old || "")}" aria-label="Nom du style" />
        <button type="button" data-act="preset-ok">${this.nameForm.mode === "rename" ? "Renommer" : "Enregistrer"}</button>
        <button type="button" data-act="preset-cancel">Annuler</button>
      </div>` : "";

    return `
      <h4>Styles nommés ${kind === "link" ? "(liens)" : "(briques)"}</h4>
      <div class="actions">
        <button type="button" data-act="preset-new" data-kind="${kind}">Enregistrer comme style nommé…</button>
        <button type="button" data-act="preset-export" title="Écrit les styles nommés locaux dans style.presets du fichier YAML">Copier dans le fichier</button>
      </div>
      ${form}
      ${list.length ? `<ul class="preset-list">${list.map((entry) => {
        const attrs = `data-kind="${kind}" data-name="${escapeHtml(entry.name)}" data-source="${entry.source}"`;

        return `<li>${this.presetChip(kind, entry.preset)}
          <span class="preset-name">${escapeHtml(entry.name)}</span>${entry.source === "file" ? " <small class=\"badge-file\">fichier</small>" : ""}
          <button type="button" data-act="preset-apply" ${attrs}>Appliquer</button>
          ${entry.source === "local" ? `<button type="button" data-act="preset-rename" ${attrs}>Renommer</button>` : ""}
          <button type="button" data-act="preset-delete" ${attrs}>Supprimer</button>
        </li>`;
      }).join("")}</ul>` : "<p class=\"empty\">Aucun style nommé.</p>"}`;
  },

  focusNameForm() {
    setTimeout(() => {
      const input = document.getElementById("preset-name");

      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  },

  // Style of the current selection, ready to be stored as a preset.
  currentPreset(kind) {
    const model = App.getModel();

    if (kind === "link") {
      const entries = this.linkSelection();

      if (!entries.length) {
        return null;
      }

      const eff = this.linkEffective(entries);

      return Style.cleanLink({ color: eff.color, width: eff.width, line: eff.line, arrow: eff.arrow, sourceArrow: eff.sourceArrow, ...eff.own });
    }

    if (!model || !this.targets.length) {
      return null;
    }

    const info = this.effective(this.targets[0], model);
    const rule = Style.clean(info.rule);
    const preset = { color: info.color, border: info.border };

    this.PRESET_NODE_KEYS.forEach((key) => {
      if (rule[key] !== undefined) {
        preset[key] = rule[key];
      }
    });

    return preset;
  },

  submitNameForm() {
    const form = this.nameForm;
    const input = document.getElementById("preset-name");
    const name = input ? input.value.trim() : "";

    if (!form || !name) {
      return;
    }

    const bucket = this.presetBucket(form.kind);
    const all = this.localPresets();

    if (form.mode === "rename") {
      if (all[bucket][form.old] !== undefined) {
        all[bucket][name] = all[bucket][form.old];

        if (name !== form.old) {
          delete all[bucket][form.old];
        }
      }
    } else {
      const preset = this.currentPreset(form.kind);

      if (!preset) {
        App.showMessage("Sélectionnez d’abord une brique ou un lien.", "info");
        return;
      }

      all[bucket][name] = preset;
    }

    Settings.set("style.presets", all);
    this.nameForm = null;
    this.render();
  },

  applyPreset(kind, name, source) {
    const model = App.getModel();
    const entry = this.presetList(kind, model).find((item) => item.name === name && item.source === source);

    if (!entry) {
      return;
    }

    if (kind === "link") {
      this.applyLink(Style.cleanLink(entry.preset), true);
      return;
    }

    const rule = Style.clean(entry.preset || {});
    const props = {};

    this.PRESET_NODE_KEYS.forEach((key) => {
      props[key] = rule[key] === undefined ? null : rule[key];
    });
    this.apply(props);
  },

  deletePreset(kind, name, source) {
    const bucket = this.presetBucket(kind);

    if (source === "file") {
      this.mutate("Suppression d’un style nommé", (style) => {
        if (style.presets && style.presets[bucket]) {
          delete style.presets[bucket][name];

          if (!Object.keys(style.presets[bucket]).length) {
            delete style.presets[bucket];
          }
        }
      });
    } else {
      const all = this.localPresets();

      delete all[bucket][name];
      Settings.set("style.presets", all);
    }

    this.render();
  },

  // Writes the local presets into the document (style.presets).
  exportPresets() {
    const local = this.localPresets();

    if (!Object.keys(local.nodes).length && !Object.keys(local.links).length) {
      App.showMessage("Aucun style nommé local à copier dans le fichier.", "info");
      return;
    }

    this.mutate("Styles nommés copiés dans le fichier", (style) => {
      const current = this.isPlainObject(style.presets) ? style.presets : {};
      const next = {};

      ["nodes", "links"].forEach((bucket) => {
        const merged = Object.assign({}, current[bucket], local[bucket]);

        if (Object.keys(merged).length) {
          next[bucket] = merged;
        }
      });
      style.presets = next;
    });
    this.render();
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
