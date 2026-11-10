"use strict";

const test = require("node:test");
const assert = require("node:assert");
const FileWatch = require("../js/file-watch.js");

const sig = (lastModified, size) => ({ lastModified, size });

test("sameSignature compares lastModified and size", () => {
  assert.ok(FileWatch.sameSignature(sig(1, 10), sig(1, 10)));
  assert.ok(!FileWatch.sameSignature(sig(1, 10), sig(2, 10)));
  assert.ok(!FileWatch.sameSignature(sig(1, 10), sig(1, 11)));
  assert.ok(!FileWatch.sameSignature(null, sig(1, 10)));
});

test("decide: unchanged, no baseline", () => {
  assert.deepStrictEqual(FileWatch.decide({ known: sig(1, 1), current: sig(1, 1) }), { status: "ok", banner: false, reload: false });
  assert.strictEqual(FileWatch.decide({ known: null, current: sig(2, 2) }).status, "ok");
});

test("decide: changed shows the banner unless ignored", () => {
  const base = { known: sig(1, 1), current: sig(2, 1), dirty: false, autoReload: false };

  assert.deepStrictEqual(FileWatch.decide(base), { status: "changed", banner: true, reload: false });
  assert.strictEqual(FileWatch.decide({ ...base, ignored: sig(2, 1) }).banner, false);
  assert.strictEqual(FileWatch.decide({ ...base, ignored: sig(2, 1) }).status, "changed");
  assert.strictEqual(FileWatch.decide({ ...base, ignored: sig(1, 5) }).banner, true);
});

test("decide: autoReload only when not dirty", () => {
  const base = { known: sig(1, 1), current: sig(2, 1), autoReload: true };

  assert.deepStrictEqual(FileWatch.decide({ ...base, dirty: false }), { status: "changed", banner: false, reload: true });
  assert.deepStrictEqual(FileWatch.decide({ ...base, dirty: true }), { status: "changed", banner: true, reload: false });
});

test("decide: missing file", () => {
  assert.deepStrictEqual(FileWatch.decide({ known: sig(1, 1), current: null }), { status: "missing", banner: true, reload: false });
  assert.strictEqual(FileWatch.decide({ known: sig(1, 1), current: null, ignored: FileWatch.MISSING }).banner, false);
  assert.strictEqual(FileWatch.decide({ known: sig(1, 1), current: null, autoReload: true }).reload, false);
});

test("bannerText", () => {
  assert.strictEqual(FileWatch.bannerText("a.yaml", "changed", false), "« a.yaml » a été modifié par un autre programme.");
  assert.match(FileWatch.bannerText("a.yaml", "changed", true), /vos modifications non enregistrées seraient perdues/);
  assert.match(FileWatch.bannerText("a.yaml", "missing", true), /introuvable/);
});
