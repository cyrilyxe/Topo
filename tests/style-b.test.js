"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Style = require("../js/style.js");
const Schema = require("../js/schema.js");
const Settings = require("../js/settings.js");

test("luminance of black and white", () => {
  assert.equal(Style.luminance("#000000"), 0);
  assert.ok(Math.abs(Style.luminance("#ffffff") - 1) < 1e-9);
});

test("auto text: dark text on light backgrounds, light text on dark ones", () => {
  assert.equal(Style.autoText("#ffffff"), Style.DARK_TEXT);
  assert.equal(Style.autoText("#ffeb3b"), Style.DARK_TEXT);
  assert.equal(Style.autoText("#000000"), Style.LIGHT_TEXT);
  assert.equal(Style.autoText("#1e3a8a"), Style.LIGHT_TEXT);
  assert.equal(Style.autoText("#0f1626"), Style.LIGHT_TEXT);
});

test("auto text keeps the preferred colour only when it is readable", () => {
  assert.equal(Style.autoText("#2563eb", "#ffffff"), "#ffffff");
  assert.equal(Style.autoText("#ffffff", "#ffffff"), Style.DARK_TEXT);
  assert.equal(Style.autoText("#0f1626", "#bcd0ff"), "#bcd0ff");
});

test("compose lays a translucent fill over its background", () => {
  const out = Style.compose({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual([out.r, out.g, out.b], [127.5, 127.5, 127.5]);
  assert.equal(Style.autoText(Style.compose(Style.parseColor("rgba(37,99,235,0.06)"), Style.parseColor("#0f1626"))), Style.LIGHT_TEXT);
});

test("hex parsing and normalisation", () => {
  assert.equal(Style.normalizeHex("#F80"), "#ff8800");
  assert.equal(Style.normalizeHex(" #ff8800 "), "#ff8800");
  assert.equal(Style.normalizeHex("ff8800"), null);
  assert.equal(Style.normalizeHex("#ff88"), null);
  assert.deepEqual(Style.parseColor("rgba(1,2,3,.5)"), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.equal(Style.parseColor("nope"), null);
});

test("clean keeps valid new rule keys only", () => {
  const out = Style.clean({ textColor: "#fff", bold: true, italic: false, textBackground: "nope", borderStyle: "dashed", borderWidth: 3 });
  assert.deepEqual(out, { textColor: "#fff", bold: true, borderStyle: "dashed", borderWidth: 3 });
  assert.deepEqual(Style.clean({ borderStyle: "wavy", borderWidth: 12 }), {});
  assert.equal(Style.clean({ borderWidth: 0 }).borderWidth, 0);
});

test("cleanLink validates link styles", () => {
  assert.deepEqual(
    Style.cleanLink({ color: "#e74c3c", width: 4, line: "dotted", arrow: "vee", sourceArrow: "circle", textColor: "#111", extra: 1 }),
    { color: "#e74c3c", width: 4, line: "dotted", arrow: "vee", sourceArrow: "circle", textColor: "#111" }
  );
  assert.deepEqual(Style.cleanLink({ width: 99, line: "wavy", arrow: "x" }), {});
  assert.deepEqual(Style.cleanLink(null), {});
});

test("Schema.normalize keeps links[].style, new rule keys and style.presets", () => {
  const doc = Schema.normalize({
    nodes: [{ id: "a" }, { id: "b" }],
    links: [{ from: "a", to: "b", style: { color: "#fff", width: 3, line: "dashed", arrow: "vee", sourceArrow: "none", textColor: "#000", zzz: 1 } }, { de: "a", vers: "b" }],
    style: {
      rules: [{ target: "a", textColor: "#fff", bold: true, italic: true, textBackground: "#000", borderStyle: "dotted", borderWidth: 4 }],
      presets: { nodes: { Alerte: { color: "#f00" } }, links: {} }
    }
  });
  assert.deepEqual(doc.links[0].style, { color: "#fff", width: 3, line: "dashed", arrow: "vee", sourceArrow: "none", textColor: "#000" });
  assert.equal(doc.links[1].style, undefined);
  assert.deepEqual(doc.style.rules[0], { target: "a", textColor: "#fff", bold: true, italic: true, textBackground: "#000", borderStyle: "dotted", borderWidth: 4 });
  assert.deepEqual(doc.style.presets.nodes.Alerte, { color: "#f00" });
});

test("Model.parse exposes link styles, rule keys and presets", () => {
  const Model = require("../js/model.js");
  const model = Model.parse([
    "nodes:", "  - id: a", "  - id: b",
    "links:", "  - from: a", "    to: b", "    style: { width: 4, line: dotted, arrow: vee }", "  - from: b", "    to: a",
    "style:", "  rules:", "    - target: a", "      textColor: \"#ffffff\"", "      borderStyle: dashed", "      borderWidth: 3",
    "  presets:", "    links:", "      Async: { line: dotted }"
  ].join("\n"));
  assert.deepEqual(model.links[0].style, { width: 4, line: "dotted", arrow: "vee" });
  assert.deepEqual(model.links[1].style, {});
  assert.equal(model.style.rules[0].borderStyle, "dashed");
  assert.equal(model.style.rules[0].textColor, "#ffffff");
  assert.deepEqual(model.style.presets.links.Async, { line: "dotted" });
});

test("Settings: style.presets is a hidden local object setting", () => {
  assert.ok(!Settings.SPEC.some((s) => s.key === "style.presets"));
  const store = Settings.create();
  assert.deepEqual(store.get("style.presets"), { nodes: {}, links: {} });
  store.set("style.presets", { nodes: { A: { color: "#fff" } } });
  assert.deepEqual(store.get("style.presets"), { nodes: { A: { color: "#fff" } }, links: {} });
  assert.equal(store.source("style.presets"), "local");
  assert.ok(!("style.presets" in store.all()));
  assert.throws(() => store.set("style.presets", "x"));
});
