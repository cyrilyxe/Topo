"use strict";

const Inspector = {
  content: null,
  actions: {},
  focusKey: null,
  query: "",
  queryNode: null,

  init(actions) {
    this.content = document.getElementById("inspector-content");
    this.actions = actions || {};

    this.content.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");

      if (button) {
        this.actions[button.dataset.action]?.(button.dataset.id);
        return;
      }

      const row = event.target.closest("li.link-row");

      if (row) {
        this.actions["link-center"]?.(row.dataset.from, row.dataset.to);
      }
    });

    this.content.addEventListener("input", (event) => {
      if (event.target.id === "link-filter") {
        this.query = event.target.value;
        this.applyFilter();
      }
    });

    this.content.addEventListener("mouseover", (event) => {
      const row = event.target.closest("li.link-row");

      if (row && !row.contains(event.relatedTarget)) {
        this.actions["link-hover"]?.(row.dataset.from, row.dataset.to);
      }
    });

    this.content.addEventListener("mouseout", (event) => {
      const row = event.target.closest("li.link-row");

      if (row && !row.contains(event.relatedTarget)) {
        this.actions["link-unhover"]?.();
      }
    });
  },

  // ---- link classification (direct / indirect / internal) ----

  descendants(id, model) {
    const result = new Map();
    let level = model.byId.get(id).children.map((child) => [child, 1]);

    while (level.length) {
      const next = [];

      level.forEach(([childId, depth]) => {
        const child = model.byId.get(childId);

        if (child && !result.has(childId)) {
          result.set(childId, depth);
          child.children.forEach((grand) => next.push([grand, depth + 1]));
        }
      });

      level = next;
    }

    return result;
  },

  // Each entry: { link, index, kind, inner: id of the subtree end, depth, outgoing }
  classifyLinks(id, model) {
    const subtree = this.descendants(id, model);
    const result = [];

    model.links.forEach((link, index) => {
      const fromIn = subtree.has(link.from);
      const toIn = subtree.has(link.to);

      if (link.from === id || link.to === id) {
        result.push({ link, index, kind: "direct", inner: id, depth: 0, outgoing: link.from === id });
      } else if (fromIn && toIn) {
        result.push({ link, index, kind: "internal", inner: link.from, depth: subtree.get(link.from), outgoing: true });
      } else if (fromIn || toIn) {
        const inner = fromIn ? link.from : link.to;

        result.push({ link, index, kind: "indirect", inner, depth: subtree.get(inner), outgoing: fromIn });
      }
    });

    return result;
  },

  indirectLinks(id, model) {
    return this.classifyLinks(id, model).filter((entry) => entry.kind === "indirect");
  },

  // ---- link list rendering ----

  linkRow(entry, id, model) {
    const { link, depth, outgoing } = entry;
    const self = model.byId.get(id);
    const otherId = outgoing ? link.to : link.from;
    const pathText = `${Model.pathLabel(link.from, model)} → ${Model.pathLabel(link.to, model)}`;
    const other = model.byId.get(otherId);
    const inner = model.byId.get(entry.inner);
    const text = [self.label, inner && inner.label, other && other.label, link.label, pathText].join(" ").toLowerCase();
    const real = entry.kind !== "direct" && inner
      ? `<sup class="link-depth" title="Profondeur : ${depth} niveau(x) sous cette brique">${depth}</sup> <button type="button" class="link-node link-real" data-action="center" data-id="${escapeHtml(inner.id)}">${escapeHtml(inner.label)}</button>`
      : "";
    const focusKey = `link:${entry.index}`;
    const active = this.focusKey === focusKey;
    const focus = entry.kind === "indirect"
      ? `<button type="button" class="link-focus${active ? " active" : ""}" data-action="focus-link" data-id="${entry.index}" aria-pressed="${active}" title="${active ? "Quitter le focus" : "Isoler ce lien dans le graphe (temporaire)"}">${active ? "Quitter" : "Focus"}</button>`
      : "";

    return `
      <li class="link-row ${entry.kind}" data-from="${escapeHtml(link.from)}" data-to="${escapeHtml(link.to)}" data-text="${escapeHtml(text)}" title="${escapeHtml(pathText)}">
        <span class="link-self">${escapeHtml(self.label)}${real}</span>
        <span class="link-arrow">${outgoing ? "→" : "←"}</span>
        ${this.nodeButton(otherId, model)}
        ${link.label ? `<span class="link-label">— ${escapeHtml(link.label)}</span>` : ""}
        ${focus}
      </li>`;
  },

  linkGroup(title, entries, id, model) {
    const rows = entries.map((entry) => this.linkRow(entry, id, model)).join("");

    return `
      <div class="link-group" data-total="${entries.length}">
        <h5>${escapeHtml(title)} <span class="link-count">${entries.length}</span></h5>
        ${entries.length ? `<ul class="link-list">${rows}</ul>` : "<p class=\"empty\">Aucun.</p>"}
      </div>`;
  },

  linksSection(id, model, isCollapsed, isGroup) {
    const all = this.classifyLinks(id, model);
    const pick = (kind) => all.filter((entry) => entry.kind === kind);
    const indirect = pick("indirect");
    const internal = pick("internal");
    const allActive = this.focusKey === `all:${id}`;
    const focusAll = indirect.length
      ? `<button type="button" class="link-focus${allActive ? " active" : ""}" data-action="focus-all" data-id="${escapeHtml(id)}" aria-pressed="${allActive}" title="Déplier temporairement ce qu’il faut pour voir les extrémités réelles">${allActive ? "Quitter le focus" : "Focus sur tous les liens"}</button>`
      : "";
    let body;

    if (isGroup && isCollapsed) {
      body = this.linkGroup("Liens portés par cette boîte", all.filter((entry) => entry.kind !== "internal"), id, model);
    } else {
      body = this.linkGroup("Directs", pick("direct"), id, model);

      if (isGroup) {
        body += this.linkGroup("Indirects (via les descendants)", indirect, id, model);
        body += internal.length
          ? `<details class="link-internal"><summary>Internes (${internal.length})</summary>${this.linkGroup("Internes au sous-arbre", internal, id, model)}</details>`
          : "";
      }
    }

    return `
      <section class="links-section">
        <h4>Liens</h4>
        <div class="link-tools">
          <input id="link-filter" type="search" placeholder="Filtrer les liens…" value="${escapeHtml(this.queryNode === id ? this.query : "")}" aria-label="Filtrer les liens" />
          ${focusAll}
        </div>
        <div class="link-scroll">${body}</div>
      </section>`;
  },

  applyFilter() {
    const query = this.query.trim().toLowerCase();

    this.content.querySelectorAll(".link-group").forEach((group) => {
      let shown = 0;

      group.querySelectorAll("li.link-row").forEach((row) => {
        const match = !query || row.dataset.text.includes(query);

        row.hidden = !match;
        shown += match ? 1 : 0;
      });

      group.querySelector(".link-count").textContent = query ? `${shown} / ${group.dataset.total}` : group.dataset.total;
    });
  },

  nodeButton(id, model) {
    const node = model.byId.get(id);

    return `<button type="button" class="link-node" data-action="center" data-id="${escapeHtml(id)}">${escapeHtml(node ? node.label : id)}</button>`;
  },

  metaSection(node) {
    const hidden = ["show", "afficher", "links", "liens"];
    const entries = Object.entries(node.meta || {}).filter(([key]) => !hidden.includes(key));

    if (!entries.length) {
      return "";
    }

    return `
      <section>
        <h4>Métadonnées</h4>
        <ul>
          ${entries.map(([key, value]) => `
            <li><strong>${escapeHtml(key)}</strong> : ${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</li>
          `).join("")}
        </ul>
      </section>`;
  },

  resourcesSection(node) {
    const list = node.meta && (node.meta.links || node.meta.liens);
    const links = (Array.isArray(list) ? list : []).filter((item) => item && safeUrl(item.url));

    if (!links.length) {
      return "";
    }

    return `
      <section>
        <h4>Ressources</h4>
        <ul>
          ${links.map((item) => `
            <li><a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label || item.url)}</a></li>
          `).join("")}
        </ul>
      </section>`;
  },

  showNode(id, model, collapsed) {
    const node = model && model.byId.get(id);

    if (!node) {
      this.clear();
      return;
    }

    const isCollapsed = collapsed.has(id);
    const isGroup = node.children.length > 0;

    this.content.innerHTML = `
      <h3>${escapeHtml(node.label)}</h3>
      <p class="path">${escapeHtml(Model.pathLabel(id, model))}</p>

      <section>
        <h4>Identité</h4>
        <ul>
          <li>Identifiant : <code>${escapeHtml(node.qualifiedId || node.id)}</code></li>
          <li>Type : ${escapeHtml(node.type || "nœud")}</li>
          <li>Rôle : ${escapeHtml(node.role || "non défini")}</li>
          <li>Parent : ${node.parent ? this.nodeButton(node.parent, model) : "aucun"}</li>
          <li>Enfants : ${isGroup ? node.children.map((child) => this.nodeButton(child, model)).join(" ") : "aucun"}</li>
        </ul>
      </section>

      ${this.metaSection(node)}
      ${this.resourcesSection(node)}

      ${this.linksSection(id, model, isCollapsed, isGroup)}

      <div class="actions">
        ${isGroup ? `<button type="button" data-action="${isCollapsed ? "expand" : "collapse"}" data-id="${escapeHtml(id)}">${isCollapsed ? "Déplier" : "Replier"}</button>` : ""}
        <button type="button" data-action="center" data-id="${escapeHtml(id)}">Recentrer</button>
        <button type="button" data-action="card" data-id="${escapeHtml(id)}">Fiche</button>
        <button type="button" data-action="style" data-id="${escapeHtml(id)}">Style</button>
        <button type="button" data-action="view-yaml" data-id="${escapeHtml(id)}">Voir dans le YAML</button>
        ${Project.canEditSource(node) ? `<button type="button" data-action="edit-source" data-id="${escapeHtml(id)}">Éditer la source</button>` : ""}
      </div>
    `;

    if (this.queryNode !== id) {
      this.query = "";
      this.queryNode = id;
    }

    this.applyFilter();
  },

  showLink(link, model) {
    const source = link && model.byId.get(link.from);
    const target = link && model.byId.get(link.to);

    if (!source || !target) {
      this.clear();
      return;
    }

    this.content.innerHTML = `
      <h3>Lien : ${escapeHtml(source.label)} → ${escapeHtml(target.label)}</h3>
      <p class="path">${escapeHtml(Model.pathLabel(source.id, model))} → ${escapeHtml(Model.pathLabel(target.id, model))}</p>

      <section>
        <h4>Détails</h4>
        <ul>
          <li>Origine : ${this.nodeButton(source.id, model)}</li>
          <li>Cible : ${this.nodeButton(target.id, model)}</li>
          <li>Étiquette : ${link.label ? escapeHtml(link.label) : "<span class=\"empty\">aucune</span>"}</li>
        </ul>
      </section>

      <div class="actions">
        <button type="button" data-action="center" data-id="${escapeHtml(source.id)}">Voir l’origine</button>
        <button type="button" data-action="center" data-id="${escapeHtml(target.id)}">Voir la cible</button>
      </div>
    `;
  },

  clear() {
    this.content.innerHTML = "<p class=\"empty\">Cliquez sur une ligne du YAML ou sur un nœud pour inspecter ses informations, ses liens et ses métadonnées.</p>";
  }
};
