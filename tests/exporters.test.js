"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Exporters = require("../js/exporters.js");
const Model = require("../js/model.js");

const model = Model.parse(Model.DEFAULT_YAML);

// Hand-made scene with real-looking geometry (absolute top-left coordinates) and awkward characters.
function scene() {
  return {
    nodes: [
      { id: "g", label: "Groupe <A> & \"B\"", type: "group", role: "", parent: null, group: true, collapsed: false, x: 100, y: 50, w: 400, h: 200, fill: "#dbeafe", fillAlpha: 0.3, stroke: "#2563eb", strokeWidth: 1, text: "#1e3a8a", dashed: true, shape: "round-rectangle", opacity: 1 },
      { id: "g/a", label: "Api", type: "service", role: "", parent: "g", group: false, collapsed: false, x: 130, y: 100, w: 170, h: 42, fill: "#2563eb", fillAlpha: 1, stroke: "", strokeWidth: 0, text: "#ffffff", dashed: false, shape: "round-rectangle", opacity: 1 },
      { id: "g/db", label: "Base\nde données", type: "database", role: "", parent: "g", group: false, collapsed: false, x: 320, y: 100, w: 150, h: 42, fill: "#0f766e", fillAlpha: 1, stroke: "", strokeWidth: 0, text: "#ffffff", dashed: false, shape: "barrel", opacity: 1 },
      { id: "col", label: "Replié", type: "group", role: "", parent: null, group: true, collapsed: true, x: 600, y: 60, w: 210, h: 56, fill: "#c4b5fd", fillAlpha: 1, stroke: "#7c3aed", strokeWidth: 1, text: "#3b0764", dashed: false, shape: "round-rectangle", opacity: 1 },
      { id: "q", label: "File", type: "queue", role: "", parent: null, group: false, collapsed: false, x: 600, y: 200, w: 170, h: 42, fill: "#c2410c", fillAlpha: 1, stroke: "", strokeWidth: 0, text: "#ffffff", dashed: false, shape: "round-rectangle", opacity: 1 }
    ],
    edges: [
      { id: "e1", source: "g/a", target: "g/db", label: "lit \"x\"", color: "#475569", dashed: false, width: 1, arrow: "triangle", sourceArrow: "none", text: "#475569" },
      { id: "e2", source: "g/a", target: "q", label: "", color: "#ff0000", dashed: true, width: 2, arrow: "triangle", sourceArrow: "none", text: "" }
    ]
  };
}

// Tiny well-formedness check + element list (tag, attributes, depth stack of parents).
function parseXml(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  const stack = [];
  const elements = [];
  let pos = 0;
  let match;

  while ((match = re.exec(body))) {
    assert.equal(body.slice(pos, match.index).trim(), "", "text outside of tags");
    pos = re.lastIndex;

    if (match[1]) {
      assert.equal(stack.pop(), match[2], "mismatched closing tag");
      continue;
    }

    const attrs = {};

    match[3].replace(/([\w:-]+)="([^"]*)"/g, (all, key, value) => {
      attrs[key] = value;
      return all;
    });
    elements.push({ tag: match[2], attrs, parent: stack[stack.length - 1] || null });

    if (!match[4]) {
      stack.push(match[2]);
    }
  }

  assert.equal(stack.length, 0, "unclosed tags");
  assert.equal(body.slice(pos).trim(), "");

  return elements;
}

test("registry exposes the built-in formats", () => {
  const ids = Exporters.list().map((f) => f.id);

  ["svg", "png", "jpg", "drawio", "mermaid", "plantuml", "json"].forEach((id) => assert.ok(ids.includes(id), id));
  assert.equal(Exporters.get("drawio").ext, "drawio");
  assert.equal(Exporters.get("png").kind, "image");
  assert.equal(Exporters.get("plantuml").kind, "text");
  assert.equal(Exporters.get("nope"), null);
});

test("register adds a custom exporter and validates it", () => {
  Exporters.register({ id: "t-custom", label: "Custom", ext: "txt", mime: "text/plain", kind: "text", build: () => "x" });
  assert.equal(Exporters.get("t-custom").build({}), "x");
  assert.throws(() => Exporters.register({ id: "bad" }));
});

