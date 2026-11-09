"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.History = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MAX = 100;
  let past = [];
  let future = [];
  let io = { get: () => "", set: () => {} };
  const listeners = [];

  function notify() {
    listeners.forEach((fn) => fn(History.state()));
  }

  const History = {
    // io: { get(): current text, set(text): applies a text }
    bind(next) {
      io = next;
    },

    push(text, label) {
      past.push({ text: String(text), label: label || "Modification" });
      if (past.length > MAX) past.shift();
      future = [];
      notify();
    },

    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ text: io.get(), label: entry.label });
      io.set(entry.text);
      notify();
      return entry.label;
    },

    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ text: io.get(), label: entry.label });
      io.set(entry.text);
      notify();
      return entry.label;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    state() {
      return {
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        undoLabel: past.length ? past[past.length - 1].label : null,
        redoLabel: future.length ? future[future.length - 1].label : null
      };
    },

    // Copy of the internal stacks (document tabs keep one per tab).
    snapshot() {
      return { past: past.slice(), future: future.slice() };
    },

    restore(saved) {
      past = saved && Array.isArray(saved.past) ? saved.past.slice() : [];
      future = saved && Array.isArray(saved.future) ? saved.future.slice() : [];
      notify();
    },

    clear() {
      past = [];
      future = [];
      notify();
    },

    onChange(fn) {
      listeners.push(fn);
    },

    // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, ignored while typing (CodeMirror keeps its own undo).
    installShortcuts() {
      document.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const target = event.target;
        if (target && target.closest && target.closest(".CodeMirror, input, textarea, select, [contenteditable=\"true\"]")) return;
        const key = event.key.toLowerCase();
        const redo = key === "y" || (key === "z" && event.shiftKey);
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        if (redo) History.redo();
        else History.undo();
      });
    }
  };

  return History;
});
