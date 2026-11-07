"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory((() => { try { return require("js-yaml"); } catch (e) { return require("../vendor/js-yaml.js"); } })());
  } else {
    root.Settings = factory(root.jsyaml);
  }
})(typeof self !== "undefined" ? self : this, function (jsyaml) {
  const LAYOUT_OPTIONS = ["fcose", "cose", "breadthfirst", "grid", "circle", "concentric", "tree"];

  function bool(key, def, label, help) {
    return { key, type: "boolean", default: def, label, help };
  }
  function choice(key, def, options, label, help) {
    return { key, type: "enum", default: def, options, label, help };
  }
  function num(key, def, min, max, step, label, help) {
    return { key, type: "number", default: def, min, max, step, label, help };
  }

  const SPEC = [
    bool("delete.relinkToParent", false, "Suppression : rattacher les liens au parent", "Case par défaut de la confirmation de suppression : les liens des briques supprimées sont rattachés à leur parent."),
    bool("drop.repulsion", true, "Répulsion au relâchement", "Au relâchement, la boîte déplacée se pose sans chevaucher ses frères."),
    choice("selection.tab", "keep", ["keep", "inspector", "style"], "Onglet à la sélection", "keep : ne pas changer d’onglet ; inspector : Inspecteur ; style : Style."),
    choice("edges.curve", "bezier", ["bezier", "taxi", "straight", "round-taxi"], "Forme des liens", "bezier (courbe), taxi (angle droit), straight (droit), round-taxi (angle arrondi)."),
    num("edges.opacity", 1, 0.15, 1, 0.05, "Opacité des liens", "De 0,15 à 1."),
    num("nodes.size", 1, 0.6, 1.6, 0.05, "Taille des nœuds", "Facteur de taille global."),
    choice("layout.default", "fcose", LAYOUT_OPTIONS, "Disposition par défaut", "Disposition appliquée quand le document n’en précise pas."),
    num("tree.indent", 28, 8, 80, 1, "Indentation de l’arbre (px)", "Décalage par niveau en disposition arbre."),
    choice("meta.card.when", "never", ["leaf", "expanded", "always", "never"], "Fiche métadonnée : quand", "leaf : brique sans enfant visible ; expanded : groupe déplié ; always ; never."),
    choice("meta.card.position", "top-right", ["top-left", "top-right", "bottom-left", "bottom-right", "free"], "Fiche métadonnée : position", "Coin d’ancrage, ou free (déplaçable)."),
    num("meta.card.maxChars", 50, 10, 200, 1, "Fiche métadonnée : caractères par ligne", "Au-delà, le texte est tronqué."),
    num("meta.card.maxLines", 3, 1, 20, 1, "Fiche métadonnée : lignes", "Au-delà, la fiche est tronquée.")
  ];

  const BY_KEY = new Map(SPEC.map((s) => [s.key, s]));
  const SOURCES = ["default", "suggested", "local", "document"];
  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  // Returns the value if valid for the key, otherwise undefined.
  function coerce(key, value) {
    const spec = BY_KEY.get(key);
    if (!spec) return undefined;
    if (spec.type === "boolean") return typeof value === "boolean" ? value : undefined;
    if (spec.type === "enum") return spec.options.includes(value) ? value : undefined;
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
    return Math.min(spec.max, Math.max(spec.min, n));
  }

  // Accepts flat dotted keys and nested objects, keeps only valid known keys.
  function flatten(obj, prefix = "", out = {}) {
    if (!isPlain(obj)) return out;
    Object.keys(obj).forEach((k) => {
      const full = prefix ? `${prefix}.${k}` : k;
      if (isPlain(obj[k]) && !BY_KEY.has(full)) flatten(obj[k], full, out);
      else {
        const v = coerce(full, obj[k]);
        if (v !== undefined) out[full] = v;
      }
    });
    return out;
  }

  function defaults() {
    const out = {};
    SPEC.forEach((s) => { out[s.key] = s.default; });
    return out;
  }

  // Pure merge of the four levels. Returns { values, sources }.
  function resolve(levels) {
    const values = defaults();
    const sources = {};
    SPEC.forEach((s) => { sources[s.key] = "default"; });
    ["suggested", "local", "document"].forEach((level) => {
      Object.keys(levels[level] || {}).forEach((key) => {
        const v = coerce(key, levels[level][key]);
        if (v === undefined) return;
        values[key] = v;
        sources[key] = level;
      });
    });
    return { values, sources };
  }

  function documentSettings(text) {
    const raw = jsyaml.load(String(text));
    if (!isPlain(raw)) return {};
    return flatten(raw.settings !== undefined ? raw.settings : raw.reglages);
  }

  // ---------- cleanup (pure) ----------

  const FLAG_KEYS = ["highlight", "mettre_en_avant", "hidden", "masquer"];
  const TARGET_KEYS = ["target", "cible"];
  const pickKey = (obj, names) => names.find((n) => obj[n] !== undefined);

  function cleanRules(rules) {
    const out = [];
    rules.forEach((rule) => {
      if (!isPlain(rule)) { out.push(rule); return; }
      const next = { ...rule };
      FLAG_KEYS.forEach((k) => { if (next[k] === false) delete next[k]; });
      const meaningful = Object.keys(next).filter((k) => !TARGET_KEYS.includes(k) && next[k] !== undefined && next[k] !== null);
      if (meaningful.length) out.push(next);
    });
    return out;
  }

  function cleanStyle(style) {
    if (!isPlain(style)) return style;
    const out = { ...style };
    ["size", "taille"].forEach((k) => { if (out[k] === 1) delete out[k]; });
    const rk = pickKey(out, ["rules", "regles"]);
    if (rk && Array.isArray(out[rk])) {
      out[rk] = cleanRules(out[rk]);
      if (!out[rk].length) delete out[rk];
    }
    return out;
  }

  function cleanView(view, defaultLayout) {
    if (!isPlain(view)) return view;
    const out = { ...view };
    ["collapsed", "replies"].forEach((k) => { if (Array.isArray(out[k]) && !out[k].length) delete out[k]; });
    if (isPlain(out.positions) && !Object.keys(out.positions).length) delete out.positions;
    if (out.layout === defaultLayout) delete out.layout;
    return out;
  }

  // raw: parsed YAML document; base: effective values without the document level.
  // Returns the cleaned top-level blocks (undefined key = nothing to change).
  function cleanup(raw, base) {
    const out = {};
    const sk = pickKey(raw, ["settings", "reglages"]);
    if (sk !== undefined) {
      const kept = {};
      const flat = flatten(raw[sk]);
      Object.keys(flat).forEach((k) => { if (flat[k] !== base[k]) kept[k] = flat[k]; });
      out.settings = kept;
    }
    const style = pickKey(raw, ["style", "presentation"]);
    if (style !== undefined) out.style = cleanStyle(raw[style]);
    const view = pickKey(raw, ["view", "vue"]);
    if (view !== undefined) out.view = cleanView(raw[view], base["layout.default"]);
    return out;
  }

  // ---------- store ----------

  function create() {
    const levels = { suggested: {}, local: {}, document: {} };
    const listeners = [];
    let current = resolve(levels);
    const self = { documentWriter: null };

    function commit(mutate) {
      const before = current;
      mutate();
      current = resolve(levels);
      const changed = SPEC.map((s) => s.key).filter((k) => before.values[k] !== current.values[k] || before.sources[k] !== current.sources[k]);
      if (changed.length) listeners.slice().forEach((fn) => fn(changed, self));
    }

    function persist() {
      try { localStorage.setItem("topo:settings", JSON.stringify(levels.local)); } catch (e) { /* storage unavailable */ }
    }

    function writeDocument(next) {
      if (typeof self.documentWriter === "function") self.documentWriter(next);
      else commit(() => { levels.document = next; });
    }

    Object.assign(self, {
      SPEC,
      get: (key) => current.values[key],
      source: (key) => current.sources[key],
      all: () => ({ ...current.values }),
      sources: () => ({ ...current.sources }),
      onChange: (fn) => { listeners.push(fn); },
      spec: (key) => BY_KEY.get(key),
      level: (name) => ({ ...levels[name] }),
      // Effective values ignoring the document level (used to clean the YAML).
      base() {
        return resolve({ suggested: levels.suggested, local: levels.local }).values;
      },

      set(key, value, scope = "local") {
        const v = coerce(key, value);
        if (v === undefined) throw new Error(`Valeur invalide pour « ${key} ».`);
        if (scope === "document") writeDocument({ ...levels.document, [key]: v });
        else commit(() => { levels.local[key] = v; persist(); });
      },

      unset(key, scope = "local") {
        if (scope === "document") {
          const next = { ...levels.document };
          delete next[key];
          writeDocument(next);
        } else {
          commit(() => { delete levels.local[key]; persist(); });
        }
      },

      setSuggested(obj) {
        commit(() => { levels.suggested = flatten(obj); });
      },

      setLocal(obj) {
        commit(() => { levels.local = flatten(obj); });
      },

      setDocument(obj) {
        commit(() => { levels.document = flatten(obj); });
      },

      setDocumentFromText(text) {
        let parsed;
        try { parsed = documentSettings(text); } catch (e) { return; }
        this.setDocument(parsed);
      },

      loadLocal() {
        let stored = {};
        try {
          stored = JSON.parse(localStorage.getItem("topo:settings") || "{}");
          const legacy = localStorage.getItem("topo:size");
          if (legacy !== null) {
            if (!isPlain(stored) || stored["nodes.size"] === undefined) stored = { ...(isPlain(stored) ? stored : {}), "nodes.size": legacy };
            localStorage.removeItem("topo:size");
          }
        } catch (e) { /* storage unavailable or corrupt */ }
        this.setLocal(stored);
        persist();
      },

      // Silently ignored when the file is unreachable (file://) or invalid.
      loadSuggested() {
        if (typeof fetch !== "function") return Promise.resolve(false);
        return fetch("topo.config.json", { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("absent"))))
          .then((json) => { self.setSuggested(isPlain(json.settings) ? json.settings : json); return true; })
          .catch(() => false);
      },

      init() {
        this.loadLocal();
        return this.loadSuggested();
      }
    });
    return self;
  }

  const Settings = create();
  Settings.create = create;
  Settings.SOURCES = SOURCES;
  Settings.resolve = resolve;
  Settings.coerce = coerce;
  Settings.flatten = flatten;
  Settings.defaults = defaults;
  Settings.documentSettings = documentSettings;
  Settings.cleanup = cleanup;
  return Settings;
});
