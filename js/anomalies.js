"use strict";

const Anomalies = {
  content: null,
  badge: null,
  list: [],

  init() {
    this.content = document.getElementById("anomalies-content");
    this.badge = document.getElementById("anomaly-badge");

    this.content.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");

      if (!button) {
        return;
      }

      const anomaly = this.list[Number(button.dataset.index)];

      if (!anomaly) {
        return;
      }

      if (button.dataset.act === "goto") {
        Editor.goToLine(Math.max(0, Number(anomaly.line)));
        App.showTab("editor");
      } else if (button.dataset.act === "fix") {
        this.applyFix(anomaly, anomaly.fixes[Number(button.dataset.fix)]);
      }
    });

    this.render([]);
  },

  render(anomalies) {
    this.list = Array.isArray(anomalies) ? anomalies : [];

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
