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
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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

  nodeOptions(model, selected) {
    return (model ? model.nodes : []).map((node) => (
      `<option value="${escapeHtml(node.id)}"${node.id === selected ? " selected" : ""}>${escapeHtml(Model.pathLabel(node.id, model))}</option>`
    )).join("");
  },

  metaRow(key, value) {
    return `<div class="forms-meta-row">
      <input type="text" data-meta="key" placeholder="clé" value="${escapeHtml(key)}" aria-label="Clé de métadonnée" />
      <input type="text" data-meta="value" placeholder="valeur" value="${escapeHtml(value)}" aria-label="Valeur de métadonnée" />
      <button type="button" data-act="meta-remove" title="Retirer cette métadonnée" aria-label="Retirer">✕</button>
    </div>`;
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
    const metaRows = Object.entries(this.scalarMeta(node)).map(([key, value]) => this.metaRow(key, value)).join("");
    const parentText = parentId && model && model.byId.has(parentId) ? Model.pathLabel(parentId, model) : "(racine)";
    const state = { idTouched: Boolean(node) };

    const body = `
      ${this.field("Libellé", `<input type="text" name="label" required data-autofocus value="${escapeHtml(node ? node.label : "")}" />`)}
      ${this.field("Identifiant", `<input type="text" name="id" ${node ? "readonly" : ""} value="${escapeHtml(node ? node.localId : "")}" autocomplete="off" />`, node ? "Non modifiable." : "Proposé depuis le libellé ; lettres, chiffres, - et _.")}
      ${this.field("Type", `<input type="text" name="type" list="forms-types" value="${escapeHtml(node ? node.type : "service")}" /><datalist id="forms-types">${types.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("")}</datalist>`)}
      ${this.field("Rôle", `<input type="text" name="role" value="${escapeHtml(node && node.role ? node.role : "")}" />`)}
      ${this.field("Parent", `<input type="text" readonly tabindex="-1" value="${escapeHtml(parentText)}" />`)}
      <fieldset class="forms-meta"><legend>Métadonnées</legend>
        <div data-rows>${metaRows}</div>
        <button type="button" data-act="meta-add">＋ Ajouter une métadonnée</button>
      </fieldset>`;

    return this.dialog({
      title: node ? `Modifier « ${node.label} »` : "Nouvelle brique",
      body,
      okLabel: node ? "Enregistrer" : "Créer",
      setup: (form) => this.setupBrick(form, taken, state, Boolean(node)),
      validate: (form) => this.validateBrick(form, taken),
      collect: (form) => this.collectBrick(form)
    });
  },

  setupBrick(form, taken, state, editing) {
    const label = form.elements.label;
    const id = form.elements.id;
    const rows = form.querySelector("[data-rows]");

    if (!editing) {
      label.addEventListener("input", () => {
        if (!state.idTouched) {
          id.value = this.uniqueSlug(this.slug(label.value), taken);
        }
      });
      id.addEventListener("input", () => {
        state.idTouched = true;
      });
      id.value = this.uniqueSlug("", taken);
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

    if (id.readOnly) {
      return "";
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

  // options: { from, to, label, editing }. Resolves { from, to, label }.
  link(options = {}) {
    const model = App.getModel();
    const body = `
      ${this.field("De", `<select name="from">${this.nodeOptions(model, options.from)}</select>`)}
      ${this.field("Vers", `<select name="to">${this.nodeOptions(model, options.to)}</select>`)}
      ${this.field("Libellé", `<input type="text" name="label" data-autofocus value="${escapeHtml(options.label || "")}" />`)}`;

    return this.dialog({
      title: options.editing ? "Modifier le lien" : "Nouveau lien",
      body,
      okLabel: options.editing ? "Enregistrer" : "Créer",
      validate: (form) => (form.elements.from.value === form.elements.to.value ? "Un lien vers soi-même est refusé." : ""),
      collect: (form) => ({ from: form.elements.from.value, to: form.elements.to.value, label: form.elements.label.value.trim() })
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
      body: `<div class="forms-message">${options.html}</div>${box}`,
      okLabel: options.okLabel || "Confirmer",
      danger: options.danger,
      collect: (form) => ({ checked: Boolean(form.elements.opt && form.elements.opt.checked) })
    });
  }
};
