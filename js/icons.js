"use strict";

// Brick icons: a small built-in set of simple line icons (original drawings, 24x24, stroke only)
// plus any image URL / data-URI. `Icons.resolve(value, color)` gives the image source Cytoscape draws.
const Icons = {
  MAX_BYTES: 200 * 1024,
  DEFAULT_COLOR: "#334155",
  TYPES: ["image/svg+xml", "image/png"],
  URL_RE: /^(data:image\/[a-z0-9.+-]+[;,]|https?:\/\/|\.{0,2}\/|[^\s:]+\.(svg|png|jpe?g|gif|webp)(\?\S*)?$)/i,
  PATHS: {
    server: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"6\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"18\" height=\"6\" rx=\"1.5\"/><path d=\"M7 7h.01M7 17h.01\"/>",
    database: "<ellipse cx=\"12\" cy=\"6\" rx=\"8\" ry=\"3\"/><path d=\"M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6\"/><path d=\"M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3\"/>",
    cloud: "<path d=\"M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.9 10 4 4 0 0 1 17.5 18Z\"/>",
    user: "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7\"/>",
    users: "<circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6\"/><circle cx=\"17\" cy=\"9\" r=\"2.8\"/><path d=\"M17 14.2c2.6 0 4.5 1.8 4.5 4.6\"/>",
    mobile: "<rect x=\"7\" y=\"2.5\" width=\"10\" height=\"19\" rx=\"2\"/><path d=\"M11 18.5h2\"/>",
    laptop: "<rect x=\"5\" y=\"5\" width=\"14\" height=\"10\" rx=\"1.5\"/><path d=\"M2 19h20\"/>",
    api: "<path d=\"M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14\"/>",
    queue: "<rect x=\"2.5\" y=\"8\" width=\"5\" height=\"8\" rx=\"1\"/><rect x=\"9.5\" y=\"8\" width=\"5\" height=\"8\" rx=\"1\"/><path d=\"M17 12h4M19.5 9.5L22 12l-2.5 2.5\"/>",
    file: "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4M9 12h6M9 16h6\"/>",
    folder: "<path d=\"M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z\"/>",
    lock: "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/>",
    key: "<circle cx=\"8\" cy=\"15\" r=\"4.5\"/><path d=\"M11.2 11.8L21 2M17 6l3 3M14.5 8.5l2 2\"/>",
    globe: "<circle cx=\"12\" cy=\"12\" r=\"9.5\"/><path d=\"M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19\"/>",
    wifi: "<path d=\"M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0\"/><path d=\"M12 19.5h.01\"/>",
    bluetooth: "<path d=\"M6.5 7.5l11 9-5.5 4.5V3l5.5 4.5-11 9\"/>",
    usb: "<circle cx=\"12\" cy=\"20\" r=\"1.8\"/><path d=\"M12 18.2V4M9.5 6.5L12 3l2.5 3.5zM12 14l-5-3.5V8.5M12 11l5-2.5V7\"/><circle cx=\"7\" cy=\"7.2\" r=\"1.3\"/><rect x=\"15.7\" y=\"4.6\" width=\"2.6\" height=\"2.4\"/>",
    "usb-c": "<rect x=\"3\" y=\"8\" width=\"18\" height=\"8\" rx=\"4\"/><rect x=\"7\" y=\"11\" width=\"10\" height=\"2\" rx=\"1\"/>",
    house: "<path d=\"M3 11l9-8 9 8M5.5 9.5V21h13V9.5M10 21v-6h4v6\"/>",
    building: "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"1\"/><path d=\"M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10.5 21v-3h3v3\"/>",
    city: "<path d=\"M2.5 21h19M4 21V10h6v11M10 21V4h6v17M16 21v-8h4v8M12 8h2M12 12h2M12 16h2\"/>",
    gear: "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><circle cx=\"12\" cy=\"12\" r=\"7\"/><path d=\"M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8\"/>"
  },

  names() {
    return Object.keys(this.PATHS);
  },

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.PATHS, name);
  },

  // Colour accepted in the inline SVG (hex / rgb only, so nothing can break out of the attribute).
  safeColor(color) {
    const text = String(color || "").trim();

    return /^#[0-9a-f]{3,8}$/i.test(text) || /^rgba?\([\d\s.,%]+\)$/i.test(text) ? text : this.DEFAULT_COLOR;
  },

  svg(name, color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="${this.safeColor(color)}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${this.PATHS[name]}</svg>`;
  },

  dataUri(name, color) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(this.svg(name, color))}`;
  },

  isUrl(value) {
    return this.URL_RE.test(String(value || "").trim());
  },

  // Built-in name -> data-URI drawn in `color`; URL / data-URI -> unchanged; anything else -> null.
  resolve(value, color) {
    const text = String(value === undefined || value === null ? "" : value).trim();

    if (!text) {
      return null;
    }

    if (this.has(text)) {
      return this.dataUri(text, color);
    }

    return this.isUrl(text) ? this.normalize(text) : null;
  },

  // Non-base64 SVG data-URIs written by hand (raw "<", spaces, quotes) are re-encoded so the browser accepts them.
  normalize(uri) {
    const match = uri.match(/^(data:image\/svg\+xml)((?:;[^,]*)?),([\s\S]*)$/i);

    if (!match || /;base64/i.test(match[2])) {
      return uri;
    }

    let body = match[3];

    try {
      body = decodeURIComponent(body);
    } catch (error) {
      // literal "%" in the markup: encode as written
    }

    return `${match[1]};utf8,${encodeURIComponent(body)}`;
  },

  // ---- file import (browser) ----

  fileError(file) {
    if (!file) {
      return "Aucun fichier.";
    }

    if (!this.TYPES.includes(file.type) && !/\.(svg|png)$/i.test(file.name || "")) {
      return "Format non pris en charge (SVG ou PNG uniquement).";
    }

    if (file.size > this.MAX_BYTES) {
      return `Fichier trop volumineux (${Math.round(file.size / 1024)} Ko, maximum ${Math.round(this.MAX_BYTES / 1024)} Ko).`;
    }

    return "";
  },

  readFile(file) {
    return new Promise((resolve, reject) => {
      const error = this.fileError(file);

      if (error) {
        reject(new Error(error));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        let uri = String(reader.result);

        if (!/^data:image\//.test(uri) || /^data:application\/octet/.test(uri)) {
          uri = uri.replace(/^data:[^,]*/, /\.svg$/i.test(file.name) ? "data:image/svg+xml;base64" : "data:image/png;base64");
        }

        resolve(uri);
      };
      reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
      reader.readAsDataURL(file);
    });
  },

  // ---- picker widget (Style tab and legend editor) ----

  pickerHtml(current, opacity) {
    const value = String(current || "");
    const embedded = /^data:/i.test(value) && value.length > 80;
    const shown = embedded ? "" : value;
    const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const cells = this.names().map((name) => `<button type="button" class="icon-cell${name === value ? " active" : ""}" data-icon-pick="${name}" title="${name}" aria-label="${name}" aria-pressed="${name === value}"><img alt="" src="${esc(this.dataUri(name))}" /></button>`).join("");

    return `<div class="icon-picker">
      <div class="icon-grid">${cells}</div>
      <span class="icon-row"><input type="text" data-icon-url value="${esc(shown)}" placeholder="${embedded ? `Image importée (${Math.round(value.length / 1024)} Ko)` : "nom, URL ou data:image/…"}" spellcheck="false" autocomplete="off" aria-label="Icône : nom, URL ou data-URI" /><button type="button" data-icon-clear title="Retirer l’icône">⟲</button></span>
      <span class="icon-row"><button type="button" data-icon-import>Importer un fichier…</button><input type="file" data-icon-file hidden accept=".svg,.png,image/svg+xml,image/png" /></span>
      <label class="icon-opacity">Opacité de l’icône <input type="range" data-icon-opacity min="0.05" max="1" step="0.05" value="${opacity === undefined || opacity === "" ? 1 : opacity}" /></label>
      <small class="icon-msg" role="status"></small>
    </div>`;
  },

  // Delegated handlers on `root` (bound once); `onChange(patch)` receives { icon } or { iconOpacity }.
  bind(root, onChange) {
    if (root.dataset.iconBound) {
      return;
    }

    root.dataset.iconBound = "1";

    const message = (target, text) => {
      const box = target.closest(".icon-picker") && target.closest(".icon-picker").querySelector(".icon-msg");

      if (box) {
        box.textContent = text;
      }
    };

    root.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-icon-pick]");
      const clear = event.target.closest("[data-icon-clear]");
      const importer = event.target.closest("[data-icon-import]");

      if (pick) {
        onChange({ icon: pick.dataset.iconPick });
      } else if (clear) {
        onChange({ icon: null });
      } else if (importer) {
        const file = importer.closest(".icon-picker").querySelector("[data-icon-file]");

        file.value = "";
        file.click();
      }
    });

    root.addEventListener("change", (event) => {
      const target = event.target;

      if (target.matches && target.matches("[data-icon-file]")) {
        const file = target.files && target.files[0];

        message(target, "");
        this.readFile(file).then((uri) => onChange({ icon: uri })).catch((error) => message(target, error.message));
      } else if (target.matches && target.matches("[data-icon-url]")) {
        const text = target.value.trim();

        if (text && !this.has(text) && !this.isUrl(text)) {
          message(target, "Nom d’icône inconnu : choisissez dans la grille ou saisissez une URL / data:image.");
          return;
        }

        message(target, "");
        onChange({ icon: text || null });
      } else if (target.matches && target.matches("[data-icon-opacity]")) {
        onChange({ iconOpacity: Number(target.value) });
      }
    });
  }
};

if (typeof module === "object" && module.exports) {
  module.exports = Icons;
}
