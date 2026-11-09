#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline/promises");
const Merge = require("../js/merge.js");
const Pkg = require("./package.js");

const useColor = process.stdout.isTTY || process.env.FORCE_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => paint("31", s);
const yellow = (s) => paint("33", s);
const cyan = (s) => paint("36", s);
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);

const USAGE = `Usage :
  node tools/topo.js build <dir> [-o architecture.yaml]
  node tools/topo.js check <dir>
  node tools/topo.js fix <dir> [--yes]
  node tools/topo.js serve [dir] [-p 8080]
  node tools/topo.js vendor [--force]
  node tools/topo.js package [-o dist]`;

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function collectFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    fs.readdirSync(abs, { withFileTypes: true }).forEach((e) => {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (Merge.isBrickFile(p)) out.push({ path: p, text: fs.readFileSync(path.join(abs, e.name), "utf8") });
      }
    });
  };
  walk(dir, "");
  return out;
}

function printAnomalies(anomalies) {
  anomalies.forEach((a) => {
    const tag = a.level === "error" ? red("✖ erreur") : yellow("⚠ avertissement");
    console.log(`${tag} ${dim(`[${a.code}]`)} ${a.file ? cyan(a.file) : ""}${a.path ? dim(` ${a.path}`) : ""}`);
    console.log(`  ${a.message}`);
    (a.fixes || []).forEach((f, i) => console.log(`  ${dim(`${i + 1})`)} ${f.key}: ${f.oldRef} → ${bold(f.newRef)}`));
  });
}

function summary(anomalies) {
  const errors = anomalies.filter((a) => a.level === "error").length;
  const warnings = anomalies.length - errors;
  console.log(`${errors ? red(`${errors} erreur(s)`) : "0 erreur"}, ${warnings} avertissement(s).`);
  return errors;
}

function mergeDir(dir, output) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Dossier introuvable : ${dir}`);
  return Merge.mergeProject(collectFiles(dir), { output });
}

function parseArgs(argv) {
  const opts = { positional: [], yes: false, force: false, dist: "dist", output: "architecture.yaml", port: 8080 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--force") opts.force = true;
    else if (a === "-o") {
      opts.output = argv[++i];
      opts.dist = opts.output;
    }
    else if (a === "-p") opts.port = Number(argv[++i]);
    else opts.positional.push(a);
  }
  return opts;
}

function cmdBuild(opts) {
  const dir = opts.positional[0];
  if (!dir) throw new Error("Dossier manquant.");
  const { document, anomalies } = mergeDir(dir, opts.output);
  printAnomalies(anomalies);
  const target = path.join(dir, opts.output);
  fs.writeFileSync(target, Merge.toYaml(document), "utf8");
  console.log(`Écrit : ${target}`);
  return summary(anomalies) ? 1 : 0;
}

function cmdCheck(opts) {
  const dir = opts.positional[0];
  if (!dir) throw new Error("Dossier manquant.");
  const { anomalies } = mergeDir(dir, opts.output);
  printAnomalies(anomalies);
  return summary(anomalies) ? 1 : 0;
}

async function choose(rl, anomaly, yes) {
  const fixes = anomaly.fixes;
  if (yes) return fixes[0];
  console.log();
  printAnomalies([anomaly]);
  const answer = (await rl.question("Choix (numéro, s = passer) : ")).trim().toLowerCase();
  const n = Number(answer);
  return Number.isInteger(n) && n >= 1 && n <= fixes.length ? fixes[n - 1] : null;
}

async function cmdFix(opts) {
  const dir = opts.positional[0];
  if (!dir) throw new Error("Dossier manquant.");
  const { anomalies } = mergeDir(dir, opts.output);
  const fixable = anomalies.filter((a) => a.fixes && a.fixes.length);
  const asked = new Set();
  const texts = new Map();
  const rl = opts.yes ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  let applied = 0;

  for (const a of fixable) {
    const sig = `${a.file}|${a.fixes[0].key}|${a.fixes[0].oldRef}`;
    if (asked.has(sig)) continue;
    asked.add(sig);
    const fix = await choose(rl, a, opts.yes);
    if (!fix) continue;
    const file = path.join(dir, fix.file);
    const before = texts.has(file) ? texts.get(file) : fs.readFileSync(file, "utf8");
    texts.set(file, Merge.applyFix(before, fix));
    applied += 1;
    console.log(`${fix.file} : ${fix.oldRef} → ${fix.newRef}`);
  }
  if (rl) rl.close();
  texts.forEach((text, file) => fs.writeFileSync(file, text, "utf8"));
  console.log(`${applied} correction(s) appliquée(s).`);
  return cmdBuild({ ...opts, positional: [dir] });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json"
};

function cmdServe(opts) {
  const root = path.resolve(opts.positional[0] || path.join(__dirname, ".."));
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.resolve(root, `.${urlPath}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Introuvable");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  });
  server.listen(opts.port, "127.0.0.1", () => console.log(`Topo sert ${root} sur http://127.0.0.1:${opts.port}/`));
  return null;
}

async function cmdVendor(opts) {
  await Pkg.vendor(opts.force);
  return 0;
}

async function cmdPackage(opts) {
  await Pkg.pack(opts);
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const commands = { build: cmdBuild, check: cmdCheck, fix: cmdFix, serve: cmdServe, vendor: cmdVendor, package: cmdPackage };
  if (!commands[cmd]) {
    console.log(USAGE);
    return cmd ? 1 : 0;
  }
  return commands[cmd](opts);
}

main().then(
  (code) => {
    if (code !== null && code !== undefined) process.exitCode = code;
  },
  (e) => {
    console.error(red(`Erreur : ${e.message}`));
    process.exitCode = 1;
  }
);
