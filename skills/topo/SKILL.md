---
name: topo
description: Décrire un projet sous forme de carte Topo (YAML d'architecture lisible par l'humain et l'IA), soit en un seul fichier, soit en petits fichiers brick.yaml répartis dans l'arborescence ; et appliquer au projet les changements que l'utilisateur a faits dans Topo. Utiliser quand l'utilisateur parle de Topo, de carte/topo du projet, de brick.yaml, d'architecture.yaml, ou fournit un YAML Topo modifié.
---

# Topo — carte de projet en YAML

Topo affiche une carte interactive d'un projet (logiciel, matériel, idées) à partir d'un YAML.
L'utilisateur ouvre le YAML dans Topo, le réorganise visuellement (ajoute, déplace, relie, supprime, annote),
puis te rend le YAML modifié : **c'est une spécification de ce qu'il veut**. Ton rôle :
1. **Produire** une carte fidèle du projet (un fichier, ou des petites briques).
2. **Relire** la carte modifiée, en déduire les changements voulus, et les appliquer au projet.

## 1. Choisir le format

| Situation | Format |
|---|---|
| Projet petit/moyen, vue d'ensemble, brainstorming | **Un seul fichier** `topo.yaml` (ou `architecture.yaml`) à la racine |
| Projet gros, plusieurs équipes/modules, carte maintenue dans le temps | **Briques** : un `brick.yaml` par dossier significatif, fusionnés par la CLI |

Dans le doute, demande. Par défaut : un seul fichier.

## 2. Schéma (clés canoniques en anglais ; des alias français existent, ne les utilise pas)

```yaml
title: Nom du projet

nodes:                      # arbre des briques
  - id: plateforme          # identifiant stable, kebab-case, unique si possible
    label: Plateforme       # texte affiché (défaut : id)
    type: group             # libre ; couleurs dédiées pour : service, database, application, external, queue
    role: domain            # libre (domain, category, layer, team…)
    meta:                   # libre, clé → valeur courte
      owner: Équipe Plateforme
      repo: "https://github.com/org/repo"
      path: src/platform    # recommandé : où ça vit dans le code
      show: [owner]         # clés de meta affichées sur la boîte repliée / la fiche
      links:                # liens web cliquables
        - { label: Doc, url: "https://…" }
      card: { when: leaf }  # fiche métadonnées : leaf | expanded | always | never
    children:               # sous-briques → la brique devient un groupe
      - id: api
        label: API
        type: service

links:                      # relations orientées entre briques (n'importe quel niveau)
  - from: api
    to: base-donnees
    label: lectures / écritures
    style: { color: "#2563eb", width: 2, line: dashed, arrow: vee }   # optionnel, voir §2 bis
```

**Références** (`from`, `to`) : id local s'il est unique ; sinon chemin qualifié par des points
(`plateforme.donnees.cache`). Topo signale les références ambiguës ou inconnues dans l'onglet Anomalies.

**Blocs de présentation — à préserver tels quels, jamais à interpréter comme des exigences** :
`style:` (couleurs, mise en avant, masquage), `view:` (replis, zoom, positions), `settings:` (réglages d'affichage).
**`trash:`** = éléments que l'utilisateur a supprimés dans Topo (restaurables) : voir §5.

## 2 bis. Présentation (facultatif — à n'écrire que si l'utilisateur le demande)

Tu peux proposer un style cohérent à la création (une couleur par rôle ou par type), mais ensuite c'est l'utilisateur qui le gère dans Topo.

```yaml
style:
  types:                    # style par défaut de tous les nœuds d'un type
    service:  { color: "#dbeafe", border: "#2563eb", shape: round-rectangle }
    database: { color: "#dcfce7", shape: barrel }
  roles:                    # prioritaire sur types
    domain:   { border: "#7c3aed", borderStyle: dashed, borderWidth: 2, bold: true }
  rules:                    # ciblées sur un nœud (prioritaires sur roles et types)
    - target: plateforme.donnees.cache
      color: "#fef3c7"
      highlight: true       # autres clés : opacity, size, hidden, label, textColor, italic, textBackground
  presets: { … }            # styles nommés enregistrés par l'utilisateur
view:
  collapsed: [clients]      # groupes repliés
  positions: { api: { x: 120, y: 80 } }
  layouts:                  # dispositions nommées figées par l'utilisateur
    revue: { positions: {…}, collapsed: […], zoom: 1, pan: {…}, layout: fcose, savedAt: "…" }
settings:                   # réglages propres à ce fichier (prioritaires sur la config locale)
  ids.scheme: slug          # slug | parent-slug | type-n
```

- Priorité des styles : défaut du type < `style.types` < `style.roles` < `style.rules`.
- `shape` : round-rectangle, rectangle, ellipse, hexagon, diamond, barrel, rhomboid, tag, star… La forme est ignorée pour un groupe déplié.
- La couleur du texte est contrastée automatiquement. Ne fixe `textColor` que pour un besoin précis.
- `links[].style` accepte `color`, `width`, `line` (solid | dashed | dotted), `arrow` et `sourceArrow` (triangle | vee | triangle-backcurve | circle | square | diamond | tee | none), et `textColor`.
- Conventions de lecture : une couleur ou une forme partagée par un type ou un rôle forme une **légende**. Un `highlight` ou un style de lien particulier signale souvent un point d'attention : mentionne-le, sans en faire une exigence.

**Fonctions de l'appli qui touchent au YAML** (bon à savoir quand tu relis une carte modifiée) :
- **Renommer un id dans Topo** réécrit toutes ses références : liens, `style.rules[].target`, `view`, `trash`. Un id changé de façon cohérente partout est donc un renommage voulu.
- **Copier-coller** de briques entre cartes : le presse-papiers contient un YAML `topo-clipboard: { nodes, links }`. En cas de conflit, les ids collés sont régénérés selon `ids.scheme`, par exemple `api-2` ou `plateforme-api`.
- Positions, replis et dispositions vivent dans `view`. Ce n'est jamais une consigne d'architecture.

## 3. Produire une carte depuis un code existant

1. Explore le dépôt (structure, points d'entrée, manifests, configs de déploiement, README).
2. Racine : 3 à 7 groupes de premier niveau (domaines, couches ou applications). Pas plus de ~7 enfants par groupe : regroupe sinon.
3. Une brique = une unité qui a un sens pour l'humain (service, module, base, file, appareil, API externe), pas chaque fichier.
4. `type` parmi `service | database | application | external | queue | group | device | library | …` (libre, garde-le cohérent).
5. `meta.path` sur chaque brique qui correspond à du code ; `meta.repo`/`meta.links` si utile ; valeurs courtes (≤ 50 caractères).
6. Liens = flux réels (appels HTTP, lectures/écritures, événements, dépendances de build) avec un `label` verbal court.
7. Ce que tu ne sais pas : `meta: { status: "à confirmer" }` plutôt qu'inventer.
8. Commentaires YAML bienvenus (Topo les préserve à l'édition).

## 4. Format briques (multi-fichiers)

- `brick.yaml` dans un dossier = la brique de ce dossier ; `nom.brick.yaml` = brique enfant sans sous-dossier.
- Le `brick.yaml` racine donne le `title` du projet.
- Un dossier sans brique mais avec des briques plus bas devient un groupe portant le nom du dossier.
- Ignorés : `node_modules`, `.git`, dossiers cachés, le fichier de sortie.

```yaml
# src/platform/execution/brick.yaml
id: execution          # optionnel (défaut : nom du dossier)
title: Exécution       # libellé de la brique
type: group
meta: { owner: Équipe Run }
nodes:                 # sous-briques internes (même schéma que §2)
  - id: api
    type: service
links:                 # refs résolues depuis cette brique ; préfère le qualifié hors de la brique
  - from: api
    to: platform.data.database
    label: écrit
```

Fusion et contrôle (Node ≥ 18, sans dépendance, depuis le dossier de Topo ou son archive) :
```bash
node <topo>/tools/topo.js check <dossier-projet>   # anomalies : refs ambiguës/inconnues, ids dupliqués
node <topo>/tools/topo.js build <dossier-projet>   # écrit <dossier-projet>/architecture.yaml (ne pas éditer à la main)
node <topo>/tools/topo.js fix <dossier-projet> --yes
```
Dans le fichier fusionné, chaque nœud porte `meta.source` (chemin du petit YAML) et un id qualifié :
c'est ce qui te permet de remonter au bon fichier.

Après avoir écrit des briques : lance `check` et corrige toutes les erreurs avant de rendre la main.

## 5. Appliquer un YAML modifié par l'utilisateur

Garde une copie de la version que tu as fournie (ou retrouve-la via git). Quand l'utilisateur te rend le nouveau YAML :

1. **Calcule le diff sémantique** (pas textuel) : nœuds ajoutés / supprimés / renommés (label) / déplacés (parent changé) / meta modifiée ;
   liens ajoutés / supprimés / relabellisés. Ignore `style`, `view`, `settings`, l'ordre des clés
   et l'ordre des frères (Topo réordonne les nœuds pour gérer l'empilement visuel).
2. **Présente le diff** à l'utilisateur en liste courte avant d'agir, regroupé par intention :
   « Nouveau service `notifications` dans Plateforme, appelé par `api` », « `cache` déplacé de Données vers Exécution »…
3. **Interprète** :
   - nœud ajouté → créer le module/service/fichier correspondant (ou la tâche, si c'est un plan) ;
   - lien ajouté → nouvelle dépendance/appel à implémenter ;
   - déplacement → refactoring (déplacer le code, changer le package/dossier) ;
   - `meta` modifiée → appliquer (owner, path, statut…) ;
   - éléments dans `trash:` ou disparus → **demander confirmation** avant de supprimer du code ;
     un lien avec `meta.relinkedFrom` = lien rattaché au parent lors d'une suppression ;
   - un `meta.status`, `meta.todo` ou un commentaire YAML ajouté = consigne de l'utilisateur, lis-les.
4. Applique, puis **régénère la carte** pour qu'elle reflète l'état réel (et lance `check` en mode briques).
   En mode briques, écris dans les petits `brick.yaml` (via `meta.source`), jamais seulement dans le fusionné.
5. Si un changement est ambigu ou irréaliste, dis-le et propose une alternative plutôt que d'improviser.

## 6. Pièges

- Ne renomme pas les `id` existants sans raison : Topo y rattache style, vue et positions. Change le `label`.
  Si tu dois renommer, mets à jour toutes les références, y compris `style.rules[].target`, `view.positions`, `view.collapsed`, `view.layouts.*` et `trash`.
- Un nouveau `type` ou `role` est libre. Si `style.types` ou `style.roles` existe déjà, ajoute une entrée pour le nouveau, ou laisse l'utilisateur la créer depuis la légende.
- Ids uniques globalement si possible ; sinon, références qualifiées obligatoires.
- Pas de tabulations (indentation en espaces).
- Ne supprime jamais les blocs `style:`, `view:`, `settings:`, `trash:` d'un fichier que l'utilisateur t'a rendu.
- Garde la carte à hauteur d'humain : si elle dépasse ~80 briques, passe en briques multi-fichiers.
