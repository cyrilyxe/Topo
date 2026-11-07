"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const jsyaml = require("js-yaml");
const DocEdit = require("../js/doc-edit.js");
const Merge = require("../js/merge.js");
const ProjectSync = require("../js/project-sync.js");

const ROOT = path.join(__dirname, "..", "examples", "demo-project");

function readProject() {
  const out = [];
  const walk = (dir, prefix) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
    else if (Merge.isBrickFile(`${prefix}${e.name}`)) out.push({ path: `${prefix}${e.name}`, text: fs.readFileSync(path.join(dir, e.name), "utf8") });
  });
  walk(ROOT, "");
  return out;
}

// Applies a merged-text edit, writes the translated files in memory and returns { files, text, merged }.
function route(fn) {
  const files = readProject();
  const before = ProjectSync.mergedText(files);
  const result = ProjectSync.translate(files, before, fn(before));
  const next = files.map((f) => ({ path: f.path, text: result.files[f.path] !== undefined ? result.files[f.path] : f.text }));
  Object.keys(result.files).filter((p) => !files.some((f) => f.path === p)).forEach((p) => next.push({ path: p, text: result.files[p] }));
  return { changed: Object.keys(result.files).sort(), files: result.files, after: Merge.mergeProject(next, { output: "architecture.yaml" }), next };
}

const idsOf = (doc) => {
  const out = [];
  const walk = (list) => (list || []).forEach((n) => { out.push(n.id); walk(n.children); });
  walk(doc.nodes);
  return out;
};
const linkPairs = (doc) => doc.links.map((l) => `${l.from}>${l.to}`);

test("adding a child under a folder brick writes into its brick.yaml", () => {
  const r = route((t) => DocEdit.addNode(t, "execution", { id: "cache", label: "Cache", type: "service" }));
  assert.deepStrictEqual(r.changed, ["platform/execution/brick.yaml"]);
  assert.ok(r.files["platform/execution/brick.yaml"].includes("# Ambigu : `resources` existe dans plusieurs briques"));
  assert.ok(idsOf(r.after.document).includes("platform.execution.cache"));
});

test("adding a child inside an inner node writes under its children", () => {
  const r = route((t) => DocEdit.addNode(t, "api", { id: "auth", label: "Auth" }));
  assert.deepStrictEqual(r.changed, ["platform/execution/brick.yaml"]);
  assert.ok(idsOf(r.after.document).includes("platform.execution.api.auth"));
});

test("renaming a file brick writes title: in its own file", () => {
  const r = route((t) => DocEdit.updateNode(t, "web", { label: "Site web" }));
  assert.deepStrictEqual(r.changed, ["clients/web.brick.yaml"]);
  assert.match(r.files["clients/web.brick.yaml"], /title: Site web/);
  assert.ok(r.files["clients/web.brick.yaml"].includes("links:"));
});

test("editing an inner node patches it in place and keeps comments", () => {
  const r = route((t) => DocEdit.updateNode(t, "workers", { label: "Jobs", role: "batch" }));
  assert.deepStrictEqual(r.changed, ["platform/execution/brick.yaml"]);
  assert.ok(r.files["platform/execution/brick.yaml"].includes("# Faute de frappe volontaire (database)"));
  assert.match(r.files["platform/execution/brick.yaml"], /label: Jobs/);
});

test("deleting an inner node removes it and the links to it in every file", () => {
  const r = route((t) => DocEdit.removeNodes(t, ["api"]).text);
  assert.deepStrictEqual(r.changed, ["clients/web.brick.yaml", "platform/execution/brick.yaml"]);
  assert.ok(!idsOf(r.after.document).includes("platform.execution.api"));
  assert.ok(!linkPairs(r.after.document).some((l) => l.includes("platform.execution.api")));
  assert.ok(r.files["platform/execution/brick.yaml"].includes("# Faute de frappe volontaire (database)"));
  assert.ok(!/^\s*links:/m.test(r.files["clients/web.brick.yaml"]));
});

test("adding a link writes it qualified into the file of the source brick", () => {
  const r = route((t) => DocEdit.addLink(t, { from: "workers", to: "database", label: "écrit" }));
  assert.deepStrictEqual(r.changed, ["platform/execution/brick.yaml"]);
  assert.match(r.files["platform/execution/brick.yaml"], /from: platform\.execution\.workers\s+to: platform\.data\.database\s+label: écrit/);
  assert.ok(linkPairs(r.after.document).includes("platform.execution.workers>platform.data.database"));
});

test("editing and removing links targets the right file link", () => {
  const edited = route((t) => DocEdit.updateLink(t, 2, { label: "jobs" }));
  assert.deepStrictEqual(edited.changed, ["platform/execution/brick.yaml"]);
  assert.match(edited.files["platform/execution/brick.yaml"], /label: jobs/);
  const removed = route((t) => DocEdit.removeLinks(t, [0]));
  assert.deepStrictEqual(removed.changed, ["clients/web.brick.yaml"]);
  assert.strictEqual(removed.after.document.links.length, 3);
});

test("moving an inner node to another file moves the block and heals references", () => {
  const r = route((t) => DocEdit.moveNode(t, "workers", "data"));
  assert.deepStrictEqual(r.changed, ["platform/data/brick.yaml", "platform/execution/brick.yaml"]);
  const ids = idsOf(r.after.document);
  assert.ok(ids.includes("platform.data.workers") && !ids.includes("platform.execution.workers"));
  assert.ok(linkPairs(r.after.document).includes("platform.execution.api>platform.data.workers"));
  assert.ok(r.files["platform/execution/brick.yaml"].includes("# Faute de frappe volontaire (database)"));
  const unresolved = r.after.anomalies.filter((a) => a.ref === "workers");
  assert.strictEqual(unresolved.length, 0);
});

test("moving an inner node inside the same file reparents it there", () => {
  const r = route((t) => DocEdit.moveNode(t, "workers", "api"));
  assert.deepStrictEqual(r.changed, ["platform/execution/brick.yaml"]);
  assert.ok(idsOf(r.after.document).includes("platform.execution.api.workers"));
  assert.ok(linkPairs(r.after.document).includes("platform.execution.api>platform.execution.api.workers"));
});

test("style and view go to the root brick.yaml", () => {
  const r = route((t) => DocEdit.setTopLevel(t, "style", { rules: [{ target: "platform.execution.api", color: "#ff0000" }] }));
  assert.deepStrictEqual(r.changed, ["brick.yaml"]);
  assert.deepStrictEqual(jsyaml.load(r.files["brick.yaml"]).style.rules[0].target, "platform.execution.api");
});

test("deleting a folder brick or moving it is refused and writes nothing", () => {
  const files = readProject();
  const before = ProjectSync.mergedText(files);
  [(t) => DocEdit.removeNodes(t, ["execution"]).text, (t) => DocEdit.moveNode(t, "execution", null), (t) => DocEdit.removeNodes(t, ["web"]).text].forEach((fn) => {
    assert.throws(() => ProjectSync.translate(files, before, fn(before)), (e) => e.refusal === true && /explorateur/.test(e.message));
  });
});

test("moving a node rewrites qualified references held by other files", () => {
  const r = route((t) => DocEdit.moveNode(t, "platform.data.resources", "execution"));
  assert.ok(r.changed.includes("resources-js/brick.yaml"));
  assert.match(r.files["resources-js/brick.yaml"], /to: platform\.execution\.resources/);
  assert.ok(linkPairs(r.after.document).includes("resources-js>platform.execution.resources"));
});
