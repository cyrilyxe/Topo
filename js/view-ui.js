"use strict";

// View chrome: side panel / diagram controls toggles, "Contrôles" menu, diagram fullscreen.
const ViewUi = {
  CLOSE_DELAY: 400,
  sideTimer: null,
  topTimer: null,
  altPinned: false,

  get fullscreen() {
    return document.body.classList.contains("diagram-fullscreen");
  },

  init() {
    this.els = {
      sideCheck: document.getElementById("opt-side-panel"),
      controlsCheck: document.getElementById("opt-controls"),
      reveal: document.getElementById("side-reveal"),
      edgeLeft: document.getElementById("edge-left"),
      edgeTop: document.getElementById("edge-top"),
      panel: document.querySelector(".editor-panel"),
      header: document.querySelector(".app-header"),
      tabs: document.getElementById("doc-tabs"),
      menu: document.getElementById("controls-menu"),
      toggle: document.getElementById("controls-toggle")
    };

    this.els.sideCheck.addEventListener("change", () => Settings.set("ui.sidePanel", this.els.sideCheck.checked));
    this.els.controlsCheck.addEventListener("change", () => Settings.set("ui.controls", this.els.controlsCheck.checked));
    this.els.reveal.addEventListener("click", () => Settings.set("ui.sidePanel", true));
    document.getElementById("btn-fullscreen").addEventListener("click", () => this.toggleFullscreen());

    Settings.onChange((keys) => {
      if (keys.some((key) => key.startsWith("ui.") || key === "fullscreen.edgeReveal")) {
        this.apply();
      }
    });

    this.bindMenu();
    this.bindEdges();
    this.bindKeys();
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && this.fullscreen) {
        this.setFullscreen(false);
      }
    });
    this.apply();
  },

  // ---- toggles ----

  apply() {
    const body = document.body;
    const side = Settings.get("ui.sidePanel") !== false;
    const controls = Settings.get("ui.controls") !== false;

    body.classList.toggle("side-hidden", !side);
    body.classList.toggle("controls-hidden", !controls);
    body.classList.toggle("edge-reveal", Settings.get("fullscreen.edgeReveal") !== false);
    this.els.sideCheck.checked = side;
    this.els.controlsCheck.checked = controls;
    this.relayoutSoon();
  },

  relayoutSoon() {
    requestAnimationFrame(() => {
      if (typeof Editor !== "undefined" && Editor.refresh) {
        Editor.refresh();
      }

      if (Graph.cy) {
        Graph.cy.resize();
      }
    });
  },

  toggleSidePanel() {
    if (this.fullscreen) {
      this.setSideOverlay(!document.body.classList.contains("side-overlay"));
    } else {
      Settings.set("ui.sidePanel", !(Settings.get("ui.sidePanel") !== false));
    }
  },

  // ---- fullscreen ----

  toggleFullscreen() {
    this.setFullscreen(!this.fullscreen);
  },

  setFullscreen(on) {
    document.body.classList.toggle("diagram-fullscreen", on);
    this.setSideOverlay(false);
    this.setTopOverlay(false);
    this.altPinned = false;
    App.closeDropdowns();

    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try {
        const result = document.documentElement.requestFullscreen();

        if (result && result.catch) {
          result.catch(() => {});
        }
      } catch (error) {
        // Class-only fullscreen is enough.
      }
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    this.relayoutSoon();
  },

  setSideOverlay(open) {
    clearTimeout(this.sideTimer);
    document.body.classList.toggle("side-overlay", open && this.fullscreen);

    if (open) {
      this.relayoutSoon();
    }
  },

  setTopOverlay(open) {
    clearTimeout(this.topTimer);

    if (open) {
      document.body.style.setProperty("--header-h", `${this.els.header.offsetHeight || 44}px`);
    }

    document.body.classList.toggle("top-overlay", open && this.fullscreen);
  },

  // The overlay stays open while focus is in the editor or a field.
  sideBusy() {
    const active = document.activeElement;

    return Boolean(active && this.els.panel.contains(active) && active.closest(".CodeMirror, input, textarea, select, [contenteditable='true']"));
  },

  topBusy() {
    const active = document.activeElement;

    return this.altPinned
      || Boolean(this.els.header.querySelector(".dropdown-panel:not([hidden])"))
      || Boolean(active && this.els.header.contains(active) && active.closest("input, select, textarea"));
  },

  scheduleSideClose() {
    clearTimeout(this.sideTimer);
    this.sideTimer = setTimeout(() => {
      if (this.sideBusy() || this.els.panel.matches(":hover")) {
        return;
      }

      this.setSideOverlay(false);
    }, this.CLOSE_DELAY);
  },

  scheduleTopClose() {
    clearTimeout(this.topTimer);
    this.topTimer = setTimeout(() => {
      if (this.topBusy() || this.els.header.matches(":hover") || this.els.tabs.matches(":hover")) {
        return;
      }

      this.setTopOverlay(false);
    }, this.CLOSE_DELAY);
  },

  bindEdges() {
    const edgeOn = () => this.fullscreen && Settings.get("fullscreen.edgeReveal") !== false;
    const openSide = () => {
      if (edgeOn()) {
        this.setSideOverlay(true);
      }
    };
    const openTop = () => {
      if (edgeOn()) {
        this.setTopOverlay(true);
      }
    };

    ["mouseenter", "mousemove"].forEach((name) => {
      this.els.edgeLeft.addEventListener(name, openSide);
      this.els.edgeTop.addEventListener(name, openTop);
    });

    // Leaving a strip without entering the revealed element must close it too.
    this.els.edgeLeft.addEventListener("mouseleave", () => this.fullscreen && this.scheduleSideClose());
    this.els.edgeTop.addEventListener("mouseleave", () => this.fullscreen && this.scheduleTopClose());
    this.els.panel.addEventListener("mouseenter", () => clearTimeout(this.sideTimer));
    this.els.panel.addEventListener("mouseleave", () => this.fullscreen && this.scheduleSideClose());
    this.els.panel.addEventListener("focusout", () => {
      if (this.fullscreen && !this.els.panel.matches(":hover")) {
        this.scheduleSideClose();
      }
    });

    [this.els.header, this.els.tabs].forEach((element) => {
      element.addEventListener("mouseenter", () => clearTimeout(this.topTimer));
      element.addEventListener("mouseleave", () => this.fullscreen && this.scheduleTopClose());
    });
  },

  // ---- keyboard ----

  bindKeys() {
    // Capture phase: runs before the tool and app handlers so that Escape priority can be decided here.
    document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
  },

  dialogOpen() {
    return (typeof Forms !== "undefined" && Forms.isOpen())
      || (typeof Help !== "undefined" && Help.isOpen())
      || (typeof SettingsUI !== "undefined" && SettingsUI.isOpen());
  },

  onKeyDown(event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && !event.altKey && !event.shiftKey && key === "b") {
      event.preventDefault();
      this.toggleSidePanel();
    } else if (mod && !event.altKey && event.shiftKey && key === "f") {
      event.preventDefault();
      this.toggleFullscreen();
    } else if (event.key === "Alt" && !mod && !event.shiftKey && !event.repeat && this.fullscreen) {
      event.preventDefault();

      if (document.body.classList.contains("top-overlay")) {
        this.altPinned = false;
        this.setTopOverlay(false);
      } else {
        this.altPinned = true;
        this.setTopOverlay(true);
      }
    } else if (event.key === "Escape" && this.fullscreen && !this.dialogOpen()) {
      const dragging = typeof Tools !== "undefined" && (Tools.moveDrag || Tools.linkDrag);

      if (dragging || this.els.header.querySelector(".dropdown-panel:not([hidden])")) {
        return;
      }

      this.setFullscreen(false);
    }
  },

  // ---- "Contrôles" menu ----

  bindMenu() {
    this.els.toggle.addEventListener("click", () => this.renderMenu());
    this.els.menu.addEventListener("click", (event) => {
      const item = event.target.closest("button[data-act]");

      if (!item) {
        return;
      }

      const value = item.dataset.value;

      App.closeDropdowns();

      if (item.dataset.act === "tool") {
        Tools.setTool(value);
      } else if (item.dataset.act === "layout") {
        App.els.layoutSelect.value = value;
        App.els.layoutSelect.dispatchEvent(new Event("change"));
      } else if (item.dataset.act === "replay") {
        document.getElementById("btn-relayout").click();
      } else if (item.dataset.act === "fit") {
        Graph.fit();
      } else if (item.dataset.act === "collapse") {
        App.collapseAll();
      } else if (item.dataset.act === "expand") {
        App.expandAll();
      }
    });
  },

  // Rebuilt on each opening so that it always reflects the current tool and layout.
  renderMenu() {
    const menu = this.els.menu;
    const add = (label, act, value, options = {}) => {
      const button = document.createElement("button");

      button.type = "button";
      button.dataset.act = act;

      if (value !== undefined) {
        button.dataset.value = value;
      }

      if (options.radio) {
        button.setAttribute("role", "menuitemradio");
        button.setAttribute("aria-checked", String(Boolean(options.checked)));
      } else {
        button.setAttribute("role", "menuitem");
      }

      const text = document.createElement("span");

      text.textContent = `${options.radio ? (options.checked ? "✓ " : "  ") : ""}${label}`;
      button.appendChild(text);

      if (options.key) {
        const kbd = document.createElement("kbd");

        kbd.textContent = options.key;
        button.appendChild(kbd);
      }

      menu.appendChild(button);
    };
    const heading = (label) => {
      const element = document.createElement("div");

      element.className = "menu-heading";
      element.textContent = label;
      menu.appendChild(element);
    };
    const rule = () => menu.appendChild(document.createElement("hr"));

    menu.textContent = "";
    heading("Outils");
    Tools.TOOLS.forEach((tool) => add(tool.name, "tool", tool.id, { radio: true, checked: Tools.current === tool.id, key: tool.key }));
    rule();
    heading("Disposition");
    [...App.els.layoutSelect.options].forEach((option) => {
      add(option.textContent, "layout", option.value, { radio: true, checked: App.els.layoutSelect.value === option.value });
    });
    add("Rejouer la disposition", "replay");
    rule();
    add("Ajuster", "fit");
    add("Tout replier", "collapse");
    add("Tout déplier", "expand");
  }
};
