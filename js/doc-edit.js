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
    trash: ["trash"]
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
    const plans = planLinks(ctx, removed, !!options.relinkToParent);

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

  function moveNode(text, id, newParentId, index) {
    const ctx = open(text);
    const entry = entryOf(ctx, id);
    const target = newParentId === undefined ? null : newParentId;
    if (target !== null) {
      entryOf(ctx, target);
      if (subtreeIds(ctx.model, id).includes(target)) throw new Error("Impossible de déplacer un nœud dans son propre sous-arbre.");
    }
    detach(entry);
    const holder = containerFor(ctx, target, true);
    insertAt(holder.seq, entry.map, index);
    return dump(ctx.doc);
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

  return { addNode, updateNode, removeNodes, moveNode, reorder, addLink, updateLink, removeLinks, setTopLevel, trashPush, trashRestore };
});
