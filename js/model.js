"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./schema.js"), (() => { try { return require("js-yaml"); } catch (e) { return require("../vendor/js-yaml.js"); } })());
  } else {
    root.Model = factory(root.Schema, root.jsyaml);
  }
})(typeof self !== "undefined" ? self : this, function (Schema, jsyaml) {
  const DEFAULT_YAML = `title: Architecture exemple

nodes:
  - id: plateforme
    label: Plateforme
    type: group
    role: domain
    meta:
      owner: Équipe Plateforme
      environment: production
      show:
        - owner
        - environment
      links:
        - label: Documentation
          url: "https://exemple.fr/docs/plateforme"
    children:
      - id: execution
        label: Exécution
        type: group
        role: category
        children:
          - id: api
            label: API
            type: service
            meta:
              repo: "https://github.com/exemple/api"
              show:
                - repo
              links:
                - label: Dépôt Git
                  url: "https://github.com/exemple/api"
          - id: workers
            label: Workers
            type: service

      - id: donnees
        label: Données
        type: group
        role: category
        children:
          - id: base-donnees
            label: Base de données
            type: database
          - id: cache
            label: Cache
            type: service

  - id: clients
    label: Clients
    type: group
    role: domain
    children:
      - id: web
        label: Application web
        type: application
      - id: mobile
        label: Application mobile
        type: application

  - id: services-externes
    label: Services externes
    type: group
    role: domain
    children:
      - id: paiement
        label: Paiement
        type: external
      - id: email
        label: E-mail
        type: external

links:
  - from: web
    to: api
    label: requêtes HTTPS
  - from: mobile
    to: api
    label: requêtes HTTPS
  - from: api
    to: base-donnees
    label: lectures / écritures
  - from: api
    to: cache
    label: mise en cache
  - from: api
    to: paiement
    label: paiement
  - from: api
    to: email
    label: notifications

style:
  size: 1
  rules:
    - target: api
      highlight: true
`;

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  function checkTabs(text) {
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (/^[ \t]*\t/.test(lines[i])) {
        throw new Error(`Tabulation détectée à la ligne ${i + 1}. L’indentation YAML doit utiliser des espaces.`);
      }
    }
  }

  // ---------- reference resolution ----------

  const indexCache = new WeakMap();

  function indexOf(model) {
    let ix = indexCache.get(model.nodes);
    if (ix) return ix;
    ix = { byQ: new Map(), byLocal: new Map() };
    model.nodes.forEach((n) => {
      ix.byQ.set(n.qualifiedId, n);
      if (!ix.byLocal.has(n.localId)) ix.byLocal.set(n.localId, []);
      ix.byLocal.get(n.localId).push(n);
    });
    indexCache.set(model.nodes, ix);
    return ix;
  }

  function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      for (let j = 1; j <= b.length; j += 1) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function closest(ref, nodes, max) {
    const last = String(ref).split(".").pop().toLowerCase();
    const limit = Math.max(1, Math.floor(last.length / 3));
    return nodes
      .map((n) => ({ q: n.qualifiedId, d: levenshtein(last, n.localId.toLowerCase()) }))
      .filter((c) => c.d <= limit)
      .sort((a, b) => a.d - b.d || a.q.localeCompare(b.q))
      .slice(0, max || 3)
      .map((c) => c.q);
  }

  function sharedPrefix(a, b) {
    const sa = a.split(".");
    const sb = b.split(".");
    let i = 0;
    while (i < sa.length && i < sb.length && sa[i] === sb[i]) i += 1;
    return i;
  }

  function resolveRef(ref, model, contextId) {
    const r = String(ref === undefined || ref === null ? "" : ref).trim();
    if (!r) return { error: "unknown", candidates: [] };
    const ix = indexOf(model);

    const exact = ix.byQ.get(r);
    if (exact) return { id: exact.id };

    const locals = ix.byLocal.get(r) || [];
    if (locals.length === 1) return { id: locals[0].id };

    const ctx = contextId !== undefined && contextId !== null && model.byId ? model.byId.get(contextId) : null;
    if (ctx) {
      let q = ctx.qualifiedId;
      for (;;) {
        const hit = ix.byQ.get(`${q}.${r}`);
        if (hit) return { id: hit.id };
        const cut = q.lastIndexOf(".");
        if (cut < 0) break;
        q = q.slice(0, cut);
      }
    }

    const matches = model.nodes.filter((n) => n.qualifiedId.endsWith(`.${r}`));
    if (matches.length === 1) return { id: matches[0].id };
    if (matches.length > 1) {
      const base = ctx ? ctx.qualifiedId : "";
      const candidates = matches
        .map((n) => n.qualifiedId)
        .sort((a, b) => sharedPrefix(b, base) - sharedPrefix(a, base) || a.localeCompare(b))
        .slice(0, 3);
      return { error: "ambiguous", candidates };
    }
    return { error: "unknown", candidates: closest(r, model.nodes, 3) };
  }

  function quoteList(items) {
    const q = items.map((c) => `\`${c}\``);
    if (q.length < 2) return q.join("");
    return `${q.slice(0, -1).join(", ")} ou ${q[q.length - 1]}`;
  }

  // Shared by the single-file parser and the merger: turns a failed resolution into an anomaly body.
  function refProblem(key, ref, res, fromDisp, toDisp) {
    const ambiguous = res.error === "ambiguous";
    const hint = res.candidates.length ? ` : vouliez-vous dire ${quoteList(res.candidates)} ?` : "";
    const what = key === "from" ? "source" : "cible";
    const message = ambiguous
      ? `Lien de \`${fromDisp}\` vers \`${toDisp}\` ambigu${hint}`
      : `Lien de \`${fromDisp}\` vers \`${toDisp}\` : ${what} inconnue \`${ref}\`${hint ? ` — vouliez-vous dire ${quoteList(res.candidates)} ?` : ""}`;
    return {
      code: ambiguous ? "ambiguous-ref" : "unknown-ref",
      message,
      candidates: res.candidates,
      fixes: res.candidates.map((newRef) => ({ key, oldRef: ref, newRef }))
    };
  }

  // ---------- parsing ----------

  function nodeLineFinder(lines) {
    let cursor = 0;
    return (rawId) => {
      const re = new RegExp(`^\\s*(?:-\\s+)?id\\s*:\\s*["']?${escapeRe(rawId)}["']?\\s*(?:#.*)?$`);
      for (let i = cursor; i < lines.length; i += 1) {
        if (re.test(lines[i].replace(/\r$/, ""))) {
          cursor = i + 1;
          return i;
        }
      }
      return -1;
    };
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function linkLines(lines) {
    const start = lines.findIndex((l) => /^(links|liens)\s*:/.test(l));
    if (start < 0) return [];
    const out = [];
    let indent = -1;
    for (let i = start + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (/^\S/.test(l) && !l.startsWith("-")) {
        if (l.startsWith("#")) continue;
        break;
      }
      const m = /^(\s*)-(\s|$)/.exec(l);
      if (m && (indent < 0 || m[1].length === indent)) {
        indent = m[1].length;
        out.push(i);
      }
    }
    return out;
  }

  function collectNodes(list, anomalies, findLine) {
    const flat = [];
    const seen = new Set();
    let auto = 0;

    const walk = (items, parentQ) => {
      items.forEach((n) => {
        let rawId = String(n.id === undefined || n.id === null ? "" : n.id).trim();
        const line = rawId ? findLine(rawId) : -1;
        if (!rawId) {
          auto += 1;
          rawId = `node-${auto}`;
          anomalies.push({ level: "warning", code: "missing-id", message: `Un nœud n’a pas d’« id » : « ${rawId} » lui est attribué.`, line });
        }
        const dotted = rawId.includes(".");
        const qualifiedId = dotted || !parentQ ? rawId : `${parentQ}.${rawId}`;
        if (seen.has(qualifiedId)) {
          anomalies.push({ level: "error", code: "duplicate-id", message: `L’identifiant « ${qualifiedId} » est utilisé plusieurs fois.`, ref: qualifiedId, line });
          return;
        }
        seen.add(qualifiedId);
        const rec = {
          localId: qualifiedId.split(".").pop(),
          qualifiedId,
          label: n.label,
          type: n.type,
          role: n.role,
          meta: isObj(n.meta) ? n.meta : {},
          parentQ,
          hasChildren: Array.isArray(n.children) && n.children.length > 0,
          line
        };
        flat.push(rec);
        if (Array.isArray(n.children)) walk(n.children, qualifiedId);
      });
    };
    walk(list, null);
    return flat;
  }

  function buildNodes(flat) {
    const counts = new Map();
    flat.forEach((r) => counts.set(r.localId, (counts.get(r.localId) || 0) + 1));
    const byQ = new Map();
    const nodes = flat.map((r) => {
      const node = {
        id: counts.get(r.localId) === 1 ? r.localId : r.qualifiedId,
        localId: r.localId,
        qualifiedId: r.qualifiedId,
        label: String(r.label || r.localId),
        type: String(r.type || (r.hasChildren ? "group" : "node")),
        role: r.role ? String(r.role) : null,
        parent: null,
        children: [],
        meta: r.meta,
        line: r.line,
        _parentQ: r.parentQ
      };
      byQ.set(r.qualifiedId, node);
      return node;
    });
    nodes.forEach((n) => {
      if (n._parentQ && byQ.has(n._parentQ)) {
        n.parent = byQ.get(n._parentQ).id;
        byQ.get(n._parentQ).children.push(n.id);
      }
      delete n._parentQ;
    });
    return nodes;
  }

  // ---------- link anchors (fromSide / toSide) ----------

  const SIDE_NAMES = ["top", "right", "bottom", "left"];

  // "top" | "right" | "bottom" | "left" (case-insensitive) or "" for auto / anything else (pure).
  function normalizeSide(value) {
    const side = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
    return SIDE_NAMES.includes(side) ? side : "";
  }

  // Cytoscape endpoint (percentages of the node box from its centre) of a side, shifted along the side
  // by `shift` (fraction of the side length, 0 = middle). Null for auto / invalid sides (pure).
  function sideEndpoint(side, shift) {
    const name = normalizeSide(side);
    if (!name) return null;
    const along = Math.round((Number(shift) || 0) * 100) || 0;
    if (name === "top") return `${along}% -50%`;
    if (name === "bottom") return `${along}% 50%`;
    if (name === "left") return `-50% ${along}%`;
    return `50% ${along}%`;
  }

  // Evenly spread positions (fractions of the side length, centred on 0) for n ends on one side (pure).
  function spreadOffsets(count, span) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const width = span === undefined ? 0.7 : span;
    return Array.from({ length: n }, (_, i) => (n < 2 ? 0 : ((i + 1) / (n + 1) - 0.5) * width * (n + 1) / n));
  }

  function buildLinks(rawLinks, model, anomalies, lines) {
    const starts = linkLines(lines);
    const links = [];
    rawLinks.forEach((l, i) => {
      const line = starts[i] === undefined ? -1 : starts[i];
      const from = String(l.from === undefined || l.from === null ? "" : l.from).trim();
      const to = String(l.to === undefined || l.to === null ? "" : l.to).trim();
      if (!from || !to) {
        anomalies.push({ level: "error", code: "unknown-ref", message: `Le lien n°${i + 1} doit définir « from » et « to ».`, line });
        return;
      }
      const rf = resolveRef(from, model);
      const rt = resolveRef(to, model);
      const bad = [];
      if (rf.error) bad.push(["from", from, rf]);
      if (rt.error) bad.push(["to", to, rt]);
      bad.forEach(([key, ref, res]) => {
        const p = refProblem(key, ref, res, rf.id || from, rt.id || to);
        anomalies.push({ level: "error", code: p.code, message: p.message, ref, candidates: p.candidates, fixes: p.fixes, fix: p.fixes[0], path: `links[${i}]`, line });
      });
      if (bad.length) return;
      if (rf.id === rt.id) {
        anomalies.push({ level: "warning", code: "self-link", message: `Le lien n°${i + 1} relie « ${from} » à lui-même : ignoré.`, path: `links[${i}]`, line });
        return;
      }
      const link = { from: rf.id, to: rt.id, label: l.label ? String(l.label) : "", type: l.type ? String(l.type) : "", meta: isObj(l.meta) ? l.meta : {}, style: isObj(l.style) ? l.style : {}, line };
      if (normalizeSide(l.fromSide)) link.fromSide = normalizeSide(l.fromSide);
      if (normalizeSide(l.toSide)) link.toSide = normalizeSide(l.toSide);
      links.push(link);
    });
    return links;
  }

  function buildStyle(style, model, anomalies) {
    const out = { size: style && style.size !== undefined ? style.size : 1, rules: [] };
    ["presets", "roles", "types", "links"].forEach((k) => { if (style && style[k] !== undefined) out[k] = style[k]; });
    ((style && style.rules) || []).forEach((rule) => {
      const res = resolveRef(rule.target, model);
      if (res.error) {
        anomalies.push({ level: "warning", code: "obsolete-style-rule", message: `Règle de style ignorée : cible « ${rule.target} » ${res.error === "ambiguous" ? "ambiguë" : "inconnue"}.`, ref: rule.target, candidates: res.candidates });
        return;
      }
      out.rules.push({ ...rule, target: res.id });
    });
    return out;
  }

  function buildView(view, model, anomalies) {
    const v = view || {};
    const out = { collapsed: [], zoom: v.zoom === undefined ? null : v.zoom, pan: v.pan || null, layout: v.layout || null, positions: {} };
    (Array.isArray(v.collapsed) ? v.collapsed : []).forEach((ref) => {
      const res = resolveRef(ref, model);
      if (res.error) {
        anomalies.push({ level: "warning", code: "unknown-ref", message: `Vue : groupe replié « ${ref} » inconnu, ignoré.`, ref: String(ref), candidates: res.candidates });
      } else {
        out.collapsed.push(res.id);
      }
    });
    Object.entries(isObj(v.positions) ? v.positions : {}).forEach(([ref, pos]) => {
      const res = resolveRef(ref, model);
      if (!res.error) out.positions[res.id] = pos;
    });
    return out;
  }

  function parse(text) {
    checkTabs(text);
    const raw = jsyaml.load(text);
    if (!isObj(raw)) throw new Error("Le YAML doit contenir un objet racine.");
    const doc = Schema.normalize(raw);
    if (!Array.isArray(doc.nodes)) throw new Error("Le YAML doit contenir une liste « nodes ».");

    const anomalies = [];
    const lines = String(text).split("\n");
    const flat = collectNodes(doc.nodes, anomalies, nodeLineFinder(lines));
    const nodes = buildNodes(flat);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const model = { title: String(doc.title || "Architecture"), nodes, links: [], byId, anomalies };

    model.links = buildLinks(doc.links || [], model, anomalies, lines);
    model.style = buildStyle(doc.style, model, anomalies);
    model.view = buildView(doc.view, model, anomalies);
    return model;
  }

  // ---------- visibility & helpers ----------

  function isVisible(id, model, collapsed) {
    let cur = model.byId.get(id);
    while (cur && cur.parent) {
      if (collapsed.has(cur.parent)) return false;
      cur = model.byId.get(cur.parent);
    }
    return true;
  }

  function visibleAncestor(id, model, collapsed) {
    let cur = model.byId.get(id);
    while (cur.parent && !isVisible(cur.id, model, collapsed)) cur = model.byId.get(cur.parent);
    return cur.id;
  }

  function pathLabel(id, model) {
    const parts = [];
    let cur = model.byId.get(id);
    while (cur) {
      parts.unshift(cur.label);
      cur = cur.parent ? model.byId.get(cur.parent) : null;
    }
    return parts.join(" › ");
  }

  function depth(id, model) {
    let level = 0;
    let cur = model.byId.get(id);
    while (cur && cur.parent) {
      level += 1;
      cur = model.byId.get(cur.parent);
    }
    return level;
  }

  function metaSummary(node) {
    const keys = node.meta && Array.isArray(node.meta.show) ? node.meta.show : [];
    return keys
      .map((k) => (node.meta[k] ? `${k} : ${node.meta[k]}` : null))
      .filter(Boolean)
      .join(" · ");
  }

  function buildElements(model, collapsed) {
    const elements = [];
    model.nodes.forEach((n) => {
      if (!isVisible(n.id, model, collapsed)) return;
      const isGroup = n.children.length > 0;
      const isCollapsed = collapsed.has(n.id);
      const summary = isGroup && isCollapsed ? metaSummary(n) : "";
      elements.push({
        group: "nodes",
        data: {
          id: n.id,
          label: summary ? `${n.label}\n${summary}` : n.label,
          parent: n.parent,
          type: n.type,
          role: n.role,
          meta: n.meta,
          isGroup,
          isCollapsed,
          depth: depth(n.id, model)
        },
        classes: [isGroup ? "group" : "node", isCollapsed ? "collapsed" : ""].filter(Boolean).join(" ")
      });
    });

    const edges = new Map();
    model.links.forEach((link) => {
      const source = visibleAncestor(link.from, model, collapsed);
      const target = visibleAncestor(link.to, model, collapsed);
      if (source === target) return;
      const isMeta = source !== link.from || target !== link.to;
      const key = `${source}=>${target}`;
      if (edges.has(key)) {
        edges.get(key).data.count += 1;
        return;
      }
      edges.set(key, {
        group: "edges",
        data: { id: key, source, target, label: link.label, count: 1, isMeta, ...(isMeta ? {} : { fromSide: link.fromSide || "", toSide: link.toSide || "" }) },
        classes: isMeta ? "meta" : "normal"
      });
    });
    edges.forEach((e) => {
      if (e.data.count > 1) e.data.label = `${e.data.label ? `${e.data.label} ` : ""}×${e.data.count}`;
      elements.push(e);
    });
    return elements;
  }

  function linksOf(id, model) {
    return {
      outgoing: model.links.filter((l) => l.from === id),
      incoming: model.links.filter((l) => l.to === id)
    };
  }

  function toMermaid(model) {
    const lines = ["flowchart TD"];
    const ident = (id) => `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const text = (s) => String(s).replace(/"/g, "'");
    const emit = (id, indent) => {
      const n = model.byId.get(id);
      if (n.children.length) {
        lines.push(`${indent}subgraph ${ident(n.id)}["${text(n.label)}"]`);
        n.children.forEach((c) => emit(c, `${indent}  `));
        lines.push(`${indent}end`);
      } else {
        lines.push(`${indent}${ident(n.id)}["${text(n.label)}"]`);
      }
    };
    model.nodes.filter((n) => !n.parent).forEach((n) => emit(n.id, "  "));
    model.links.forEach((l) => {
      const label = l.label ? `|"${text(l.label)}"|` : "";
      lines.push(`  ${ident(l.from)} -->${label} ${ident(l.to)}`);
    });
    return lines.join("\n");
  }

  // ---------- textual editing ----------

  function isEmptyValue(obj) {
    if (obj === null || obj === undefined) return true;
    if (Array.isArray(obj)) return obj.length === 0;
    if (typeof obj === "object") return Object.keys(obj).filter((k) => obj[k] !== undefined).length === 0;
    return false;
  }

  function findBlock(lines, names) {
    const re = new RegExp(`^(?:${names.map(escapeRe).join("|")})\\s*:`);
    const start = lines.findIndex((l) => re.test(l));
    if (start < 0) return null;
    let end = start + 1;
    let last = start;
    for (; end < lines.length; end += 1) {
      const l = lines[end];
      if (/^[^\s#-]/.test(l)) break;
      if (l.trim() !== "" && !l.startsWith("#")) last = end;
    }
    return { start, end: last + 1 };
  }

  function replaceTopLevelBlock(text, key, obj) {
    const names = [key, ...(Schema.ROOT_ALIASES[key] || [])];
    const lines = String(text).split("\n");
    const block = findBlock(lines, names);
    const dumped = isEmptyValue(obj) ? [] : jsyaml.dump({ [key]: obj }, { lineWidth: -1, noRefs: true }).replace(/\n$/, "").split("\n");

    if (block) {
      let { end } = block;
      if (!dumped.length && lines[end] !== undefined && lines[end].trim() === "") end += 1;
      lines.splice(block.start, end - block.start, ...dumped);
      return lines.join("\n");
    }
    if (!dumped.length) return text;
    const base = String(text).replace(/\s+$/, "");
    return `${base}\n\n${dumped.join("\n")}\n`;
  }

  function findNodeLine(text, localId) {
    const re = new RegExp(`^\\s*-\\s+id\\s*:\\s*["']?${escapeRe(localId)}["']?\\s*(?:#.*)?$`);
    return String(text).split("\n").findIndex((l) => re.test(l.replace(/\r$/, "")));
  }

  return {
    DEFAULT_YAML,
    parse,
    resolveRef,
    refProblem,
    closest,
    isVisible,
    visibleAncestor,
    pathLabel,
    depth,
    metaSummary,
    buildElements,
    normalizeSide,
    sideEndpoint,
    spreadOffsets,
    linksOf,
    toMermaid,
    replaceTopLevelBlock,
    findNodeLine
  };
});
