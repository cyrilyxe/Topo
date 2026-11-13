"use strict";

const Editor = {
  cm: null,
  marks: [],
  lastFolds: new Set(),
  quiet: false,
  pendingScroll: null,
  onFold: null,

  init(textarea, onChange, onCursorLine, onTextSelection) {
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
        "Ctrl-F": () => EditorSearch.show(),
        "Cmd-F": () => EditorSearch.show()
      }
    });

    this.cm.on("change", () => onChange && onChange());
    this.cm.on("cursorActivity", () => {
      if (this.cm.somethingSelected() && onTextSelection) {
        onTextSelection(this.cm.listSelections());
      } else if (onCursorLine) {
        onCursorLine(this.cm.getCursor().line);
      }
    });
    this.cm.on("fold", (cm, from) => this.foldEvent("fold", from));
    this.cm.on("unfold", (cm, from) => this.foldEvent("unfold", from));

    return this.cm;
  },

  getValue() {
    return this.cm.getValue();
  },

  setValue(text) {
    this.replaceAll(text);
  },

  // Folds and marks are lost on a full replacement: forget them without telling the graph.
  replaceAll(text) {
    this.quiet = true;
    this.lastFolds = new Set();
    this.marks = [];
    try {
      this.cm.setValue(text);
    } finally {
      this.quiet = false;
    }
  },

  // Replace the whole text while keeping cursor and scroll position.
  setValuePreserve(text) {
    const cursor = this.cm.getCursor();
    const scroll = this.cm.getScrollInfo();

    this.replaceAll(text);
    this.cm.setCursor({ line: Math.min(cursor.line, this.cm.lineCount() - 1), ch: cursor.ch });
    this.cm.scrollTo(scroll.left, scroll.top);
  },

  refresh() {
    if (this.cm) {
      this.cm.refresh();

      if (this.pendingScroll !== null) {
        this.scrollToLine(this.pendingScroll);
      }
    }
  },

  scrollToLine(line) {
    const index = Math.max(0, Math.min(line, this.cm.lineCount() - 1));

    if (!this.cm.getWrapperElement().offsetParent) {
      this.pendingScroll = index;
      return;
    }

    this.pendingScroll = null;
    this.cm.scrollIntoView({ from: { line: index, ch: 0 }, to: { line: index + 1, ch: 0 } }, 60);
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
  },

  // ---- node blocks, selection highlight and folding ----

  indentOf(text) {
    return text.match(/^\s*/)[0].length;
  },

  isBlank(text) {
    return !text.trim() || /^\s*#/.test(text);
  },

  // Last line of the block starting at `start` whose first line has indent `indent`.
  blockEnd(lines, start, indent) {
    let end = start;

    for (let i = start + 1; i < lines.length; i += 1) {
      if (!this.isBlank(lines[i]) && this.indentOf(lines[i]) <= indent) {
        break;
      }

      if (lines[i].trim()) {
        end = i;
      }
    }

    return end;
  },

  // { start, end, indent } of the YAML list item declaring `node`, or null.
  nodeBlock(node, lines) {
    const declared = node.line >= 0 && /^\s*(-\s*)?id\s*:/.test(lines[node.line] || "") ? node.line : this.findNodeDeclaration(node);

    if (declared < 0) {
      return null;
    }

    let start = declared;

    if (!/^\s*-\s/.test(lines[declared])) {
      const field = this.indentOf(lines[declared]);

      while (start > 0 && !(/^\s*-\s/.test(lines[start]) && this.indentOf(lines[start]) < field)) {
        start -= 1;
      }
    }

    const indent = this.indentOf(lines[start]);

    return { start, end: this.blockEnd(lines, start, indent), indent };
  },

  // Entry of `link` in the links: list, or null.
  linkBlock(link, lines) {
    if (!link || link.line < 0 || !lines[link.line]) {
      return null;
    }

    return { start: link.line, end: this.blockEnd(lines, link.line, this.indentOf(lines[link.line])) };
  },

  clearHighlight() {
    this.marks.forEach((mark) => mark.clear());
    this.marks = [];
  },

  // blocks: [{ start, end }] (0-based, inclusive). Scrolls to the first one when asked.
  highlightBlocks(blocks, scroll) {
    this.clearHighlight();

    blocks.forEach((block) => {
      const to = { line: block.end, ch: this.cm.getLine(block.end).length };

      this.marks.push(this.cm.markText({ line: block.start, ch: 0 }, to, { className: "cm-selected-node" }));
    });

    if (scroll && blocks.length) {
      this.scrollToLine(blocks[0].start);
    }
  },

  // Highlights the YAML blocks of nodes (model nodes) and links (model links).
  highlightSelection(nodes, links, scroll) {
    const lines = this.cm.getValue().split("\n");
    const blocks = nodes.slice(0, 200).map((node) => this.nodeBlock(node, lines))
      .concat(links.slice(0, 200).map((link) => this.linkBlock(link, lines)))
      .filter(Boolean);

    this.highlightBlocks(blocks, scroll);
  },

  // Nodes whose `id:` line lies inside the selected line ranges.
  nodesInRanges(ranges, model) {
    const ids = [];

    ranges.forEach((range) => {
      const first = Math.min(range.anchor.line, range.head.line);
      const last = Math.max(range.anchor.line, range.head.line);

      for (let i = first; i <= last; i += 1) {
        const match = this.cm.getLine(i).match(/^\s*(?:-\s*)?id\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
        const node = match && this.analyzeLine(i, model).type === "node" ? this.findNodeAt(model, match[1], i) : null;

        if (node && !ids.includes(node.id)) {
          ids.push(node.id);
        }
      }
    });

    return ids;
  },

  // Line of the `children:` key of a node block, or -1.
  childrenLine(block, lines) {
    const field = block.indent + 2;

    for (let i = block.start + 1; i <= block.end; i += 1) {
      if (this.indentOf(lines[i]) === field && /^\s*(children|enfants)\s*:\s*(#.*)?$/.test(lines[i])) {
        return i;
      }
    }

    return -1;
  },

  childrenRange(cm, pos) {
    const lines = cm.getValue().split("\n");
    const indent = Editor.indentOf(lines[pos.line]);
    let end = pos.line;

    for (let i = pos.line + 1; i < lines.length; i += 1) {
      const text = lines[i];

      if (text.trim() && !/^\s*#/.test(text) && Editor.indentOf(text) < indent + (/^\s*-\s/.test(text) ? 0 : 1)) {
        break;
      }

      if (text.trim()) {
        end = i;
      }
    }

    return end > pos.line ? { from: { line: pos.line, ch: lines[pos.line].length }, to: { line: end, ch: lines[end].length } } : undefined;
  },

  // Folds/unfolds the children: block of the groups whose collapsed state changed since the last call.
  syncFolds(collapsed, model) {
    const lines = this.cm.getValue().split("\n");
    const apply = (id, force) => {
      const node = model.byId.get(id);
      const block = node && this.nodeBlock(node, lines);
      const line = block ? this.childrenLine(block, lines) : -1;

      if (line >= 0) {
        this.quiet = true;
        this.cm.foldCode({ line, ch: 0 }, { rangeFinder: this.childrenRange, scanUp: false }, force);
        this.quiet = false;
      }
    };

    collapsed.forEach((id) => !this.lastFolds.has(id) && apply(id, "fold"));
    this.lastFolds.forEach((id) => !collapsed.has(id) && apply(id, "unfold"));
    this.lastFolds = new Set(collapsed);
  },

  foldEvent(kind, from) {
    if (!this.quiet && this.onFold && /^\s*(children|enfants)\s*:/.test(this.cm.getLine(from.line))) {
      this.onFold(kind, from.line);
    }
  }
};
