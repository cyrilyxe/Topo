"use strict";

const Anomalies = {
  content: null,
  badge: null,
  list: [],
  prev: null,
  parsedText: null,
  renames: new Map(),

  init() {
    this.content = document.getElementById("anomalies-content");
    this.badge = document.getElementById("anomaly-badge");

    this.content.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");

      if (!button) {
        return;
      }

      const anomaly = this.fresh(this.list[Number(button.dataset.index)]);

      if (!anomaly) {
        return;
      }

      if (button.dataset.act === "goto") {
        App.showTab("editor");
        Editor.goToLine(Math.max(0, Number(anomaly.line)));
      } else if (button.dataset.act === "fix") {
        this.applyFix(anomaly, anomaly.fixes[Number(button.dataset.fix)]);
      } else if (button.dataset.act === "rename") {
        this.renameRefs(this.renameFor(anomaly));
      }
    });

    this.render([]);
  },

  // The editor may hold text that was not parsed yet (typing is applied after a delay): parse it now so that
  // line numbers match, then find the same anomaly again in the refreshed list.
  fresh(anomaly) {
    if (!anomaly || App.getText() === this.parsedText) {
      return anomaly;
    }

    App.applyNow(false);

    if (App.getText() !== this.parsedText) {
      return anomaly;
    }

    const same = this.list.find((item) => item.code === anomaly.code && item.message === anomaly.message);

    if (!same) {
      App.showMessage("Cette anomalie n’existe plus.", "info");
    }

    return same;
  },

  // Ids renamed by hand in the text: a node disappeared and another appeared on the same line.
  track(model) {
    if (!model) {
      return;
    }

    const before = this.prev;

    if (before && before !== model) {
      const was = new Set(before.nodes.map((node) => node.qualifiedId));
      const is = new Set(model.nodes.map((node) => node.qualifiedId));
      const appeared = model.nodes.filter((node) => !was.has(node.qualifiedId) && node.line >= 0);

      before.nodes.filter((node) => !is.has(node.qualifiedId) && node.line >= 0).forEach((gone) => {
        const now = appeared.find((node) => node.line === gone.line && node.localId !== gone.localId);

        if (now) {
          this.renames.set(now.localId, this.renames.get(gone.localId) || gone.localId);
          this.renames.delete(gone.localId);
        }
      });
    }

    this.prev = model;

    const locals = new Set(model.nodes.map((node) => node.localId));

    Array.from(this.renames).forEach(([current, original]) => {
      if (!locals.has(current) || locals.has(original)) {
        this.renames.delete(current);
      }
    });
  },

  // { oldRef, newRef } when the unknown reference of this anomaly is an id that was renamed by hand.
  renameFor(anomaly) {
    if (!anomaly || !["unknown-ref", "obsolete-style-rule"].includes(anomaly.code) || !anomaly.ref) {
      return null;
    }

    for (const [current, original] of this.renames) {
      if (anomaly.ref === original || String(anomaly.ref).endsWith(`.${original}`)) {
        return { oldRef: original, newRef: current };
      }
    }

    return null;
  },

  renameRefs(rename) {
    if (!rename) {
      return;
    }

    const done = App.edit(`Renommer les références « ${rename.oldRef} » → « ${rename.newRef} »`, (text) => DocEdit.renameRefs(text, rename.oldRef, rename.newRef));

    if (done) {
      App.showMessage(`Références « ${rename.oldRef} » renommées en « ${rename.newRef} ».`, "success");
    }
  },

  render(anomalies) {
    this.list = Array.isArray(anomalies) ? anomalies : [];
    this.parsedText = App.getText();
    this.track(App.getModel());

    const errors = this.list.filter((item) => item.level === "error").length;

    this.badge.textContent = String(this.list.length);
    this.badge.hidden = this.list.length === 0;
    this.badge.classList.toggle("warn", errors === 0);

    if (!this.list.length) {
      this.content.innerHTML = "<p class=\"empty\">Aucune anomalie détectée.</p>";
      return;
    }

    this.content.innerHTML = this.list.map((anomaly, index) => {
      const level = anomaly.level === "error" ? "error" : "warning";
      const fixes = Array.isArray(anomaly.fixes) ? anomaly.fixes : [];
      const rename = this.renameFor(anomaly);

      return `
        <div class="anomaly ${level}">
          <div class="anomaly-head">
            <span class="anomaly-icon" title="${level === "error" ? "Erreur" : "Avertissement"}">${level === "error" ? "✖" : "⚠"}</span>
            <div>
              <div>${escapeHtml(anomaly.message)}</div>
              <div class="anomaly-code">${escapeHtml(anomaly.code || "")}${anomaly.line >= 0 ? ` · ligne ${escapeHtml(anomaly.line + 1)}` : ""}</div>
            </div>
          </div>
          <div class="anomaly-actions">
            ${anomaly.line >= 0 ? `<button type="button" data-act="goto" data-index="${index}">Aller à la ligne</button>` : ""}
            ${fixes.map((fix, fixIndex) => `
              <button type="button" data-act="fix" data-index="${index}" data-fix="${fixIndex}">Remplacer par <code>${escapeHtml(fix.newRef)}</code></button>
            `).join("")}
            ${rename ? `<button type="button" data-act="rename" data-index="${index}">Renommer les références <code>${escapeHtml(rename.oldRef)}</code> → <code>${escapeHtml(rename.newRef)}</code></button>` : ""}
          </div>
        </div>`;
    }).join("");
  },

  applyFix(anomaly, fix) {
    if (!fix || !fix.oldRef) {
      return;
    }

    const text = App.getText();
    const lines = text.split("\n");
    const escaped = String(fix.oldRef).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`((?:from|to|de|vers|target|cible)\\s*:\\s*["']?)${escaped}(["']?)(?=\\s*(?:[,}#]|$))`);
    const line = Number(anomaly.line);
    const candidates = Number.isFinite(line) ? [line, line + 1, line - 1] : [];
    const replacement = (match, before, after) => `${before}${fix.newRef}${after}`;

    for (const index of candidates) {
      if (index >= 0 && index < lines.length && expression.test(lines[index])) {
        lines[index] = lines[index].replace(expression, replacement);
        App.replaceText(lines.join("\n"));
        App.showMessage(`Référence remplacée par « ${fix.newRef} ».`, "success");
        return;
      }
    }

    const found = lines.findIndex((item) => expression.test(item));

    if (found < 0) {
      App.showMessage(`Référence « ${fix.oldRef} » introuvable dans le texte.`, "error");
      return;
    }

    lines[found] = lines[found].replace(expression, replacement);
    App.replaceText(lines.join("\n"));
    App.showMessage(`Référence remplacée par « ${fix.newRef} ».`, "success");
  }
};
