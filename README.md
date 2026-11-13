# Topo

> **Fais-moi le topo.** Une carte vivante de ton projet, lisible par un humain comme par une IA.

Topo dessine une carte interactive d’un projet (logiciel, matériel, idées…) à partir d’un simple YAML. On peut la commencer avant d’écrire la moindre ligne de code, la faire évoluer, et la donner telle quelle à Claude Code ou à une autre IA pour qu’elle comprenne le projet. Une CLI Node fusionne aussi de petits fichiers « briques » répartis dans l’arborescence en une carte unique.

### Pourquoi « Topo » ?

Le nom joue sur deux sens. *Topo*, c’est la **topographie** : la carte du terrain, quel que soit ce qu’on y pose (services, périphériques, concepts). Et en français familier, « **faire le topo** », c’est résumer une situation à quelqu’un. C’est exactement le rôle du YAML qu’on partage avec une IA ou un collègue.

Contrairement aux générateurs comme Doxygen, qui *extraient* la structure du code existant, Topo *décrit l’intention* du projet. On écrit la carte, et le code suit (ou pas).

La spécification complète est dans [`docs/SPEC.md`](docs/SPEC.md).

## Lancement

- Ouvrez simplement `index.html` dans un navigateur moderne (fonctionne en `file://`), ou
- lancez `node tools/topo.js serve` puis ouvrez `http://localhost:8080` (l’API File System Access y fonctionne : « Enregistrer » réécrit le fichier ouvert).

Aucun build, aucun backend. Les bibliothèques (js-yaml, Cytoscape, cytoscape-svg, CodeMirror) sont chargées depuis des CDN.

## Fonctions

- Éditeur YAML (CodeMirror) appliqué automatiquement après 600 ms d’inactivité ; les erreurs de syntaxe n’effacent pas le graphe courant.
- Groupes imbriqués repliables (double-clic), méta-arêtes, fiche de métadonnées dans le groupe, recherche texte / regex, menus contextuels.
- Panneaux : Éditeur, Inspecteur, Style (règles de présentation écrites dans le bloc `style:`), Anomalies (références ambiguës ou inconnues avec boutons de correction).
- Fichiers : Nouveau, Ouvrir, Enregistrer (Ctrl+S), Enregistrer sous (Ctrl+Maj+S), import JSON ; Recharger depuis le disque (Alt+R, annulable par Ctrl+Z) et détection d’un fichier modifié par un autre programme (bandeau Recharger / Ignorer, marqueur ⟳ dans l’onglet, confirmation avant d’écraser ; réglages `files.watch` et `files.autoReload`) ; premier enregistrement : nom proposé d’après le `title` du YAML (`architecture-exemple.yaml`) ; renommer par double-clic sur l’onglet ou clic sur le nom de fichier (avec fichier lié : « Enregistrer sous… », l’onglet suit le nouveau fichier) ; « Ouvrir le fichier enregistré » recharge depuis le disque.
- Éditeur : barre de recherche au-dessus du YAML (Ctrl+F, ou permanente via Vue > Barre de recherche de l’éditeur, réglage `editor.searchBar`) : compteur n / total, suivant / précédent (Entrée / Maj+Entrée), casse, regex, surlignage, ids du modèle proposés ; les menus du bandeau s’ouvrent au survol quand l’un d’eux est déjà ouvert.
- Persistance de la vue (repli, zoom, déplacement, disposition, positions) dans `localStorage` par document, et dans le bloc `view:` du fichier à l’enregistrement (option du menu Vue).
- Exports : SVG, PNG, JSON, Mermaid.
- Affichage : panneau latéral (Ctrl+B) et contrôles du diagramme masquables (menu Vue), menu Contrôles (outils, dispositions, ajuster, replier/déplier), plein écran du diagramme (Ctrl+Maj+F, Échap pour quitter ; en plein écran, le bord gauche révèle le panneau, le bord haut ou Alt le bandeau).
- Aide (`?` ou F1) générée depuis le schéma, thème clair / sombre.

