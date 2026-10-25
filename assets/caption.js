/* Pure caption assembly. No DOM. Training order matches the RetroModel packer. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RetroCaption = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function norm(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function decadeOf(year) {
    const n = Number(year);
    if (!Number.isFinite(n) || n <= 0) return "";
    return Math.floor(n / 10) * 10 + "s";
  }

  function cleanParts(text) {
    return String(text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * model fields are already resolved:
   * prefix bool, year string|number, decade string, characters string[],
   * series string, bodyMode "tags"|"sentence", description string,
   * source "hires"|"lowres"|"", designer string, quality string[]
   */
  function resolveCaption(model) {
    const slots = [];
    const add = (kind, text) => {
      const value = String(text || "").trim();
      if (!value) return;
      slots.push({ kind, text: value });
    };

    if (model.prefix) add("prefix", "anime screenshot");
    if (model.year) add("year", String(model.year));
    if (model.decade) add("decade", model.decade);
    (model.characters || []).forEach((name) => add("character", name));
    if (model.series) add("series", model.series);

    if (model.bodyMode === "sentence") {
      const sentence = String(model.description || "").replace(/\s+/g, " ").trim();
      if (sentence) add("description", sentence);
    } else {
      cleanParts(model.description).forEach((part) => add("description", part));
    }

    if (model.source === "hires" || model.source === "lowres") add("source", model.source);
    if (model.designer) add("designer", model.designer);
    (model.quality || []).forEach((tag) => add("quality", tag));

    return {
      text: slots.map((slot) => slot.text).join(", "),
      slots,
    };
  }

  return { norm, decadeOf, cleanParts, resolveCaption };
});
