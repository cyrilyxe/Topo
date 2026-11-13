"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./schema.js"), require("./model.js"), require("../vendor/yaml.js"));
  } else {
    root.DocEdit = factory(root.Schema, root.Model, root.YAML);
  }
})(typeof self !== "undefined" ? self : this, function (Schema, Model, YAML) {
  const ALIASES = {
    nodes: ["nodes", "noeuds"],
    children: ["children", "enfants"],
    links: ["links", "liens"],
    from: ["from", "de"],
    to: ["to", "vers"],
    label: ["label", "titre", "title"],
    settings: ["settings", "reglages"],
    trash: ["trash"],
    rules: ["rules", "regles"],
    target: ["target", "cible"],
    collapsed: ["collapsed", "replies"]
  };

  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const namesOf = (key) => ALIASES[key] || [key].concat((Schema.ROOT_ALIASES || {})[key] || []);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // ---------- low-level YAML helpers ----------

  function load(text) {
    const doc = YAML.parseDocument(String(text));
    if (doc.errors.length) throw new Error(`YAML invalide : ${doc.errors[0].message}`);
    if (!YAML.isMap(doc.contents)) throw new Error("Le YAML doit contenir un objet racine.");
    return doc;
  }

  const dump = (doc) => doc.toString({ lineWidth: 0 });
  const keyName = (pair) => String(YAML.isScalar(pair.key) ? pair.key.value : pair.key);

  function findPair(map, names) {
    return map.items.find((p) => names.includes(keyName(p)));
  }

  function getNode(map, key) {
    const pair = findPair(map, namesOf(key));
    return pair ? pair.value : undefined;
  }

  function removeKey(map, key) {
    const names = namesOf(key);
    map.items = map.items.filter((p) => !names.includes(keyName(p)));
  }

  function newSeq(doc) {
    return doc.createNode([]);
  }

  function getSeq(doc, map, key, create) {
    const existing = getNode(map, key);
    if (YAML.isSeq(existing)) return existing;
    if (!create) return null;
    const seq = newSeq(doc);
    const pair = findPair(map, namesOf(key));
    if (pair) pair.value = seq;
    else map.set(key, seq);
    return seq;
  }

  function dropIfEmpty(map, key, seq) {
    if (seq && seq.items.length === 0) removeKey(map, key);
  }

  // Assigns value under key (any alias), keeping comments of what already exists.
  // mode "merge": null deletes the key, objects are merged. mode "replace": objects are synced exactly.
  function assign(doc, map, key, value, mode) {
    const pair = findPair(map, namesOf(key));
    if (value === null || value === undefined) {
      if (mode === "merge") { removeKey(map, key); return; }
      if (value === undefined) { removeKey(map, key); return; }
    }
    if (!pair) { map.set(key, doc.createNode(value)); return; }
    const old = pair.value;
    if (isPlain(value) && YAML.isMap(old)) syncMap(doc, old, value, mode);
    else if (YAML.isScalar(old) && !isPlain(value) && !Array.isArray(value) && value !== null) old.value = value;
    else pair.value = doc.createNode(value);
  }

  function syncMap(doc, map, obj, mode) {
    if (mode === "replace") {
      map.items = map.items.filter((p) => keyName(p) in obj && obj[keyName(p)] !== undefined);
    }
    Object.keys(obj).forEach((k) => assign(doc, map, k, obj[k], mode));
    if (mode === "merge" && map.items.length === 0) map.flow = false;
  }

  // ---------- node resolution (internal id -> position in the document) ----------

  function indexNodes(doc, model) {
    const idByQ = new Map(model.nodes.map((n) => [n.qualifiedId, n.id]));
    const entries = new Map();
    const seen = new Set();
    let auto = 0;

    const visit = (seq, parentQ, parentId, owner) => {
      seq.items.forEach((item) => {
        const rawId = YAML.isMap(item) ? item.get("id") : undefined;
        let id = String(rawId === undefined || rawId === null ? "" : rawId).trim();
        if (!id) { auto += 1; id = `node-${auto}`; }
        const q = id.includes(".") || !parentQ ? id : `${parentQ}.${id}`;
        if (seen.has(q)) return;
        seen.add(q);
        const internal = idByQ.get(q);
        if (!YAML.isMap(item) || internal === undefined) return;
        entries.set(internal, { id: internal, map: item, seq, owner, parentId });
        const kids = getNode(item, "children");
        if (YAML.isSeq(kids)) visit(kids, q, internal, item);
      });
    };

    const top = getNode(doc.contents, "nodes");
    if (YAML.isSeq(top)) visit(top, null, null, doc.contents);
    return entries;
  }

  function open(text) {
    const doc = load(text);
    const model = Model.parse(String(text));
    return { doc, model, root: doc.contents, entries: indexNodes(doc, model) };
  }

  function entryOf(ctx, id) {
    const entry = ctx.entries.get(id);
    if (!entry) throw new Error(`Élément introuvable : « ${id} ».`);
    return entry;
  }

  function subtreeIds(model, id) {
    const out = [];
    const walk = (nid) => {
      out.push(nid);
      model.byId.get(nid).children.forEach(walk);
    };
    walk(id);
    return out;
  }

  function containerFor(ctx, parentId, create) {
    if (parentId === null || parentId === undefined) return { seq: getSeq(ctx.doc, ctx.root, "nodes", create), owner: ctx.root, key: "nodes" };
    const parent = entryOf(ctx, parentId);
    return { seq: getSeq(ctx.doc, parent.map, "children", create), owner: parent.map, key: "children" };
  }

  function detach(entry) {
    const at = entry.seq.items.indexOf(entry.map);
    entry.seq.items.splice(at, 1);
    if (entry.owner !== null && entry.parentId !== null) dropIfEmpty(entry.owner, "children", entry.seq);
    return at;
  }

  function insertAt(seq, item, index) {
    const at = index === undefined || index === null ? seq.items.length : clamp(index, 0, seq.items.length);
    seq.items.splice(at, 0, item);
  }

  // ---------- links ----------

  function rawLinks(ctx) {
    const seq = getSeq(ctx.doc, ctx.root, "links", false);
    return seq ? seq.items : [];
  }

  function endpoint(ctx, item, side) {
    if (!YAML.isMap(item)) return null;
    const value = getNode(item, side);
    const ref = YAML.isScalar(value) ? value.value : value;
    const res = Model.resolveRef(ref, ctx.model);
    return res.error ? null : res.id;
  }

  function setEndpoint(item, side, value) {
    const pair = findPair(item, namesOf(side));
    if (pair) {
      if (YAML.isScalar(pair.value)) pair.value.value = value;
      else pair.value = new YAML.Scalar(value);
    } else {
      item.set(side, value);
    }
  }

  function nearestSurvivor(model, id, removed) {
    let cur = model.byId.get(id).parent;
    while (cur !== null && removed.has(cur)) cur = model.byId.get(cur).parent;
    return cur === undefined ? null : cur;
  }

  function markRelinked(doc, item, original) {
    let meta = getNode(item, "meta");
    if (!YAML.isMap(meta)) {
      item.set("meta", doc.createNode({}));
      meta = item.get("meta", true);
    }
    const from = getNode(meta, "relinkedFrom");
    const merged = { ...(YAML.isMap(from) ? from.toJSON() : {}) };
    Object.keys(original).forEach((s) => { if (!(s in merged)) merged[s] = original[s]; });
    meta.set("relinkedFrom", doc.createNode(merged));
  }

  function planLinks(ctx, removed, relink) {
    return rawLinks(ctx).map((item, index) => {
      const from = endpoint(ctx, item, "from");
      const to = endpoint(ctx, item, "to");
      const hitFrom = from !== null && removed.has(from);
      const hitTo = to !== null && removed.has(to);
      if (!hitFrom && !hitTo) return null;
      const plan = { index, item, from, to, hitFrom, hitTo, drop: !relink };
      if (relink) planRelink(ctx.model, plan, removed);
      return plan;
    }).filter(Boolean);
  }

  function planRelink(model, plan, removed) {
    plan.newFrom = plan.hitFrom ? nearestSurvivor(model, plan.from, removed) : plan.from;
    plan.newTo = plan.hitTo ? nearestSurvivor(model, plan.to, removed) : plan.to;
    plan.drop = plan.newFrom === null || plan.newTo === null || plan.newFrom === plan.newTo;
  }

  function applyRelinks(ctx, plans) {
    plans.filter((p) => !p.drop).forEach((p) => {
      const original = {};
      if (p.hitFrom) { setEndpoint(p.item, "from", p.newFrom); original.from = p.from; }
      if (p.hitTo) { setEndpoint(p.item, "to", p.newTo); original.to = p.to; }
      markRelinked(ctx.doc, p.item, original);
    });
  }

  function dropLinks(ctx, plans) {
    const seq = getSeq(ctx.doc, ctx.root, "links", false);
    const dead = new Set(plans.filter((p) => p.drop).map((p) => p.item));
    if (!seq || !dead.size) return;
    seq.items = seq.items.filter((item) => !dead.has(item));
    dropIfEmpty(ctx.root, "links", seq);
  }

  // ---------- public: nodes ----------

  function addNode(text, parentId, nodeObj, index) {
    const ctx = open(text);
    if (!isPlain(nodeObj) || nodeObj.id === undefined || nodeObj.id === null || String(nodeObj.id).trim() === "") {
      throw new Error("Le nouveau nœud doit avoir un identifiant.");
    }
    const holder = containerFor(ctx, parentId === undefined ? null : parentId, true);
    const parentQ = parentId ? ctx.model.byId.get(parentId).qualifiedId : null;
    const id = String(nodeObj.id).trim();
    const q = id.includes(".") || !parentQ ? id : `${parentQ}.${id}`;
    if (ctx.model.nodes.some((n) => n.qualifiedId === q)) throw new Error(`L’identifiant « ${q} » existe déjà.`);
    insertAt(holder.seq, ctx.doc.createNode(nodeObj), index);
    return dump(ctx.doc);
  }

  function updateNode(text, id, patch) {
    const ctx = open(text);
    const entry = entryOf(ctx, id);
    Object.keys(patch || {}).forEach((key) => {
      if (key === "id" || key === "children") throw new Error(`La clé « ${key} » ne peut pas être modifiée par updateNode.`);
      assign(ctx.doc, entry.map, key, patch[key], "merge");
    });
    return dump(ctx.doc);
  }

  function topMost(model, ids) {
    const set = new Set(ids);
    return [...set].filter((id) => {
      let p = model.byId.get(id).parent;
      while (p !== null) {
        if (set.has(p)) return false;
        p = model.byId.get(p).parent;
      }
      return true;
    });
  }

  function removeNodes(text, ids, options = {}) {
    const ctx = open(text);
    ids.forEach((id) => entryOf(ctx, id));
    const roots = topMost(ctx.model, ids);
    const groups = roots.map((id) => subtreeIds(ctx.model, id));
    const removed = new Set([].concat(...groups));
    const plans = options.keepLinks ? [] : planLinks(ctx, removed, !!options.relinkToParent);

    const trashed = roots.map((id, i) => {
      const entry = entryOf(ctx, id);
      const mine = plans.filter((p) => p.drop && groups[i].includes(p.hitFrom ? p.from : p.to));
      return {
        node: entry.map.toJSON(),
        parentId: entry.parentId,
        index: entry.seq.items.indexOf(entry.map),
        ids: groups[i],
        links: mine.map((p) => ({ index: p.index, link: p.item.toJSON() }))
      };
    });

    applyRelinks(ctx, plans);
    dropLinks(ctx, plans);
    roots.forEach((id) => detach(entryOf(ctx, id)));
    return { text: dump(ctx.doc), trashed };
  }

  // New internal id of each moved node (old internal id -> new internal id), matching both subtrees in parallel.
  function movedIdMap(before, after, id, newQ) {
    const map = new Map();
    const pair = (oldNode, newNode) => {
      if (!newNode) return;
      map.set(oldNode.id, newNode.id);
      oldNode.children.forEach((c, i) => pair(before.byId.get(c), after.byId.get(newNode.children[i])));
    };
    pair(before.byId.get(id), after.nodes.find((n) => n.qualifiedId === newQ));
    return map;
  }

  function refTargets(ctx) {
    const out = [];
    const scalarRef = (holder, side) => {
      const pair = findPair(holder, namesOf(side));
      if (pair && YAML.isScalar(pair.value)) out.push({ ref: pair.value.value, set: (v) => { pair.value.value = v; } });
    };
    rawLinks(ctx).forEach((item) => { if (YAML.isMap(item)) { scalarRef(item, "from"); scalarRef(item, "to"); } });
    const style = getNode(ctx.root, "style");
    const rules = YAML.isMap(style) ? getNode(style, "rules") : null;
    if (YAML.isSeq(rules)) rules.items.forEach((r) => { if (YAML.isMap(r)) scalarRef(r, "target"); });
    const view = getNode(ctx.root, "view");
    if (!YAML.isMap(view)) return out;
    const collapsed = getNode(view, "collapsed");
    if (YAML.isSeq(collapsed)) collapsed.items.forEach((it) => { if (YAML.isScalar(it)) out.push({ ref: it.value, set: (v) => { it.value = v; } }); });
    const viewRefs = (holder) => {
      const hidden = getNode(holder, "collapsed");
      if (holder !== view && YAML.isSeq(hidden)) hidden.items.forEach((it) => { if (YAML.isScalar(it)) out.push({ ref: it.value, set: (v) => { it.value = v; } }); });
      const positions = getNode(holder, "positions");
      if (YAML.isMap(positions)) {
        positions.items.forEach((p) => {
          if (!YAML.isScalar(p.key)) p.key = new YAML.Scalar(p.key);
          out.push({ ref: p.key.value, set: (v) => { p.key.value = v; } });
        });
      }
    };
    viewRefs(view);
    const layouts = getNode(view, "layouts");
    if (YAML.isMap(layouts)) layouts.items.forEach((p) => { if (YAML.isMap(p.value)) viewRefs(p.value); });
    trashRefs(ctx, out);
    return out;
  }

  // Ids kept by trashed entries (parent, ids, links) follow renames and moves too.
  function trashRefs(ctx, out) {
    const trash = getNode(ctx.root, "trash");
    if (!YAML.isSeq(trash)) return;
    const scalarIn = (holder, key) => {
      const pair = findPair(holder, [key]);
      if (pair && YAML.isScalar(pair.value)) out.push({ ref: pair.value.value, set: (v) => { pair.value.value = v; } });
    };
    trash.items.forEach((entry) => {
      if (!YAML.isMap(entry)) return;
      scalarIn(entry, "parent");
      const ids = findPair(entry, ["ids"]);
      if (ids && YAML.isSeq(ids.value)) ids.value.items.forEach((it) => { if (YAML.isScalar(it)) out.push({ ref: it.value, set: (v) => { it.value = v; } }); });
      const links = findPair(entry, ["links"]);
      if (links && YAML.isSeq(links.value)) {
        links.value.items.forEach((l) => {
          const link = YAML.isMap(l) ? findPair(l, ["link"]) : null;
          if (link && YAML.isMap(link.value)) { scalarIn(link.value, "from"); scalarIn(link.value, "to"); }
        });
      }
    });
  }

  // Rewrites references whose resolution changed because a subtree moved (qualified paths changed).
  function rewriteRefs(ctx, before, after, moved) {
    refTargets(ctx).forEach((t) => {
      const old = Model.resolveRef(t.ref, before);
      if (old.error) return;
      const oldNode = before.byId.get(old.id);
      const expected = moved.has(old.id) ? after.byId.get(moved.get(old.id)) : after.nodes.find((n) => n.qualifiedId === oldNode.qualifiedId);
      if (!expected) return;
      const now = Model.resolveRef(t.ref, after);
      if (!now.error && now.id === expected.id) return;
      t.set(expected.id);
    });
  }

  function moveNode(text, id, newParentId, index) {
    const ctx = open(text);
    const entry = entryOf(ctx, id);
    const target = newParentId === undefined ? null : newParentId;
    if (target !== null) {
      entryOf(ctx, target);
      if (subtreeIds(ctx.model, id).includes(target)) throw new Error("Impossible de déplacer un nœud dans son propre sous-arbre.");
    }
    const rawId = YAML.isMap(entry.map) ? String(entry.map.get("id") === undefined ? "" : entry.map.get("id")).trim() : "";
    const targetQ = target === null ? null : ctx.model.byId.get(target).qualifiedId;
    const newQ = rawId.includes(".") || !targetQ ? (rawId || id) : `${targetQ}.${rawId}`;
    detach(entry);
    const holder = containerFor(ctx, target, true);
    insertAt(holder.seq, entry.map, index);
    const moved = dump(ctx.doc);
    const after = Model.parse(moved);
    const map = movedIdMap(ctx.model, after, id, newQ);
    rewriteRefs(ctx, ctx.model, after, map);
    return dump(ctx.doc);
  }

  // ---------- ids: generation (pure) and renaming ----------

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function slugify(text) {
    return String(text === undefined || text === null ? "" : text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const ID_SCHEMES = ["slug", "parent-slug", "type-n"];

  // info: { label, type, parent (local id of the parent or null) }.
  function idBase(scheme, info) {
    const slug = slugify(info && info.label) || "brique";
    if (scheme === "type-n") return slugify(info && info.type) || "brique";
    if (scheme === "parent-slug" && info && info.parent) return `${info.parent}-${slug}`;
    return slug;
  }

  // taken: Set of ids already used. The result is never in it.
  function autoId(scheme, info, taken) {
    const base = idBase(scheme, info);
    const used = taken instanceof Set ? taken : new Set(taken || []);
    if (scheme === "type-n") {
      const re = new RegExp(`^${escapeRe(base)}-(\\d+)$`);
      let n = 1;
      used.forEach((id) => { const m = re.exec(id); if (m) n = Math.max(n, Number(m[1]) + 1); });
      while (used.has(`${base}-${n}`)) n += 1;
      return `${base}-${n}`;
    }
    let candidate = base;
    for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;
    return candidate;
  }

  // True when `id` is what the scheme would have produced (possibly with a -2, -3 suffix).
  function isAutoId(scheme, info, id) {
    const base = idBase(scheme, info);
    const suffixed = new RegExp(`^${escapeRe(base)}-\\d+$`).test(String(id));
    return scheme === "type-n" ? suffixed : String(id) === base || suffixed;
  }

  function usedIds(model, except) {
    const used = new Set();
    model.nodes.forEach((n) => { if (n !== except) [n.id, n.localId, n.qualifiedId].forEach((v) => used.add(v)); });
    return used;
  }

  function renameId(text, oldId, newId) {
    const next = String(newId === undefined || newId === null ? "" : newId).trim();
    const ctx = open(text);
    const entry = entryOf(ctx, oldId);
    const node = ctx.model.byId.get(oldId);
    if (!/^[A-Za-z0-9_-]+$/.test(next)) throw new Error("Identifiant invalide : lettres, chiffres, - et _ uniquement.");
    if (next === node.localId) return String(text);
    if (usedIds(ctx.model, node).has(next)) throw new Error(`L’identifiant « ${next} » existe déjà.`);

    const raw = YAML.isMap(entry.map) && entry.map.get("id") !== undefined && entry.map.get("id") !== null ? String(entry.map.get("id")).trim() : "";
    const newRaw = raw.includes(".") ? `${raw.slice(0, raw.lastIndexOf(".") + 1)}${next}` : next;
    const parentQ = node.parent ? ctx.model.byId.get(node.parent).qualifiedId : null;
    const newQ = raw.includes(".") || !parentQ ? newRaw : `${parentQ}.${newRaw}`;
    const scalar = entry.map.get("id", true);
    if (YAML.isScalar(scalar)) scalar.value = newRaw;
    else entry.map.set("id", newRaw);

    const after = Model.parse(dump(ctx.doc));
    rewriteRefs(ctx, ctx.model, after, movedIdMap(ctx.model, after, oldId, newQ));
    return dump(ctx.doc);
  }

  // Rewrites every reference written `oldRef` (or ending with `.oldRef`) to `newRef`; for ids already renamed by hand.
  function renameRefs(text, oldRef, newRef) {
    const doc = load(text);
    const ctx = { doc, root: doc.contents };
    refTargets(ctx).forEach((t) => {
      const ref = String(t.ref);
      if (ref === oldRef) t.set(newRef);
      else if (ref.endsWith(`.${oldRef}`)) t.set(`${ref.slice(0, ref.length - oldRef.length)}${newRef}`);
    });
    return dump(doc);
  }

  // After an edit that may have changed what the scheme produces (label, type, parent), re-generates the id of a
  // node whose id was still automatic. textBefore/textAfter: documents around the edit; returns the final text.
  function followId(textBefore, textAfter, id, scheme) {
    const before = Model.parse(String(textBefore));
    const node = before.byId.get(id);
    if (!node) return textAfter;
    const parentOf = (model, n) => (n.parent ? model.byId.get(n.parent).localId : null);
    if (!isAutoId(scheme, { label: node.label, type: node.type, parent: parentOf(before, node) }, node.localId)) return textAfter;
    const after = Model.parse(String(textAfter));
    let cand = after.byId.get(id);
    if (!cand || cand.localId !== node.localId) {
      const same = after.nodes.filter((n) => n.localId === node.localId);
      cand = same.length === 1 ? same[0] : null;
    }
    if (!cand) return textAfter;
    const info = { label: cand.label, type: cand.type, parent: parentOf(after, cand) };
    if (isAutoId(scheme, info, cand.localId)) return textAfter;
    const fresh = autoId(scheme, info, usedIds(after, cand));
    return fresh === cand.localId ? textAfter : renameId(textAfter, cand.id, fresh);
  }

  // ---------- copy ----------

  // Complete subtrees of the selected nodes plus the links whose two ends are inside them.
  // Ids used by the payload links are paths inside the payload (a top-level copied node is a root).
  function exportNodes(text, ids) {
    const ctx = open(text);
    ids.forEach((id) => entryOf(ctx, id));
    const roots = topMost(ctx.model, ids);
    const pathOf = new Map();
    const walkIds = (internal, prefix) => {
      const model = ctx.model.byId.get(internal);
      const path = prefix ? `${prefix}.${model.localId}` : model.localId;
      pathOf.set(internal, path);
      model.children.forEach((c) => walkIds(c, path));
    };
    const nodes = roots.map((id) => {
      walkIds(id, "");
      return entryOf(ctx, id).map.toJSON();
    });
    const links = [];
    rawLinks(ctx).forEach((item) => {
      const from = endpoint(ctx, item, "from");
      const to = endpoint(ctx, item, "to");
      if (from === null || to === null || !pathOf.has(from) || !pathOf.has(to)) return;
      const json = item.toJSON();
      json[keyName(findPair(item, namesOf("from")))] = pathOf.get(from);
      json[keyName(findPair(item, namesOf("to")))] = pathOf.get(to);
      links.push(json);
    });
    return { nodes, links };
  }

  function reorder(text, id, op) {
    const ctx = open(text);
    const entry = entryOf(ctx, id);
    const items = entry.seq.items;
    const at = items.indexOf(entry.map);
    const dest = { front: items.length - 1, forward: at + 1, backward: at - 1, back: 0 }[op];
    if (dest === undefined) throw new Error(`Opération d’ordre inconnue : « ${op} ».`);
    items.splice(at, 1);
    items.splice(clamp(dest, 0, items.length), 0, entry.map);
    return dump(ctx.doc);
  }

  // ---------- public: links ----------

  function addLink(text, link) {
    const ctx = open(text);
    if (!link || !link.from || !link.to) throw new Error("Un lien doit avoir une source et une cible.");
    const obj = {};
    Object.keys(link).forEach((k) => { if (link[k] !== undefined && link[k] !== null && link[k] !== "") obj[k] = link[k]; });
    getSeq(ctx.doc, ctx.root, "links", true).items.push(ctx.doc.createNode(obj));
    return dump(ctx.doc);
  }

  // Adds several links at once. pairs: [{ from, to }] (duplicates ignored); common: { type, label, style }.
  // With a type, a non-empty style is merged into style.links[type]; without type (or with common.perLink) it goes on each link.
  function addLinks(text, pairs, common) {
    const c = common || {};
    const style = isPlain(c.style) && Object.keys(c.style).length ? c.style : null;
    const seen = new Set();
    let next = String(text);
    (pairs || []).forEach((p) => {
      const key = `${p.from}\u0000${p.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      const link = { from: p.from, to: p.to };
      if (c.label) link.label = c.label;
      if (c.type) link.type = c.type;
      if (style && (!c.type || c.perLink)) link.style = style;
      next = addLink(next, link);
    });
    if (style && c.type && !c.perLink) {
      const model = Model.parse(next);
      const old = model.style || {};
      const block = {};
      if (old.size !== undefined && old.size !== null && Number(old.size) !== 1) block.size = old.size;
      if ((old.rules || []).length) block.rules = old.rules.map((r) => ({ ...r }));
      ["presets", "roles", "types", "links"].forEach((k) => { if (old[k] && Object.keys(old[k]).length) block[k] = JSON.parse(JSON.stringify(old[k])); });
      block.links = { ...(block.links || {}), [c.type]: { ...((block.links || {})[c.type] || {}), ...style } };
      next = setTopLevel(next, "style", block);
    }
    return next;
  }

  function linkItem(ctx, index) {
    const item = rawLinks(ctx)[index];
    if (!YAML.isMap(item)) throw new Error(`Lien introuvable : n°${index}.`);
    return item;
  }

  function updateLink(text, index, patch) {
    const ctx = open(text);
    const item = linkItem(ctx, index);
    Object.keys(patch || {}).forEach((key) => assign(ctx.doc, item, key, patch[key], "merge"));
    return dump(ctx.doc);
  }

  function removeLinks(text, indexes) {
    const ctx = open(text);
    const seq = getSeq(ctx.doc, ctx.root, "links", false);
    const dead = new Set(indexes.map((i) => linkItem(ctx, i)));
    seq.items = seq.items.filter((item) => !dead.has(item));
    dropIfEmpty(ctx.root, "links", seq);
    return dump(ctx.doc);
  }

  // ---------- public: top-level blocks & trash ----------

  function blankBefore(map, key) {
    const pair = findPair(map, [key]);
    if (!YAML.isScalar(pair.key)) pair.key = new YAML.Scalar(pair.key);
    pair.key.spaceBefore = true;
  }

  function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    return isPlain(value) && Object.keys(value).filter((k) => value[k] !== undefined).length === 0;
  }

  function setTopLevel(text, key, value) {
    const doc = load(text);
    if (isEmpty(value)) {
      removeKey(doc.contents, key);
    } else {
      const fresh = !findPair(doc.contents, namesOf(key));
      assign(doc, doc.contents, key, value, "replace");
      if (fresh) blankBefore(doc.contents, key);
    }
    return dump(doc);
  }

  function trashPush(text, entries) {
    const doc = load(text);
    const fresh = !findPair(doc.contents, ["trash"]);
    const seq = getSeq(doc, doc.contents, "trash", true);
    entries.forEach((e) => {
      const obj = { deletedAt: e.deletedAt || new Date().toISOString() };
      if (e.parentId !== null && e.parentId !== undefined) obj.parent = e.parentId;
      obj.index = e.index;
      obj.node = e.node;
      if (e.ids) obj.ids = e.ids;
      if (e.links && e.links.length) obj.links = e.links;
      seq.items.push(doc.createNode(obj));
    });
    if (fresh) blankBefore(doc.contents, "trash");
    return dump(doc);
  }

  function revertRelinks(ctx, ids) {
    const set = new Set(ids);
    rawLinks(ctx).forEach((item) => {
      const meta = YAML.isMap(item) ? getNode(item, "meta") : null;
      const from = YAML.isMap(meta) ? getNode(meta, "relinkedFrom") : null;
      if (!YAML.isMap(from)) return;
      ["from", "to"].forEach((side) => {
        const original = from.get(side);
        if (original === undefined || !set.has(String(original))) return;
        setEndpoint(item, side, String(original));
        from.delete(side);
      });
      if (from.items.length === 0) meta.delete("relinkedFrom");
      if (meta.items.length === 0) removeKey(item, "meta");
    });
  }

  function trashRestore(text, trashIndex) {
    const ctx = open(text);
    const seq = getSeq(ctx.doc, ctx.root, "trash", false);
    const item = seq && seq.items[trashIndex];
    if (!item) throw new Error(`Élément introuvable dans la corbeille : n°${trashIndex}.`);
    const entry = item.toJSON();
    const nodeId = String(entry.node.id);
    if (ctx.model.nodes.some((n) => n.localId === nodeId)) throw new Error(`Restauration impossible : « ${nodeId} » existe déjà.`);

    revertRelinks(ctx, entry.ids || [nodeId]);
    const parent = entry.parent !== undefined && ctx.entries.has(entry.parent) ? entry.parent : null;
    insertAt(containerFor(ctx, parent, true).seq, ctx.doc.createNode(entry.node), entry.index);

    const links = getSeq(ctx.doc, ctx.root, "links", true);
    [...(entry.links || [])].sort((a, b) => a.index - b.index).forEach((l) => {
      insertAt(links, ctx.doc.createNode(l.link), l.index);
    });
    dropIfEmpty(ctx.root, "links", links);

    seq.items.splice(trashIndex, 1);
    dropIfEmpty(ctx.root, "trash", seq);
    return dump(ctx.doc);
  }

  // Plain scalars holding ": " break YAML ("bad indentation of a mapping entry"); wrap them in double quotes.
  // Returns { text, lines } with the 1-based lines changed. Block scalars (| >) and their content are left alone.
  function quoteUnsafeScalars(text) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const rows = text.split(/\r?\n/);
    const lines = [];
    let blockIndent = -1;

    const out = rows.map((row, index) => {
      const indent = row.search(/\S/);

      if (blockIndent >= 0) {
        if (indent < 0 || indent > blockIndent) {
          return row;
        }

        blockIndent = -1;
      }

      const match = /^(\s*(?:-\s+)?[^\s#'"{[][^:#]*?:\s+)(.+?)\s*$/.exec(row);

      if (!match) {
        return row;
      }

      const value = match[2];

      if (/^[|>][-+0-9]*$/.test(value)) {
        blockIndent = indent;
        return row;
      }

      if (/^["'[{&*!|>]/.test(value) || !(/:\s/.test(value) || /:$/.test(value))) {
        return row;
      }

      lines.push(index + 1);
      return `${match[1]}"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
    });

    return { text: out.join(eol), lines };
  }

  return { quoteUnsafeScalars, addNode, updateNode, removeNodes, moveNode, renameId, renameRefs, followId, exportNodes, slugify, autoId, isAutoId, ID_SCHEMES, reorder, addLink, addLinks, updateLink, removeLinks, setTopLevel, trashPush, trashRestore };
});
