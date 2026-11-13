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

  function list(key, def, label, help) {
    return { key, type: "list", default: def, label, help };
  }

  const SPEC_ALL = [
    bool("delete.relinkToParent", false, "Suppression : rattacher les liens au parent", "Case par défaut de la confirmation de suppression : les liens des briques supprimées sont rattachés à leur parent."),
    choice("ids.scheme", "slug", ["slug", "parent-slug", "type-n"], "Identifiants automatiques", "slug : depuis le libellé ; parent-slug : <id du parent>-<libellé> ; type-n : <type>-<n> incrémental."),
    bool("ids.followMove", false, "Identifiants : suivre le déplacement et le libellé", "Si l’id d’une brique est encore automatique (celui que le schéma produirait), il est régénéré quand on la déplace ou qu’on change son libellé ; les références suivent."),
    bool("drop.repulsion", true, "Répulsion au relâchement", "Au relâchement, la boîte déplacée se pose sans chevaucher ses frères."),
    choice("create.placement", "click", ["click", "free-slot"], "Placement d’une nouvelle brique", "click : le coin haut-gauche de la brique est posé au point cliqué ; free-slot : dans un emplacement libre du groupe (à la racine, toujours au clic)."),
    choice("repulsion.direction", "auto", ["auto", "right", "down", "left", "up"], "Répulsion de stabilisation : direction", "Sens dans lequel une boîte est poussée après un ajout ou un changement de taille ; auto : axe de séparation minimale."),
    choice("selection.tab","keep", ["keep", "inspector", "style"], "Onglet à la sélection", "keep : ne pas changer d’onglet ; inspector : Inspecteur ; style : Style."),
    choice("editor.foldSync", "graph-to-editor", ["graph-to-editor", "both", "off"], "Pliage synchronisé éditeur / graphe", "graph-to-editor : replier un groupe dans le graphe plie son bloc children: dans l’éditeur ; both : et inversement ; off : aucune synchronisation."),
    choice("edges.curve", "bezier", ["bezier", "curved", "taxi", "straight", "round-taxi"], "Forme des liens", "bezier (auto : droit, courbé seulement pour les liens parallèles), curved (courbes franches), taxi (angle droit), straight (droit), round-taxi (angle arrondi)."),
    choice("edges.side", "auto", ["auto", "right", "left", "bottom", "top"], "Côté de sortie des liens", "Côté de la boîte par où les liens sortent et entrent (formes angle et courbes) ; auto : à droite en disposition arbre, sinon direct."),
    num("edges.opacity", 1, 0.15, 1, 0.05, "Opacité des liens", "De 0,15 à 1."),
    num("nodes.size", 1, 0.6, 1.6, 0.05, "Taille des nœuds", "Facteur de taille global."),
    choice("layout.default", "fcose", LAYOUT_OPTIONS, "Disposition par défaut", "Disposition appliquée quand le document n’en précise pas."),
    num("tree.indent", 28, 8, 80, 1, "Indentation de l’arbre (px)", "Décalage par niveau en disposition arbre."),
    bool("ui.sidePanel", true, "Afficher le panneau latéral", "Affiche le panneau latéral (éditeur, inspecteur, style, anomalies). Raccourci : Ctrl+B."),
    bool("ui.controls", true, "Afficher les contrôles du diagramme", "Affiche la barre de contrôles du haut et la palette d’outils du diagramme (le menu Contrôles reste disponible)."),
    bool("fullscreen.edgeReveal", true, "Plein écran : révéler les panneaux au survol des bords", "En plein écran, survoler le bord gauche affiche le panneau latéral, le bord haut (ou la touche Alt) affiche le bandeau."),
    choice("meta.card.when", "never",["leaf", "expanded", "always", "never"], "Fiche métadonnée : quand", "leaf : brique sans enfant visible ; expanded : groupe déplié ; always ; never."),
    choice("meta.card.position", "top-right", ["top-left", "top-right", "bottom-left", "bottom-right", "free"], "Fiche métadonnée : position", "Coin d’ancrage, ou free (déplaçable)."),
    num("meta.card.maxChars", 50, 10, 200, 1, "Fiche métadonnée : caractères par ligne", "Au-delà, le texte est tronqué."),
    num("meta.card.maxLines", 3, 1, 20, 1, "Fiche métadonnée : lignes", "Au-delà, la fiche est tronquée."),
    bool("links.multi", false, "Liens multiples", "Mode Lien : les liens tracés forment une série brouillon (panneau « Série de liens ») créée d’un coup ; Ctrl pendant le tracé fait de même ponctuellement."),
    bool("links.multiAnchor", true, "Liens multiples : garder la source", "Série de liens : la source reste armée après chaque lien (clic droit pour la changer). Désactivé : elle est relâchée après chaque paire (clic source puis clic cible)."),
    bool("files.watch", true, "Surveiller le fichier ouvert", "Détecte qu’un autre programme a modifié le fichier ouvert (retour de focus et toutes les 2 s) : bandeau « Recharger / Ignorer » et marqueur dans l’onglet."),
    bool("files.autoReload", false, "Recharger automatiquement", "Si le fichier change sur le disque et que l’onglet n’a pas de modification non enregistrée, le recharger sans bandeau (nécessite la surveillance)."),
    list("meta.keys", ["owner", "status", "path", "repo", "version", "environment", "todo", "doc"], "Clés de métadonnées suggérées", "Clés proposées dans le formulaire de brique, en plus de celles déjà utilisées dans le projet (séparées par des virgules)."),
    { key: "style.presets", type: "object", hidden: true, default: { nodes: {}, links: {} }, label: "Styles nommés", help: "Styles de brique et de lien enregistrés (géré par l’onglet Style)." }
  ];
  const SPEC = SPEC_ALL.filter((s) => !s.hidden);

  const BY_KEY = new Map(SPEC_ALL.map((s) => [s.key, s]));
  const SOURCES = ["default", "suggested", "local", "document"];
  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  // Returns the value if valid for the key, otherwise undefined.
  function coerce(key, value) {
    const spec = BY_KEY.get(key);
    if (!spec) return undefined;
    if (spec.type === "boolean") return typeof value === "boolean" ? value : undefined;
    if (spec.type === "enum") return spec.options.includes(value) ? value : undefined;
    if (spec.type === "list") {
      const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
      if (!items) return undefined;
      return Array.from(new Set(items.filter((v) => typeof v === "string" || typeof v === "number").map((v) => String(v).trim()).filter(Boolean)));
    }
    if (spec.type === "object") {
      if (!isPlain(value)) return undefined;
      const out = {};
      ["nodes", "links"].forEach((k) => { out[k] = isPlain(value[k]) ? value[k] : {}; });
      return out;
    }
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
    SPEC_ALL.forEach((s) => { out[s.key] = s.default; });
    return out;
  }

  // Pure merge of the four levels. Returns { values, sources }.
  function resolve(levels) {
    const values = defaults();
    const sources = {};
    SPEC_ALL.forEach((s) => { sources[s.key] = "default"; });
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
      Object.keys(flat).forEach((k) => { if (JSON.stringify(flat[k]) !== JSON.stringify(base[k])) kept[k] = flat[k]; });
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
      const changed = SPEC_ALL.map((s) => s.key).filter((k) => JSON.stringify(before.values[k]) !== JSON.stringify(current.values[k]) || before.sources[k] !== current.sources[k]);
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
      all: () => Object.fromEntries(Object.entries(current.values).filter(([k]) => !BY_KEY.get(k).hidden)),
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
        if (typeof fetch !== "function" || (typeof location !== "undefined" && location.protocol === "file:")) return Promise.resolve(false);
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
