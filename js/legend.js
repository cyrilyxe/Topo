"use strict";

// Dynamic legend: types and roles in use (with counts), their styles, filter chips and a compact style editor.
const Legend = {
  KEYS: { collapsed: "topo:legend-collapsed", height: "topo:legend-height", scope: "topo:legend-scope" },
  BUILTIN_TYPES: ["service", "database", "application", "external", "queue", "group"],
  SHAPE_POINTS: {
    rectangle: "1,2 19,2 19,14 1,14",
    hexagon: "5,2 15,2 19,8 15,14 5,14 1,8",
    diamond: "10,1 19,8 10,15 1,8",
    rhomboid: "5,2 19,2 15,14 1,14",
    tag: "1,2 14,2 19,8 14,14 1,14",
    star: "10,1 12.5,6 18.5,6.5 14,10.5 15.5,15.5 10,12.5 4.5,15.5 6,10.5 1.5,6.5 7.5,6",
    octagon: "6,1 14,1 19,5 19,11 14,15 6,15 1,11 1,5",
    "cut-rectangle": "3,2 17,2 19,4 19,12 17,14 3,14 1,12 1,4"
  },
  FIELDS: [
    { key: "color", label: "Fond", kind: "color" },
    { key: "border", label: "Bordure", kind: "color" },
    { key: "borderStyle", label: "Style de bordure", kind: "select" },
    { key: "borderWidth", label: "Épaisseur", kind: "number" },
    { key: "shape", label: "Forme", kind: "select" },
    { key: "textColor", label: "Texte", kind: "color" }
  ],
  LINK_FIELDS: [
    { key: "color", label: "Couleur", kind: "color" },
    { key: "width", label: "Épaisseur", kind: "number" },
    { key: "line", label: "Trait", kind: "select" },
    { key: "arrow", label: "Flèche (cible)", kind: "select" },
    { key: "sourceArrow", label: "Flèche (source)", kind: "select" },
    { key: "textColor", label: "Texte du libellé", kind: "color" }
  ],

  root: null,
  body: null,
  pop: null,
  popTarget: null,
  inited: false,
  model: null,

  init() {
    this.root = document.getElementById("legend");

    if (!this.root || this.inited) {
      return;
    }

    this.inited = true;
    this.body = document.getElementById("legend-body");

    const scope = document.getElementById("legend-scope");

    scope.value = this.load(this.KEYS.scope, "used") === "all" ? "all" : "used";
    scope.addEventListener("change", () => {
      this.save(this.KEYS.scope, scope.value);
      this.render(this.model);
    });

    document.getElementById("legend-toggle").addEventListener("click", () => this.setCollapsed(!this.root.classList.contains("collapsed")));
    this.setCollapsed(this.load(this.KEYS.collapsed, "") === "1", true);
    this.applyHeight(Number(this.load(this.KEYS.height, "")) || 0);
    this.bindResize();

    this.root.addEventListener("click", (event) => this.onClick(event));

    const search = document.getElementById("search");

    if (search) {
      search.addEventListener("input", () => this.renderFilters());
    }

    document.addEventListener("mousedown", (event) => {
      if (this.pop && !this.pop.contains(event.target) && !event.target.closest("[data-lg=\"edit\"], [data-act=\"level-edit\"]")) {
        this.closeEditor();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.pop) {
        this.closeEditor();
      }
    });
  },

  load(key, fallback) {
    try {
      const value = localStorage.getItem(key);

      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  },

  save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // storage unavailable: preference not kept
    }
  },

  resizeGraph() {
    window.dispatchEvent(new Event("resize"));

    if (typeof Graph !== "undefined" && Graph.cy) {
      Graph.cy.resize();
    }
  },

  setCollapsed(collapsed, quiet) {
    this.root.classList.toggle("collapsed", collapsed);

    const button = document.getElementById("legend-toggle");

    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = collapsed ? "▸" : "▾";
    this.save(this.KEYS.collapsed, collapsed ? "1" : "");

    if (!quiet) {
      this.resizeGraph();
    }
  },

  applyHeight(px) {
    if (px > 0) {
      this.body.style.height = `${px}px`;
      this.body.style.maxHeight = "none";
    }
  },

  bindResize() {
    const handle = document.getElementById("legend-resize");

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = this.body.getBoundingClientRect().height;
      const move = (e) => {
        const height = Math.round(Math.min(window.innerHeight * 0.6, Math.max(28, startHeight + startY - e.clientY)));

        this.applyHeight(height);
        this.save(this.KEYS.height, String(height));
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        this.resizeGraph();
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  },

  // ---- data ----

  entries(model) {
    const all = (document.getElementById("legend-scope") || {}).value === "all";
    const style = (model && model.style) || {};
    const counts = { type: new Map(), role: new Map() };

    ((model && model.nodes) || []).forEach((node) => {
      const type = node.type || "node";

      counts.type.set(type, (counts.type.get(type) || 0) + 1);

      if (node.role) {
        counts.role.set(node.role, (counts.role.get(node.role) || 0) + 1);
      }
    });

    const own = (map) => (map && typeof map === "object" ? Object.keys(map) : []);
    const build = (kind, extra) => {
      const names = new Set(counts[kind].keys());

      if (all) {
        extra.forEach((name) => names.add(name));
      }

      const order = (name) => {
        const index = this.BUILTIN_TYPES.indexOf(name);

        return kind === "type" && index >= 0 ? index : 100;
      };

      return Array.from(names).sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((name) => ({ kind, name, count: counts[kind].get(name) || 0 }));
    };

    const linkNames = new Map(Style.linkTypes(model).map((item) => [item.name, item.count]));

    if (all) {
      own(style.links).forEach((name) => linkNames.set(name, linkNames.get(name) || 0));
    }

    return {
      types: build("type", this.BUILTIN_TYPES.concat(own(style.types))),
      roles: build("role", own(style.roles)),
      links: Array.from(linkNames, ([name, count]) => ({ kind: "link", name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    };
  },

  levelMap(model, kind) {
    const style = (model && model.style) || {};

    return kind === "role" ? style.roles : kind === "link" ? style.links : style.types;
  },

  // Key of the style block / French label of a legend kind.
  blockKey(kind) {
    return kind === "role" ? "roles" : kind === "link" ? "links" : "types";
  },

  kindLabel(kind) {
    return kind === "role" ? "rôle" : kind === "link" ? "type de lien" : "type";
  },

  // Validated style entry of a role / type / link type (empty when none).
  entry(kind, value, model) {
    const map = this.levelMap(model || this.model || App.getModel(), kind);

    return kind === "link" ? Style.levelOfLink(map, value) : Style.levelOf(map, value);
  },

  hasStyle(kind, value) {
    return Object.keys(this.entry(kind, value)).length > 0;
  },

  // ---- rendering ----

  render(model) {
    if (!this.root) {
      return;
    }

    this.model = model;

    const { types, roles, links } = this.entries(model);
    const section = (title, kind, list) => `<div class="lg-section"><span class="lg-title">${title}</span>${list.length ? list.map((item) => (item.kind === "link" ? this.linkItemHtml(item, model) : this.itemHtml(item, model))).join("") : "<em class=\"empty\">aucun</em>"}</div>`;

    this.body.innerHTML = `${section("Types", "type", types)}${section("Rôles", "role", roles)}${section("Liens", "link", links)}
      <div class="lg-section lg-misc"><span class="lg-title">Divers</span>
        <span class="lg-plain"><i class="dot collapsed"></i> Groupe replié</span>
        <span class="lg-plain"><i class="dot meta"></i> Méta-arête</span>
        <span class="lg-plain"><i class="dot search"></i> Résultat de recherche</span>
      </div>`;

    this.renderFilters();

    if (this.pop) {
      this.syncEditor();
    }
  },

  // Fill / stroke / shape actually used for a role or type.
  look(kind, value, model) {
    const entry = this.entry(kind, value, model);
    let fill;
    let stroke;

    if (kind === "type") {
      const key = typeof Graph !== "undefined" ? Graph.typeKey(value) : "default";

      fill = value === "group" ? "var(--group-0-fill)" : `var(--node-${key})`;
      stroke = value === "group" ? "var(--group-0-border)" : "transparent";
    } else {
      fill = "transparent";
      stroke = "var(--text-muted)";
    }

    return { fill: entry.color || fill, stroke: entry.border || stroke, shape: entry.shape || "round-rectangle", borderStyle: entry.borderStyle || "solid", borderWidth: entry.borderWidth };
  },

  swatch(look) {
    const width = look.borderWidth === undefined ? 1.5 : Math.max(0.5, Math.min(3, look.borderWidth));
    const dash = look.borderStyle === "dashed" ? " stroke-dasharray=\"3 2\"" : look.borderStyle === "dotted" ? " stroke-dasharray=\"1 2\"" : "";
    const paint = `fill="${escapeHtml(look.fill)}" stroke="${escapeHtml(look.stroke)}" stroke-width="${look.borderStyle === "double" ? Math.max(width, 2.5) : width}"${dash}`;
    let shape;

    if (look.shape === "ellipse") {
      shape = `<ellipse cx="10" cy="8" rx="9" ry="6.5" ${paint}/>`;
    } else if (look.shape === "barrel") {
      shape = `<path d="M3 2 Q0 8 3 14 L17 14 Q20 8 17 2 Z" ${paint}/>`;
    } else if (this.SHAPE_POINTS[look.shape]) {
      shape = `<polygon points="${this.SHAPE_POINTS[look.shape]}" ${paint} stroke-linejoin="round"/>`;
    } else {
      shape = `<rect x="1" y="2" width="18" height="12" rx="4" ${paint}/>`;
    }

    return `<svg class="lg-svg" viewBox="0 0 20 16" width="20" height="16" aria-hidden="true">${shape}</svg>`;
  },

  // Small icon shown next to a type / role that defines `icon` (empty string otherwise).
  iconHtml(kind, value, model) {
    const uri = typeof Icons !== "undefined" ? Icons.resolve(this.entry(kind, value, model).icon, getComputedStyle(document.body).color) : null;

    return uri ? `<img class="lg-icon" alt="" src="${escapeHtml(uri)}" />` : "";
  },

  itemHtml(item, model) {
    const filters = Style.splitFilters(this.searchValue());
    const active = (item.kind === "type" ? filters.types : filters.roles).some((v) => v.toLowerCase() === item.name.toLowerCase());
    const value = escapeHtml(item.name);
    const styled = this.hasStyle(item.kind, item.name);

    return `<span class="lg-item${active ? " active" : ""}${item.count ? "" : " unused"}">
      <button type="button" class="lg-sw" data-lg="filter" data-kind="${item.kind}" data-value="${value}" title="Filtrer sur ${item.kind === "type" ? "ce type" : "ce rôle"} (Maj+clic : cumuler)" aria-pressed="${active}">${this.swatch(this.look(item.kind, item.name, model))}</button>
      <button type="button" class="lg-name" data-lg="edit" data-kind="${item.kind}" data-value="${value}" title="Éditer le style ${item.kind === "type" ? "du type" : "du rôle"}${styled ? " (défini dans le fichier)" : ""}">${this.iconHtml(item.kind, item.name, model)}${value}${styled ? " ✎" : ""}</button>
      ${item.count ? `<small class="lg-count">${item.count}</small>` : ""}</span>`;
  },

  // Legend entry of a link type: stroke preview (click = edit its style) and use count.
  linkItemHtml(item, model) {
    const value = escapeHtml(item.name);
    const entry = this.entry("link", item.name, model);
    const styled = Object.keys(entry).length > 0;

    return `<span class="lg-item lg-link${item.count ? "" : " unused"}">
      <button type="button" class="lg-sw lg-link-sw" data-lg="edit" data-kind="link" data-value="${value}" title="Éditer le style de ce type de lien" aria-label="Éditer le style du type de lien ${value}">${StyleUI.linkPreviewHtml(entry)}</button>
      <button type="button" class="lg-name" data-lg="edit" data-kind="link" data-value="${value}" title="Éditer le style de ce type de lien${styled ? " (défini dans le fichier)" : ""}">${value}${styled ? " ✎" : ""}</button>
      ${item.count ? `<small class="lg-count">${item.count}</small>` : ""}</span>`;
  },

  // ---- filters (written into the search field) ----

  searchValue() {
    const search = document.getElementById("search");

    return search ? search.value : "";
  },

  setSearch(text) {
    const search = document.getElementById("search");

    if (!search) {
      return;
    }

    search.value = text;
    search.dispatchEvent(new Event("input", { bubbles: true }));
  },

  // Click replaces the filter of that key (and toggles it off when it is the only one); additive (Shift) accumulates.
  toggleFilter(kind, value, additive) {
    const parts = Style.splitFilters(this.searchValue());
    const field = kind === "role" ? "roles" : "types";
    const same = (v) => v.toLowerCase() === value.toLowerCase();
    const present = parts[field].some(same);

    if (additive) {
      parts[field] = present ? parts[field].filter((v) => !same(v)) : parts[field].concat(value);
    } else {
      parts[field] = present && parts[field].length === 1 ? [] : [value];
    }

    this.setSearch(Style.buildSearch(parts));
  },

  renderFilters() {
    const box = document.getElementById("legend-filter");

    if (!box) {
      return;
    }

    const parts = Style.splitFilters(this.searchValue());
    const chips = parts.types.map((v) => ({ kind: "type", value: v })).concat(parts.roles.map((v) => ({ kind: "role", value: v })));

    box.innerHTML = chips.map((chip) => `<button type="button" class="lg-chip" data-lg="unfilter" data-kind="${chip.kind}" data-value="${escapeHtml(chip.value)}" title="Retirer ce filtre">${chip.kind}:${escapeHtml(chip.value)} ✕</button>`).join("")
      + (this.searchValue().trim() ? "<button type=\"button\" class=\"lg-chip lg-clear\" data-lg=\"clear\" title=\"Effacer la recherche et les filtres\" aria-label=\"Effacer la recherche et les filtres\">✕</button>" : "");

    this.body.querySelectorAll(".lg-item:not(.lg-link)").forEach((element) => {
      const button = element.querySelector(".lg-sw");
      const list = button.dataset.kind === "type" ? parts.types : parts.roles;
      const on = list.some((v) => v.toLowerCase() === button.dataset.value.toLowerCase());

      element.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  },

  onClick(event) {
    const target = event.target.closest("[data-lg]");

    if (!target) {
      return;
    }

    const { lg, kind, value } = target.dataset;

    if (lg === "filter") {
      this.toggleFilter(kind, value, event.shiftKey);
    } else if (lg === "unfilter") {
      this.toggleFilter(kind, value, true);
    } else if (lg === "clear") {
      this.setSearch("");
    } else if (lg === "edit") {
      this.openStyleEditor(kind, value, target);
    }
  },

  // ---- writing style.roles / style.types ----

  setStyle(kind, value, patch) {
    const key = this.blockKey(kind);

    StyleUI.mutate(`Style du ${this.kindLabel(kind)} « ${value} »`, (style) => {
      const map = style[key] && typeof style[key] === "object" ? style[key] : {};
      const entry = Object.assign({}, map[value] || {});

      Object.keys(patch).forEach((name) => {
        const v = patch[name];

        if (v === null || v === undefined || v === false || v === "") {
          delete entry[name];
        } else {
          entry[name] = v;
        }
      });

      if (Object.keys(entry).length) {
        map[value] = entry;
      } else {
        delete map[value];
      }

      style[key] = map;
    });
  },

  resetStyle(kind, value) {
    const key = this.blockKey(kind);

    if (!this.hasStyle(kind, value) && !Object.prototype.hasOwnProperty.call(this.levelMap(App.getModel(), kind) || {}, value)) {
      return;
    }

    StyleUI.mutate(`Style du ${this.kindLabel(kind)} « ${value} » : défaut`, (style) => {
      if (style[key]) {
        delete style[key][value];
      }
    });
  },

  // ---- compact style editor (popover) ----

  fallbackColor(kind, value, field) {
    if (kind === "link") {
      return field === "color" ? StyleUI.toHex(Graph.token("--edge", "#8b98ad")) || "#8b98ad" : "#475569";
    }

    if (field === "color") {
      const type = kind === "type" ? value : "default";
      const key = typeof Graph !== "undefined" ? Graph.typeKey(type) : "default";

      return StyleUI.toHex(Graph.token(`--node-${key}`, StyleUI.TYPE_DEFAULTS[key])) || "#0369a1";
    }

    return field === "border" ? "#ffffff" : "#0f172a";
  },

  fieldHtml(field, kind, value, entry) {
    const current = entry[field.key];

    if (field.kind === "color") {
      const hex = StyleUI.toHex(current) || this.fallbackColor(kind, value, field.key);

      return `<div class="lg-field"><span>${field.label}</span><span class="lg-row"><input type="color" data-k="${field.key}" value="${escapeHtml(hex)}" /><input type="text" class="hex-input" data-k="${field.key}" data-hex="1" maxlength="9" spellcheck="false" autocomplete="off" value="${escapeHtml(current ? hex : "")}" placeholder="${escapeHtml(hex)}" aria-label="${field.label} (hexadécimal)" /><button type="button" data-lg-clear="${field.key}" title="Revenir au défaut">⟲</button></span></div>`;
    }

    if (field.kind === "number") {
      return `<div class="lg-field"><span>${field.label}</span><span class="lg-row"><input type="number" data-k="${field.key}" min="${kind === "link" ? 1 : 0}" max="8" step="1" value="${current === undefined ? "" : escapeHtml(current)}" placeholder="défaut" /></span></div>`;
    }

    const options = { shape: Style.SHAPES, line: Style.LINK_LINES, arrow: Style.LINK_ARROWS, sourceArrow: Style.LINK_ARROWS }[field.key] || Style.BORDER_STYLES;

    return `<div class="lg-field"><span>${field.label}</span><span class="lg-row"><select data-k="${field.key}"><option value="">(défaut)</option>${options.map((name) => `<option value="${name}" ${current === name ? "selected" : ""}>${name}</option>`).join("")}</select></span></div>`;
  },

  // Opens the compact editor of a role / type style under (above) `anchor`.
  openStyleEditor(kind, value, anchor) {
    if (kind !== "role" && kind !== "type" && kind !== "link") {
      return;
    }

    this.closeEditor();

    const model = App.getModel();
    const entry = this.entry(kind, value, model);
    const pop = document.createElement("div");
    const isLink = kind === "link";
    const label = this.kindLabel(kind);

    pop.className = "legend-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", `Style du ${label} ${value}`);
    pop.innerHTML = `<div class="lg-pop-head"><strong>${label.charAt(0).toUpperCase()}${label.slice(1)} « ${escapeHtml(value)} »</strong><button type="button" data-lg-close="1" aria-label="Fermer">✕</button></div>
      <p class="lg-hint">${isLink ? "S’applique à tous les liens de ce type (le style propre à un lien reste prioritaire)." : `S’applique à toutes les briques ${kind === "role" ? "de ce rôle" : "de ce type"} (une règle de brique reste prioritaire).`}</p>
      ${(isLink ? this.LINK_FIELDS : this.FIELDS).map((field) => this.fieldHtml(field, kind, value, entry)).join("")}
      ${isLink ? "" : `<div class="lg-row lg-flags">
        <label><input type="checkbox" data-k="bold" ${entry.bold ? "checked" : ""} /> Gras</label>
        <label><input type="checkbox" data-k="italic" ${entry.italic ? "checked" : ""} /> Italique</label>
      </div>`}
      ${isLink ? "" : `<div class="lg-field lg-icon-field"><span>Icône</span>${Icons.pickerHtml(entry.icon, entry.iconOpacity)}</div>`}
      <div class="lg-pop-actions"><button type="button" data-lg-reset="1" title="Supprime le style de ce ${label} du fichier">Défaut</button></div>`;

    document.body.appendChild(pop);
    this.pop = pop;
    this.popTarget = { kind, value };

    pop.addEventListener("input", (event) => this.onEditorInput(event));
    pop.addEventListener("change", (event) => this.onEditorChange(event));
    pop.addEventListener("click", (event) => this.onEditorClick(event));

    if (!isLink) {
      Icons.bind(pop, (patch) => {
        const next = Object.assign({}, this.entry(kind, value, App.getModel()), patch);
        const picker = pop.querySelector(".icon-picker");

        this.setStyle(kind, value, patch);

        if (picker && picker.isConnected) {
          picker.outerHTML = Icons.pickerHtml(next.icon, next.iconOpacity);
        }
      });
    }
    this.position(pop, anchor);
  },

  position(pop, anchor) {
    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 40, top: window.innerHeight - 40, bottom: window.innerHeight - 20 };
    const width = pop.offsetWidth || 280;
    const height = pop.offsetHeight || 300;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const above = rect.top - height - 6;
    const top = above >= 8 ? above : Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - height - 8));

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  },

  closeEditor() {
    if (this.pop) {
      this.pop.remove();
    }

    this.pop = null;
    this.popTarget = null;
  },

  // Refreshes the fields from the model (undo, external edit) without stealing focus.
  syncEditor() {
    if (!this.pop || !this.popTarget) {
      return;
    }

    const { kind, value } = this.popTarget;
    const entry = this.entry(kind, value, this.model);

    this.pop.querySelectorAll("[data-k]").forEach((input) => {
      if (input === document.activeElement) {
        return;
      }

      const key = input.dataset.k;
      const current = entry[key];

      if (input.type === "checkbox") {
        input.checked = Boolean(current);
      } else if (input.type === "color") {
        input.value = StyleUI.toHex(current) || this.fallbackColor(kind, value, key);
      } else if (input.dataset.hex) {
        input.value = current ? StyleUI.toHex(current) || "" : "";
      } else {
        input.value = current === undefined ? "" : String(current);
      }
    });
  },

  onEditorInput(event) {
    const input = event.target;

    if (input.type === "color") {
      const hexInput = this.pop.querySelector(`input[data-hex][data-k="${input.dataset.k}"]`);

      if (hexInput) {
        hexInput.value = input.value;
      }
    } else if (input.dataset.hex) {
      input.classList.toggle("invalid", !StyleUI.hexFrom(input.value) && input.value.trim() !== "");
    }
  },

  onEditorChange(event) {
    const input = event.target;
    const key = input.dataset.k;

    if (!key || !this.popTarget) {
      return;
    }

    const { kind, value } = this.popTarget;
    let patch;

    if (input.type === "checkbox") {
      patch = { [key]: input.checked };
    } else if (input.type === "color") {
      patch = { [key]: input.value };
    } else if (input.dataset.hex) {
      const hex = StyleUI.hexFrom(input.value);

      if (input.value.trim() === "") {
        patch = { [key]: null };
      } else if (hex) {
        patch = { [key]: hex };
      } else {
        input.classList.add("invalid");
        return;
      }

      input.classList.remove("invalid");
    } else if (input.type === "number") {
      patch = { [key]: input.value === "" ? null : Math.min(8, Math.max(kind === "link" ? 1 : 0, Number(input.value))) };
    } else {
      patch = { [key]: input.value || null };
    }

    if (patch[key] && typeof patch[key] === "string" && /^#/.test(patch[key])) {
      StyleUI.pushRecent(patch[key]);
    }

    this.setStyle(kind, value, patch);
  },

  onEditorClick(event) {
    const button = event.target.closest("button");

    if (!button || !this.popTarget) {
      return;
    }

    const { kind, value } = this.popTarget;

    if (button.dataset.lgClose) {
      this.closeEditor();
    } else if (button.dataset.lgReset) {
      this.resetStyle(kind, value);
    } else if (button.dataset.lgClear) {
      this.setStyle(kind, value, { [button.dataset.lgClear]: null });
    }
  }
};
