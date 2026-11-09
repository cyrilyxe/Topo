"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Style = require("../js/style.js");
const Model = require("../js/model.js");

const YAML_TEXT = `
nodes:
  - id: web
    label: Web
    type: service
    role: user
  - id: api
    label: API
    type: service
  - id: db
    label: DB
    type: database
    role: user
style:
  types:
    service: { color: "#111111", shape: hexagon, border: "#222222" }
  roles:
    user: { color: "#333333", shape: bogus, borderStyle: dashed }
  rules:
    - target: web
      color: "#444444"
`;

function resolve(text) {
  const model = Model.parse(text);
  const elements = model.nodes.map((n) => ({ group: "nodes", data: { id: n.id, type: n.type, role: n.role } }));
  const out = Style.apply(elements, model).elements;

  return new Map(out.map((e) => [e.data.id, e.data]));
}

test("priority: type < style.types < style.roles < brick rule", () => {
  const data = resolve(YAML_TEXT);

  assert.equal(data.get("api").rule.color, "#111111");
  assert.equal(data.get("api").rule.shape, "hexagon");
  assert.equal(data.get("db").rule.color, "#333333");
  assert.equal(data.get("web").rule.color, "#444444");
  assert.equal(data.get("web").rule.border, "#222222");
  assert.equal(data.get("web").rule.borderStyle, "dashed");
});

test("invalid shape is dropped; levels keep provenance", () => {
  const data = resolve(YAML_TEXT);

  assert.equal(data.get("db").rule.shape, undefined);
  assert.equal(data.get("web").rule.shape, "hexagon");
  assert.equal(data.get("web").levels.role.color, "#333333");
  assert.equal(data.get("web").levels.type.color, "#111111");
});

test("a node without any style gets no rule", () => {
  const data = resolve("nodes:\n  - id: a\n    label: A\n    type: queue\n");

  assert.equal(data.get("a").rule, undefined);
});

test("parseSearch: type: / role: filters, OR within a key, AND across keys, plus text", () => {
  const c = Style.parseSearch("type:service type:database role:user api");

  assert.deepEqual(c.types, ["service", "database"]);
  assert.deepEqual(c.roles, ["user"]);
  assert.equal(c.text, "api");
  assert.deepEqual(Style.parseSearch("TYPE:service"), { types: ["service"] });
  assert.deepEqual(Style.parseSearch("role:\"my role\"").roles, ["my role"]);
  assert.equal(Style.parseSearch(""), null);
  assert.equal(Style.parseSearch("type:"), null);
  assert.deepEqual(Style.parseSearch("plain"), { text: "plain" });
  assert.ok(Style.parseSearch("type:service /ap[i]/i").regex instanceof RegExp);
  assert.ok(Style.parseSearch("/type:x/").regex.test("type:x"));
});

test("matchSearch applies the filters", () => {
  const model = Model.parse(YAML_TEXT);
  const hits = (text) => model.nodes.filter((n) => Style.matchSearch(Style.parseSearch(text), n)).map((n) => n.id);

  assert.deepEqual(hits("type:service"), ["web", "api"]);
  assert.deepEqual(hits("type:service role:user"), ["web"]);
  assert.deepEqual(hits("type:service type:database"), ["web", "api", "db"]);
  assert.deepEqual(hits("role:user db"), ["db"]);
});

test("splitFilters / buildSearch round-trip", () => {
  const parts = Style.splitFilters("type:service role:\"my role\" foo");

  assert.deepEqual(parts, { types: ["service"], roles: ["my role"], rest: "foo" });
  assert.equal(Style.buildSearch(parts), "type:service role:\"my role\" foo");
});

test("Model.parse keeps style.roles and style.types", () => {
  const model = Model.parse(YAML_TEXT);

  assert.equal(model.style.roles.user.color, "#333333");
  assert.equal(model.style.types.service.shape, "hexagon");
});
