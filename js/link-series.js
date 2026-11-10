"use strict";

// Link series: a DRAFT of several links. Drafts are temporary Cytoscape edges (class link-draft, ids "__draft:...")
// outside the YAML, tuned live in a floating non-modal panel, and written in one go (one history entry).
const LinkSeries = {
  KIND: "link-series",
  state: null,
  closing: null,

  isActive() {
    return Boolean(this.state);
  },

  // ---- pairs ----

  // Adds a draft pair (opens the panel and arms `from` as the series source on the first one).
  add(from, to) {
    if (!from || !to || from === to) {
      return false;
    }

    if (!this.state) {
      this.open(from);
    }

    const s = this.state;

    if (s.pairs.some((p) => p.from === from && p.to === to)) {
      App.showMessage("Ce lien est déjà dans la série.", "info");
      return false;
    }

    const pair = { from, to };

    s.pairs.push(pair);
    this.addDraft(pair);
    this.renderList();

    return true;
  },

  // Arms `id` as the series source, or releases it (null): aura and ghost line follow.
  setSource(id) {
    if (!this.state) {
      return;
    }

    this.state.from = id || null;

    try {
      Tools.endSeries();
      Tools.markSeries();
    } catch (error) { /* tools not ready */ }

    this.updateHint();
  },

  updateHint() {
    const s = this.state;
    const hint = s && s.panel && s.panel.querySelector("[data-ls-hint]");

    if (hint) {
      hint.textContent = s.from ? `Source : ${this.nameOf(s.from)} — clic droit pour changer` : "Choisissez une source";
    }
  },

  // Keeps the panel checkbox in step with links.multiAnchor.
  syncAnchor() {
    const box = this.state && this.state.panel && this.state.panel.querySelector("[data-ls-anchor]");

    if (box) {
      box.checked = Boolean(Settings.get("links.multiAnchor"));
    }
  },

  remove(index) {
    const s = this.state;
    const pair = s && s.pairs[index];

    if (!pair) {
      return;
    }

    s.pairs.splice(index, 1);

    if (typeof Graph !== "undefined" && Graph.cy) {
      Graph.cy.getElementById(this.draftId(pair)).remove();
    }

    this.renderList();
  },

  // ---- draft edges ----

  draftId(pair) {
    return `__draft:${pair.from}=>${pair.to}`;
  },

  typeStyle() {
    const model = App.getModel();

    return Style.levelOfLink(model && model.style && model.style.links, this.state.type);
  },

  // Style the drafts are drawn with: existing type style, then the style typed in the panel.
  effectiveStyle() {
    return Object.assign({}, this.typeStyle(), Style.cleanLink(this.state.style));
  },

  addDraft(pair) {
    const cy = typeof Graph !== "undefined" ? Graph.cy : null;
    const model = App.getModel();

    if (!cy || !model || !this.state) {
      return;
    }

    const visible = (id) => (model.byId.has(id) ? Model.visibleAncestor(id, model, App.collapsed) : null);
    const source = visible(pair.from);
    const target = visible(pair.to);
    const id = this.draftId(pair);

    if (!source || !target || source === target || !cy.getElementById(source).nonempty() || !cy.getElementById(target).nonempty() || cy.getElementById(id).nonempty()) {
      return;
    }

    const edge = cy.add({
      group: "edges",
      data: { id, source, target, label: this.state.label, linkStyle: this.effectiveStyle(), isDraft: true },
      classes: "link-draft",
      selectable: false,
      grabbable: false
    });

    Graph.applyEdgeLinkStyle(edge);
  },

  // Called by Graph.refresh after it rebuilt the elements.
  reinject() {
    if (this.state) {
      this.state.pairs.forEach((pair) => this.addDraft(pair));
    }
  },

  // Pushes label / style of the panel to every draft edge.
  refreshDrafts() {
    if (!this.state || typeof Graph === "undefined" || !Graph.cy) {
      return;
    }

    const style = this.effectiveStyle();

    Graph.cy.edges(".link-draft").forEach((edge) => {
      edge.data("label", this.state.label);
      edge.data("linkStyle", style);
      Graph.applyEdgeLinkStyle(edge);
    });
  },

  startAnimation() {
    this.state.timer = setInterval(() => {
      if (typeof Graph !== "undefined" && Graph.cy) {
        Graph.cy.edges(".link-draft").toggleClass("draft-dim");
      }
    }, 500);
  },

  // ---- panel ----

  open(from) {
    this.state = { from, pairs: [], type: "", label: "", style: {}, styleOpen: false, timer: null, panel: null };
    this.buildPanel();
    this.startAnimation();
  },

  buildPanel() {
    const s = this.state;
    const suggest = Forms.linkSuggestions(App.getModel());
    const panel = document.createElement("div");

    panel.className = "float-win link-series-win";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Série de liens");
    panel.innerHTML = `
      <div class="float-win-header">
        <h2>Série de liens</h2>
        <button type="button" class="icon-btn" data-ls="close" aria-label="Fermer la série">✕</button>
      </div>
      <div class="float-win-body">
        <p class="ls-count"><strong data-ls-count></strong> <small data-ls-hint></small></p>
        <label class="ls-anchor"><input type="checkbox" data-ls-anchor${Settings.get("links.multiAnchor") ? " checked" : ""} /> Garder la source</label>
        <ul class="ls-list" data-ls-list></ul>
        ${Forms.field("Type", Forms.combo(`<input type="text" name="ls-type" list="ls-types" autocomplete="off" /><datalist id="ls-types">${Forms.options(suggest.types)}</datalist>`))}
        ${Forms.field("Libellé", Forms.combo(`<input type="text" name="ls-label" list="ls-labels" autocomplete="off" /><datalist id="ls-labels">${Forms.options(suggest.labels)}</datalist>`))}
        <button type="button" class="ls-style-toggle" data-ls="style-toggle" aria-expanded="false">▸ Style</button>
        <div class="ls-style" data-ls-style hidden></div>
        <p class="ls-note" data-ls-note hidden></p>
        <div class="ls-actions">
          <button type="button" data-ls="cancel">Annuler</button>
          <button type="button" class="primary" data-ls="create">Créer</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    s.panel = panel;

    Forms.bindMove(panel, this.KIND, panel, panel.querySelector(".float-win-header"));

    panel.addEventListener("click", (event) => this.onClick(event));
    panel.addEventListener("input", (event) => this.onInput(event));
    panel.addEventListener("change", (event) => this.onChange(event));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.requestClose();
      }
    });
    this.renderList();
    this.updateHint();
  },

  nameOf(id) {
    const model = App.getModel();

    return model && model.byId.has(id) ? model.byId.get(id).label : id;
  },

  renderList() {
    const s = this.state;

    if (!s || !s.panel) {
      return;
    }

    const n = s.pairs.length;

    s.panel.querySelector("[data-ls-count]").textContent = `${n} lien${n > 1 ? "s" : ""}`;
    s.panel.querySelector("[data-ls-list]").innerHTML = s.pairs.map((pair, index) => (
      `<li><span>${escapeHtml(this.nameOf(pair.from))} → ${escapeHtml(this.nameOf(pair.to))}</span><button type="button" data-ls="remove" data-i="${index}" title="Retirer ce lien de la série" aria-label="Retirer">✕</button></li>`
    )).join("");

    const create = s.panel.querySelector("[data-ls=create]");

    create.textContent = `Créer ${n} lien${n > 1 ? "s" : ""}`;
    create.disabled = n === 0;
    this.updateNote();
  },

  // "Applies to the k existing links of that type" when the type style is going to be changed.
  updateNote() {
    const s = this.state;

    if (!s || !s.panel) {
      return;
    }

    const model = App.getModel();
    const k = s.type && Object.keys(Style.cleanLink(s.style)).length && model ? model.links.filter((l) => l.type === s.type).length : 0;
    const note = s.panel.querySelector("[data-ls-note]");

    note.hidden = !k;
    note.textContent = k ? `Le style s’applique aussi aux ${k} lien${k > 1 ? "s" : ""} existant${k > 1 ? "s" : ""} de ce type.` : "";
  },

  // ---- style editor ----

  renderStyle() {
    const s = this.state;
    const box = s && s.panel && s.panel.querySelector("[data-ls-style]");

    if (!box) {
      return;
    }

    const model = App.getModel();
    const shown = Object.assign({}, this.typeStyle(), Style.cleanLink(s.style));
    const color = StyleUI.toHex(shown.color) || StyleUI.toHex(Graph.token("--edge", "#8b98ad")) || "#8b98ad";
    const width = shown.width || 2;
    const presets = StyleUI.presetList("link", model);
    const recents = StyleUI.recentLinks();

    box.innerHTML = `
      <div class="style-field"><span>Couleur</span>${StyleUI.colorField("ls-color", color, "ls-clear", "color")}</div>
      <label>Épaisseur : <span data-ls-width>${width} px</span> <input type="range" min="1" max="8" step="1" value="${width}" data-ls-prop="width" /></label>
      <div class="style-field"><span>Trait</span>${this.select("line", Style.LINK_LINES, shown.line || "solid")}</div>
      <div class="style-field"><span>Flèche (cible)</span>${this.select("arrow", Style.LINK_ARROWS, shown.arrow || "triangle")}</div>
      <div class="style-field"><span>Flèche (source)</span>${this.select("sourceArrow", Style.LINK_ARROWS, shown.sourceArrow || "none")}</div>
      <div class="style-field"><span>Texte du libellé</span>${StyleUI.colorField("ls-text", shown.textColor || "#475569", "ls-clear", "textColor")}</div>
      <div class="actions"><button type="button" data-ls="style-reset">${s.type ? "Revenir au défaut du type" : "Par défaut"}</button></div>
      ${presets.length ? `<h4>Styles nommés</h4><ul class="preset-list">${presets.map((entry, i) => `<li>${StyleUI.presetChip("link", entry.preset)} <span class="preset-name">${escapeHtml(entry.name)}</span> <button type="button" data-ls="preset" data-i="${i}">Appliquer</button></li>`).join("")}</ul>` : ""}
      ${recents.length ? `<h4>Derniers styles</h4><div class="link-recents">${recents.map((item, i) => `<button type="button" class="link-recent" data-ls="recent" data-i="${i}" title="${escapeHtml(JSON.stringify(item))}">${StyleUI.linkPreviewHtml(item)} <small>${escapeHtml(item.arrow || "")}</small></button>`).join("")}</div>` : ""}`;
  },

  select(prop, options, value) {
    return `<select data-ls-prop="${prop}" aria-label="${prop}">${options.map((name) => `<option value="${name}" ${name === value ? "selected" : ""}>${name}</option>`).join("")}</select>`;
  },

  patch(prop, value) {
    const s = this.state;

    if (!s) {
      return;
    }

    if (value === null || value === undefined || value === "") {
      delete s.style[prop];
    } else {
      s.style[prop] = value;
    }

    this.refreshDrafts();
    this.updateNote();
  },

  setStyle(style) {
    this.state.style = Style.cleanLink(style);
    this.refreshDrafts();
    this.updateNote();
    this.renderStyle();
  },

  // ---- events ----

  onInput(event) {
    const s = this.state;
    const target = event.target;

    if (!s) {
      return;
    }

    if (target.name === "ls-type") {
      s.type = target.value.trim();
      this.refreshDrafts();
      this.updateNote();

      if (s.styleOpen) {
        this.renderStyle();
      }
    } else if (target.name === "ls-label") {
      s.label = target.value.trim();
      this.refreshDrafts();
    } else if (target.type === "color" && target.id) {
      const prop = target.id === "ls-color" ? "color" : "textColor";
      const hex = s.panel.querySelector(`#${target.id}-hex`);

      if (hex) {
        hex.value = target.value;
      }

      this.patch(prop, target.value);
    } else if (target.dataset.lsProp === "width") {
      s.panel.querySelector("[data-ls-width]").textContent = `${target.value} px`;
      this.patch("width", Number(target.value));
    }
  },

  onChange(event) {
    const target = event.target;

    if (!this.state) {
      return;
    }

    if (target.dataset.lsAnchor !== undefined) {
      Settings.set("links.multiAnchor", target.checked, Settings.source("links.multiAnchor") === "document" ? "document" : "local");
    } else if (target.classList.contains("hex-input")) {
      const hex = StyleUI.hexFrom(target.value);
      const prop = target.id === "ls-color-hex" ? "color" : "textColor";

      if (hex) {
        target.classList.remove("invalid");
        this.patch(prop, hex);
        this.renderStyle();
      } else if (target.value.trim() === "") {
        this.patch(prop, null);
        this.renderStyle();
      } else {
        target.classList.add("invalid");
      }
    } else if (target.tagName === "SELECT" && target.dataset.lsProp) {
      this.patch(target.dataset.lsProp, target.value);
    }
  },

  onClick(event) {
    const button = event.target.closest("button");
    const s = this.state;

    if (!button || !s) {
      return;
    }

    const act = button.dataset.ls;
    const index = Number(button.dataset.i);

    if (act === "close" || act === "cancel") {
      this.requestClose();
    } else if (act === "create") {
      this.create();
    } else if (act === "remove") {
      this.remove(index);
    } else if (act === "style-toggle") {
      s.styleOpen = !s.styleOpen;
      button.textContent = `${s.styleOpen ? "▾" : "▸"} Style`;
      button.setAttribute("aria-expanded", String(s.styleOpen));
      s.panel.querySelector("[data-ls-style]").hidden = !s.styleOpen;

      if (s.styleOpen) {
        this.renderStyle();
      }
    } else if (act === "style-reset") {
      this.setStyle({});
    } else if (act === "preset") {
      const entry = StyleUI.presetList("link", App.getModel())[index];

      if (entry) {
        this.setStyle(entry.preset);
      }
    } else if (act === "recent") {
      const item = StyleUI.recentLinks()[index];

      if (item) {
        this.setStyle(item);
      }
    } else if (button.dataset.act === "ls-clear") {
      this.patch(button.dataset.prop, null);
      this.renderStyle();
    }
  },

  // ---- end of the series ----

  // One history entry ("Ajout de n liens"); type given + style changed: style goes to style.links[type].
  create() {
    const s = this.state;

    if (!s || !s.pairs.length) {
      return;
    }

    const model = App.getModel();
    const pairs = s.pairs.filter((p) => model.byId.has(p.from) && model.byId.has(p.to));
    const style = Style.cleanLink(s.style);
    const n = pairs.length;

    if (!n) {
      App.showMessage("Les briques de la série n’existent plus.", "warning");
      return;
    }

    const done = App.edit(`Ajout de ${n} lien${n > 1 ? "s" : ""}`, (text) => DocEdit.addLinks(text, pairs, { type: s.type, label: s.label, style }));

    if (done) {
      StyleUI.pushRecentLink(style);
      App.showMessage(`${n} lien${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""}.`, "success");
      this.finish();
    }
  },

  // Asks for confirmation when drafts exist. Resolves true when the series is closed.
  requestClose() {
    if (!this.state) {
      return Promise.resolve(true);
    }

    if (this.closing) {
      return this.closing;
    }

    this.closing = (async () => {
      let proceed = true;

      try {
        const n = this.state ? this.state.pairs.length : 0;

        if (n > 0) {
          const answer = await Forms.confirm({
            title: "Annuler la série de liens",
            html: `Êtes-vous sûr de vouloir annuler la création des ${n} liens ?`,
            okLabel: "Oui, annuler",
            danger: true
          });

          proceed = Boolean(answer);
        }
      } catch (error) {
        proceed = true;
      } finally {
        this.closing = null;

        if (proceed) {
          this.finish();
        }
      }

      return proceed;
    })();

    return this.closing;
  },

  // Always cleans drafts, timer, panel and armed source, whatever the state.
  finish() {
    const s = this.state;

    this.state = null;

    try {
      if (s && s.timer) {
        clearInterval(s.timer);
      }
    } catch (error) { /* nothing to stop */ }

    try {
      if (typeof Graph !== "undefined" && Graph.cy) {
        Graph.cy.edges(".link-draft").remove();
      }
    } catch (error) { /* graph already gone */ }

    try {
      if (s && s.panel) {
        s.panel.remove();
      }
    } catch (error) { /* panel already gone */ }

    try {
      Tools.endSeries();
    } catch (error) { /* tools not ready */ }
  }
};
