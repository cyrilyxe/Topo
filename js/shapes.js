"use strict";

// Custom brick shapes: named polygons (normalised coordinates, -1..1, y down, clockwise) drawn by Cytoscape through
// `shape: polygon` + `shape-polygon-points`. Native Cytoscape shapes pass through unchanged.
// Shapes.cytoscapeStyle(name) -> style object; Shapes.drawio(name) -> draw.io style fragment (custom shapes only).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Shapes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const round = (n) => Math.round(n * 1000) / 1000;
  const flat = (pairs) => pairs.reduce((all, pair) => all.concat([round(pair[0]), round(pair[1])]), []);
  const arc = (cx, cy, rx, ry, from, to, step) => {
    const out = [];

    for (let a = from; a <= to + 1e-9; a += step) {
      out.push([cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180)]);
    }

    return out;
  };

  // Cloud outline: union of a few circles (+ a body rectangle with a flat bottom), resampled to 36 points.
  function cloud() {
    const circles = [[24, 41, 14], [38, 26, 17], [58, 20, 19], [75, 30, 14], [77, 41, 14]];
    const body = { x0: 24, x1: 77, y0: 30, y1: 55 };
    const centre = [50, 36];
    const inCircle = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < c[2] - 0.01;
    const inBody = (p) => p[0] > body.x0 + 0.01 && p[0] < body.x1 - 0.01 && p[1] > body.y0 + 0.01 && p[1] < body.y1 - 0.01;
    const candidates = [];

    circles.forEach((c, i) => {
      for (let a = 0; a < 360; a += 1) {
        const p = [c[0] + c[2] * Math.cos((a * Math.PI) / 180), c[1] + c[2] * Math.sin((a * Math.PI) / 180)];

        if (p[1] <= body.y1 + 0.001 && !inBody(p) && !circles.some((o, j) => j !== i && inCircle(p, o))) {
          candidates.push(p);
        }
      }
    });

    for (let x = body.x0; x <= body.x1; x += 0.5) {
      candidates.push([x, body.y1]);
    }

    const ring = candidates
      .map((p) => ({ p, a: Math.atan2(p[1] - centre[1], p[0] - centre[0]) }))
      .sort((m, n) => m.a - n.a)
      .map((item) => item.p);
    const lengths = ring.map((p, i) => Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]));
    const total = lengths.reduce((s, v) => s + v, 0);
    const out = [];
    let walked = 0;
    let index = 0;

    for (let k = 0; k < 36; k += 1) {
      const target = (total * k) / 36;

      while (index < ring.length - 1 && walked + lengths[index] <= target) {
        walked += lengths[index];
        index += 1;
      }

      out.push(ring[index]);
    }

    const xs = out.map((p) => p[0]);
    const ys = out.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);

    return out.map((p) => [(2 * (p[0] - x0)) / (x1 - x0) - 1, (2 * (p[1] - y0)) / (y1 - y0) - 1]);
  }

  function documentShape() {
    const wave = [];

    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;

      wave.push([1 - 2 * t, 0.72 + 0.28 * Math.sin(2 * Math.PI * t)]);
    }

    return [[-1, -1], [1, -1]].concat(wave);
  }

  function cylinderH() {
    return arc(0.7, 0, 0.3, 1, -90, 90, 15).concat(arc(-0.7, 0, 0.3, 1, 90, 270, 15));
  }

  // Half-round notches in the middle of both sides.
  function ticket() {
    const right = [];
    const left = [];

    for (let a = -90; a <= 90; a += 30) {
      right.push([1 - 0.14 * Math.cos((a * Math.PI) / 180), 0.3 * Math.sin((a * Math.PI) / 180)]);
      left.push([-1 + 0.14 * Math.cos(((90 - (a + 90)) * Math.PI) / 180), 0.3 * Math.sin(((90 - (a + 90)) * Math.PI) / 180)]);
    }

    return [[-1, -1], [1, -1]].concat(right, [[1, 1], [-1, 1]], left);
  }

  function shield() {
    return [[-1, -1], [1, -1], [1, 0.1], [0.93, 0.45], [0.75, 0.72], [0.45, 0.9], [0, 1], [-0.45, 0.9], [-0.75, 0.72], [-0.93, 0.45], [-1, 0.1]];
  }

  // Hand-written polygons; `inset` = share of the node width kept free on the left (icon / label placement).
  const DEFS = {
    file: { label: "Fichier", points: () => [[-1, -1], [0.55, -1], [1, -0.45], [1, 1], [-1, 1]], inset: 0, drawio: "shape=note;size=14" },
    folder: { label: "Dossier", points: () => [[-1, -1], [-0.4, -1], [-0.25, -0.6], [1, -0.6], [1, 1], [-1, 1]], inset: 0, drawio: "shape=folder;tabWidth=60;tabHeight=12;tabPosition=left" },
    cloud: { label: "Nuage", points: cloud, inset: 0.06, drawio: "ellipse;shape=cloud" },
    document: { label: "Document", points: documentShape, inset: 0, drawio: "shape=document;boundedLbl=1" },
    "cylinder-h": { label: "Cylindre couché", points: cylinderH, inset: 0.05, drawio: "shape=cylinder3;direction=south;boundedLbl=1;size=10" },
    arrow: { label: "Flèche", points: () => [[-1, -0.55], [0.4, -0.55], [0.4, -1], [1, 0], [0.4, 1], [0.4, 0.55], [-1, 0.55]], inset: 0, drawio: "shape=singleArrow;arrowWidth=0.55;arrowSize=0.2" },
    chevron: { label: "Chevron", points: () => [[-1, -1], [0.6, -1], [1, 0], [0.6, 1], [-1, 1], [-0.6, 0]], inset: 0.2, drawio: "shape=step;perimeter=stepPerimeter;fixedSize=1" },
    shield: { label: "Bouclier", points: shield, inset: 0, drawio: "rounded=1" },
    speech: { label: "Bulle", points: () => [[-1, -1], [1, -1], [1, 0.35], [-0.35, 0.35], [-0.7, 1], [-0.7, 0.35], [-1, 0.35]], inset: 0, drawio: "shape=callout;perimeter=calloutPerimeter;position2=0.2" },
    ticket: { label: "Ticket", points: ticket, inset: 0.03, drawio: "rounded=1" },
    house: { label: "Maison", points: () => [[0, -1], [1, -0.3], [1, 1], [-1, 1], [-1, -0.3]], inset: 0, drawio: "rounded=1" }
  };

  const cache = {};

  function names() {
    return Object.keys(DEFS);
  }

  function isCustom(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(DEFS, name);
  }

  function pointList(name) {
    if (!isCustom(name)) {
      return null;
    }

    if (!cache[name]) {
      cache[name] = flat(DEFS[name].points());
    }

    return cache[name];
  }

  // "x y x y ..." for shape-polygon-points (null for a native / unknown shape).
  function points(name) {
    const list = pointList(name);

    return list ? list.join(" ") : null;
  }

  function cytoscapeStyle(name) {
    return isCustom(name) ? { shape: "polygon", "shape-polygon-points": points(name) } : { shape: name };
  }

  function drawio(name) {
    return isCustom(name) ? DEFS[name].drawio : null;
  }

  function label(name) {
    return isCustom(name) ? DEFS[name].label : name;
  }

  function inset(name) {
    return isCustom(name) ? DEFS[name].inset : 0;
  }

  // Inline SVG preview (polygon in a 24x16 box) generated from the points.
  function svg(name, attrs) {
    const list = pointList(name);

    if (!list) {
      return "";
    }

    const out = [];

    for (let i = 0; i < list.length; i += 2) {
      out.push(`${round(12 + list[i] * 10.5)},${round(8 + list[i + 1] * 6.5)}`);
    }

    return `<svg class="shape-svg" viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><polygon points="${out.join(" ")}" ${attrs || 'fill="#cbd5e1" stroke="#334155" stroke-width="1"'} stroke-linejoin="round"/></svg>`;
  }

  // Button grid of the custom shapes with previews; clicks are handled by the caller through `data-shape-pick`.
  function pickerHtml(current, extra) {
    return `<span class="shape-grid">${names().map((name) => `<button type="button" class="shape-cell${name === current ? " active" : ""}" ${extra || ""} data-shape-pick="${name}" title="${label(name)} (${name})" aria-label="${label(name)}" aria-pressed="${name === current}">${svg(name)}</button>`).join("")}</span>`;
  }

  return { names, isCustom, points, cytoscapeStyle, drawio, label, inset, svg, pickerHtml };
});
