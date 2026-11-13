"use strict";

// Persistent search bar above the YAML editor (replaces the CodeMirror dialog, which covered line 1).
// Ctrl+F opens it and focuses the field; Vue > "Barre de recherche de l'éditeur" keeps it visible.
const EditorSearch = {
  MAX: 2000,
  isOpen: false,
  matches: [],
  index: -1,
  anchor: null,
  marks: [],
  currentMark: null,
  scrollbar: null,
  caseSensitive: false,
  regex: false,
  timer: null,
  els: {},

  init() {
    const byId = (id) => document.getElementById(id);

    this.els = {
      bar: byId("editor-search"),
      input: byId("editor-search-input"),
      list: byId("editor-search-list"),
      count: byId("es-count"),
      check: byId("opt-search-bar")
    };

    if (!this.els.bar || !Editor.cm) {
      return;
    }

    this.cm = Editor.cm;
    this.anchor = this.cm.getCursor();

    this.els.input.addEventListener("input", () => this.refresh(true));
    this.els.input.addEventListener("focus", () => this.fillSuggestions());
    this.els.input.addEventListener("keydown", (event) => this.onKey(event));
    byId("es-next").addEventListener("click", () => this.step(1));
    byId("es-prev").addEventListener("click", () => this.step(-1));
    byId("es-close").addEventListener("click", () => this.close());
    byId("es-clear").addEventListener("click", () => {
      this.els.input.value = "";
      this.refresh(false);
      this.els.input.focus();
    });
    ["case", "regex"].forEach((name) => {
      const button = byId(`es-${name}`);

      button.addEventListener("click", () => {
        const key = name === "case" ? "caseSensitive" : "regex";

        this[key] = !this[key];
        button.setAttribute("aria-pressed", String(this[key]));
        this.refresh(true);
        this.els.input.focus();
      });
    });

    if (this.els.check) {
      this.els.check.addEventListener("change", () => {
        Settings.set("editor.searchBar", this.els.check.checked);

        if (this.els.check.checked) {
          this.els.input.focus();
        }
      });
    }

    this.cm.on("change", () => {
      if (this.isOpen && this.els.input.value) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(false), 250);
      }
    });
    Settings.onChange((keys) => {
      if (keys.includes("editor.searchBar")) {
        this.setOpen(this.wanted());
      }
    });
    this.setOpen(this.wanted());
  },

  wanted() {
    return Settings.get("editor.searchBar") === true;
  },

  setOpen(on) {
    this.isOpen = on;
    this.els.bar.hidden = !on;

    if (this.els.check) {
      this.els.check.checked = this.wanted();
    }

    if (on) {
      this.refresh(false);
    } else {
      this.clearMarks();
    }

    if (typeof ViewUi !== "undefined" && ViewUi.relayoutSoon) {
      ViewUi.relayoutSoon();
    }
  },

  // Ctrl+F: show (even when the setting is off), focus, pre-fill with a one-line selection.
  show() {
    if (!this.els.bar) {
      return;
    }

    const selected = this.cm.somethingSelected() ? this.cm.getSelection() : "";

    this.setOpen(true);

    if (selected && !selected.includes("\n") && selected.length < 200) {
      this.els.input.value = selected;
    }

    this.fillSuggestions();
    this.refresh(true);
    this.els.input.focus();
    this.els.input.select();
  },

  close() {
    const match = this.matches[this.index];

    if (this.wanted()) {
      Settings.set("editor.searchBar", false);
    } else {
      this.setOpen(false);
    }

    if (match) {
      this.cm.setSelection(match.from, match.to);
    }

    this.cm.focus();
  },

  onKey(event) {
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === "Enter") {
      event.preventDefault();
      this.step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (mod && event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.els.input.select();
    }
  },

  fillSuggestions() {
    const model = typeof App !== "undefined" && App.getModel ? App.getModel() : null;
    const nodes = model && model.nodes ? model.nodes.slice(0, 500) : [];
    const html = nodes.map((node) => `<option value="${escapeHtml(node.id)}" label="${escapeHtml(node.label && node.label !== node.id ? String(node.label).split("\n")[0] : "")}"></option>`).join("");

    if (html !== this.lastList) {
      this.lastList = html;
      this.els.list.innerHTML = html;
    }
  },

  // false = invalid regex, null = empty query.
  query() {
    const text = this.els.input.value;

    if (!text) {
      return null;
    }

    if (!this.regex) {
      return text;
    }

    try {
      const expression = new RegExp(text, this.caseSensitive ? "" : "i");

      return expression.test("") ? false : expression;
    } catch (error) {
      return false;
    }
  },

  clearMarks() {
    this.marks.forEach((mark) => mark.clear());
    this.marks = [];
    this.currentMark = null;

    if (this.scrollbar) {
      this.scrollbar.clear();
      this.scrollbar = null;
    }

    this.matches = [];
    this.index = -1;
  },

  // Recomputes matches and highlights; `jump` also scrolls to the match at/after the anchor.
  refresh(jump) {
    this.clearMarks();

    const query = this.query();

    this.els.input.classList.toggle("invalid", query === false);

    if (!query) {
      this.updateCount();
      return;
    }

    const cursor = this.cm.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: !this.caseSensitive });

    while (this.matches.length < this.MAX && cursor.findNext()) {
      this.matches.push({ from: cursor.from(), to: cursor.to() });
    }

    this.cm.operation(() => {
      this.matches.forEach((match) => {
        this.marks.push(this.cm.markText(match.from, match.to, { className: "cm-es-match" }));
      });
    });

    if (typeof this.cm.showMatchesOnScrollbar === "function") {
      try {
        this.scrollbar = this.cm.showMatchesOnScrollbar(query, !this.caseSensitive);
      } catch (error) {
        this.scrollbar = null;
      }
    }

    const anchor = this.anchor || { line: 0, ch: 0 };
    const found = this.matches.findIndex((match) => match.from.line > anchor.line || (match.from.line === anchor.line && match.from.ch >= anchor.ch));

    this.index = this.matches.length ? (found >= 0 ? found : 0) : -1;
    this.markCurrent(jump);
  },

  markCurrent(scroll) {
    if (this.currentMark) {
      this.currentMark.clear();
      this.currentMark = null;
    }

    const match = this.matches[this.index];

    if (match) {
      this.currentMark = this.cm.markText(match.from, match.to, { className: "cm-es-current" });
      this.anchor = match.from;

      if (scroll) {
        // Move the editor selection too (focus stays in the search field), so the match is selected and the graph follows.
        this.cm.setSelection(match.from, match.to, { scroll: false });
        this.cm.scrollIntoView({ from: match.from, to: match.to }, 80);
      }
    }

    this.updateCount();
  },

  step(delta) {
    if (!this.matches.length) {
      this.refresh(true);
      return;
    }

    this.index = (this.index + delta + this.matches.length) % this.matches.length;
    this.markCurrent(true);
  },

  updateCount() {
    const total = this.matches.length;
    const capped = total >= this.MAX ? "+" : "";

    this.els.count.textContent = this.els.input.value && this.query() !== false ? `${total ? this.index + 1 : 0} / ${total}${capped}` : "";
    this.els.count.title = this.query() === false ? "Expression régulière invalide" : "Correspondance courante / total";
  }
};
