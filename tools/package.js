"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const YAML_URL = "https://unpkg.com/js-yaml@4.1.1/dist/js-yaml.js";
const INCLUDE = ["index.html", "styles.css", "js", "tools", "vendor", "docs", "examples", "README.md", "package.json"];

function readIndex() {
  return fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
}

function cdnUrls(html) {
  const re = /(?:src|href)="(https:\/\/[^"]+)"/g;
  const urls = [];
  let m;
  while ((m = re.exec(html))) urls.push(m[1]);
  return urls;
}

function vendorPath(url) {
  const u = new URL(url);
  return `vendor/${u.host}${u.pathname}`;
}

async function download(url, target, force) {
  if (!force && fs.existsSync(target)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function vendor(force) {
  const jobs = cdnUrls(readIndex()).map((url) => [url, path.join(ROOT, vendorPath(url))]);
  jobs.push([YAML_URL, path.join(ROOT, "vendor", "js-yaml.js")]);
  for (const [url, target] of jobs) {
    const done = await download(url, target, force);
    console.log(`${done ? "Téléchargé" : "Présent   "} : ${path.relative(ROOT, target).replace(/\\/g, "/")}`);
  }
}

function vendorComplete() {
  const files = cdnUrls(readIndex()).map(vendorPath).concat("vendor/js-yaml.js");
  return files.every((f) => fs.existsSync(path.join(ROOT, f)));
}

function rewriteHtml(html) {
  return html.replace(/((?:src|href)=")(https:\/\/[^"]+)(")/g, (_, a, url, c) => `${a}${vendorPath(url)}${c}`);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach((e) => {
    if (e.name === "node_modules" || e.name.startsWith(".")) return;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
}

function listFiles(dir, rel = "") {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), r));
    else out.push(r);
  });
  return out.sort();
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

// entries: [{ name, data: Buffer }]
function makeZip(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach(({ name, data }) => {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = zlib.deflateRawSync(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    lh.copy(ch, 6, 4, 30);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  });
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512);
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf("/");
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  h.write(base, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write(`${mtime.toString(8).padStart(11, "0")}\0`, 136);
  h.write("        ", 148);
  h.write("0", 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += h[i];
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

function makeTarGz(entries, now = new Date()) {
  const mtime = Math.floor(now.getTime() / 1000);
  const parts = [];
  entries.forEach(({ name, data }) => {
    parts.push(tarHeader(name, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  });
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

function readEntries(root, prefix) {
  return listFiles(root).map((f) => ({ name: `${prefix}/${f}`, data: fs.readFileSync(path.join(root, f)) }));
}

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;

function stageFiles(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  INCLUDE.forEach((item) => {
    const src = path.join(ROOT, item);
    if (fs.statSync(src).isDirectory()) copyDir(src, path.join(stage, item));
    else fs.copyFileSync(src, path.join(stage, item));
  });
  const htmlFile = path.join(stage, "index.html");
  fs.writeFileSync(htmlFile, rewriteHtml(fs.readFileSync(htmlFile, "utf8")));
}

async function pack(opts) {
  if (!vendorComplete()) await vendor(false);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const name = `topo-${version}`;
  const outDir = path.resolve(opts.dist || "dist");
  const stage = path.join(outDir, name);
  stageFiles(stage);

  const entries = readEntries(stage, name);
  const zip = path.join(outDir, `${name}.zip`);
  const tgz = path.join(outDir, `${name}.tar.gz`);
  fs.writeFileSync(zip, makeZip(entries));
  fs.writeFileSync(tgz, makeTarGz(entries));
  console.log(`Dossier : ${stage}`);
  console.log(`Archive : ${zip} (${kb(fs.statSync(zip).size)})`);
  console.log(`Archive : ${tgz} (${kb(fs.statSync(tgz).size)})`);
  console.log("Utilisation : extraire l'archive, puis ouvrir index.html (file://), lancer « node tools/topo.js serve », ou servir le dossier avec un serveur statique.");
}

module.exports = { vendor, pack, makeZip, makeTarGz, crc32, rewriteHtml, cdnUrls, vendorPath };
