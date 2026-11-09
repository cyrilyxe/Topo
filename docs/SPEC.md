# Topo — spécification v2

Static web app (no build step, opened via `index.html` or `node tools/topo.js serve`)
that renders an architecture diagram from YAML, plus a Node CLI that merges many
small "brick" YAML files spread in a project tree into one big YAML.

Code identifiers and comments: **English**. UI text: **French**.
All browser modules are plain scripts exposing one global object (no ES modules,
so `file://` keeps working). `js/schema.js`, `js/model.js`, `js/merge.js` are UMD:
they also work with `require()` in Node (`jsyaml` from global or `require("js-yaml")`).

---

## 1. YAML schema (canonical English keys, French aliases accepted)

| Canonical | Aliases (legacy) | Meaning |
|-----------|------------------|---------|
| `title` | `titre` | Diagram title |
| `nodes` | `noeuds` | Top-level list of nodes |
| `id` | — | Node identifier. May contain `.` only in merged files (qualified path) |
| `label` | `titre`, `title` (on a node) | Displayed text (defaults to id) |
| `type` | — | Free text (service, database, external, group…). Drives the node icon/colour |
| `role` | — | Free text (domain, category…) |
| `children` | `enfants` | Nested nodes → node becomes a group |
| `meta` | — | Free map. Special keys: `show` (alias `afficher`: list of meta keys shown on a collapsed group), `links` (alias `liens`: list of `{label, url}`), `source` (set by the merger: path of the small YAML) |
| `links` (root) | `liens` | List of edges |
| `from` / `to` | `de` / `vers` | Edge ends: node reference (see §2) |
| `label` (link) | — | Edge text |
| `style` | `presentation` | Presentation block |
| `style.size` | `taille` | Global node size factor |
| `style.rules[]` | `regles` | Per-node rules: `target` (`cible`), `label` (`etiquette`), `color` (`couleur`), `border` (`bordure`), `opacity` (`opacite`), `size` (`taille`), `highlight` (`mettre_en_avant`), `hidden` (`masquer`) |
| `view` | `vue` | Saved view: `collapsed: [ids]` (`replies`), `zoom`, `pan: {x,y}`, `layout` (`fcose`|`cose`\|`breadthfirst`\|`grid`\|`circle`\|`concentric`), `positions: {id: {x,y}}` (optional, written when the user dragged nodes) |

`Schema.normalize(raw)` converts any document (French or English keys, any mix)
to the canonical English shape. The app always writes canonical keys when it
generates YAML; it never rewrites keys the user typed except the `view:` block (§4).

## 2. Node references (links, style targets, view ids)

