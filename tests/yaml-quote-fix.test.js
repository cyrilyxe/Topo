"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("../vendor/js-yaml.js");
const DocEdit = require("../js/doc-edit.js");

test("quoteUnsafeScalars quotes plain values holding ': '", () => {
  const text = [
    "nodes:",
    "  - id: carte",
    "    label: Carte",
    "    meta:",
    "      Description: Fait. Hors ligne réseau : seules les tuiles en cache.",
    "      url: https://example.org/a",
    "      note: \"déjà : quotée\"",
    "      doc: |",
    "        texte libre : intact",
    "    type: service # commentaire"
  ].join("\n");
  const fix = DocEdit.quoteUnsafeScalars(text);

  assert.deepEqual(fix.lines, [5]);
  const doc = yaml.load(fix.text);
  assert.equal(doc.nodes[0].meta.Description, "Fait. Hors ligne réseau : seules les tuiles en cache.");
  assert.equal(doc.nodes[0].meta.doc, "texte libre : intact\n");
  assert.equal(doc.nodes[0].type, "service");
});

test("quoteUnsafeScalars escapes quotes and keeps CRLF", () => {
  const fix = DocEdit.quoteUnsafeScalars("a: x : \"y\"\r\nb: ok\r\n");

  assert.deepEqual(fix.lines, [1]);
  assert.ok(fix.text.includes("\r\n"));
  assert.equal(yaml.load(fix.text).a, "x : \"y\"");
});
