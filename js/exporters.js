"use strict";

// Export registry. A format is { id, label, ext, mime, kind: "image" | "text", note?, build(ctx) }.
// ctx = { model, cy?, graph?, title, bg? }. Text formats are built from a "scene" (pure data, see sceneFromCy /
// sceneFromModel), so the builders run in Node without Cytoscape. Future UML / Merise exporters plug in with register().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Exporters = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const Shapes = typeof module === "object" && module.exports ? require("./shapes.js") : self.Shapes;
  const formats = new Map();

  function register(def) {
    if (!def || !def.id || typeof def.build !== "function") {
      throw new Error("Exporter invalide : id et build() requis.");
    }

    formats.set(def.id, Object.assign({ label: def.id, ext: def.id, mime: "text/plain", kind: "text" }, def));

    return formats.get(def.id);
  }

  function list() {
    return Array.from(formats.values());
  }

  function get(id) {
    return formats.get(id) || null;
  }

  // ---------- colours ----------

  // "rgb(1,2,3)" / "rgba(...)" / "#abc" / "#aabbcc" -> { hex: "#aabbcc", alpha } ; "transparent" -> alpha 0 ; else null.
  function parseColor(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();

    if (!text) {
      return null;
    }

    if (text === "transparent" || text === "none") {
      return { hex: "#ffffff", alpha: 0 };
    }

    const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);

    if (rgb) {
      const h = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0");
      let alpha = 1;

      if (rgb[4] !== undefined) {
        alpha = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : Number(rgb[4]);
      }

      return { hex: `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`, alpha };
    }

    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);

    if (hex) {
      const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];

      return { hex: `#${digits}`, alpha: 1 };
    }

    return null;
  }

  const DEFAULT_COLORS = {
    service: "#2563eb",
    database: "#0f766e",
    application: "#7c3aed",
    external: "#6b7280",
    queue: "#c2410c",
    default: "#0369a1"
  };

  function typeKey(type) {
    const key = String(type || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

    return key || "default";
  }

  // ---------- scene ----------

  // Scene = { nodes: [{ id, label, type, role, parent, group, collapsed, x, y, w, h, fill, fillAlpha, stroke, strokeWidth,
  //   text, dashed, shape, opacity }], edges: [{ id, source, target, label, color, dashed, width, arrow, sourceArrow, text }] }
  // Node x / y are absolute top-left coordinates; parents come before their children.
  function sceneFromCy(cy) {
    const nodes = cy.nodes().filter((node) => !node.hasClass("meta-card"));
    const ids = new Set();

    nodes.forEach((node) => ids.add(node.id()));

    const depthOf = (node) => {
      let depth = 0;
      let parent = node.data("parent");

      while (parent && ids.has(parent)) {
        depth += 1;
        parent = cy.getElementById(parent).data("parent");
      }

      return depth;
    };

    const items = [];

    nodes.forEach((node) => {
      const box = node.boundingBox({ includeLabels: false, includeOverlays: false });
      const fill = parseColor(node.style("background-color")) || { hex: "#ffffff", alpha: 1 };
      const stroke = parseColor(node.style("border-color"));
      const text = parseColor(node.style("color"));
      const parent = node.data("parent");
      const borderStyle = String(node.style("border-style") || "solid");

      items.push({
        depth: depthOf(node),
        node: {
          id: node.id(),
          label: String(node.data("display") || node.data("label") || node.id()),
          type: node.data("type") || "",
          role: node.data("role") || "",
          parent: parent && ids.has(parent) ? parent : null,
          group: node.isParent(),
          collapsed: node.hasClass("collapsed"),
          x: box.x1,
          y: box.y1,
          w: box.w,
          h: box.h,
          fill: fill.hex,
          fillAlpha: fill.alpha * (Number(node.numericStyle("background-opacity")) || 0),
          stroke: stroke ? stroke.hex : "",
          strokeWidth: Number(node.numericStyle("border-width")) || 0,
          text: text ? text.hex : "#000000",
          dashed: borderStyle === "dashed" || borderStyle === "dotted",
          shape: Shapes && Shapes.isCustom(node.data("ruleShape")) && !node.isParent() ? node.data("ruleShape") : String(node.style("shape") || "round-rectangle"),
          opacity: Number(node.numericStyle("opacity"))
        }
      });
    });

    items.sort((a, b) => a.depth - b.depth);

    const edges = [];

    cy.edges().forEach((edge) => {
      const source = edge.data("source");
      const target = edge.data("target");

      if (String(edge.id()).startsWith("__draft:") || !ids.has(source) || !ids.has(target)) {
        return;
      }

      const color = parseColor(edge.style("line-color"));
      const text = parseColor(edge.style("color"));

      edges.push({
        id: edge.id(),
        source,
        target,
        label: String(edge.data("label") || ""),
        color: color ? color.hex : "",
        dashed: ["dashed", "dotted"].includes(String(edge.style("line-style"))),
        width: Number(edge.numericStyle("width")) || 1,
        arrow: String(edge.style("target-arrow-shape") || "triangle"),
        sourceArrow: String(edge.style("source-arrow-shape") || "none"),
        text: text ? text.hex : ""
      });
    });

    return { nodes: items.map((item) => item.node), edges };
  }

  // Geometry-less fallback (Node, or no graph): simple grid layout, default type colours.
  function sceneFromModel(model) {
    const LEAF = { w: 170, h: 42 };
    const PAD = 32;
    const GAP = 30;
    const nodes = [];
    const children = (node) => (node.children || []).map((id) => model.byId.get(id)).filter(Boolean);

    const place = (node, x, y, parent) => {
      const kids = children(node);
      const item = {
        id: node.id,
        label: node.label || node.id,
        type: node.type || "",
        role: node.role || "",
        parent,
        group: kids.length > 0,
        collapsed: false,
        x,
        y,
        w: LEAF.w,
        h: LEAF.h,
        fill: kids.length ? "#dbeafe" : DEFAULT_COLORS[typeKey(node.type)] || DEFAULT_COLORS.default,
        fillAlpha: kids.length ? 0.4 : 1,
        stroke: kids.length ? "#2563eb" : "",
        strokeWidth: kids.length ? 1 : 0,
        text: kids.length ? "#1e3a8a" : "#ffffff",
        dashed: false,
        shape: "round-rectangle",
        opacity: 1
      };

      nodes.push(item);

      if (!kids.length) {
        return item;
      }

      const cols = Math.min(3, kids.length);
      let cx = x + PAD;
      let cy = y + PAD + 10;
      let rowH = 0;
      let maxX = 0;
      let maxY = 0;

      kids.forEach((kid, index) => {
        if (index > 0 && index % cols === 0) {
          cx = x + PAD;
          cy += rowH + GAP;
          rowH = 0;
        }

        const placed = place(kid, cx, cy, node.id);

        cx += placed.w + GAP;
        rowH = Math.max(rowH, placed.h);
        maxX = Math.max(maxX, placed.x + placed.w);
        maxY = Math.max(maxY, placed.y + placed.h);
      });

      item.w = maxX - x + PAD;
      item.h = maxY - y + PAD;

      return item;
    };

    let ox = 0;

    (model.nodes || []).filter((node) => !node.parent).forEach((node) => {
      const item = place(node, ox, 0, null);

      ox += item.w + GAP * 2;
    });

    const ids = new Set(nodes.map((node) => node.id));
    const edges = (model.links || [])
      .filter((link) => ids.has(link.from) && ids.has(link.to))
      .map((link, index) => {
        const style = link.style || {};

        return {
          id: `e${index + 1}`,
          source: link.from,
          target: link.to,
          label: link.label || "",
          color: parseColor(style.color) ? parseColor(style.color).hex : "#64748b",
          dashed: style.line === "dashed" || style.line === "dotted",
          width: Number(style.width) || 1,
          arrow: style.arrow || "triangle",
          sourceArrow: style.sourceArrow || "none",
          text: ""
        };
      });

    return { nodes, edges };
  }

  function sceneOf(ctx) {
    if (ctx.scene) {
      return ctx.scene;
    }

    if (ctx.cy) {
      return sceneFromCy(ctx.cy);
    }

    if (ctx.model) {
      return sceneFromModel(ctx.model);
    }

    throw new Error("Aucun modèle à exporter.");
  }

  // ---------- helpers ----------

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n/g, "&#xa;");
  }

  function htmlLabel(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r?\n/g, "<br>");
  }

  // Unique, tool-safe identifiers (one per scene node).
  function makeIds(nodes, prefix) {
    const used = new Set();
    const map = new Map();

    nodes.forEach((node) => {
      const base = `${prefix}${String(node.id).replace(/[^A-Za-z0-9_]/g, "_")}`;
      let id = base;
      let n = 2;

      while (used.has(id)) {
        id = `${base}_${n}`;
        n += 1;
      }

      used.add(id);
      map.set(node.id, id);
    });

    return map;
  }

  function childrenMap(nodes) {
    const ids = new Set(nodes.map((node) => node.id));
    const map = new Map();

    nodes.forEach((node) => {
      const key = node.parent && ids.has(node.parent) ? node.parent : "";

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key).push(node);
    });

    return map;
  }

  // A group node with children in the scene is a container; collapsed groups are plain vertices.
  function isContainer(node, kids) {
    return node.group && !node.collapsed && kids.has(node.id);
  }

  // ---------- draw.io ----------

  const DRAWIO_SHAPES = {
    ellipse: "ellipse",
    diamond: "rhombus",
    hexagon: "shape=hexagon;perimeter=hexagonPerimeter2",
    barrel: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=10",
    octagon: "shape=octagon",
    rhomboid: "shape=parallelogram;perimeter=parallelogramPerimeter",
    star: "shape=mxgraph.basic.star",
    tag: "shape=document",
    rectangle: "rounded=0",
    "cut-rectangle": "shape=cube;size=10;darkOpacity=0"
  };

  const DRAWIO_ARROWS = {
    triangle: "block",
    "triangle-tee": "block",
    "triangle-cross": "block",
    "triangle-backcurve": "block",
    vee: "open",
    circle: "oval",
    diamond: "diamond",
    square: "box",
    tee: "dash",
    none: "none"
  };

  function drawioNodeStyle(node, container) {
    const parts = [];

    parts.push((Shapes && Shapes.drawio(node.shape)) || DRAWIO_SHAPES[node.shape] || "rounded=1");
    parts.push("whiteSpace=wrap", "html=1");

    parts.push(node.fillAlpha > 0 ? `fillColor=${node.fill}` : "fillColor=none");

    if (node.fillAlpha > 0 && node.fillAlpha < 1) {
      parts.push(`fillOpacity=${Math.round(node.fillAlpha * 100)}`);
    }

    parts.push(node.stroke && node.strokeWidth > 0 ? `strokeColor=${node.stroke}` : "strokeColor=none");

    if (node.strokeWidth > 1) {
      parts.push(`strokeWidth=${Math.round(node.strokeWidth)}`);
    }

    parts.push(`fontColor=${node.text || "#000000"}`);

    if (node.dashed) {
      parts.push("dashed=1");
    }

    if (node.opacity >= 0 && node.opacity < 1) {
      parts.push(`opacity=${Math.round(node.opacity * 100)}`);
    }

    if (container) {
      parts.push("container=1", "collapsible=0", "verticalAlign=top", "fontStyle=1");
    }

    return parts.join(";");
  }

  function drawioEdgeStyle(edge) {
    const arrow = DRAWIO_ARROWS[edge.arrow] || "block";
    const source = DRAWIO_ARROWS[edge.sourceArrow] || "none";
    const parts = ["html=1", "rounded=0", `endArrow=${arrow}`, `endFill=${arrow === "open" ? 0 : 1}`, `startArrow=${source}`, `startFill=${source === "open" ? 0 : 1}`];

    if (edge.color) {
      parts.push(`strokeColor=${edge.color}`);
    }

    if (edge.width > 1) {
      parts.push(`strokeWidth=${Math.round(edge.width * 10) / 10}`);
    }

    if (edge.dashed) {
      parts.push("dashed=1");
    }

    parts.push(`fontColor=${edge.text || "#475569"}`);

    return parts.join(";");
  }

  function toDrawio(scene, options) {
    const title = (options && options.title) || "Topo";
    const nodes = scene.nodes;
    const ids = new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const kids = childrenMap(nodes);
    const roots = nodes.filter((node) => !node.parent || !byId.has(node.parent));
    const minX = roots.length ? Math.min(...roots.map((node) => node.x)) : 0;
    const minY = roots.length ? Math.min(...roots.map((node) => node.y)) : 0;
    const round = (n) => Math.round(Number(n) * 100) / 100;
    const cells = ['        <mxCell id="0" />', '        <mxCell id="1" parent="0" />'];

    nodes.forEach((node) => {
      const parent = node.parent && byId.has(node.parent) ? byId.get(node.parent) : null;
      const dx = parent ? parent.x : minX - 40;
      const dy = parent ? parent.y : minY - 40;
      const container = isContainer(node, kids);

      cells.push(
        `        <mxCell id="${ids.get(node.id)}" value="${xmlEscape(htmlLabel(node.label))}" style="${xmlEscape(drawioNodeStyle(node, container))}" vertex="1" parent="${parent ? ids.get(parent.id) : "1"}">`,
        `          <mxGeometry x="${round(node.x - dx)}" y="${round(node.y - dy)}" width="${round(node.w)}" height="${round(node.h)}" as="geometry" />`,
        "        </mxCell>"
      );
    });

    scene.edges.forEach((edge, index) => {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        return;
      }

      cells.push(
        `        <mxCell id="e${index + 1}" value="${xmlEscape(htmlLabel(edge.label))}" style="${xmlEscape(drawioEdgeStyle(edge))}" edge="1" parent="1" source="${ids.get(edge.source)}" target="${ids.get(edge.target)}">`,
        '          <mxGeometry relative="1" as="geometry" />',
        "        </mxCell>"
      );
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<mxfile host="Topo" version="1.0">',
      `  <diagram id="topo-1" name="${xmlEscape(title)}">`,
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">',
      "      <root>",
      cells.join("\n"),
      "      </root>",
      "    </mxGraphModel>",
      "  </diagram>",
      "</mxfile>",
      ""
    ].join("\n");
  }

  // ---------- Mermaid ----------

  function mermaidText(value) {
    return String(value == null ? "" : value).replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>");
  }

  // Closest classic flowchart node shapes for the custom shapes (the others stay rectangles).
  const MERMAID_SHAPES = {
    cloud: ["([", "])"],
    "cylinder-h": ["[(", ")]"],
    arrow: [">", "]"],
    chevron: [">", "]"],
    file: ["[[", "]]"]
  };

  function toMermaid(scene) {
    const ids = makeIds(scene.nodes, "n_");
    const kids = childrenMap(scene.nodes);
    const lines = ["flowchart LR"];
    const classes = new Map();

    const emit = (node, indent) => {
      const id = ids.get(node.id);
      const sub = kids.get(node.id);

      if (isContainer(node, kids)) {
        lines.push(`${indent}subgraph ${id}["${mermaidText(node.label)}"]`);
        sub.forEach((child) => emit(child, `${indent}  `));
        lines.push(`${indent}end`);
        return;
      }

      const text = `"${mermaidText(node.label)}"`;
      const wrap = MERMAID_SHAPES[node.shape] || ["[", "]"];

      lines.push(`${indent}${id}${wrap[0]}${text}${wrap[1]}`);

      const key = typeKey(node.type);

      if (!classes.has(key)) {
        classes.set(key, { node, ids: [] });
      }

      classes.get(key).ids.push(id);
    };

    (kids.get("") || []).forEach((node) => emit(node, "  "));

    scene.edges.forEach((edge) => {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        return;
      }

      const label = edge.label ? `|"${mermaidText(edge.label)}"|` : "";
      const noArrow = edge.arrow === "none";
      const op = edge.dashed ? (noArrow ? "-.-" : "-.->") : noArrow ? "---" : "-->";

      lines.push(`  ${ids.get(edge.source)} ${op}${label} ${ids.get(edge.target)}`);
    });

    classes.forEach((entry, key) => {
      const n = entry.node;
      const props = [`fill:${n.fill}`];

      if (n.stroke && n.strokeWidth > 0) {
        props.push(`stroke:${n.stroke}`);
      }

      props.push(`color:${n.text || "#000000"}`);
      lines.push(`  classDef t_${key} ${props.join(",")}`);
      lines.push(`  class ${entry.ids.join(",")} t_${key}`);
    });

    return `${lines.join("\n")}\n`;
  }

  // ---------- PlantUML ----------

  function pumlText(value) {
    return String(value == null ? "" : value).replace(/"/g, "'").replace(/\r?\n/g, "\\n");
  }

  function pumlKind(node) {
    const key = typeKey(node.type);

    if (["file", "folder", "cloud"].includes(node.shape)) {
      return node.shape;
    }

    if (key === "database") {
      return "database";
    }

    if (key === "queue") {
      return "queue";
    }

    if (["actor", "person", "user"].includes(key)) {
      return "actor";
    }

    if (["external", "cloud"].includes(key)) {
      return "cloud";
    }

    return "component";
  }

  function toPlantUml(scene, options) {
    const title = (options && options.title) || "";
    const ids = makeIds(scene.nodes, "n_");
    const kids = childrenMap(scene.nodes);
    const lines = ["@startuml"];

    if (title) {
      lines.push(`title ${pumlText(title)}`);
    }

    lines.push("left to right direction");

    const color = (node) => (node.fillAlpha >= 0.5 && node.fill ? ` ${node.fill}` : "");

    const emit = (node, indent) => {
      const id = ids.get(node.id);

      if (isContainer(node, kids)) {
        lines.push(`${indent}package "${pumlText(node.label)}" as ${id} {`);
        kids.get(node.id).forEach((child) => emit(child, `${indent}  `));
        lines.push(`${indent}}`);
        return;
      }

      lines.push(`${indent}${pumlKind(node)} "${pumlText(node.label)}" as ${id}${color(node)}`);
    };

    (kids.get("") || []).forEach((node) => emit(node, ""));

    scene.edges.forEach((edge) => {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        return;
      }

      const style = [edge.color || "", edge.dashed ? "dashed" : ""].filter(Boolean).join(",");
      const bracket = style ? `[${style}]` : "";
      const head = edge.arrow === "none" ? "" : ">";
      const label = edge.label ? ` : ${pumlText(edge.label)}` : "";

      lines.push(`${ids.get(edge.source)} -${bracket}-${head} ${ids.get(edge.target)}${label}`);
    });

    lines.push("@enduml");

    return `${lines.join("\n")}\n`;
  }

  // ---------- JSON ----------

  function toJson(model) {
    return JSON.stringify(model, (key, value) => (value instanceof Map ? undefined : value), 2);
  }

  // ---------- built-in formats ----------

  function requireGraph(ctx) {
    if (!ctx.graph || !ctx.cy) {
      throw new Error("Le graphe n’est pas disponible.");
    }

    return ctx.graph;
  }

  register({
    id: "svg",
    label: "Image SVG",
    ext: "svg",
    mime: "image/svg+xml",
    kind: "image",
    title: "Image vectorielle (SVG).",
    build: (ctx) => requireGraph(ctx).exportSvg()
  });

  register({
    id: "png",
    label: "Image PNG",
    ext: "png",
    mime: "image/png",
    kind: "image",
    title: "Image PNG (échelle 2, fond du thème).",
    build: (ctx) => requireGraph(ctx).exportPng()
  });

  register({
    id: "jpg",
    label: "Image JPG",
    ext: "jpg",
    mime: "image/jpeg",
    kind: "image",
    title: "Image JPEG (échelle 2, fond du thème).",
    build: (ctx) => {
      requireGraph(ctx);

      return ctx.cy.jpg({ full: true, scale: 2, bg: ctx.bg || "#ffffff", quality: 0.92, output: "blob" });
    }
  });

  register({
    id: "drawio",
    label: "draw.io",
    ext: "drawio",
    mime: "application/vnd.jgraph.mxfile",
    kind: "text",
    title: "Fichier draw.io (diagrams.net), positions et styles actuels.",
    note: "Ce fichier s’ouvre dans diagrams.net (Fichier › Ouvrir depuis › Appareil).",
    build: (ctx) => toDrawio(sceneOf(ctx), { title: ctx.title })
  });

  register({
    id: "mermaid",
    label: "Mermaid",
    ext: "mmd",
    mime: "text/plain",
    kind: "text",
    title: "Diagramme Mermaid (flowchart).",
    build: (ctx) => toMermaid(sceneOf(ctx))
  });

  register({
    id: "plantuml",
    label: "PlantUML",
    ext: "puml",
    mime: "text/plain",
    kind: "text",
    title: "Diagramme de composants PlantUML.",
    build: (ctx) => toPlantUml(sceneOf(ctx), { title: ctx.title })
  });

  register({
    id: "json",
    label: "JSON",
    ext: "json",
    mime: "application/json",
    kind: "text",
    title: "Modèle (nœuds et liens) au format JSON.",
    build: (ctx) => toJson(ctx.model)
  });

  // Browser context built from the live app (App, Graph).
  function context() {
    const model = typeof App !== "undefined" ? App.getModel() : null;
    const hasGraph = typeof Graph !== "undefined" && Graph.cy;

    return {
      model,
      cy: hasGraph ? Graph.cy : null,
      graph: hasGraph ? Graph : null,
      title: model ? model.title : "",
      bg: hasGraph ? Graph.background() : "#ffffff"
    };
  }

  return { register, list, get, context, parseColor, typeKey, sceneFromCy, sceneFromModel, toDrawio, toMermaid, toPlantUml, toJson, xmlEscape };
});
