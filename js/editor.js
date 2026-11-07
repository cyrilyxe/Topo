"use strict";

const Editor = {
  cm: null,

  init(textarea, onChange, onCursorLine) {
    this.cm = CodeMirror.fromTextArea(textarea, {
      mode: "yaml",
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      smartIndent: true,
      foldGutter: true,
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
      extraKeys: {
        Tab: (cm) => {
          if (cm.somethingSelected()) {
            cm.indentSelection("add");
          } else {
            cm.replaceSelection("  ");
          }
        },
        "Shift-Tab": (cm) => {
          if (cm.somethingSelected()) {
            cm.indentSelection("subtract");
          }
        },
        "Ctrl-F": "findPersistent",
        "Cmd-F": "findPersistent"
      }
    });

    this.cm.on("change", () => onChange && onChange());
    this.cm.on("cursorActivity", () => onCursorLine && onCursorLine(this.cm.getCursor().line));

    return this.cm;
  },

  getValue() {
    return this.cm.getValue();
  },

  setValue(text) {
    this.cm.setValue(text);
  },

  // Replace the whole text while keeping cursor and scroll position.
  setValuePreserve(text) {
    const cursor = this.cm.getCursor();
    const scroll = this.cm.getScrollInfo();

    this.cm.setValue(text);
    this.cm.setCursor({ line: Math.min(cursor.line, this.cm.lineCount() - 1), ch: cursor.ch });
    this.cm.scrollTo(scroll.left, scroll.top);
  },

  refresh() {
    if (this.cm) {
      this.cm.refresh();
    }
  },

  focus() {
    if (this.cm) {
      this.cm.focus();
    }
  },

  normalizeTabs(text) {
    return String(text).split("\n").map((line) => {
      const match = line.match(/^(\t+)/);

      if (!match) {
        return line;
      }

      return "  ".repeat(match[1].length) + line.slice(match[1].length);
    }).join("\n");
  },

  // index: 0-based line index.
  goToLine(index) {
    const line = Math.max(0, Math.min(index, this.cm.lineCount() - 1));

    this.cm.setCursor({ line, ch: 0 });
    this.cm.focus();
    this.cm.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 1, ch: 0 } }, 120);
    this.cm.addLineClass(line, "background", "active-line");

    setTimeout(() => {
      this.cm.removeLineClass(line, "background", "active-line");
    }, 1800);
  },

  // Finds what the YAML line at `lineIndex` (0-based) belongs to: a node or a link.
  analyzeLine(lineIndex, model) {
    const lines = this.cm.getValue().split("\n");
    const indentOf = (text) => text.match(/^\s*/)[0].length;
    const isBlank = (text) => !text.trim() || /^\s*#/.test(text);

    let section = null;

    for (let i = lineIndex; i >= 0; i -= 1) {
      const match = lines[i].match(/^([A-Za-z_][\w-]*)\s*:/);

      if (match) {
        section = match[1];
        break;
      }
    }

    const isNodes = section === "nodes" || section === "noeuds";
    const isLinks = section === "links" || section === "liens";

    if (!isNodes && !isLinks) {
      return { type: null };
    }

    let threshold = isBlank(lines[lineIndex] || "") ? Infinity : indentOf(lines[lineIndex]) + 1;

    for (let i = lineIndex; i >= 0; i -= 1) {
      const text = lines[i];
      const dash = text.match(/^(\s*)-\s+/);

      if (isBlank(text) || !dash || dash[1].length >= threshold) {
        continue;
      }

      const fields = this.extractFields(lines, i, dash[0].length);

      if (isNodes && fields.id) {
        const node = this.findNodeAt(model, fields.id, i);

        return node ? { type: "node", id: node.id, line: i } : { type: null };
      }

      if (isLinks && (fields.from || fields.de) && (fields.to || fields.vers)) {
        return {
          type: "link",
          line: i,
          link: this.findLinkAt(model, fields.from || fields.de, fields.to || fields.vers, i)
        };
      }

      threshold = dash[1].length;
    }

    return { type: null };
  },

  extractFields(lines, start, fieldIndent) {
    const baseIndent = lines[start].match(/^\s*/)[0].length;
    const fields = {};

    for (let i = start; i < lines.length; i += 1) {
      const text = lines[i];

      if (i > start && text.trim() && text.match(/^\s*/)[0].length <= baseIndent) {
        break;
      }

      const body = i === start ? text.slice(fieldIndent) : text;
      const indent = i === start ? fieldIndent : text.match(/^\s*/)[0].length;

      if (indent !== fieldIndent) {
        continue;
      }

      const match = body.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);

      if (match) {
        fields[match[1]] = match[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      }
    }

    return fields;
  },

  findNodeAt(model, rawId, lineIndex) {
    if (!model) {
      return null;
    }

    const matches = model.nodes.filter((node) => (
      node.localId === rawId || node.qualifiedId === rawId || node.id === rawId
    ));

    if (matches.length <= 1) {
      return matches[0] || null;
    }

    return matches.find((node) => node.line === lineIndex + 1 || node.line === lineIndex) || matches[0];
  },

  findLinkAt(model, fromRef, toRef, lineIndex) {
    if (!model) {
      return null;
    }

    const byLine = model.links.find((link) => link.line === lineIndex + 1 || link.line === lineIndex);

    if (byLine) {
      return byLine;
    }

    const refOf = (ref) => model.nodes.filter((node) => (
      node.id === ref || node.qualifiedId === ref || node.localId === ref
    ));
    const froms = new Set(refOf(fromRef).map((node) => node.id));
    const tos = new Set(refOf(toRef).map((node) => node.id));

    return model.links.find((link) => froms.has(link.from) && tos.has(link.to)) || null;
  },

  // Index (0-based) of the line declaring a node, or -1.
  findNodeDeclaration(node) {
    const lines = this.cm.getValue().split("\n");
    const names = [node.localId, node.qualifiedId, node.id].filter(Boolean);

    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(`^\\s*(-\\s*)?id\\s*:\\s*["']?${escaped}["']?\\s*(#.*)?$`);
      const index = lines.findIndex((line) => expression.test(line));

      if (index >= 0) {
        return index;
      }
    }

    return -1;
  }
};
