# Topo — spec v3 : édition graphique

Complète `docs/SPEC.md`. Principe directeur : **le texte YAML reste la source de vérité**.
Toute action graphique = une modification du texte (commentaires préservés) → re-parse → rendu.
Code en anglais, UI en français, scripts globaux (pas d'ES modules), aucune dépendance runtime hors `vendor/`.

## 1. Fondations

### 1.1 `DocEdit` (js/doc-edit.js) — édition YAML qui préserve les commentaires
Basé sur la lib `yaml` (eemeli, v2) bundlée en UMD dans `vendor/yaml.js` (global `YAML`, `require` en Node).
Toutes les fonctions sont **pures** : `(text, …args) → newText`. Elles comprennent les clés canoniques ET les alias FR
(`nodes|noeuds`, `children|enfants`, `links|liens`, `from|de`, `to|vers`, `style|presentation`, `view|vue`).
Un nœud est désigné par son **id interne** (celui de `Model.parse` : local si unique, sinon qualifié).
- `addNode(text, parentId|null, nodeObj, index?)` · `updateNode(text, id, patch)` (patch: label,type,role,meta… ; `null` supprime la clé)
- `removeNodes(text, ids, {relinkToParent})` → `{ text, trashed: [{ node, parentId, index, links:[…] }] }` ;
  sans relink : liens entrants/sortants du sous-arbre retirés ; avec relink : chaque extrémité supprimée remplacée par
  le plus proche ancêtre survivant (lien supprimé si plus d'ancêtre ou si boucle), le lien garde `meta.relinkedFrom`.
- `moveNode(text, id, newParentId|null, index?)` (reparentage + réordonnancement ; refuse de déplacer un nœud dans son propre sous-arbre).
- `reorder(text, id, op)` op ∈ `front|forward|backward|back` = position parmi ses frères (dernier = dessiné au-dessus).
- `addLink(text, {from,to,label})` · `updateLink(text, index, patch)` · `removeLinks(text, indexes)`.
- `setTopLevel(text, key, value|null)` (remplace `Model.replaceTopLevelBlock` à terme).
- `trashPush(text, entries)` / `trashRestore(text, trashIndex)` : bloc racine `trash:` (liste `{ deletedAt, parent, index, node, links }`).
  Restaurer réinsère le nœud à sa place (ou à la racine si le parent n'existe plus) et ses liens d'origine (`relinkedFrom` annulé).

### 1.2 `History` (js/history.js)
Pile undo/redo de snapshots texte (max 100), `History.push(text, label)`, `undo()`, `redo()`, `canUndo/canRedo`.
Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z hors de CodeMirror (CodeMirror garde son propre undo quand il a le focus).
Chaque action graphique pousse un snapshot avec un libellé (« Suppression de 3 éléments »).

### 1.3 `Settings` (js/settings.js) — configuration à 4 niveaux
Priorité croissante : **défauts intégrés** < `topo.config.json` (suggérée, versionnée avec le dépôt) < **localStorage** (l'utilisateur) < bloc `settings:` du YAML (document figé, portable).
API : `Settings.get(key)`, `Settings.set(key, value, scope="local")`, `Settings.onChange(fn)`, `Settings.all()`, `Settings.source(key)`.
Clés (toutes documentées dans Schema.HELP et dans la boîte Réglages) :
| clé | défaut | effet |
|---|---|---|
| `drop.repulsion` | `true` | au relâchement, la boîte déplacée se pose sans chevaucher ses frères |
| `selection.tab` | `"keep"` | onglet affiché à la sélection : `keep` \| `inspector` \| `style` |
| `edges.curve` | `"bezier"` | `bezier` (courbe) \| `taxi` (angle droit) \| `straight` \| `round-taxi` |
| `edges.opacity` | `1` | opacité des liens (0.15–1), slider à côté de « Taille » |
| `nodes.size` | `1` | taille globale |
| `layout.default` | `"fcose"` | disposition par défaut (+ `tree`) |
| `tree.indent` | `28` | indentation (px) par niveau en disposition arbre |
| `meta.card.*` | voir §4 | défauts des fiches métadonnées |
Boîte « Réglages » (menu Vue) : chaque clé, sa valeur effective et sa provenance, bouton « rétablir ».
Actions : **« Nettoyer le YAML »** (retire du `settings:`/`style:`/`view:` tout ce qui est égal au défaut effectif, règles de style vides, `highlight: false`, etc.) et **« Figer la configuration dans le YAML »** (écrit toutes les clés effectives dans `settings:` → rendu identique partout).

## 2. Disposition & interactions de base
- **Répulsion au relâchement** (`drop.repulsion`) : sur `dragfree`, si la boîte (avec ses enfants) chevauche un frère (même parent, ou racine), elle est déplacée au plus près vers un emplacement libre (marge 16 px). Les frères ne bougent pas. Un groupe déplacé emmène ses enfants (pas d'éparpillement). Désactivée → superposition libre.
- **Ordre des plans** = ordre YAML : menu contextuel « Premier plan / Avancer / Reculer / Arrière-plan » → `DocEdit.reorder`. Un enfant ne passe jamais sous son parent ; pour descendre plus bas, l'action propose d'appliquer au parent (« Appliquer à Plateforme »).
- **Liens** : style `edges.curve`, opacité `edges.opacity` (slider barre du graphe).
- **Disposition « arbre »** (`tree`) : vue outline. Chaque groupe déplié empile ses enfants **en colonne**, indentés de `tree.indent`, dans l'ordre YAML (en mode projet = l'arborescence des dossiers, déjà reflétée par l'imbrication). Au premier passage en `tree`, seul le niveau 1 est déplié. Un clic sur un groupe le déplie/replie (un niveau à la fois). Liens en `taxi` par défaut dans cette disposition.
- **Onglet à la sélection** : `selection.tab` (par défaut `keep` : on reste sur l'onglet courant, Style compris).

## 3. Outils (barre verticale sur le graphe, raccourcis à la Adobe)
| outil | touche | comportement |
|---|---|---|
| Sélection | V | clic = sélectionner ; Maj/Ctrl+clic = ajouter ; glisser sur le fond = rectangle de sélection ; glisser une boîte = déplacer |
| Main | H (ou Espace maintenu) | glisser = déplacer la vue ; rien n'est sélectionnable |
| Brique | B | clic sur une brique = formulaire « nouvel enfant » ; clic sur le fond = brique racine |
| Lien | L | glisser d'une brique à une autre (aperçu en pointillés) → formulaire libellé |
| Déplacer dans… | M | glisser une brique « volante » : la boîte survolée s'éclaire ; relâcher = reparentage (`moveNode`) ; relâcher sur le fond = sortie à la racine. Échap annule |
Le curseur et une ligne d'aide en bas du graphe expliquent l'outil courant. `Suppr` = supprimer la sélection (nœuds + liens) → **corbeille**, avec case « rattacher les liens au parent » dans la confirmation (mémorisée).
Formulaires (dialog modal) : id (proposé depuis le libellé, unicité vérifiée en direct), libellé, type (liste des types connus + libre), rôle, métadonnées clé/valeur ; lien : de, vers (pré-remplis), libellé.
Mode projet : les éditions s'appliquent au petit YAML source (`meta.source`) ; un reparentage entre deux fichiers déplace le bloc d'un fichier à l'autre ; en cas de doute, message et refus plutôt que corruption.

## 4. Fiches métadonnées (« brique métadonnée »)
Une fiche = nœud dérivé `meta-card` affichant les métadonnées d'une brique (`meta` hors clés spéciales, filtrées par `meta.show` si présent).
Réglage par brique `meta.card` (sinon défauts `Settings meta.card.*`) :
- `when`: `leaf` (brique sans enfant visible = feuille ou groupe replié) | `expanded` (groupe déplié) | `always` | `never` (défaut : réglage global `meta.card.when` s'il est choisi par l'utilisateur (local ou document ; le « never » intégré/suggéré ne compte pas), sinon `leaf` si `meta.show` existe, sinon `never`).
- `position`: `top-left|top-right|bottom-left|bottom-right|free` (free = déplaçable, position gardée dans `view.positions`).
- `maxChars` (défaut 50 par ligne), `maxLines` (défaut 3). Tronqué → `…` + indicateur ; clic = déplier/retronquer.
Implémentation : `js/meta-cards.js` (`MetaCards.inject`, appelé par `Graph.refresh` après `Style.apply`) ; nœud `card:<id>` ; enfant de la brique si groupe déplié (coin intérieur), sinon collé à l'extérieur du coin ; non-`free` : suit sa brique, exclue de la répulsion, des dispositions, de la recherche et de la sélection ; `free` : position persistée dans `view.positions` sous `card:<id>`. Inspecteur : section « Fiche métadonnées ».
Rendu dérivé de la brique : fond blanc 50 % (sombre 50 % en thème sombre), bordure couleur de la brique, texte contrasté.
Conséquence voulue : groupe déplié → les fiches des enfants s'affichent ; groupe replié → les fiches enfants disparaissent avec eux et la fiche du groupe (`leaf`) apparaît.

## 5. Onglet Style
- Affiche le **style effectif** observé (couleur du type, profondeur, règles), en distinguant « hérité » et « règle ».
- Palette : couleurs des types + du thème + 8 dernières couleurs utilisées.
- **Pinceau** (copier le style) : sur une brique sélectionnée → copie sa règle ; clic sur d'autres briques / la sélection → applique. Échap pour sortir.
- S'applique à la **sélection multiple**.
