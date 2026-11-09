"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const Pkg = require("../tools/package.js");

const entries = [
  { name: "t/a.txt", data: Buffer.from("hello world ".repeat(50)) },
  { name: "t/sub/b.txt", data: Buffer.from("b") }
];

test("crc32 known value", () => {
  assert.strictEqual(Pkg.crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("zip structure", () => {
  const zip = Pkg.makeZip(entries);
  assert.strictEqual(zip.readUInt32LE(0), 0x04034b50);
  const end = zip.length - 22;
  assert.strictEqual(zip.readUInt32LE(end), 0x06054b50);
  assert.strictEqual(zip.readUInt16LE(end + 10), 2);
  const csize = zip.readUInt32LE(18);
  const raw = zlib.inflateRawSync(zip.subarray(30 + 7, 30 + 7 + csize));
  assert.strictEqual(raw.toString(), entries[0].data.toString());
});

test("tar.gz readable by tar", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-tar-"));
  const file = path.join(dir, "x.tar.gz");
  fs.writeFileSync(file, Pkg.makeTarGz(entries));
  let out;
  try {
    out = execFileSync("tar", ["-tzf", "x.tar.gz"], { cwd: dir }).toString();
  } catch (e) {
    t.skip("tar indisponible");
    return;
  }
  assert.match(out, /t\/a\.txt/);
  assert.match(out, /t\/sub\/b\.txt/);
});

test("rewriteHtml removes CDN urls", () => {
  const out = Pkg.rewriteHtml('<script src="https://unpkg.com/x@1/y.js"></script>');
  assert.strictEqual(out, '<script src="vendor/unpkg.com/x@1/y.js"></script>');
});
