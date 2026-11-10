"use strict";

// Reusable modal dialogs (brick, link, confirmation). Every entry point returns a Promise
// resolving to the collected value, or null when cancelled.
const Forms = {
  active: null,
  BASE_TYPES: ["service", "database", "application", "external", "queue", "group"],
  FOCUSABLE: "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",

  isOpen() {
    return Boolean(this.active);
  },

  // opts: { title, body, okLabel, danger, validate(form) -> string, collect(form) -> value, setup(form) }
  dialog(opts) {
    this.closeActive(null);

    return new Promise((resolve) => {
      const modal = document.createElement("div");

      modal.className = "modal forms-modal";
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <form class="modal-dialog forms-dialog" role="dialog" aria-modal="true" aria-labelledby="forms-title" novalidate>
          <div class="modal-header"><h2 id="forms-title">${escapeHtml(opts.title)}</h2></div>
          <div class="modal-body forms-body">${opts.body}</div>
          <div class="forms-error" role="alert"></div>
          <div class="forms-footer">
            <button type="button" data-act="cancel">Annuler</button>
            <button type="submit" class="forms-ok${opts.danger ? " danger" : ""}">${escapeHtml(opts.okLabel || "Valider")}</button>
          </div>
        </form>`;

      document.body.appendChild(modal);

      const form = modal.querySelector("form");
      const ok = modal.querySelector(".forms-ok");
      const errorBox = modal.querySelector(".forms-error");
      const session = { modal, form, resolve, lastFocus: document.activeElement };

      const check = () => {
        const error = opts.validate ? opts.validate(form) : "";

        errorBox.textContent = error || "";
        ok.disabled = Boolean(error);

        return !error;
      };

      form.addEventListener("input", check);
      form.addEventListener("change", check);
      form.addEventListener("submit", (event) => {
        event.preventDefault();

        if (check()) {
          this.closeActive(opts.collect ? opts.collect(form) : {});
        }
      });
      form.addEventListener("click", (event) => {
        const clear = event.target.closest("button[data-act=clear]");
        const input = clear && clear.parentElement.querySelector("input");

        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();

          if (typeof input.showPicker === "function") {
            try { input.showPicker(); } catch (error) { /* no picker without a user gesture */ }
          }
        }
      });
      modal.querySelector("[data-act=cancel]").addEventListener("click", () => this.closeActive(null));
      modal.querySelector(".modal-backdrop").addEventListener("mousedown", () => this.closeActive(null));
      modal.addEventListener("keydown", (event) => {
        event.stopPropagation();

        if (event.key === "Escape") {
          event.preventDefault();
          this.closeActive(null);
        } else if (event.key === "Tab") {
          this.trapFocus(event, form);
        }
      });

      this.active = session;
      this.bindMove(modal, opts.kind || "dialog");

      if (opts.setup) {
        opts.setup(form, check);
      }

      check();

      const first = form.querySelector("[data-autofocus]") || form.querySelector("input:not([readonly]), select, textarea") || ok;

      first.focus();

      if (first.select) {
        first.select();
      }
    });
  },

  closeActive(value) {
    const session = this.active;

    if (!session) {
      return;
    }

    this.active = null;
    session.modal.remove();

    if (session.lastFocus && typeof session.lastFocus.focus === "function") {
      session.lastFocus.focus();
    }

    session.resolve(value);
  },

  // ---- movable dialogs (drag the title bar; last offset remembered per form kind) ----

  POS_KEY: "topo:form-pos:",

  readPos(kind) {
    try {
      const pos = JSON.parse(localStorage.getItem(this.POS_KEY + kind) || "null");

      return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null;
    } catch (error) {
      return null;
    }
  },

  savePos(kind, pos) {
    try {
      if (pos) {
        localStorage.setItem(this.POS_KEY + kind, JSON.stringify(pos));
      } else {
        localStorage.removeItem(this.POS_KEY + kind);
      }
    } catch (error) {
      // storage unavailable: position just forgotten
    }
  },

  // Offsets are relative to the centred position; the dialog always stays fully inside the window.
  bindMove(modal, kind) {
    const dialog = modal.querySelector(".forms-dialog");
    const header = modal.querySelector(".modal-header");
    const pos = { x: 0, y: 0 };
    const place = (x, y) => {
      const rect = dialog.getBoundingClientRect();
      const baseLeft = rect.left - pos.x;
      const baseTop = rect.top - pos.y;

      pos.x = Math.round(Math.min(Math.max(x, -baseLeft), Math.max(-baseLeft, window.innerWidth - rect.width - baseLeft)));
      pos.y = Math.round(Math.min(Math.max(y, -baseTop), Math.max(-baseTop, window.innerHeight - rect.height - baseTop)));
      dialog.style.transform = pos.x || pos.y ? `translate(${pos.x}px, ${pos.y}px)` : "";
    };
    const saved = this.readPos(kind);

    header.classList.add("forms-drag");

    if (saved) {
      place(saved.x, saved.y);
    }

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button, input, select, textarea, a")) {
        return;
      }

      const startX = event.clientX - pos.x;
      const startY = event.clientY - pos.y;
      const move = (e) => place(e.clientX - startX, e.clientY - startY);
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        this.savePos(kind, { x: pos.x, y: pos.y });
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      event.preventDefault();
    });
    header.addEventListener("dblclick", (event) => {
      if (!event.target.closest("button, input, select, textarea, a")) {
        place(0, 0);
        this.savePos(kind, null);
      }
    });
  },

  trapFocus(event, form) {
    const items = Array.from(form.querySelectorAll(this.FOCUSABLE)).filter((el) => !el.disabled && !el.readOnly);

    if (!items.length) {
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  // ---- helpers ----

  slug(text) {
    return DocEdit.slugify(text);
  },

  // Id proposed by the "ids.scheme" setting for a brick that is being created.
  proposeId(label, type, parentLocal, taken) {
    return DocEdit.autoId(Settings.get("ids.scheme") || "slug", { label, type, parent: parentLocal }, taken);
  },

  // A suggestion field: the control plus a ✕ button that empties it to show every option again.
  combo(control) {
    return `<span class="forms-combo">${control}<button type="button" class="forms-clear" data-act="clear" tabindex="-1" title="Vider le champ pour revoir toutes les suggestions" aria-label="Vider le champ">✕</button></span>`;
  },

  takenIds(model, exceptId) {
    const taken = new Set();

    (model ? model.nodes : []).forEach((node) => {
      if (node.id !== exceptId) {
        [node.id, node.localId, node.qualifiedId].forEach((value) => taken.add(value));
      }
    });

    return taken;
  },

  uniqueSlug(base, taken) {
    const root = base || "brique";
    let candidate = root;

    for (let n = 2; taken.has(candidate); n += 1) {
      candidate = `${root}-${n}`;
    }

    return candidate;
  },

  field(label, control, hint) {
    return `<label class="forms-field"><span>${escapeHtml(label)}</span>${control}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</label>`;
  },

  nodeOptions(model) {
    return (model ? model.nodes : []).map((node) => (
      `<option value="${escapeHtml(node.id)}" label="${escapeHtml(Model.pathLabel(node.id, model))}"></option>`
    )).join("");
  },

  // Brick id typed in a link field (id, qualified id or displayed path), or null.
  resolveNodeText(model, text) {
    const value = String(text || "").trim();
    const nodes = model ? model.nodes : [];
    const hit = nodes.find((node) => node.id === value) || nodes.find((node) => node.qualifiedId === value) ||
      nodes.find((node) => Model.pathLabel(node.id, model) === value);

    return hit ? hit.id : null;
  },

  metaRow(key, value) {
    return `<div class="forms-meta-row">
      ${this.combo(`<input type="text" data-meta="key" list="forms-meta-keys" placeholder="clé" value="${escapeHtml(key)}" aria-label="Clé de métadonnée" autocomplete="off" />`)}
      ${this.combo(`<input type="text" data-meta="value" list="forms-meta-values" placeholder="valeur" value="${escapeHtml(value)}" aria-label="Valeur de métadonnée" autocomplete="off" />`)}
      <button type="button" data-act="meta-remove" title="Retirer cette métadonnée" aria-label="Retirer">✕</button>
    </div>`;
  },

  // Meta keys that are structure, not user data: never suggested.
  META_RESERVED: ["show", "afficher", "links", "liens", "card", "source", "sourceId"],

  // Pure. Suggestions for meta fields: { keys, values } where keys = project keys (most used first) then the
  // `preset` keys (setting meta.keys), de-duplicated and without reserved keys; values[key] = values already used
  // for that key (most used first).
  metaSuggestions(model, preset) {
    const configured = preset !== undefined ? preset : (typeof Settings !== "undefined" ? Settings.get("meta.keys") : []);
    const counts = new Map();
    const values = {};
    const rank = (map) => Array.from(map, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((item) => item.name);

    ((model && model.nodes) || []).forEach((node) => {
      Object.entries((node && node.meta) || {}).forEach(([key, value]) => {
        if (this.META_RESERVED.includes(key)) {
          return;
        }

        counts.set(key, (counts.get(key) || 0) + 1);

        if (["string", "number", "boolean"].includes(typeof value) && String(value) !== "") {
          const bucket = values[key] || (values[key] = new Map());

          bucket.set(String(value), (bucket.get(String(value)) || 0) + 1);
        }
      });
    });

    const keys = rank(counts);

    (Array.isArray(configured) ? configured : []).forEach((key) => {
      if (key && !this.META_RESERVED.includes(key) && !keys.includes(key)) {
        keys.push(key);
      }
    });

    Object.keys(values).forEach((key) => {
      values[key] = rank(values[key]);
    });

    return { keys, values };
  },

  // Pure. Suggestions for the link form: link types (used ones first, then those only styled in style.links)
  // and labels already used (most used first).
  linkSuggestions(model) {
    const used = typeof Style !== "undefined" ? Style.linkTypes(model).map((item) => item.name) : [];
    const styled = model && model.style && model.style.links && typeof model.style.links === "object" ? Object.keys(model.style.links) : [];
    const labels = new Map();

    ((model && model.links) || []).forEach((link) => {
      if (link.label) {
        labels.set(link.label, (labels.get(link.label) || 0) + 1);
      }
    });

    return {
      types: Array.from(new Set([...used, ...styled])),
      labels: Array.from(labels, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((item) => item.name)
    };
  },

  options(list) {
    return list.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");
  },

  scalarMeta(node) {
    const out = {};

    Object.entries((node && node.meta) || {}).forEach(([key, value]) => {
      if (["string", "number", "boolean"].includes(typeof value)) {
        out[key] = String(value);
      }
    });

    return out;
  },

  // ---- brick ----

  // options: { parentId, node } ; node given = edit mode. Resolves { id, label, type, role, meta }.
  brick(options = {}) {
    const model = App.getModel();
    const node = options.node || null;
    const parentId = node ? node.parent : options.parentId || null;
    const taken = this.takenIds(model, node ? node.id : null);
    const types = Array.from(new Set([...this.BASE_TYPES, ...(model ? model.nodes.map((n) => n.type) : [])]));
    const roles = Array.from(new Set((model ? model.nodes : []).map((n) => n.role).filter(Boolean)));
    const parentLocal = parentId && model && model.byId.has(parentId) ? model.byId.get(parentId).localId : null;
    const metaRows = Object.entries(this.scalarMeta(node)).map(([key, value]) => this.metaRow(key, value)).join("");
    const parentText = parentId && model && model.byId.has(parentId) ? Model.pathLabel(parentId, model) : "(racine)";
    const state = { idTouched: Boolean(node) };
    const suggest = this.metaSuggestions(model);

    const body = `
      ${this.field("Libellé", `<input type="text" name="label" required data-autofocus value="${escapeHtml(node ? node.label : "")}" />`)}
      ${this.field("Identifiant", `<input type="text" name="id" value="${escapeHtml(node ? node.localId : "")}" autocomplete="off" />`, node ? "Renommer met à jour toutes les références (liens, style, vue)." : "Proposé selon le réglage « ids.scheme » ; lettres, chiffres, - et _.")}
      ${this.field("Type", this.combo(`<input type="text" name="type" list="forms-types" value="${escapeHtml(node ? node.type : "service")}" autocomplete="off" /><datalist id="forms-types">${types.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("")}</datalist>`))}
      ${this.field("Rôle", this.combo(`<input type="text" name="role" list="forms-roles" value="${escapeHtml(node && node.role ? node.role : "")}" autocomplete="off" /><datalist id="forms-roles">${roles.map((r) => `<option value="${escapeHtml(r)}"></option>`).join("")}</datalist>`))}
      ${this.field("Parent", `<input type="text" readonly tabindex="-1" value="${escapeHtml(parentText)}" />`)}
      <fieldset class="forms-meta"><legend>Métadonnées</legend>
        <datalist id="forms-meta-keys">${this.options(suggest.keys)}</datalist>
        <datalist id="forms-meta-values"></datalist>
        <div data-rows>${metaRows}</div>
        <button type="button" data-act="meta-add">＋ Ajouter une métadonnée</button>
      </fieldset>`;

    return this.dialog({
      title: node ? `Modifier « ${node.label} »` : "Nouvelle brique",
      body,
      okLabel: node ? "Enregistrer" : "Créer",
      kind: "brick",
      setup: (form) => this.setupBrick(form, taken, state, Boolean(node), parentLocal, suggest),
      validate: (form) => this.validateBrick(form, taken),
      collect: (form) => this.collectBrick(form)
    });
  },

  setupBrick(form, taken, state, editing, parentLocal, suggest) {
    const label = form.elements.label;
    const id = form.elements.id;
    const type = form.elements.type;
    const rows = form.querySelector("[data-rows]");
    const valueList = form.querySelector("#forms-meta-values");

    // Value suggestions follow the key of the row being edited.
    const fillValues = (event) => {
      const row = event.target.closest && event.target.closest(".forms-meta-row");

      if (row && valueList && suggest) {
        valueList.innerHTML = this.options(suggest.values[row.querySelector("[data-meta=key]").value.trim()] || []);
      }
    };

    form.addEventListener("focusin", fillValues);
    form.addEventListener("input", fillValues);

    if (!editing) {
      const propose = () => {
        if (!state.idTouched) {
          id.value = this.proposeId(label.value, type.value.trim(), parentLocal, taken);
        }
      };

      label.addEventListener("input", propose);
      type.addEventListener("input", propose);
      id.addEventListener("input", () => {
        state.idTouched = true;
      });
      propose();
    }

    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");

      if (!button) {
        return;
      }

      if (button.dataset.act === "meta-add") {
        rows.insertAdjacentHTML("beforeend", this.metaRow("", ""));
        rows.lastElementChild.querySelector("input").focus();
      } else if (button.dataset.act === "meta-remove") {
        button.closest(".forms-meta-row").remove();
        form.dispatchEvent(new Event("input"));
      }
    });
  },

  validateBrick(form, taken) {
    const id = form.elements.id;
    const value = id.value.trim();

    if (!form.elements.label.value.trim()) {
      return "Le libellé est obligatoire.";
    }

    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return "Identifiant invalide : lettres, chiffres, - et _ uniquement.";
    }

    return taken.has(value) ? `L’identifiant « ${value} » existe déjà.` : "";
  },

  collectBrick(form) {
    const meta = {};

    form.querySelectorAll(".forms-meta-row").forEach((row) => {
      const key = row.querySelector("[data-meta=key]").value.trim();

      if (key) {
        meta[key] = row.querySelector("[data-meta=value]").value;
      }
    });

    return {
      id: form.elements.id.value.trim(),
      label: form.elements.label.value.trim(),
      type: form.elements.type.value.trim(),
      role: form.elements.role.value.trim(),
      meta
    };
  },

  // ---- link ----

  // options: { from, to, label, type, editing }. Resolves { from, to, label, type }.
  link(options = {}) {
    const model = App.getModel();
    const suggest = this.linkSuggestions(model);
    const body = `
      ${this.field("De", this.combo(`<input type="text" name="from" list="forms-nodes" value="${escapeHtml(options.from || "")}" autocomplete="off" />`))}
      ${this.field("Vers", this.combo(`<input type="text" name="to" list="forms-nodes" value="${escapeHtml(options.to || "")}" autocomplete="off" />`))}
      <datalist id="forms-nodes">${this.nodeOptions(model)}</datalist>
      ${this.field("Type", this.combo(`<input type="text" name="type" list="forms-link-types" value="${escapeHtml(options.type || "")}" autocomplete="off" /><datalist id="forms-link-types">${this.options(suggest.types)}</datalist>`), "Libre ; le style d’un type se règle dans la légende.")}
      ${this.field("Libellé", this.combo(`<input type="text" name="label" list="forms-link-labels" data-autofocus value="${escapeHtml(options.label || "")}" autocomplete="off" /><datalist id="forms-link-labels">${this.options(suggest.labels)}</datalist>`))}`;

    return this.dialog({
      title: options.editing ? "Modifier le lien" : "Nouveau lien",
      body,
      kind: "link",
      okLabel: options.editing ? "Enregistrer" : "Créer",
      validate: (form) => {
        const from = this.resolveNodeText(model, form.elements.from.value);
        const to = this.resolveNodeText(model, form.elements.to.value);

        if (!from || !to) {
          return "Choisissez les deux briques dans les suggestions.";
        }

        return from === to ? "Un lien vers soi-même est refusé." : "";
      },
      collect: (form) => ({
        from: this.resolveNodeText(model, form.elements.from.value),
        to: this.resolveNodeText(model, form.elements.to.value),
        label: form.elements.label.value.trim(),
        type: form.elements.type.value.trim()
      })
    });
  },

  // ---- confirmation ----

  // options: { title, html, okLabel, danger, checkbox: { label, checked } }. Resolves { checked } or null.
  confirm(options) {
    const box = options.checkbox
      ? `<label class="forms-check"><input type="checkbox" name="opt"${options.checkbox.checked ? " checked" : ""} /> ${escapeHtml(options.checkbox.label)}</label>`
      : "";

    return this.dialog({
      title: options.title,
      kind: "confirm",
      body: `<div class="forms-message">${options.html}</div>${box}`,
      okLabel: options.okLabel || "Confirmer",
      danger: options.danger,
      collect: (form) => ({ checked: Boolean(form.elements.opt && form.elements.opt.checked) })
    });
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = Forms;
}
