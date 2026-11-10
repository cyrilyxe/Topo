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

  const LINK_STYLE_KEYS = ["color", "width", "line", "arrow", "sourceArrow", "textColor"];

  function normalizeLinkStyle(raw) {
    if (!isObj(raw)) return undefined;
    const out = {};
    LINK_STYLE_KEYS.forEach((key) => assign(out, key, raw[key]));
    return Object.keys(out).length ? out : undefined;
  }

  function normalizeLink(raw) {
    const l = isObj(raw) ? raw : {};
    const out = {};
    assign(out, "from", pick(l, ["from", "de"]));
    assign(out, "to", pick(l, ["to", "vers"]));
    assign(out, "label", l.label);
    assign(out, "type", l.type);
    assign(out, "meta", normalizeMeta(l.meta));
    assign(out, "style", normalizeLinkStyle(l.style));
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
    ["hidden", ["hidden", "masquer"]],
    ["textColor", ["textColor", "couleur_texte"]],
    ["bold", ["bold", "gras"]],
    ["italic", ["italic", "italique"]],
    ["textBackground", ["textBackground", "fond_texte"]],
    ["borderStyle", ["borderStyle", "style_bordure"]],
    ["borderWidth", ["borderWidth", "epaisseur_bordure"]],
    ["shape", ["shape", "forme"]]
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
    // Blocks owned by other features, kept as written.
    ["presets", "roles", "types", "links"].forEach((k) => { if (isObj(raw[k])) out[k] = raw[k]; });
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
    h("Lien", "type", [], "texte libre", "Type du lien (libre : sync, async, dépendance…). Son style se règle une fois pour tous les liens du type dans style.links ou depuis la légende.", "  type: async"),
    h("Lien", "style", [], "objet", "Style du lien : color, width, line, arrow, sourceArrow, textColor.", "  style: { color: \"#e74c3c\", width: 3, line: dashed, arrow: vee }"),
    h("Lien", "style.color", [], "couleur", "Couleur du trait et des flèches.", "    color: \"#e74c3c\""),
    h("Lien", "style.width", [], "nombre 1–8", "Épaisseur du trait.", "    width: 3"),
    h("Lien", "style.line", [], "solid | dashed | dotted", "Type de trait.", "    line: dotted"),
    h("Lien", "style.arrow", [], "triangle | vee | triangle-backcurve | circle | square | diamond | tee | none", "Flèche côté cible.", "    arrow: vee"),
    h("Lien", "style.sourceArrow", [], "même liste que arrow", "Flèche côté source (none par défaut).", "    sourceArrow: circle"),
    h("Lien", "style.textColor", [], "couleur", "Couleur de l’étiquette du lien (par défaut : automatique).", "    textColor: \"#111827\""),
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
    h("Style", "textColor", ["couleur_texte"], "couleur", "Couleur du texte (par défaut : automatique, contrastée avec le fond effectif).", "  textColor: \"#ffffff\""),
    h("Style", "bold", ["gras"], "booléen", "Texte en gras.", "  bold: true"),
    h("Style", "italic", ["italique"], "booléen", "Texte en italique.", "  italic: true"),
    h("Style", "textBackground", ["fond_texte"], "couleur", "Fond derrière le texte (le texte auto se contraste avec lui).", "  textBackground: \"#fff3bf\""),
    h("Style", "borderStyle", ["style_bordure"], "solid | dashed | dotted | double", "Style de la bordure du nœud.", "  borderStyle: dashed"),
    h("Style", "borderWidth", ["epaisseur_bordure"], "nombre 0–8", "Épaisseur de la bordure en pixels.", "  borderWidth: 4"),
    h("Style", "shape", ["forme"], "round-rectangle | rectangle | ellipse | hexagon | diamond | barrel | rhomboid | tag | star | octagon | cut-rectangle", "Forme du nœud (feuilles et groupes repliés ; un groupe déplié reste un rectangle). Valable dans une règle, un rôle ou un type.", "  shape: hexagon"),
    h("Style", "style.roles", ["roles"], "objet", "Style partagé par toutes les briques d’un rôle (clés : color, border, borderStyle, borderWidth, shape, textColor, bold, italic, opacity, size). Priorité : défaut du type < style.types < style.roles < règle de brique.", "style:\n  roles:\n    domain: { shape: hexagon, color: \"#fde68a\" }"),
    h("Style", "style.types", [], "objet", "Style partagé par toutes les briques d’un type (mêmes clés que style.roles).", "style:\n  types:\n    database: { shape: barrel }"),
    h("Style", "style.links", [], "objet", "Style partagé par tous les liens d’un type : { <type>: {color, width, line, arrow, sourceArrow, textColor} }. Priorité : défaut < style.links[type] < links[].style.", "style:\n  links:\n    async: { line: dotted, arrow: vee, color: \"#7c3aed\" }"),
    h("Recherche", "type:x role:y", [], "filtre", "Dans le champ de recherche : type:service role:user (guillemets si espace : role:\"my role\"). Plusieurs valeurs d’une même clé = OU, clés différentes = ET ; combinable avec du texte ou une /regex/. Les puces de la légende écrivent ces filtres (Maj+clic : cumuler).", "type:service role:user api"),
    h("Style", "style.presets", [], "objet", "Styles nommés réutilisables : { nodes: {nom: {propriétés de règle}}, links: {nom: {propriétés de style de lien}} }. Copiés depuis l’onglet Style.", "style:\n  presets:\n    nodes:\n      Alerte: { color: \"#e74c3c\", borderStyle: dashed }\n    links:\n      Async: { line: dotted, arrow: vee }"),
    h("Vue", "view.collapsed", ["replies"], "liste d’ids", "Groupes repliés.", "view:\n  collapsed: [donnees]"),
    h("Vue", "view.zoom", [], "nombre", "Niveau de zoom.", "view:\n  zoom: 1.1"),
    h("Vue", "view.pan", [], "objet {x, y}", "Décalage du graphe.", "view:\n  pan: { x: 10, y: 20 }"),
    h("Vue", "view.layout", [], "texte", "Disposition : fcose (défaut, adaptée aux groupes), cose, breadthfirst, grid, circle ou concentric.", "view:\n  layout: breadthfirst"),
    h("Vue", "view.positions", [], "objet", "Positions {id: {x, y}} écrites quand l’utilisateur déplace des nœuds.", "view:\n  positions:\n    api: { x: 100, y: 50 }"),
    h("Vue", "view.layouts", [], "objet", "Dispositions nommées {nom: {positions, collapsed, zoom, pan, layout, savedAt}} écrites par Vue › Dispositions.", "view:\n  layouts:\n    Revue: { collapsed: [donnees], layout: fcose }"),
    h("Vue", "view.layouts.<nom>.savedAt", [], "date ISO", "Date d’enregistrement de la disposition.", "savedAt: 2026-11-08T10:00:00Z"),
    h("Réglages", "settings", ["reglages"], "objet", "Réglages figés dans le document (priorité maximale : défauts < topo.config.json < local < document). Menu Vue > Réglages.", "settings:\n  edges.curve: taxi\n  nodes.size: 1.2"),
    h("Réglages", "ids.scheme", [], "slug | parent-slug | type-n", "Génération des identifiants de briques : slug (depuis le libellé, défaut), parent-slug (<id parent>-<libellé>), type-n (<type>-<n> incrémental). Un suffixe -2, -3… garantit l’unicité.", "  ids.scheme: parent-slug"),
    h("Réglages", "ids.followMove", [], "booléen", "Régénère l’id d’une brique encore automatique quand on la déplace ou change son libellé ; toutes les références sont réécrites (défaut : false).", "  ids.followMove: true"),
    h("Réglages", "drop.repulsion", [], "booléen", "Au relâchement, la boîte déplacée se pose sans chevaucher ses frères (défaut : true).", "  drop.repulsion: true"),
    h("Réglages", "create.placement", [], "click | free-slot", "Placement d’une nouvelle brique : click (défaut) pose son coin haut-gauche au point cliqué ; free-slot cherche un emplacement libre dans le groupe (à la racine, toujours au clic).", "  create.placement: free-slot"),
    h("Réglages", "repulsion.direction", [], "auto | right | down | left | up", "Direction de la répulsion de stabilisation (après ajout, collage, changement de taille, dépli) : la boîte la plus légère est poussée ; auto (défaut) = axe de séparation minimale.", "  repulsion.direction: right"),
    h("Réglages", "selection.tab", [], "keep | inspector | style", "Onglet affiché à la sélection d’un nœud (défaut : keep).", "  selection.tab: keep"),
    h("Réglages", "editor.foldSync", [], "graph-to-editor | both | off", "Pliage synchronisé éditeur/graphe : graph-to-editor (défaut) plie le bloc children: dans l’éditeur quand un groupe est replié ; both agit aussi dans l’autre sens ; off désactive.", "  editor.foldSync: both"),
    h("Réglages", "edges.curve", [], "bezier | taxi | straight | round-taxi", "Forme des liens (défaut : bezier).", "  edges.curve: taxi"),
    h("Réglages", "edges.opacity", [], "nombre 0,15–1", "Opacité des liens (défaut : 1).", "  edges.opacity: 0.6"),
    h("Réglages", "nodes.size", [], "nombre 0,6–1,6", "Taille globale des nœuds (défaut : 1).", "  nodes.size: 1.2"),
    h("Réglages", "layout.default", [], "texte", "Disposition par défaut : fcose, cose, breadthfirst, grid, circle, concentric ou tree (défaut : fcose).", "  layout.default: tree"),
    h("Réglages", "tree.indent", [], "nombre (px)", "Indentation par niveau en disposition arbre (défaut : 28).", "  tree.indent: 28"),
    h("Réglages", "ui.sidePanel", [], "booléen", "Affiche le panneau latéral (défaut : true ; Vue > Panneau latéral, Ctrl+B).", "  ui.sidePanel: false"),
    h("Réglages", "ui.controls", [], "booléen", "Affiche la barre de contrôles et la palette d’outils du diagramme (défaut : true ; menu Contrôles).", "  ui.controls: false"),
    h("Réglages", "fullscreen.edgeReveal", [], "booléen", "Plein écran : le survol des bords (gauche : panneau, haut : bandeau) les fait apparaître en superposition (défaut : true).", "  fullscreen.edgeReveal: true"),
    h("Réglages", "meta.keys", [], "liste de textes", "Clés de métadonnées proposées dans le formulaire de brique, en plus de celles déjà utilisées dans le projet (défaut : owner, status, path, repo, version, environment, todo, doc).", "  meta.keys: [owner, status, repo]"),
    h("Réglages", "links.multi", [], "booléen", "Mode Lien : tracer un lien ajoute une paire à une série brouillon (panneau « Série de liens », liens temporaires animés) au lieu d’ouvrir le formulaire ; la source reste armée pour ajouter A→C, etc. Les liens sont créés d’un coup (une entrée d’historique). Ctrl pendant le tracé fait de même ponctuellement. Défaut : false.", "  links.multi: true"),
    h("Réglages", "links.multiAnchor", [], "booléen", "Série de liens : garder la source armée après chaque lien (défaut : true ; clic droit = relâcher la source, le clic suivant sur une brique en choisit une autre). Désactivé : la source est relâchée après chaque paire (clic source puis clic cible).", "  links.multiAnchor: false"),
    h("Réglages", "meta.card.when", [], "leaf | expanded | always | never", "Quand afficher la fiche métadonnée (défaut : never).", "  meta.card.when: leaf"),
    h("Réglages", "meta.card.position", [], "texte", "Ancrage de la fiche : top-left, top-right, bottom-left, bottom-right ou free (défaut : top-right).", "  meta.card.position: top-right"),
    h("Réglages", "meta.card.maxChars", [], "nombre", "Caractères par ligne avant troncature (défaut : 50).", "  meta.card.maxChars: 50"),
    h("Réglages", "meta.card.maxLines", [], "nombre", "Lignes avant troncature (défaut : 3).", "  meta.card.maxLines: 3"),
    h("Brique", "id", [], "texte", "Identifiant de la brique (défaut : nom du dossier, ou <nom> pour x.brick.yaml).", "id: resources-js"),
    h("Brique", "title", ["label"], "texte", "Libellé de la brique. Sur le brick.yaml racine : titre du diagramme.", "title: Artefact"),
    h("Brique", "type", [], "texte libre", "Type de la brique (optionnel).", "type: group"),
    h("Brique", "role", [], "texte libre", "Rôle de la brique (optionnel).", "role: domain"),
    h("Brique", "meta", [], "objet", "Informations libres de la brique (optionnel).", "meta:\n  owner: Équipe A"),
    h("Brique", "meta.card", [], "objet", "Fiche métadonnées de la brique (clés de meta, filtrées par meta.show). Sans meta.card : réglages globaux meta.card.* ; à défaut, fiche en « leaf » si meta.show existe, sinon aucune.", "meta:\n  owner: Équipe A\n  card: { when: leaf, position: bottom-right, maxChars: 40, maxLines: 4 }"),
    h("Brique", "meta.card.when", [], "leaf | expanded | always | never", "leaf : brique sans enfant visible (feuille ou groupe replié) ; expanded : groupe déplié ; always ; never.", "  card: { when: always }"),
    h("Brique", "meta.card.position", [], "texte", "Coin de la fiche : top-left, top-right, bottom-left, bottom-right, ou free (déplaçable, position gardée dans view.positions).", "  card: { position: free }"),
    h("Brique", "meta.card.maxChars", [], "nombre", "Caractères par ligne avant troncature.", "  card: { maxChars: 40 }"),
    h("Brique", "meta.card.maxLines", [], "nombre", "Lignes avant troncature (clic sur la fiche = tout afficher).", "  card: { maxLines: 4 }"),
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
    { keys: "Ctrl+Alt+1…9", description: "Appliquer la n-ième disposition nommée" },
    { keys: "Ctrl+Tab / Ctrl+Maj+Tab", description: "Onglet suivant / précédent (app installée ; sinon menu Fichier)" },
    { keys: "Ctrl+W", description: "Fermer l’onglet (app installée ; sinon menu Fichier)" },
    { keys: "V / H / B / L / M", description: "Outil Sélection / Main / Brique / Lien / Déplacer dans…" },
    { keys: "Ctrl (outil Lien)", description: "Tenu pendant le tracé d’un lien : série de liens (comme la case « Liens multiples ») = brouillon dans le panneau « Série de liens » ; clic sur d’autres briques = liens depuis la même source ; « Créer n liens » les écrit d’un coup ; Échap / Annuler (avec confirmation) abandonne" },
    { keys: "Clic droit (série de liens)", description: "Relâche la source armée ; le clic suivant sur une brique la choisit comme nouvelle source, le suivant crée la paire (un clic droit maintenu et déplacé déplace toujours la vue ; pas de menu contextuel pendant une série)" },
    { keys: "Espace (maintenu)", description: "Main temporaire (déplacer la vue)" },
    { keys: "Maj/Ctrl + clic", description: "Ajouter ou retirer une brique de la sélection" },
    { keys: "Suppr / Retour arrière", description: "Supprimer la sélection (vers la corbeille)" },
    { keys: "Ctrl+C / Ctrl+X / Ctrl+V", description: "Copier / couper / coller les briques sélectionnées (YAML dans le presse-papiers ; collage dans la brique sélectionnée, sinon à la racine)" },
    { keys: "Ctrl+]  /  Ctrl+[", description: "Avancer / reculer la brique sélectionnée d’un plan" },
    { keys: "Ctrl+Maj+]  /  Ctrl+Maj+[", description: "Premier plan / arrière-plan" },
    { keys: "Ctrl+B", description: "Afficher / masquer le panneau latéral" },
    { keys: "Ctrl+Maj+F", description: "Plein écran du diagramme (Échap pour quitter ; survol du bord gauche = panneau, bord haut ou Alt = bandeau)" },
    { keys: "F1", description: "Afficher l’aide" },
    { keys: "Échap", description: "Fermer la fenêtre / désélectionner" },
    { keys: "Double-clic sur un groupe", description: "Replier / déplier le groupe" },
    { keys: "Clic droit", description: "Menu contextuel" }
  ];

  return { normalize, normalizeNode, normalizeLink, ROOT_ALIASES, HELP, SHORTCUTS };
});