test("drawio: well-formed XML, containers, relative child geometry, edges", () => {
  const xml = Exporters.toDrawio(scene(), { title: "Test & <co>" });
  const els = parseXml(xml);
  const cells = els.filter((e) => e.tag === "mxCell");
  const vertices = cells.filter((c) => c.attrs.vertex === "1");
  const edges = cells.filter((c) => c.attrs.edge === "1");

  assert.equal(els[0].tag, "mxfile");
  assert.ok(els.some((e) => e.tag === "mxGraphModel"));
  assert.equal(vertices.length, 5);
  assert.equal(edges.length, 2);

  const group = vertices.find((v) => v.attrs.value.includes("Groupe"));
  const child = vertices.find((v) => v.attrs.value === "Api");
  const collapsed = vertices.find((v) => v.attrs.value === "Replié");

  assert.match(group.attrs.style, /container=1/);
  assert.match(group.attrs.style, /dashed=1/);
  assert.match(group.attrs.style, /fillOpacity=30/);
  assert.equal(group.attrs.value, "Groupe &amp;lt;A&amp;gt; &amp;amp; &quot;B&quot;");
  assert.equal(group.attrs.parent, "1");
  assert.equal(child.attrs.parent, group.attrs.id);
  assert.doesNotMatch(collapsed.attrs.style, /container=1/);

  // Child geometry is relative to its group (130-100, 100-50); the group is shifted to the 40px margin.
  const geo = els.filter((e) => e.tag === "mxGeometry");
  const idx = cells.indexOf(cells.find((c) => c.attrs.id === child.attrs.id));
  const childGeo = geo.filter((g) => g.attrs.relative !== "1")[vertices.indexOf(child)];

  assert.ok(idx > 0);
  assert.equal(childGeo.attrs.x, "30");
  assert.equal(childGeo.attrs.y, "50");

  const rootGeo = geo.filter((g) => g.attrs.relative !== "1")[vertices.indexOf(group)];

  assert.equal(rootGeo.attrs.x, "40");
  assert.equal(rootGeo.attrs.y, "40");

  const ids = new Map(vertices.map((v) => [v.attrs.value, v.attrs.id]));

  assert.equal(edges[0].attrs.source, ids.get("Api"));
  assert.equal(edges[0].attrs.target, vertices.find((v) => v.attrs.value.startsWith("Base")).attrs.id);
  assert.equal(edges[0].attrs.value, "lit &quot;x&quot;");
  assert.match(edges[1].attrs.style, /dashed=1/);
  assert.match(edges[1].attrs.style, /strokeColor=#ff0000/);
  assert.match(edges[1].attrs.style, /endArrow=block/);
});

test("drawio: unique ids and edge endpoints reference existing vertices", () => {
  const els = parseXml(Exporters.toDrawio(Exporters.sceneFromModel(model), { title: model.title }));
  const cells = els.filter((e) => e.tag === "mxCell");
  const ids = cells.map((c) => c.attrs.id);

  assert.equal(new Set(ids).size, ids.length);

  const vertices = new Set(cells.filter((c) => c.attrs.vertex === "1").map((c) => c.attrs.id));

  assert.equal(vertices.size, model.nodes.length);
  cells.filter((c) => c.attrs.edge === "1").forEach((e) => {
    assert.ok(vertices.has(e.attrs.source));
    assert.ok(vertices.has(e.attrs.target));
  });
  cells.filter((c) => c.attrs.vertex === "1").forEach((v) => assert.ok(v.attrs.parent === "1" || vertices.has(v.attrs.parent)));
});

test("mermaid: subgraph, nodes, links, classDef", () => {
  const out = Exporters.toMermaid(scene());

  assert.match(out, /^flowchart LR/);
  assert.match(out, /subgraph n_g\["Groupe <A> & #quot;B#quot;"\]/);
  assert.match(out, /^ {4}n_g_a\["Api"\]$/m);
  assert.match(out, /n_g_db\["Base<br\/>de données"\]/);
  assert.match(out, /^ {2}end$|^ {2}end/m);
  assert.match(out, /n_g_a -->\|"lit #quot;x#quot;"\| n_g_db/);
  assert.match(out, /n_g_a -\.-> n_q/);
  assert.match(out, /classDef t_service fill:#2563eb,color:#ffffff/);
  assert.match(out, /class n_g_a t_service/);
  assert.match(out, /n_col\["Replié"\]/);
  assert.doesNotMatch(out, /subgraph n_col/);
});

test("mermaid from a parsed model keeps groups and every link", () => {
  const out = Exporters.toMermaid(Exporters.sceneFromModel(model));

  assert.equal((out.match(/subgraph /g) || []).length, model.nodes.filter((n) => n.children.length).length);
  assert.equal((out.match(/ -->/g) || []).length, model.links.length);
});

test("plantuml: package, component kinds and labelled links", () => {
  const out = Exporters.toPlantUml(scene(), { title: "Mon titre" });

  assert.match(out, /^@startuml/);
  assert.match(out, /title Mon titre/);
  assert.match(out, /package "Groupe <A> & 'B'" as n_g \{/);
  assert.match(out, /component "Api" as n_g_a #2563eb/);
  assert.match(out, /database "Base\\nde données" as n_g_db/);
  assert.match(out, /queue "File" as n_q/);
  assert.match(out, /component "Replié" as n_col/);
  assert.match(out, /n_g_a -\[#475569\]-> n_g_db : lit 'x'/);
  assert.match(out, /n_g_a -\[#ff0000,dashed\]-> n_q$/m);
  assert.match(out, /@enduml\n$/);
  assert.equal((out.match(/\{/g) || []).length, (out.match(/\}/g) || []).length);
});

test("json export drops Maps and keeps nodes and links", () => {
  const data = JSON.parse(Exporters.get("json").build({ model }));

  assert.equal(data.title, model.title);
  assert.equal(data.nodes.length, model.nodes.length);
  assert.equal(data.links.length, model.links.length);
  assert.equal(data.byId, undefined);
});

test("text formats build from a model alone (no Cytoscape)", () => {
  ["drawio", "mermaid", "plantuml", "json"].forEach((id) => {
    const out = Exporters.get(id).build({ model, title: model.title });

    assert.ok(out.length > 20, id);
  });
});

test("parseColor handles rgb, rgba, hex and transparent", () => {
  assert.deepEqual(Exporters.parseColor("rgb(37,99,235)"), { hex: "#2563eb", alpha: 1 });
  assert.deepEqual(Exporters.parseColor("rgba(0, 0, 0, 0.5)"), { hex: "#000000", alpha: 0.5 });
  assert.deepEqual(Exporters.parseColor("#abc"), { hex: "#aabbcc", alpha: 1 });
  assert.equal(Exporters.parseColor("transparent").alpha, 0);
  assert.equal(Exporters.parseColor("nonsense"), null);
});
