"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Icons = require("../js/icons.js");
const Style = require("../js/style.js");
const Model = require("../js/model.js");

const NAMES = ["server", "database", "cloud", "user", "users", "mobile", "laptop", "api", "queue", "file", "folder", "lock", "key", "globe", "wifi", "bluetooth", "usb", "usb-c", "house", "building", "city", "gear"];

test("every built-in icon resolves to an SVG data-URI", () => {
  assert.deepEqual(Icons.names().sort(), NAMES.slice().sort());

  NAMES.forEach((name) => {
    const uri = Icons.resolve(name);

    assert.match(uri, /^data:image\/svg\+xml;utf8,/);
    assert.match(decodeURIComponent(uri.split(",")[1]), /^<svg [^>]*stroke="#334155"/);
  });
});

test("built-in icon takes the requested colour, unsafe colours fall back", () => {
  assert.match(decodeURIComponent(Icons.resolve("database", "#ffffff")), /stroke="#ffffff"/);
  assert.match(decodeURIComponent(Icons.resolve("database", "red\" onload=\"x")), /stroke="#334155"/);
});

test("URLs and data-URIs pass through unchanged, junk gives null", () => {
  const data = "data:image/png;base64,AAAA";

  assert.equal(Icons.resolve(data), data);
  assert.equal(Icons.resolve("https://example.com/a.svg"), "https://example.com/a.svg");
  assert.equal(Icons.resolve("./icons/a.png"), "./icons/a.png");
  assert.equal(Icons.resolve("logo.svg"), "logo.svg");
  const raw = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>";
  const fixed = Icons.resolve(raw);

  assert.match(fixed, /^data:image\/svg\+xml;utf8,%3Csvg/);
  assert.equal(Icons.resolve(fixed), fixed);
  assert.equal(Icons.resolve("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
  assert.equal(Icons.resolve("nope"), null);
  assert.equal(Icons.resolve(""), null);
  assert.equal(Icons.resolve(undefined), null);
});

test("file import: size and type checks", () => {
  assert.match(Icons.fileError({ name: "big.svg", type: "image/svg+xml", size: 300 * 1024 }), /trop volumineux/);
  assert.match(Icons.fileError({ name: "a.gif", type: "image/gif", size: 10 }), /Format/);
  assert.equal(Icons.fileError({ name: "a.svg", type: "image/svg+xml", size: 1000 }), "");
});

test("icon priority: type < roles < brick rule, iconOpacity validated", () => {
  const model = Model.parse(`
nodes:
  - id: a
    label: A
    type: database
    role: core
  - id: b
    label: B
    type: database
  - id: c
    label: C
    type: service
style:
  types:
    database: { icon: database, iconOpacity: 0.5 }
  roles:
    core: { icon: gear, iconOpacity: 7 }
  rules:
    - target: b
      icon: "data:image/png;base64,AAAA"
`);
  const elements = model.nodes.map((n) => ({ group: "nodes", data: { id: n.id, type: n.type, role: n.role } }));
  const byId = new Map(Style.apply(elements, model).elements.map((e) => [e.data.id, e.data.rule || {}]));

  assert.equal(byId.get("a").icon, "gear");
  assert.equal(byId.get("a").iconOpacity, 0.5);
  assert.equal(byId.get("b").icon, "data:image/png;base64,AAAA");
  assert.equal(byId.get("c").icon, undefined);
});