## Schéma résumé

```yaml
title: Mon système
nodes:
  - id: platform
    label: Plateforme
    children:
      - { id: api, type: service, role: domain, meta: { owner: equipe-a } }
      - { id: db, type: database }
links:
  - { from: api, to: db, label: SQL }
style:
  size: 1
  rules:
    - { target: api, color: "#2563eb", highlight: true }
view:
  collapsed: []
  layout: fcose
```

Les clés françaises historiques (`titre`, `noeuds`, `enfants`, `liens`, `de`, `vers`, `presentation`…) restent acceptées. Voir l’aide intégrée pour la table complète.

## Projet de briques et CLI

```
node tools/topo.js build <dossier> [-o architecture.yaml]
node tools/topo.js check <dossier>
node tools/topo.js fix <dossier> [--yes]
node tools/topo.js serve [dossier] [-p 8080]
```

Le format des fichiers `brick.yaml` est décrit dans `docs/SPEC.md` (§5-6).

### Dans le navigateur

Menu **Projet ▸ Ouvrir un dossier de briques…** (Chrome/Edge via `node tools/topo.js serve`, accès lecture/écriture). Le dossier est fusionné en un diagramme ; l’onglet **Projet** liste les briques et les anomalies de fusion, avec correctifs « Remplacer par … » écrits dans les petits fichiers. Les changements de fichiers sont détectés (bannière « Reconstruire »). « Éditer la source » (menu d’un nœud ou inspecteur) ouvre le petit YAML ; l’enregistrer reconstruit le fusionné. Ctrl+S sur le fusionné écrit `architecture.yaml` mais ne remonte pas dans les briques. Sans File System Access API (Firefox, Safari), le dossier est lu en lecture seule et correctifs/enregistrements sont téléchargés.

## Déploiement autonome

`node tools/topo.js package` télécharge les libs CDN dans `vendor/` (une fois) puis produit `dist/topo-<version>.zip` et `.tar.gz` : `index.html` (URLs réécrites en relatif), `styles.css`, `js/`, `tools/`, `vendor/`, `docs/`, `examples/`, `README.md`, `package.json`. Aucun `npm install`, CDN ni accès internet requis.

Trois façons de servir après extraction :
1. ouvrir `index.html` en `file://` ;
2. `node tools/topo.js serve` (Node ≥ 18, sans `node_modules`) ;
3. n'importe quel serveur statique, ex. nginx : `root /srv/topo; index index.html;`

La CLI `build`/`check`/`fix` fonctionne aussi sans `node_modules` (js-yaml est pris dans `vendor/`).

## Structure

- `index.html`, `styles.css` : interface et thème (tokens CSS)
- `js/schema.js`, `js/model.js`, `js/merge.js` : schéma, modèle, fusion (UMD)
- `js/app.js` : orchestration, API globale `App`
- `js/editor.js`, `js/graph.js`, `js/inspector.js` : éditeur, graphe Cytoscape, inspecteur
- `js/style.js`, `js/style-ui.js` : application et édition des règles de style
- `js/files.js`, `js/help.js`, `js/anomalies.js` : fichiers, aide, anomalies

## Utiliser Topo avec Claude (ou une autre IA)

Le skill [`skills/topo/SKILL.md`](skills/topo/SKILL.md) explique à Claude comment produire une carte Topo d'un projet (un fichier ou des `brick.yaml`) et comment appliquer au projet les changements que vous faites dans Topo.

Installation pour tous vos projets (Claude Code) :

```bash
mkdir -p ~/.claude/skills/topo && cp skills/topo/SKILL.md ~/.claude/skills/topo/
```

Ou pour un seul projet : copiez le dossier dans `<projet>/.claude/skills/topo/`. Pour une autre IA, collez simplement le contenu du fichier dans son contexte.