Every node has a **local id** and a **qualified id** = ids of its ancestors and
itself joined with `.` (e.g. `platform.execution.api`).
`Model.resolveRef(ref, model, contextId?)` resolution order:
1. exact qualified id;
2. exact local id if unique;
3. relative to `contextId` (sibling / descendant of the context's ancestors, nearest first);
4. suffix match on qualified ids (`execution.api` matches `platform.execution.api`) if unique.
Returns `{ id }` or `{ error: "unknown"|"ambiguous", candidates: [qualifiedIds] }`.

In single-file mode the internal node key is the **qualified id** only when the
local id is duplicated; otherwise the local id (keeps old files unchanged).
Simplest correct implementation: internal key = local id if globally unique, else qualified id.

## 3. Parsing never throws on semantic problems

`Model.parse(text)` throws only on YAML syntax error / missing `nodes`.
Everything else becomes `model.anomalies[]`:
```
{ level: "error"|"warning", code, message, path?, ref?, candidates?: [], fix?: {...} }
```
codes: `duplicate-id`, `ambiguous-ref`, `unknown-ref`, `self-link`, `obsolete-style-rule`,
`missing-id` (node gets an auto id `node-<n>`). Unresolved links are dropped from the graph.

## 4. View persistence

- Collapsed groups, zoom, pan, layout, positions are kept per document in
  `localStorage` (key = file name or `"__scratch__"`), restored on open.
- On **Save**, the `view:` top-level block is written into the YAML by textual
  replacement of that block only (`Model.replaceTopLevelBlock(text, "view", obj)`),
  preserving the user's comments elsewhere. When a file is opened, its `view:` wins over localStorage.

## 5. Brick projects (multi-file)

A project is a folder tree. Brick files:
- `brick.yaml` (or `brick.yml`) in a folder describes the brick of that folder;
- `<name>.brick.yaml` describes a child brick of the folder (no own subfolder).
- Folders without a brick file but containing bricks below become plain groups (label = folder name).
- Ignored: `node_modules`, `.git`, dot-folders, and the build output file.

Brick file format:
```yaml
id: resources-js          # optional, default: folder name (or <name> for x.brick.yaml)
title: Artefact           # label of the brick (alias: label)
type: group               # optional
role: domain              # optional
meta: { ... }             # optional
nodes: [ ... ]            # optional inner nodes (same schema as §1, local ids)
links:                    # optional, refs resolved per §2 with this brick as context
  - from: api
    to: ressources
```
Root `brick.yaml` of the project gives the diagram `title` (its id is not part of qualified ids).

`Merge.mergeProject(files, options)` — pure function:
- input `files: [{ path: "a/b/brick.yaml", text }]` (posix relative paths), `options.output` (path to ignore, default `architecture.yaml`);
- output `{ document, anomalies }` where `document` is the canonical merged object:
  every node id is its **qualified id**, `label` = brick title (or local label),
  `meta.source = "<path>"` (and `meta.sourceId = <local id>`) on each node coming from a file;
  links use qualified ids. Each link keeps `meta.source` of the file it came from.
- anomalies (§3 format) + `file` (source path) + for refs a `fix`:
  `{ file, key: "to"|"from"|..., oldRef, newRef }` — one fix per candidate,
  message e.g. *« Lien de `x.api` vers `ressources` ambigu : vouliez-vous dire `x.y.ressources`, `a.ressources` ou `ressources` (brique) ? »*
  Unknown refs propose up to 3 closest qualified ids (Levenshtein on last segment).
- duplicate local ids in different bricks are **not** errors after merge (qualified ids differ) — they are reported as `warning` `duplicate-id` only when a ref to them is ambiguous; a true duplicate qualified id is an `error`.

`Merge.applyFix(text, fix)` — returns new text where the value of `key:` equal to
`oldRef` (quoted or not, also French alias keys `de`/`vers`) inside that file is replaced by `newRef`.
Pure text replacement → comments preserved.

`Merge.toYaml(document)` — dumps with a header comment `# Generated by topo — do not edit by hand, edit the brick files`.

## 6. CLI `tools/topo.js` (Node ≥ 18, dep: js-yaml)

```
node tools/topo.js build <dir> [-o architecture.yaml]   # merge, write output, print anomalies, exit 1 on errors
node tools/topo.js check <dir>                          # merge, print anomalies only
node tools/topo.js fix <dir> [--yes]                    # for each ambiguous/unknown ref: interactive choice
                                                         # (readline: numbered candidates, s = skip); --yes picks the first candidate
node tools/topo.js serve [dir] [-p 8080]                # static server for the app (localhost → File System Access API works)
```

## 7. App features (UI)

- Header: title of the current document + dirty marker `●`, file name.
- Toolbar groups: **Fichier** (Nouveau, Ouvrir…, Enregistrer Ctrl+S, Enregistrer sous… Ctrl+Shift+S, Importer JSON),
  **Exporter** (SVG, PNG, JSON, Mermaid), **Projet** (Ouvrir un dossier de briques…), **Aide** (`?` button, F1).
- Open/Save use the File System Access API when available (keeps the file handle → Enregistrer writes back
  to the same file); fallback: `<input type=file>` + download for "Enregistrer sous".
- SVG export of the current view (collapsed state, styles) via `cytoscape-svg`; PNG via `cy.png({full:true, scale:2})`.
- Help modal: generated from `Schema.HELP` (table of every key: name, aliases, type, effect, example) + keyboard shortcuts + CLI usage.
- Anomalies panel (badge count) listing `model.anomalies`; click → go to line in editor; fixes shown as buttons.
- Light/dark theme (prefers-color-scheme + toggle stored in localStorage).
- Layout selector (fcose (default), cose, breadthfirst, grid, circle, concentric).
- HTML escaping of every user-provided string injected with innerHTML.
- Project panel (multi-file mode): see §5; tree of bricks, anomalies with fix buttons that write into the
  small YAML (directory handle), "Reconstruire", "Enregistrer le YAML fusionné", change detection on source files
  (poll `lastModified` every 3 s → banner « 2 fichiers sources modifiés — Reconstruire ? »),
  "Éditer la source" on a brick opens its small YAML in the editor; saving writes it back and rebuilds.
