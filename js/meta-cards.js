"use strict";

// Metadata cards: derived Cytoscape nodes ("card:<id>") showing the meta of a brick.
const MetaCards = {
  SPECIAL: ["show", "afficher", "links", "liens", "card", "source", "sourceId"],
  WHEN: ["leaf", "expanded", "always", "never"],
  POSITIONS: ["top-left", "top-right", "bottom-left", "bottom-right", "free"],
  CHAR_WIDTH: 6.2,
  OUTSIDE: 8,
  INSET: 4,
  expanded: {},
  busy: false,

  isCard(id) {
    return String(id).startsWith("card:");
  },

  setting(key, fallback) {
    const value = typeof Settings !== "undefined" ? Settings.get(key) : undefined;

    return value ?? fallback;
  },

  // Per-brick meta.card wins; otherwise the global settings (when: never unless meta.show exists).
  config(node) {
    const own = node.meta && node.meta.card && typeof node.meta.card === "object" ? node.meta.card : {};
    const hasShow = Boolean(node.meta && Array.isArray(node.meta.show) && node.meta.show.length);
    const explicit = typeof Settings !== "undefined" && Settings.source && ["local", "document"].includes(Settings.source("meta.card.when"));
    const fallbackWhen = explicit || !hasShow ? this.setting("meta.card.when", "never") : "leaf";
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    const count = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : fallback);

    return {
      when: pick(own.when, this.WHEN, fallbackWhen),
      position: pick(own.position, this.POSITIONS, this.setting("meta.card.position", "top-right")),
      maxChars: count(own.maxChars, count(this.setting("meta.card.maxChars", 50), 50)),
      maxLines: count(own.maxLines, count(this.setting("meta.card.maxLines", 3), 3))
    };
  },

  formatValue(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.formatValue(item)).join(", ");
    }

    const text = value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);

    return text.replace(/\s*\n\s*/g, " ").trim();
  },

  entries(meta) {
    const data = meta || {};
    const show = Array.isArray(data.show) ? data.show : null;
    const keys = show && show.length ? show : Object.keys(data).filter((key) => !this.SPECIAL.includes(key));

    return keys
      .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== "")
      .map((key) => `${key} : ${this.formatValue(data[key])}`);
  },

  // Pure: { text (truncated), full, truncated }.
  compose(meta, maxChars, maxLines) {
    const lines = this.entries(meta);
    const clip = (line) => (line.length > maxChars ? `${line.slice(0, Math.max(1, maxChars - 1))}…` : line);
    const kept = lines.slice(0, maxLines).map(clip);

    if (lines.length > maxLines) {
      kept.push(`… +${lines.length - maxLines}`);
    }

    const full = lines.join("\n");
    const text = kept.join("\n");

    return { text, full, truncated: text !== full };
  },

  applies(when, expandedGroup) {
    return when === "always" || (when === "leaf" && !expandedGroup) || (when === "expanded" && expandedGroup);
  },

  ownerColor(data) {
    const token = (name, fallback) => (typeof Graph !== "undefined" ? Graph.token(name, fallback) : fallback);

    if (data.rule && data.rule.color) {
      return data.rule.color;
    }

    if (data.isCollapsed) {
      return token("--collapsed-border", "#6d28d9");
    }

    if (data.isGroup) {
      return token(`--group-${Math.min(Number(data.depth) || 0, 3)}-border`, "#2563eb");
    }

    return token(`--node-${data.typeKey || "default"}`, "#0369a1");
  },

  // Returns the card elements for the visible bricks of `elements` (already styled); does not mutate them.
  inject(elements, model, known = {}) {
    const nodes = elements.filter((element) => element.group === "nodes");
    const parents = new Set(nodes.map((element) => element.data.parent).filter(Boolean));
    const cards = [];

    nodes.forEach((element) => {
      const owner = model.byId.get(element.data.id);
      const card = owner && this.cardFor(element, owner, parents.has(element.data.id), known);

      if (card) {
        cards.push(card);
      }
    });

    return cards;
  },

  cardFor(element, owner, expandedGroup, known) {
    const config = this.config(owner);

    if (!this.applies(config.when, expandedGroup)) {
      return null;
    }

    const { text, full, truncated } = this.compose(owner.meta, config.maxChars, config.maxLines);

    if (!full) {
      return null;
    }

    const id = `card:${owner.id}`;
    const free = config.position === "free";
    const open = Boolean(this.expanded[id]);
    const saved = free ? known[id] : null;
    const card = {
      group: "nodes",
      data: {
        id,
        owner: owner.id,
        text,
        full,
        shown: open ? full : text,
        truncated,
        expanded: open,
        free,
        placed: Boolean(saved),
        anchor: free ? "top-right" : config.position,
        maxWidth: Math.round(config.maxChars * this.CHAR_WIDTH),
        ownerColor: this.ownerColor(element.data),
        parent: (expandedGroup ? owner.id : element.data.parent) || undefined
      },
      classes: "meta-card",
      grabbable: free
    };

    if (saved) {
      card.position = { x: saved.x, y: saved.y };
    }

    return card;
  },

  toggle(card) {
    const id = card.id();
    const open = !card.data("expanded");

    this.expanded[id] = open;
    card.data({ expanded: open, shown: open ? card.data("full") : card.data("text") });
    this.place(card);
  },

  box(node) {
    const box = node.boundingBox({ includeLabels: false, includeOverlays: false, includeEdges: false });

    return { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
  },

  // Box of an expanded group computed without its own cards (keeps the placement stable).
  innerBox(owner) {
    const kids = owner.children().not(".meta-card");

    if (kids.empty()) {
      return this.box(owner);
    }

    const box = this.box(kids);
    const pad = owner.numericStyle("padding") || 0;

    return { x1: box.x1 - pad, y1: box.y1 - pad, x2: box.x2 + pad, y2: box.y2 + pad };
  },

  target(card, owner) {
    const w = card.outerWidth();
    const h = card.outerHeight();
    const inside = card.data("parent") === owner.id();
    const box = inside ? this.innerBox(owner) : this.box(owner);
    const anchor = card.data("anchor");
    const right = anchor.endsWith("right");
    const top = anchor.startsWith("top");
    const gap = inside ? this.INSET : this.OUTSIDE;
    const edge = inside ? this.INSET : 0;
    let x;

    if (inside) {
      x = right ? box.x2 - gap - w / 2 : box.x1 + gap + w / 2;
    } else {
      x = right ? box.x2 + gap + w / 2 : box.x1 - gap - w / 2;
    }

    return { x, y: top ? box.y1 + edge + h / 2 : box.y2 - edge - h / 2 };
  },

  place(card) {
    const owner = card.cy().getElementById(card.data("owner"));

    if (owner.empty()) {
      return;
    }

    this.hold(() => card.position(this.target(card, owner)));
  },

  placeAll(cy, options = {}) {
    cy.nodes(".meta-card").forEach((card) => {
      const keep = card.data("free") && card.data("placed") && !options.resetFree;

      if (!keep) {
        this.place(card);
        card.data("placed", true);
      }
    });
  },

  hold(fn) {
    const before = this.busy;

    this.busy = true;

    try {
      fn();
    } finally {
      this.busy = before;
    }
  },

  // Non-free cards follow their owner (and the owners above a moved node).
  follow(node) {
    if (this.busy || node.hasClass("meta-card")) {
      return;
    }

    const cy = node.cy();

    node.ancestors().union(node).forEach((owner) => {
      const card = cy.getElementById(`card:${owner.id()}`);

      if (card.nonempty() && !card.data("free")) {
        this.place(card);
      }
    });
  },

  bind(cy) {
    cy.on("position", "node", (event) => this.follow(event.target));
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = MetaCards;
}
