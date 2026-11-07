"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Schema = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  function pick(obj, names) {
    for (const name of names) {
      if (obj[name] !== undefined) return obj[name];
    }
    return undefined;
  }

  function assign(out, key, value) {
    if (value !== undefined) out[key] = value;
  }

  function normalizeMeta(meta) {
    if (!isObj(meta)) return undefined;
    const out = { ...meta };
    for (const [alias, key] of [["afficher", "show"], ["liens", "links"]]) {
      if (alias in out) {
        if (!(key in out)) out[key] = out[alias];
        delete out[alias];
      }
    }
    return out;
  }

  function normalizeNode(raw) {
    const n = isObj(raw) ? raw : {};
    const out = {};
    assign(out, "id", n.id);
    assign(out, "label", pick(n, ["label", "titre", "title"]));
    assign(out, "type", n.type);
    assign(out, "role", n.role);
    assign(out, "meta", normalizeMeta(n.meta));
    const children = pick(n, ["children", "enfants"]);
    if (Array.isArray(children)) out.children = children.map(normalizeNode);
    return out;
  }

  function normalizeLink(raw) {
    const l = isObj(raw) ? raw : {};
    const out = {};
    assign(out, "from", pick(l, ["from", "de"]));
    assign(out, "to", pick(l, ["to", "vers"]));
    assign(out, "label", l.label);
    assign(out, "meta", normalizeMeta(l.meta));
    return out;
  }

  const RULE_KEYS = [
    ["target", ["target", "cible"]],
    ["label", ["label", "etiquette"]],
    ["color", ["color", "couleur"]],
    ["border", ["border", "bordure"]],
    ["opacity", ["opacity", "opacite"]],
    ["size", ["size", "taille"]],
    ["highlight", ["highlight", "mettre_en_avant"]],
    ["hidden", ["hidden", "masquer"]]
  ];

  function normalizeRule(raw) {
    const r = isObj(raw) ? raw : {};
    const out = {};
    RULE_KEYS.forEach(([key, names]) => assign(out, key, pick(r, names)));
    return out;
  }

  function normalizeStyle(raw) {
    if (!isObj(raw)) return undefined;
    const out = {};
    assign(out, "size", pick(raw, ["size", "taille"]));
    const rules = pick(raw, ["rules", "regles"]);
    if (Array.isArray(rules)) out.rules = rules.map(normalizeRule);
    return out;
  }

  function normalizeView(raw) {
    if (!isObj(raw)) return undefined;
    const out = {};
    assign(out, "collapsed", pick(raw, ["collapsed", "replies"]));
    ["zoom", "pan", "layout", "positions"].forEach((k) => assign(out, k, raw[k]));
    return out;
  }

  function normalize(raw) {
    const r = isObj(raw) ? raw : {};
    const out = {};
    assign(out, "title", pick(r, ["title", "titre"]));
    const nodes = pick(r, ["nodes", "noeuds"]);
    if (Array.isArray(nodes)) out.nodes = nodes.map(normalizeNode);
    const links = pick(r, ["links", "liens"]);
    if (Array.isArray(links)) out.links = links.map(normalizeLink);
    assign(out, "style", normalizeStyle(pick(r, ["style", "presentation"])));
    assign(out, "view", normalizeView(pick(r, ["view", "vue"])));
    return out;
  }

  // Root keys and their legacy aliases, used by textual block replacement.
  const ROOT_ALIASES = {
    title: ["titre"],
    nodes: ["noeuds"],
    links: ["liens"],
    style: ["presentation"],
    view: ["vue"]
  };

  function h(section, key, aliases, type, description, example) {
    return { section, key, aliases, type, description, example };
  }

  const HELP = [
    h("Document", "title", ["titre"], "texte", "Titre du diagramme, affiché dans l’en-tête.", "title: Mon architecture"),
    h("Document", "nodes", ["noeuds"], "liste", "Liste des nœuds de premier niveau (obligatoire).", "nodes:\n  - id: api\n    label: API"),
    h("Document", "links", ["liens"], "liste", "Liste des liens (arêtes) entre nœuds.", "links:\n  - from: web\n    to: api"),
    h("Document", "style", ["presentation"], "objet", "Bloc de présentation (taille globale, règles par nœud).", "style:\n  size: 1.2\n  rules: []"),
    h("Document", "view", ["vue"], "objet", "Vue enregistrée (groupes repliés, zoom, disposition). Écrite par l’application à l’enregistrement.", "view:\n  collapsed: [donnees]\n  layout: fcose"),
    h("Nœud", "id", [], "texte", "Identifiant du nœud. Peut contenir « . » dans un fichier fusionné (chemin qualifié).", "- id: api"),
    h("Nœud", "label", ["titre", "title"], "texte", "Texte affiché (par défaut : l’id).", "label: API publique"),
    h("Nœud", "type", [], "texte libre", "Catégorie libre (service, database, external, group…). Pilote l’icône et la couleur.", "type: service"),
    h("Nœud", "role", [], "texte libre", "Rôle libre (domaine, catégorie…).", "role: domain"),
    h("Nœud", "children", ["enfants"], "liste", "Nœuds imbriqués : le nœud devient un groupe repliable.", "children:\n  - id: workers"),
    h("Nœud", "meta", [], "objet", "Dictionnaire libre d’informations affichées dans l’inspecteur.", "meta:\n  owner: Équipe A"),
    h("Nœud", "meta.show", ["afficher"], "liste", "Clés de meta résumées sur un groupe replié.", "meta:\n  owner: Équipe A\n  show: [owner]"),
    h("Nœud", "meta.links", ["liens"], "liste", "Liens externes {label, url} affichés dans l’inspecteur.", "meta:\n  links:\n    - label: Docs\n      url: \"https://exemple.fr\""),
    h("Nœud", "meta.source", [], "texte", "Chemin du petit YAML d’origine (renseigné par la fusion, ne pas écrire à la main).", "meta:\n  source: platform/brick.yaml"),
    h("Lien", "from", ["de"], "référence", "Nœud source : id, id qualifié (a.b.c) ou suffixe unique.", "- from: web"),
    h("Lien", "to", ["vers"], "référence", "Nœud cible (même syntaxe que from).", "  to: api"),
    h("Lien", "label", [], "texte", "Texte affiché sur l’arête.", "  label: requêtes HTTPS"),
    h("Style", "style.size", ["taille"], "nombre", "Facteur de taille global des nœuds.", "style:\n  size: 1.2"),
    h("Style", "style.rules", ["regles"], "liste", "Règles de présentation par nœud.", "style:\n  rules:\n    - target: api\n      color: \"#e74c3c\""),
    h("Style", "target", ["cible"], "référence", "Nœud visé par la règle.", "- target: api"),
    h("Style", "label", ["etiquette"], "texte", "Remplace le texte affiché.", "  label: API v2"),
    h("Style", "color", ["couleur"], "couleur", "Couleur de fond du nœud.", "  color: \"#3498db\""),
    h("Style", "border", ["bordure"], "couleur", "Couleur de bordure.", "  border: \"#2c3e50\""),
    h("Style", "opacity", ["opacite"], "nombre 0–1", "Opacité du nœud.", "  opacity: 0.5"),
    h("Style", "size", ["taille"], "nombre", "Facteur de taille de ce nœud.", "  size: 1.5"),
    h("Style", "highlight", ["mettre_en_avant"], "booléen", "Met le nœud en avant.", "  highlight: true"),
    h("Style", "hidden", ["masquer"], "booléen", "Masque le nœud.", "  hidden: true"),
    h("Vue", "view.collapsed", ["replies"], "liste d’ids", "Groupes repliés.", "view:\n  collapsed: [donnees]"),
    h("Vue", "view.zoom", [], "nombre", "Niveau de zoom.", "view:\n  zoom: 1.1"),
    h("Vue", "view.pan", [], "objet {x, y}", "Décalage du graphe.", "view:\n  pan: { x: 10, y: 20 }"),
    h("Vue", "view.layout", [], "texte", "Disposition : fcose (défaut, adaptée aux groupes), cose, breadthfirst, grid, circle ou concentric.", "view:\n  layout: breadthfirst"),
    h("Vue", "view.positions", [], "objet", "Positions {id: {x, y}} écrites quand l’utilisateur déplace des nœuds.", "view:\n  positions:\n    api: { x: 100, y: 50 }"),
    h("Réglages", "settings", ["reglages"], "objet", "Réglages figés dans le document (priorité maximale : défauts < topo.config.json < local < document). Menu Vue > Réglages.", "settings:\n  edges.curve: taxi\n  nodes.size: 1.2"),
    h("Réglages", "drop.repulsion", [], "booléen", "Au relâchement, la boîte déplacée se pose sans chevaucher ses frères (défaut : true).", "  drop.repulsion: true"),
    h("Réglages", "selection.tab", [], "keep | inspector | style", "Onglet affiché à la sélection d’un nœud (défaut : keep).", "  selection.tab: keep"),
    h("Réglages", "edges.curve", [], "bezier | taxi | straight | round-taxi", "Forme des liens (défaut : bezier).", "  edges.curve: taxi"),
    h("Réglages", "edges.opacity", [], "nombre 0,15–1", "Opacité des liens (défaut : 1).", "  edges.opacity: 0.6"),
    h("Réglages", "nodes.size", [], "nombre 0,6–1,6", "Taille globale des nœuds (défaut : 1).", "  nodes.size: 1.2"),
    h("Réglages", "layout.default", [], "texte", "Disposition par défaut : fcose, cose, breadthfirst, grid, circle, concentric ou tree (défaut : fcose).", "  layout.default: tree"),
    h("Réglages", "tree.indent", [], "nombre (px)", "Indentation par niveau en disposition arbre (défaut : 28).", "  tree.indent: 28"),
    h("Réglages", "meta.card.when", [], "leaf | expanded | always | never", "Quand afficher la fiche métadonnée (défaut : never).", "  meta.card.when: leaf"),
    h("Réglages", "meta.card.position", [], "texte", "Ancrage de la fiche : top-left, top-right, bottom-left, bottom-right ou free (défaut : top-right).", "  meta.card.position: top-right"),
    h("Réglages", "meta.card.maxChars", [], "nombre", "Caractères par ligne avant troncature (défaut : 50).", "  meta.card.maxChars: 50"),
    h("Réglages", "meta.card.maxLines", [], "nombre", "Lignes avant troncature (défaut : 3).", "  meta.card.maxLines: 3"),
    h("Brique", "id", [], "texte", "Identifiant de la brique (défaut : nom du dossier, ou <nom> pour x.brick.yaml).", "id: resources-js"),
    h("Brique", "title", ["label"], "texte", "Libellé de la brique. Sur le brick.yaml racine : titre du diagramme.", "title: Artefact"),
    h("Brique", "type", [], "texte libre", "Type de la brique (optionnel).", "type: group"),
    h("Brique", "role", [], "texte libre", "Rôle de la brique (optionnel).", "role: domain"),
    h("Brique", "meta", [], "objet", "Informations libres de la brique (optionnel).", "meta:\n  owner: Équipe A"),
    h("Brique", "nodes", ["noeuds"], "liste", "Nœuds internes de la brique (ids locaux).", "nodes:\n  - id: api"),
    h("Brique", "links", ["liens"], "liste", "Liens résolus avec cette brique comme contexte.", "links:\n  - from: api\n    to: resources")
  ];

  const SHORTCUTS = [
    { keys: "Ctrl+S", description: "Enregistrer" },
    { keys: "Ctrl+Shift+S", description: "Enregistrer sous…" },
    { keys: "Ctrl+O", description: "Ouvrir un fichier" },
    { keys: "Ctrl+F", description: "Rechercher un nœud" },
    { keys: "Ctrl+Z", description: "Annuler la dernière action graphique" },
    { keys: "Ctrl+Y", description: "Rétablir (aussi Ctrl+Shift+Z)" },
    { keys: "V / H / B / L", description: "Outil Sélection / Main / Brique / Lien" },
    { keys: "Espace (maintenu)", description: "Main temporaire (déplacer la vue)" },
    { keys: "Maj/Ctrl + clic", description: "Ajouter ou retirer une brique de la sélection" },
    { keys: "Suppr / Retour arrière", description: "Supprimer la sélection (vers la corbeille)" },
    { keys: "Ctrl+]  /  Ctrl+[", description: "Avancer / reculer la brique sélectionnée d’un plan" },
    { keys: "Ctrl+Maj+]  /  Ctrl+Maj+[", description: "Premier plan / arrière-plan" },
    { keys: "F1", description: "Afficher l’aide" },
    { keys: "Échap", description: "Fermer la fenêtre / désélectionner" },
    { keys: "Double-clic sur un groupe", description: "Replier / déplier le groupe" },
    { keys: "Clic droit", description: "Menu contextuel" }
  ];

  return { normalize, normalizeNode, normalizeLink, ROOT_ALIASES, HELP, SHORTCUTS };
});
