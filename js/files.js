"use strict";

const Files = {
  // Current document: { name, handle }
  current: { name: null, handle: null },

  hasPicker() {
    return typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
  },

  isAbort(error) {
    return error && error.name === "AbortError";
  },

  // Resolves to { text, name, handle } or null when cancelled.
  async open() {
    let file = null;
    let handle = null;

    if (this.hasPicker()) {
      try {
        [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: "YAML ou JSON",
            accept: {
              "text/yaml": [".yaml", ".yml"],
              "application/json": [".json"]
            }
          }]
        });
        file = await handle.getFile();
      } catch (error) {
        if (this.isAbort(error)) {
          return null;
        }

        throw error;
      }
    } else {
      file = await this.pickWithInput();

      if (!file) {
        return null;
      }
    }

    const raw = await file.text();

    if (/\.json$/i.test(file.name)) {
      return {
        text: this.jsonToYaml(raw),
        name: file.name.replace(/\.json$/i, ".yaml"),
        handle: null
      };
    }

    return { text: raw, name: file.name, handle, sig: handle ? FileWatch.signatureOf(file) : null };
  },

  pickWithInput() {
    return new Promise((resolve) => {
      const input = document.createElement("input");

      input.type = "file";
      input.accept = ".yaml,.yml,.json,application/json,text/yaml";
      input.addEventListener("change", () => resolve(input.files[0] || null));
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  },

  jsonToYaml(raw) {
    const data = JSON.parse(raw);

    return jsyaml.dump(data, { indent: 2, lineWidth: 100, noRefs: true });
  },

  // Writes into the current handle; without handle falls back to saveAs.
  async save(text) {
    const handle = this.current.handle;

    if (!handle) {
      return this.saveAs(text, this.current.name);
    }

    await this.write(handle, text);

    return { name: this.current.name, handle };
  },

  async write(handle, text) {
    if (typeof handle.queryPermission === "function") {
      const options = { mode: "readwrite" };

      if ((await handle.queryPermission(options)) !== "granted") {
        if ((await handle.requestPermission(options)) !== "granted") {
          throw new Error("Permission d’écriture refusée.");
        }
      }
    }

    const writable = await handle.createWritable();

    await writable.write(text);
    await writable.close();
  },

  // Resolves to { name, handle } or null when cancelled.
  async saveAs(text, suggestedName) {
    const name = suggestedName || "architecture.yaml";

    if (this.hasPicker()) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{
            description: "YAML",
            accept: { "text/yaml": [".yaml", ".yml"] }
          }]
        });

        await this.write(handle, text);

        return { name: handle.name, handle };
      } catch (error) {
        if (this.isAbort(error)) {
          return null;
        }

        throw error;
      }
    }

    this.download(text, name, "text/yaml");

    return { name, handle: null };
  },

  download(content, name, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
