"use strict";

const CustomShapes = typeof Shapes !== "undefined" ? Shapes : require("./shapes.js");

const Style = {
  userScale: 1,
  modelSize: 1,

  RULE_KEYS: ["label", "color", "border", "opacity", "size", "highlight", "hidden", "textColor", "bold", "italic", "textBackground", "borderStyle", "borderWidth", "shape", "icon", "iconOpacity"],
  // Properties a style.roles / style.types entry may carry.
  LEVEL_KEYS: ["color", "border", "borderStyle", "borderWidth", "shape", "icon", "iconOpacity", "textColor", "bold", "italic", "opacity", "size"],
  SHAPES: ["round-rectangle", "rectangle", "ellipse", "hexagon", "diamond", "barrel", "rhomboid", "tag", "star", "octagon", "cut-rectangle", ...CustomShapes.names()],
  BORDER_STYLES: ["solid", "dashed", "dotted", "double"],
  LINK_LINES: ["solid", "dashed", "dotted"],
  LINK_ARROWS: ["triangle", "vee", "triangle-backcurve", "circle", "square", "diamond", "tee", "none"],
  DARK_TEXT: "#0f172a",
  LIGHT_TEXT: "#ffffff",

  // ---- colours (pure) ----

  // "#rgb", "#rrggbb", "#rrggbbaa", "rgb()/rgba()" -> { r, g, b, a } (0-255, a 0-1) or null.
  parseColor(value) {
    const text = String(value === undefined || value === null ? "" : value).trim();
    let match = text.match(/^#([0-9a-f]{3})$/i);

    if (match) {
      const h = match[1];

      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
    }

    match = text.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);

    if (match) {
      const h = match[1];

      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: match[2] ? parseInt(match[2], 16) / 255 : 1 };
    }

    match = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);

    if (match) {
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
    }

    return null;
  },

  // Strict user input: "#rgb" or "#rrggbb" -> lowercase "#rrggbb", otherwise null.
  normalizeHex(value) {
    const text = String(value === undefined || value === null ? "" : value).trim();

    if (/^#[0-9a-f]{6}$/i.test(text)) {
      return text.toLowerCase();
    }

    const short = text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);

    return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : null;
  },

  // WCAG relative luminance (0-1) of a colour string or { r, g, b }.
  luminance(color) {
    const c = typeof color === "string" ? this.parseColor(color) : color;

    if (!c) {
      return 0;
    }

    const channel = (v) => {
      const x = Math.min(255, Math.max(0, v)) / 255;

      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  },

  // WCAG contrast ratio (1-21) between two colours.
  contrast(a, b) {
    const la = this.luminance(a);
    const lb = this.luminance(b);

    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  },

  // Opaque colour of `fg` (with its alpha, times `alpha` if given) laid over the opaque `bg`.
  compose(fg, bg, alpha) {
    const f = typeof fg === "string" ? this.parseColor(fg) : fg;
    const b = typeof bg === "string" ? this.parseColor(bg) : bg;

    if (!f || !b) {
      return f || b || null;
    }

    const a = Math.min(1, Math.max(0, (f.a === undefined ? 1 : f.a) * (alpha === undefined ? 1 : alpha)));

    return { r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a), a: 1 };
  },

  // Text colour readable on `background`: `preferred` when it already reaches WCAG AA (4.5),
  // otherwise the better of dark / light.
  autoText(background, preferred) {
    const bg = typeof background === "string" ? this.parseColor(background) : background;

    if (!bg) {
      return preferred || this.DARK_TEXT;
    }

    if (preferred && this.parseColor(preferred) && this.contrast(preferred, bg) >= 4.5) {
      return preferred;
    }

    return this.contrast(this.DARK_TEXT, bg) >= this.contrast(this.LIGHT_TEXT, bg) ? this.DARK_TEXT : this.LIGHT_TEXT;
  },

  // Validated link style { color, width, line, arrow, sourceArrow, textColor } (unknown / invalid keys dropped).
  cleanLink(style) {
    const out = {};
    const s = style && typeof style === "object" ? style : {};

    if (s.color && this.parseColor(s.color)) {
      out.color = String(s.color);
    }

    const width = Number(s.width);

    if (s.width !== undefined && width >= 1 && width <= 8) {
      out.width = width;
    }

    if (this.LINK_LINES.includes(s.line)) {
      out.line = s.line;
    }

    if (this.LINK_ARROWS.includes(s.arrow)) {
      out.arrow = s.arrow;
    }

    if (this.LINK_ARROWS.includes(s.sourceArrow)) {
      out.sourceArrow = s.sourceArrow;
    }

    if (s.textColor && this.parseColor(s.textColor)) {
      out.textColor = String(s.textColor);
    }

    return out;
  },

  setUserScale(value) {
    const number = Number(value);

    this.userScale = Number.isFinite(number) && number > 0 ? number : 1;
  },

  setModel(model) {
    const number = Number(model && model.style && model.style.size);

    this.modelSize = Number.isFinite(number) && number > 0 ? number : 1;
  },

  scale() {
    return this.userScale * this.modelSize;
  },

  rules(model) {
    return model && model.style && Array.isArray(model.style.rules) ? model.style.rules : [];
  },

  // Map of every accepted reference (qualified id, key, unique local id) to node key.
  lookup(model) {
    const map = new Map();
    const localCount = new Map();

    model.nodes.forEach((node) => {
      localCount.set(node.localId, (localCount.get(node.localId) || 0) + 1);
    });

    model.nodes.forEach((node) => {
      if (node.localId && localCount.get(node.localId) === 1) {
        map.set(node.localId, node.id);
      }
    });

    model.nodes.forEach((node) => {
      map.set(node.qualifiedId, node.id);
      map.set(node.id, node.id);
    });

    return map;
  },

  // Merged rule properties applying to a node key.
  ruleFor(nodeId, model) {
    const map = this.lookup(model);
    const merged = {};

    this.rules(model).forEach((rule) => {
      if (map.get(rule.target) !== nodeId) {
        return;
      }

      this.RULE_KEYS.forEach((key) => {
        if (rule[key] !== undefined && rule[key] !== null) {
          merged[key] = rule[key];
        }
      });
    });

    return merged;
  },

  clean(rule) {
    const result = {};

    if (rule.label !== undefined) {
      result.label = String(rule.label);
    }

    if (rule.color) {
      result.color = String(rule.color);
    }

    if (rule.border) {
      result.border = String(rule.border);
    }

    const opacity = Number(rule.opacity);

    if (rule.opacity !== undefined && opacity >= 0 && opacity <= 1) {
      result.opacity = opacity;
    }

    const size = Number(rule.size);

    if (rule.size !== undefined && size > 0) {
      result.size = size;
    }

    if (rule.highlight) {
      result.highlight = true;
    }

    if (rule.hidden) {
      result.hidden = true;
    }

    if (rule.textColor && this.parseColor(rule.textColor)) {
      result.textColor = String(rule.textColor);
    }

    if (rule.textBackground && this.parseColor(rule.textBackground)) {
      result.textBackground = String(rule.textBackground);
    }

    if (rule.bold === true) {
      result.bold = true;
    }

    if (rule.italic === true) {
      result.italic = true;
    }

    if (this.BORDER_STYLES.includes(rule.borderStyle)) {
      result.borderStyle = rule.borderStyle;
    }

    const borderWidth = Number(rule.borderWidth);

    if (rule.borderWidth !== undefined && rule.borderWidth !== null && rule.borderWidth !== "" && borderWidth >= 0 && borderWidth <= 8) {
      result.borderWidth = borderWidth;
    }

    if (this.SHAPES.includes(rule.shape)) {
      result.shape = rule.shape;
    }

    // Icon: built-in name, URL or data-URI (resolved by Icons.resolve).
    if (typeof rule.icon === "string" && rule.icon.trim() && !/[\r\n]/.test(rule.icon.trim())) {
      result.icon = rule.icon.trim();
    }

    const iconOpacity = Number(rule.iconOpacity);

    if (rule.iconOpacity !== undefined && rule.iconOpacity !== null && rule.iconOpacity !== "" && iconOpacity >= 0 && iconOpacity <= 1) {
      result.iconOpacity = iconOpacity;
    }

    return result;
  },

  // Validated style of a style.roles / style.types entry (no label / highlight / hidden).
  cleanLevel(raw) {
    const clean = this.clean(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
    const out = {};

    this.LEVEL_KEYS.forEach((key) => {
      if (clean[key] !== undefined) {
        out[key] = clean[key];
      }
    });

    return out;
  },

  // Own entry `name` of a style.roles / style.types map, validated ({} when absent).
  levelOf(map, name) {
    return map && typeof map === "object" && name && Object.prototype.hasOwnProperty.call(map, name) ? this.cleanLevel(map[name]) : {};
  },

  // "type:service role:`my role` text" -> { types, roles, rest } (a whole /regex/ is never split).
  splitFilters(text) {
    const value = String(text || "").trim();
    const types = [];
    const roles = [];
    let rest = value;

    if (!/^\/.*\/[gimsuy]*$/s.test(value)) {
      rest = value.replace(/(^|\s)(type|role):("([^"]*)"|\S*)/gi, (match, pre, key, raw, quoted) => {
        const v = String(quoted !== undefined ? quoted : raw).trim();

        if (v) {
          (key.toLowerCase() === "type" ? types : roles).push(v);
        }

        return pre;
      }).replace(/\s+/g, " ").trim();
    }

    return { types, roles, rest };
  },

  // Inverse of splitFilters.
  buildSearch(parts) {
    const quote = (v) => (/\s/.test(v) ? `"${v}"` : v);

    return [
      ...(parts.types || []).map((v) => `type:${quote(v)}`),
      ...(parts.roles || []).map((v) => `role:${quote(v)}`),
      parts.rest || ""
    ].filter(Boolean).join(" ");
  },

  // Pure filter parser: "type:service role:user text" -> { types, roles, text | regex } (null when empty).
  parseSearch(text) {
    const value = String(text || "").trim();

    if (!value) {
      return null;
    }

    const { types, roles, rest } = this.splitFilters(value);
    let base = {};

    if (rest) {
      const delimited = rest.match(/^\/(.*)\/([gimsuy]*)$/s);

      if (delimited) {
        try {
          base = { regex: new RegExp(delimited[1], delimited[2].replace(/g|y/g, "")) };
        } catch (error) {
          return { error: `Expression régulière invalide : ${error.message}` };
        }
      } else if (/[\^$.*+?()[\]{}|]/.test(rest)) {
        try {
          base = { regex: new RegExp(rest, "i") };
        } catch {
          base = { text: rest };
        }
      } else {
        base = { text: rest };
      }
    }

    if (types.length) {
      base.types = types;
    }

    if (roles.length) {
      base.roles = roles;
    }

    return Object.keys(base).length ? base : null;
  },

  // True when a model node ({ id, qualifiedId, label, type, role, meta }) satisfies parseSearch criteria.
  matchSearch(criteria, node) {
    const same = (list, value) => list.some((item) => item.toLowerCase() === String(value || "").toLowerCase());

    if (criteria.types && !same(criteria.types, node.type)) {
      return false;
    }

    if (criteria.roles && !same(criteria.roles, node.role)) {
      return false;
    }

    if (!criteria.regex && !criteria.text) {
      return true;
    }

    const target = [node.id, node.qualifiedId, node.label, node.type || "", JSON.stringify(node.meta || {})].join("\n");

    return criteria.regex ? criteria.regex.test(target) : target.toLowerCase().includes(criteria.text.toLowerCase());
  },

  // Attaches `linkStyle` to each edge element: the style of the first real link it carries.
  applyLinkStyles(elements, model) {
    const collapsed = new Set(elements.filter((e) => e.group === "nodes" && e.data.isCollapsed).map((e) => e.data.id));
    const edges = new Map(elements.filter((e) => e.group === "edges").map((e) => [e.data.id, e]));
    const claimed = new Set();

    (model.links || []).forEach((link) => {
      const key = `${Model.visibleAncestor(link.from, model, collapsed)}=>${Model.visibleAncestor(link.to, model, collapsed)}`;
      const edge = edges.get(key);

      if (!edge || claimed.has(key)) {
        return;
      }

      claimed.add(key);

      const style = this.linkStyle(link, model.style);

      if (Object.keys(style).length) {
        edge.data.linkStyle = style;
      }
    });
  },

  // Effective link style: default < style.links[type] < links[].style (pure).
  linkStyle(link, style) {
    return Object.assign({}, this.levelOfLink(style && style.links, link && link.type), this.cleanLink(link && link.style));
  },

  // Validated own entry `type` of a style.links map ({} when absent).
  levelOfLink(map, type) {
    return map && typeof map === "object" && type && Object.prototype.hasOwnProperty.call(map, type) ? this.cleanLink(map[type]) : {};
  },

  // Distinct link types of a model with their counts, most used first.
  linkTypes(model) {
    const counts = new Map();

    ((model && model.links) || []).forEach((link) => {
      if (link.type) {
        counts.set(link.type, (counts.get(link.type) || 0) + 1);
      }
    });

    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },

  // Attaches rule data to node elements and drops hidden nodes.
  apply(elements, model) {
    this.setModel(model);

    const map = this.lookup(model);
    const obsolete = [];
    const perNode = new Map();

    this.rules(model).forEach((rule) => {
      const nodeId = map.get(rule.target);

      if (!nodeId) {
        obsolete.push(rule.target);
        return;
      }

      perNode.set(nodeId, Object.assign(perNode.get(nodeId) || {}, this.clean(rule)));
    });

    const hidden = new Set();

    elements.forEach((element) => {
      if (element.group === "nodes" && perNode.get(element.data.id)?.hidden) {
        hidden.add(element.data.id);
      }
    });

    let grew = hidden.size > 0;

    while (grew) {
      grew = false;

      elements.forEach((element) => {
        if (element.group === "nodes" && element.data.parent && hidden.has(element.data.parent) && !hidden.has(element.data.id)) {
          hidden.add(element.data.id);
          grew = true;
        }
      });
    }

    const result = elements.filter((element) => {
      if (element.group === "nodes") {
        return !hidden.has(element.data.id);
      }

      return !hidden.has(element.data.source) && !hidden.has(element.data.target);
    });

    this.applyLinkStyles(result, model);

    const style = model.style || {};

    // Priority: built-in type default < style.types < style.roles < brick rule.
    result.forEach((element) => {
      if (element.group !== "nodes") {
        return;
      }

      const own = perNode.get(element.data.id);
      const levels = { type: this.levelOf(style.types, element.data.type), role: this.levelOf(style.roles, element.data.role) };
      const merged = Object.assign({}, levels.type, levels.role, own || {});

      if (Object.keys(levels.type).length || Object.keys(levels.role).length) {
        element.data.levels = levels;
      }

      if (Object.keys(merged).length) {
        element.data.rule = merged;
      }

      if (own && own.label !== undefined) {
        element.data.display = own.label;
      }
    });

    return { elements: result, obsolete };
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = Style;
}
