"use strict";

// Pure translation of an edit made on the merged document into edits of the small brick YAML files.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./schema.js"), require("./model.js"), require("./merge.js"), require("./doc-edit.js"), (() => { try { return require("js-yaml"); } catch (e) { return require("../vendor/js-yaml.js"); } })());
  } else {
    root.ProjectSync = factory(root.Schema, root.Model, root.Merge, root.DocEdit, root.jsyaml);
  }
})(typeof self !== "undefined" ? self : this, function (Schema, Model, Merge, DocEdit, jsyaml) {
  const ROOT_FILE = "brick.yaml";
  const OUTPUT = "architecture.yaml";
  const NODE_KEYS = ["nodes", "noeuds", "links", "liens"];
  const SEP = "\u0001";

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  function refuse(message) {
    const error = new Error(message);
    error.refusal = true;
    throw error;
  }

  function loadRaw(text) {
    const raw = jsyaml.load(text);
    if (!isObj(raw)) throw new Error("Le YAML doit contenir un objet racine.");
    return raw;
  }

  // ---------- merged document index ----------

  function flatten(rawNodes) {
    const map = new Map();
    const tops = [];
    const walk = (list, parent) => (list || []).forEach((n) => {
      const id = isObj(n) ? str(n.id) : "";
      if (!id) return;
      const key = id.includes(".") || !parent ? id : `${parent}.${id}`;
      if (map.has(key)) return;
      map.set(key, { key, raw: n, parent, children: [] });
      if (parent) map.get(parent).children.push(key);
      else tops.push(key);
      walk(n.children, key);
    });
    walk(rawNodes, null);
    return { map, tops };
  }

  const metaOf = (rec) => (isObj(rec.raw.meta) ? rec.raw.meta : {});
  const sourceOf = (rec) => metaOf(rec).source;

  function cleanMeta(meta) {
    const out = { ...(isObj(meta) ? meta : {}) };
    delete out.source;
    delete out.sourceId;
    return Object.keys(out).length ? out : undefined;
  }

  // brick = node of a brick file, inner = node declared inside a file, dir = folder without brick file.
  function kindOf(map, rec) {
    const source = sourceOf(rec);
    if (source === undefined) return "dir";
    const parent = rec.parent ? map.get(rec.parent) : null;
    if (source !== ROOT_FILE && (!parent || sourceOf(parent) !== source)) return "brick";
    return "inner";
  }

  function chainOf(map, rec) {
    const ids = [];
    for (let cur = rec; cur && kindOf(map, cur) === "inner"; cur = cur.parent ? map.get(cur.parent) : null) {
      ids.unshift(str(metaOf(cur).sourceId));
    }
    return ids.join(".");
  }

  function registryOf(map) {
    const nodes = [...map.values()].map((r) => ({ id: r.key, qualifiedId: r.key, localId: r.key.split(".").pop() }));
    return { nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
  }

  function buildIndex(text) {
    const raw = loadRaw(text);
    const flat = flatten(Schema.normalize(raw).nodes);
    const bricks = new Map();
    flat.map.forEach((rec) => { if (kindOf(flat.map, rec) === "brick") bricks.set(sourceOf(rec), rec.key); });
    return { raw, ...flat, bricks, reg: registryOf(flat.map), model: Model.parse(text) };
  }

  // ---------- file store ----------

  function createStore(files) {
    const original = new Map(files.map((f) => [f.path, f.text]));
    const texts = new Map(original);
    const created = new Set();
    return {
      has: (path) => texts.has(path),
      get(path) {
        if (!texts.has(path)) {
          created.add(path);
          texts.set(path, `title: Architecture\n`);
        }
        return texts.get(path);
      },
      set: (path, text) => texts.set(path, text),
      paths: () => [...texts.keys()],
      result() {
        const out = {};
        texts.forEach((text, path) => { if (text !== original.get(path)) out[path] = text; });
        return { files: out, created: [...created] };
      }
    };
  }

  // DocEdit needs a `nodes` list: adds a temporary empty one to files that have none.
  function runEdit(store, path, fn) {
    const base = store.get(path);
    let raw;
    try {
      raw = loadRaw(base);
    } catch (error) {
      refuse(`Le fichier « ${path} » est illisible : ${error.message}`);
    }
    const shim = !Array.isArray(raw.nodes) && !Array.isArray(raw.noeuds) && !("nodes" in raw) && !("noeuds" in raw);
    let out = fn(shim ? `${base.replace(/\s*$/, "\n")}nodes: []\n` : base);
    if (shim) {
      const check = loadRaw(out);
      if (Array.isArray(check.nodes) && check.nodes.length === 0) out = DocEdit.setTopLevel(out, "nodes", []);
    }
    store.set(path, out);
  }

  function internalId(text, chain, path) {
    const node = Model.parse(text).nodes.find((n) => n.qualifiedId === chain);
    if (!node) refuse(`Brique « ${chain} » introuvable dans « ${path} » : reconstruisez le projet puis réessayez.`);
    return node.id;
  }

  // ---------- links ----------

  const qOf = (model, ref) => {
    const res = Model.resolveRef(ref, model);
    return res.error ? null : model.byId.get(res.id).qualifiedId;
  };

  function linkRecords(raw, model) {
    return (Schema.normalize(raw).links || []).map((l, i) => ({
      i,
      from: qOf(model, l.from),
      to: qOf(model, l.to),
      label: l.label === undefined ? "" : String(l.label),
      meta: cleanMeta(l.meta),
      source: isObj(l.meta) ? l.meta.source : undefined
    })).filter((l) => l.from && l.to);
  }

  const linkKey = (l) => [l.from, l.to, l.label, JSON.stringify(l.meta || null)].join(SEP);
  const score = (a, b) => Number(a.from === b.from) + Number(a.to === b.to) + Number(a.label === b.label);

  // Pairs old and new links of one source file: { same, pairs: [[old, new]], removed, added }.
  function matchLinks(olds, news) {
    const rest = news.slice();
    const left = [];
    olds.forEach((o) => {
      const at = rest.findIndex((n) => linkKey(n) === linkKey(o));
      if (at >= 0) rest.splice(at, 1);
      else left.push(o);
    });
    const pairs = [];
    const candidates = [];
    left.forEach((o) => rest.forEach((n) => candidates.push({ o, n, s: score(o, n) })));
    candidates.sort((a, b) => b.s - a.s);
    const usedO = new Set();
    const usedN = new Set();
    candidates.forEach(({ o, n, s }) => {
      if (s > 0 && !usedO.has(o) && !usedN.has(n)) { pairs.push([o, n]); usedO.add(o); usedN.add(n); }
    });
    const leftO = left.filter((o) => !usedO.has(o));
    const leftN = rest.filter((n) => !usedN.has(n));
    while (leftO.length && leftN.length) pairs.push([leftO.shift(), leftN.shift()]);
    return { pairs, removed: leftO, added: leftN };
  }

  function replayLinks(ctx, path) {
    const text = ctx.store.get(path);
    const raw = loadRaw(text);
    const brick = ctx.old.bricks.get(path);
    const links = Schema.normalize({ links: raw.links !== undefined ? raw.links : raw.liens }).links || [];
    const out = [];
    links.forEach((l, index) => {
      const from = str(l.from);
      const to = str(l.to);
      if (!from || !to) return;
      const rf = Model.resolveRef(from, ctx.old.reg, brick || null);
      const rt = Model.resolveRef(to, ctx.old.reg, brick || null);
      if (rf.error || rt.error || rf.id === rt.id) return;
      out.push({ index, from: rf.id, to: rt.id });
    });
    return out;
  }

  function planLinks(ctx) {
    const olds = linkRecords(ctx.old.raw, ctx.old.model);
    const news = linkRecords(ctx.nw.raw, ctx.nw.model);
    const sources = new Set(olds.map((l) => l.source).filter((s) => s !== undefined));
    const plan = { modify: [], remove: [], add: [] };

    sources.forEach((path) => {
      const mine = olds.filter((l) => l.source === path);
      const m = matchLinks(mine, news.filter((l) => l.source === path));
      if (!m.pairs.length && !m.removed.length) return;
      const replay = replayLinks(ctx, path);
      if (replay.length !== mine.length || replay.some((r, k) => r.from !== mine[k].from || r.to !== mine[k].to)) {
        refuse(`Les liens de « ${path} » ne correspondent plus au YAML fusionné : reconstruisez le projet puis réessayez.`);
      }
      const indexOf = (o) => replay[mine.indexOf(o)].index;
      m.pairs.forEach(([o, n]) => {
        const patch = {};
        if (o.from !== n.from) patch.from = n.from;
        if (o.to !== n.to) patch.to = n.to;
        if (o.label !== n.label) patch.label = n.label || null;
        if (Object.keys(patch).length) plan.modify.push({ path, index: indexOf(o), patch });
      });
      m.removed.forEach((o) => plan.remove.push({ path, index: indexOf(o) }));
      m.added.forEach((n) => plan.add.push({ link: n }));
    });
    plan.add.push(...news.filter((l) => l.source === undefined).map((link) => ({ link })));
    return plan;
  }

  function applyLinkEdits(ctx, plan) {
    plan.modify.forEach(({ path, index, patch }) => runEdit(ctx.store, path, (t) => DocEdit.updateLink(t, index, patch)));
    const byFile = new Map();
    plan.remove.forEach(({ path, index }) => byFile.set(path, (byFile.get(path) || []).concat(index)));
    byFile.forEach((indexes, path) => runEdit(ctx.store, path, (t) => DocEdit.removeLinks(t, indexes)));
  }

  function fileOfKey(ctx, key) {
    const rec = ctx.old.map.get(key);
    if (rec && kindOf(ctx.old.map, rec) !== "dir") return sourceOf(rec);
    return ctx.addedFile.get(key) || ROOT_FILE;
  }

  function applyLinkAdds(ctx, plan) {
    plan.add.forEach(({ link }) => {
      const obj = { from: link.from, to: link.to };
      if (link.label) obj.label = link.label;
      if (link.meta) obj.meta = link.meta;
      runEdit(ctx.store, fileOfKey(ctx, link.from), (t) => DocEdit.addLink(t, obj));
    });
  }

  // ---------- nodes ----------

  function identOf(rec) {
    const m = metaOf(rec);
    return m.source !== undefined && m.sourceId !== undefined ? `${m.source}${SEP}${m.sourceId}` : null;
  }

  // newKey -> oldKey for nodes present on both sides (even when their qualified key changed).
  function matchNodes(old, nw) {
    const byIdent = new Map();
    old.map.forEach((rec) => {
      const id = identOf(rec);
      if (id !== null) byIdent.set(id, (byIdent.get(id) || []).concat(rec.key));
    });
    const match = new Map();
    nw.map.forEach((rec) => {
      const twin = old.map.get(rec.key);
      const id = identOf(rec);
      if (twin && identOf(twin) === id) match.set(rec.key, rec.key);
      else if (id !== null && (byIdent.get(id) || []).length === 1) match.set(rec.key, byIdent.get(id)[0]);
    });
    return match;
  }

  function describe(rec) {
    return `« ${rec.raw.label || rec.key} »`;
  }

  function folderRefusal(rec, action) {
    return `${action} ${describe(rec)} revient à modifier un dossier ou un fichier brick.yaml entier : faites-le dans l’explorateur de fichiers, puis reconstruisez le projet.`;
  }

  function containerOf(ctx, oldParentKey) {
    if (oldParentKey === null) return { path: ROOT_FILE, parentChain: null };
    const rec = ctx.old.map.get(oldParentKey);
    const kind = kindOf(ctx.old.map, rec);
    if (kind === "dir") refuse(`${describe(rec)} est un dossier sans fichier brick.yaml : créez ce fichier dans l’explorateur, ou rangez dans une autre brique.`);
    return { path: sourceOf(rec), parentChain: kind === "brick" ? null : chainOf(ctx.old.map, rec) };
  }

  function planNodes(ctx) {
    const { old, nw } = ctx;
    const match = matchNodes(old, nw);
    const matchedOld = new Set(match.values());
    nw.map.forEach((rec) => {
      if (match.has(rec.key) && rec.parent && !match.has(rec.parent)) refuse("Opération trop complexe pour le mode projet (déplacement dans une brique créée dans la même action).");
    });
    const removed = [...old.map.values()].filter((r) => !matchedOld.has(r.key));
    const removedSet = new Set(removed.map((r) => r.key));
    const plan = { removed: removed.filter((r) => !r.parent || !removedSet.has(r.parent)), modified: [], moved: [], added: [], match };

    nw.map.forEach((rec) => {
      const oldKey = match.get(rec.key);
      if (oldKey === undefined) {
        if (!rec.parent || match.has(rec.parent)) plan.added.push(rec);
        return;
      }
      const before = old.map.get(oldKey);
      const newParent = rec.parent ? match.get(rec.parent) : null;
      if ((before.parent || null) !== newParent) plan.moved.push({ rec, before, newParent });
      const patch = nodePatch(before, rec);
      if (patch) plan.modified.push({ before, rec, patch });
    });
    return plan;
  }

  function nodePatch(before, rec) {
    const a = before.raw;
    const b = rec.raw;
    const patch = {};
    ["label", "type", "role"].forEach((k) => { if (!same(a[k], b[k])) patch[k] = b[k] === undefined ? null : b[k]; });
    const ma = cleanMeta(a.meta) || {};
    const mb = cleanMeta(b.meta) || {};
    if (!same(ma, mb)) {
      patch.meta = {};
      Object.keys(mb).forEach((k) => { if (!same(ma[k], mb[k])) patch.meta[k] = mb[k]; });
      Object.keys(ma).forEach((k) => { if (!(k in mb)) patch.meta[k] = null; });
    }
    return Object.keys(patch).length ? patch : null;
  }

  function applyRemoved(ctx, plan) {
    plan.removed.forEach((rec) => {
      if (kindOf(ctx.old.map, rec) !== "inner") refuse(folderRefusal(rec, "Supprimer"));
      const path = sourceOf(rec);
      const chain = chainOf(ctx.old.map, rec);
      runEdit(ctx.store, path, (t) => DocEdit.removeNodes(t, [internalId(t, chain, path)]).text);
    });
  }

  const BRICK_KEYS = { label: "title", type: "type", role: "role" };

  function labelKey(raw) {
    return ["title", "titre", "label"].find((k) => k in raw) === "label" ? "label" : "title";
  }

  function patchBrickFile(ctx, rec, next, patch) {
    const path = sourceOf(rec);
    let text = ctx.store.get(path);
    Object.keys(patch).forEach((k) => {
      const key = k === "label" ? labelKey(loadRaw(text)) : BRICK_KEYS[k] || k;
      let value = patch[k];
      if (k === "meta") value = cleanMeta(next.raw.meta);
      text = DocEdit.setTopLevel(text, key, value === null ? undefined : value);
    });
    ctx.store.set(path, text);
  }

  function applyModified(ctx, plan) {
    plan.modified.forEach(({ before, rec, patch }) => {
      const kind = kindOf(ctx.old.map, before);
      if (kind === "dir") refuse(`${describe(before)} est un dossier sans fichier brick.yaml : ses propriétés ne peuvent pas être enregistrées.`);
      if (kind === "brick") {
        patchBrickFile(ctx, before, rec, patch);
        return;
      }
      const path = sourceOf(before);
      const chain = chainOf(ctx.old.map, before);
      runEdit(ctx.store, path, (t) => DocEdit.updateNode(t, internalId(t, chain, path), patch));
    });
  }

  function subtreeKeys(map, key) {
    const out = [key];
    map.get(key).children.forEach((c) => out.push(...subtreeKeys(map, c)));
    return out;
  }

  function newQualified(ctx, move) {
    const parentQ = move.newParent === null ? "" : `${move.newParent}.`;
    const q = `${parentQ}${str(metaOf(move.before).sourceId)}`;
    const clash = ctx.old.map.has(q) && !subtreeKeys(ctx.old.map, move.before.key).includes(q);
    if (clash) refuse(`Impossible de déplacer ${describe(move.before)} : « ${q} » existe déjà à cet endroit.`);
    return q;
  }

  function applyMoved(ctx, plan) {
    plan.moved.forEach((move) => {
      const { before } = move;
      if (kindOf(ctx.old.map, before) !== "inner") refuse(folderRefusal(before, "Déplacer"));
      const target = containerOf(ctx, move.newParent);
      const from = sourceOf(before);
      const newQ = newQualified(ctx, move);
      subtreeKeys(ctx.old.map, before.key).forEach((k) => ctx.moveMap.set(k, newQ + k.slice(before.key.length)));
      if (from === target.path) moveInFile(ctx, before, target);
      else moveAcross(ctx, before, target);
      ctx.addedFile.set(newQ, target.path);
    });
  }

  function targetParent(t, target, path) {
    return target.parentChain === null ? null : internalId(t, target.parentChain, path);
  }

  function moveInFile(ctx, before, target) {
    const chain = chainOf(ctx.old.map, before);
    runEdit(ctx.store, target.path, (t) => DocEdit.moveNode(t, internalId(t, chain, target.path), targetParent(t, target, target.path)));
  }

  function moveAcross(ctx, before, target) {
    const path = sourceOf(before);
    const chain = chainOf(ctx.old.map, before);
    let carried;
    runEdit(ctx.store, path, (t) => {
      const res = DocEdit.removeNodes(t, [internalId(t, chain, path)], { keepLinks: true });
      carried = res.trashed[0];
      return res.text;
    });
    runEdit(ctx.store, target.path, (t) => DocEdit.addNode(t, targetParent(t, target, target.path), carried.node));
  }

  function cleanNode(n) {
    const meta = cleanMeta(n.meta);
    const id = n.meta && n.meta.sourceId !== undefined ? String(n.meta.sourceId) : String(n.id);
    const out = { id };
    if (n.label !== undefined && String(n.label) !== id) out.label = n.label;
    if (n.type !== undefined) out.type = n.type;
    if (n.role !== undefined) out.role = n.role;
    if (meta) out.meta = meta;
    if (Array.isArray(n.children) && n.children.length) out.children = n.children.map(cleanNode);
    return out;
  }

  function markAdded(ctx, node, parentQ, path) {
    const q = `${parentQ ? `${parentQ}.` : ""}${node.id}`;
    ctx.addedFile.set(q, path);
    (node.children || []).forEach((c) => markAdded(ctx, c, q, path));
  }

  function applyAdded(ctx, plan) {
    plan.added.forEach((rec) => {
      const parentOld = rec.parent === null ? null : plan.match.get(rec.parent);
      const target = containerOf(ctx, parentOld);
      const node = cleanNode(rec.raw);
      runEdit(ctx.store, target.path, (t) => DocEdit.addNode(t, targetParent(t, target, target.path), node));
      markAdded(ctx, node, parentOld, target.path);
    });
  }

  function planOrder(ctx, plan) {
    const parents = new Set([null, ...[...plan.match.values()]]);
    const movedKeys = new Set(plan.moved.map((m) => m.before.key));
    const out = [];
    parents.forEach((parentOld) => {
      const oldKids = parentOld === null ? ctx.old.tops : ctx.old.map.get(parentOld).children;
      const newParentKey = parentOld === null ? null : [...plan.match].find(([, o]) => o === parentOld)[0];
      const newKids = (newParentKey === null ? ctx.nw.tops : ctx.nw.map.get(newParentKey).children)
        .map((k) => plan.match.get(k)).filter((k) => k !== undefined && !movedKeys.has(k));
      const inner = oldKids.filter((k) => newKids.includes(k) && kindOf(ctx.old.map, ctx.old.map.get(k)) === "inner");
      const wanted = newKids.filter((k) => inner.includes(k));
      if (!same(inner, wanted)) out.push({ parentOld, wanted });
    });
    return out;
  }

  function applyOrder(ctx, plan) {
    planOrder(ctx, plan).forEach(({ parentOld, wanted }) => {
      const target = containerOf(ctx, parentOld);
      const first = ctx.old.map.get(wanted[0]);
      const path = sourceOf(first);
      wanted.forEach((key, index) => {
        const chain = chainOf(ctx.old.map, ctx.old.map.get(key));
        runEdit(ctx.store, path, (t) => DocEdit.moveNode(t, internalId(t, chain, path), targetParent(t, target, path), index));
      });
    });
  }

  // ---------- top-level blocks (style, view, trash, settings, title) -> root brick file ----------

  function applyTopLevel(ctx) {
    const keys = new Set([...Object.keys(ctx.old.raw), ...Object.keys(ctx.nw.raw)].filter((k) => !NODE_KEYS.includes(k)));
    keys.forEach((key) => {
      if (same(ctx.old.raw[key], ctx.nw.raw[key])) return;
      const value = ctx.nw.raw[key];
      ctx.store.set(ROOT_FILE, DocEdit.setTopLevel(ctx.store.get(ROOT_FILE), key, value === undefined || value === null ? undefined : value));
    });
  }

  // ---------- references broken by qualified-id changes after a move ----------

  function newRegistry(ctx) {
    const files = ctx.store.paths().map((path) => ({ path, text: ctx.store.get(path) }));
    return registryOf(flatten(Schema.normalize(Merge.mergeProject(files, { output: OUTPUT }).document).nodes).map);
  }

  function brokenBy(ctx, reg, ref, brick) {
    const res = Model.resolveRef(ref, ctx.old.reg, brick || null);
    const target = res.error ? undefined : ctx.moveMap.get(res.id);
    if (target === undefined) return null;
    const now = Model.resolveRef(ref, reg, brick || null);
    return !now.error && now.id === target ? null : target;
  }

  function healLinks(ctx, reg) {
    ctx.store.paths().forEach((path) => {
      if (path === OUTPUT || !Merge.isBrickFile(path)) return;
      let raw;
      try { raw = loadRaw(ctx.store.get(path)); } catch (e) { return; }
      const brick = ctx.old.bricks.get(path);
      (Schema.normalize({ links: raw.links !== undefined ? raw.links : raw.liens }).links || []).forEach((l, index) => {
        const patch = {};
        ["from", "to"].forEach((side) => {
          const fixed = brokenBy(ctx, reg, str(l[side]), brick);
          if (fixed) patch[side] = fixed;
        });
        if (Object.keys(patch).length) runEdit(ctx.store, path, (t) => DocEdit.updateLink(t, index, patch));
      });
    });
  }

  function healRoot(ctx, reg) {
    if (!ctx.store.has(ROOT_FILE)) return;
    const raw = loadRaw(ctx.store.get(ROOT_FILE));
    const fix = (ref) => brokenBy(ctx, reg, str(ref), null) || ref;
    const style = isObj(raw.style) ? raw.style : null;
    if (style && Array.isArray(style.rules)) {
      const rules = style.rules.map((r) => (isObj(r) && r.target !== undefined ? { ...r, target: fix(r.target) } : r));
      if (!same(rules, style.rules)) ctx.store.set(ROOT_FILE, DocEdit.setTopLevel(ctx.store.get(ROOT_FILE), "style", { ...style, rules }));
    }
    const view = isObj(raw.view) ? raw.view : null;
    if (!view) return;
    const next = { ...view };
    if (Array.isArray(view.collapsed)) next.collapsed = view.collapsed.map(fix);
    if (isObj(view.positions)) next.positions = Object.fromEntries(Object.entries(view.positions).map(([k, v]) => [fix(k), v]));
    if (!same(next, view)) ctx.store.set(ROOT_FILE, DocEdit.setTopLevel(ctx.store.get(ROOT_FILE), "view", next));
  }

  function heal(ctx) {
    if (!ctx.moveMap.size) return;
    const reg = newRegistry(ctx);
    healLinks(ctx, reg);
    healRoot(ctx, reg);
  }

  // ---------- public ----------

  function mergedText(files) {
    return Merge.toYaml(Merge.mergeProject(files, { output: OUTPUT }).document);
  }

  // files: [{path, text}], oldText/newText: merged YAML before/after the edit.
  // Returns { files: {path: newText}, created: [path], notes: [] } or throws an Error with `refusal: true`.
  function translate(files, oldText, newText) {
    const ctx = {
      store: createStore(files.filter((f) => f.path !== OUTPUT)),
      old: buildIndex(oldText),
      nw: buildIndex(newText),
      addedFile: new Map(),
      moveMap: new Map(),
      notes: []
    };
    const links = planLinks(ctx);
    const nodes = planNodes(ctx);

    applyLinkEdits(ctx, links);
    applyRemoved(ctx, nodes);
    applyModified(ctx, nodes);
    applyAdded(ctx, nodes);
    applyMoved(ctx, nodes);
    applyOrder(ctx, nodes);
    applyLinkAdds(ctx, links);
    applyTopLevel(ctx);
    heal(ctx);
    return { ...ctx.store.result(), notes: ctx.notes };
  }

  return { translate, mergedText, ROOT_FILE };
});
