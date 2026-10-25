(function () {
  const { norm, decadeOf, cleanParts, resolveCaption } = window.RetroCaption;
  const TAGS = window.RetroTags;
  const $ = (id) => document.getElementById(id);

  const JUMP = {
    prefix: "sec-prefix",
    year: "sec-year",
    decade: "sec-year",
    character: "sec-cast",
    series: "sec-series",
    description: "sec-body",
    source: "sec-source",
    designer: "sec-designer",
    quality: "sec-quality",
  };

  const state = {
    prefix: true,
    seriesId: null,
    yearMode: "auto",
    yearManual: "",
    includeDecade: true,
    characters: [],
    designerMode: "auto",
    designerManual: null,
    bodyMode: "tags",
    sentence: "",
    counts: [],
    tags: {},
    extra: "",
    sourceMode: "auto",
    quality: [],
    why: "Pick a series, or start from a template. Empty slots are left out of the caption.",
    template: "",
    view: "steps",
    indexId: null,
    indexOpen: null,
    indexQuery: "",
    castQuery: "",
  };
  TAGS.groups.forEach((group) => {
    state.tags[group.id] = [];
  });

  let catalog = [];
  let byId = new Map();
  let designers = [];
  let characters = [];
  let promptUses = new Map();
  let shotMax = 1;
  let castRows = [];
  let castFraction = 1;
  let castLockUntil = 0;
  let castObserver = null;

  function el(tag, props, kids) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value == null) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    });
    (kids || []).forEach((kid) => {
      if (kid == null) return;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  function currentSeries() {
    return state.seriesId ? byId.get(state.seriesId) || null : null;
  }

  function seriesSource(series) {
    if (!series) return "";
    return series.hires ? "hires" : "lowres";
  }

  function resolveYear() {
    if (state.yearMode === "none") return "";
    if (state.yearMode === "manual") return /^\d{4}$/.test(state.yearManual) ? state.yearManual : "";
    const series = currentSeries();
    return series && series.year ? String(series.year) : "";
  }

  function resolveDecade(year) {
    if (!state.includeDecade || !/^\d{4}$/.test(String(year || ""))) return "";
    return decadeOf(year);
  }

  function resolveSource() {
    if (state.sourceMode === "none") return "";
    if (state.sourceMode === "hires" || state.sourceMode === "lowres") return state.sourceMode;
    return seriesSource(currentSeries());
  }

  function resolveDesigner() {
    if (state.designerMode === "none") return null;
    if (state.designerMode === "manual") return state.designerManual;
    const series = currentSeries();
    if (!series || !series.designer) return null;
    return {
      name: series.designer.name,
      prompt: series.designer.prompt,
      role: series.designer.role || "",
      auto: true,
    };
  }

  function orderedDescription() {
    if (state.bodyMode === "sentence") {
      return state.sentence.replace(/\s+/g, " ").trim();
    }
    const ordered = [];
    const add = (id) => {
      const value = String(id || "").trim();
      if (value && !ordered.includes(value)) ordered.push(value);
    };
    TAGS.counts.forEach((tag) => {
      if (state.counts.includes(tag.id)) add(tag.id);
    });
    TAGS.groups.forEach((group) => {
      const picked = state.tags[group.id] || [];
      group.tags.forEach((tag) => {
        if (picked.includes(tag.id)) add(tag.id);
      });
    });
    cleanParts(state.extra).forEach((part) => add(norm(part)));
    return ordered.join(", ");
  }

  function orderedQuality() {
    return TAGS.quality.map((tag) => tag.id).filter((id) => state.quality.includes(id));
  }

  function resolved() {
    const series = currentSeries();
    const year = resolveYear();
    const designer = resolveDesigner();
    return {
      series,
      year,
      decade: resolveDecade(year),
      source: resolveSource(),
      designer,
      description: orderedDescription(),
      quality: orderedQuality(),
    };
  }

  function captionModel(view) {
    return {
      prefix: state.prefix,
      year: view.year,
      decade: view.decade,
      characters: state.characters.map((person) => person.prompt),
      series: view.series ? view.series.prompt : "",
      bodyMode: state.bodyMode,
      description: view.description,
      source: view.source,
      designer: view.designer ? view.designer.prompt : "",
      quality: view.quality,
    };
  }

  function setWhy(text) {
    state.why = text;
    $("why").textContent = text;
  }

  function rank(query, fields) {
    const q = query.toLowerCase();
    if (!q) return 1;
    let best = 0;
    fields.forEach((field) => {
      const value = String(field || "").toLowerCase();
      if (!value) return;
      if (value === q) best = Math.max(best, 5);
      else if (value.startsWith(q)) best = Math.max(best, 4);
      else if (value.split(/\s+/).some((word) => word.startsWith(q))) best = Math.max(best, 3);
      else if (value.includes(q)) best = Math.max(best, 2);
    });
    return best;
  }

  function attachCombo(input, menu, config) {
    let items = [];
    let active = 0;

    function close() {
      menu.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    function placeMenu() {
      const rect = input.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      let top = rect.bottom + 4;
      let maxHeight = Math.max(120, Math.min(280, below - 12));
      if (below < 180 && above > below) {
        maxHeight = Math.max(120, Math.min(280, above - 12));
        top = Math.max(8, rect.top - 4 - maxHeight);
      }
      menu.style.position = "fixed";
      menu.style.left = rect.left + "px";
      menu.style.width = rect.width + "px";
      menu.style.right = "auto";
      menu.style.top = top + "px";
      menu.style.maxHeight = maxHeight + "px";
      menu.style.zIndex = "40";
    }

    function paint() {
      items = config.items(input.value.trim());
      menu.replaceChildren();
      if (!items.length) {
        menu.append(el("li", { class: "combo-empty" }, [config.empty || "No matches"]));
        active = 0;
      } else {
        active = Math.max(0, Math.min(active, items.length - 1));
        items.forEach((item, index) => {
          const row = el("li", {
            role: "option",
            class: index === active ? "active" : "",
            "aria-selected": index === active ? "true" : "false",
          });
          config.render(row, item);
          row.addEventListener("mousedown", (event) => {
            event.preventDefault();
            config.pick(item);
            input.value = "";
            close();
          });
          menu.append(row);
        });
      }
      menu.hidden = false;
      input.setAttribute("aria-expanded", "true");
      placeMenu();
      const current = menu.querySelector(".active");
      if (current) current.scrollIntoView({ block: "nearest" });
    }

    input.addEventListener("focus", () => {
      active = 0;
      paint();
    });
    input.addEventListener("input", () => {
      active = 0;
      paint();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (menu.hidden) paint();
        active = Math.min(active + 1, Math.max(items.length - 1, 0));
        paint();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        paint();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (items[active]) {
          config.pick(items[active]);
          input.value = "";
          close();
        } else if (config.pickRaw) {
          config.pickRaw(input.value);
          input.value = "";
          close();
        }
      } else if (event.key === "Escape") {
        close();
      }
    });
    document.addEventListener("mousedown", (event) => {
      if (!input.parentElement.contains(event.target)) close();
    });
    window.addEventListener("scroll", () => {
      if (!menu.hidden) placeMenu();
    }, true);
    window.addEventListener("resize", () => {
      if (!menu.hidden) placeMenu();
    });
    return { close };
  }

  function searchSeries(query) {
    return catalog
      .map((series) => ({
        series,
        score: rank(query, [
          series.display,
          series.prompt,
          series.native,
          series.year,
          ...(series.aliases || []),
          ...(series.studios || []),
          series.designer && series.designer.name,
        ]),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.series.display.localeCompare(b.series.display))
      .slice(0, 40)
      .map((row) => row.series);
  }

  function searchCast(query) {
    const pool = $("cast-all").checked || !state.seriesId
      ? characters
      : characters.filter((person) => person.seriesId === state.seriesId);
    return pool
      .map((person) => ({
        person,
        score: rank(query, [person.name, person.prompt, person.native, ...(person.alt || []), person.seriesTitle]),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
      .slice(0, 40)
      .map((row) => row.person);
  }

  function searchDesigners(query) {
    return designers
      .map((person) => ({
        person,
        score: rank(query, [person.name, person.prompt, ...person.credits.map((credit) => credit.title)]),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
      .slice(0, 40)
      .map((row) => row.person);
  }

  function renderOption(row, title, sub) {
    row.append(el("div", { class: "opt-title", text: title }), el("div", { class: "opt-sub", text: sub }));
  }

  function selectSeries(id) {
    state.seriesId = id;
    state.template = "";
  }

  function addCharacter(person) {
    const key = person.seriesId + ":" + person.prompt;
    if (state.characters.some((item) => item.seriesId + ":" + item.prompt === key)) return;
    state.characters.push({
      seriesId: person.seriesId,
      name: person.name,
      prompt: person.prompt,
      gender: person.gender || "",
      role: person.role || "",
      seriesTitle: person.seriesTitle,
      shotCount: person.shotCount || 0,
    });
  }

  function findCharacter(seriesId, prompt) {
    return characters.find((person) => person.seriesId === seriesId && person.prompt === prompt);
  }

  function resetState() {
    state.prefix = true;
    state.seriesId = null;
    state.yearMode = "auto";
    state.yearManual = "";
    state.includeDecade = true;
    state.characters = [];
    state.designerMode = "auto";
    state.designerManual = null;
    state.bodyMode = "tags";
    state.sentence = "";
    state.counts = [];
    TAGS.groups.forEach((group) => {
      state.tags[group.id] = [];
    });
    state.extra = "";
    state.sourceMode = "auto";
    state.quality = [];
    state.template = "";
  }

  function qualityConflict(tag, source) {
    if (source === "hires" && tag.tier === "lo") return "Left out of hires captions in the training pack.";
    if (source === "lowres" && tag.tier === "hi") return "Used on hires captions, not lowres ones.";
    return "";
  }

  function renderCaption(view) {
    const built = resolveCaption(captionModel(view));
    $("caption-text").value = built.text;
    const count = built.slots.length;
    $("token-count").textContent = count === 1 ? "1 token" : count + " tokens";
    const chips = $("caption-chips");
    chips.replaceChildren();
    if (!built.slots.length) {
      chips.append(el("span", { class: "meta", text: "Nothing in the caption yet." }));
    }
    built.slots.forEach((slot) => {
      chips.append(el("button", {
        type: "button",
        class: "k-" + slot.kind,
        text: slot.text,
        onclick: () => {
          const target = $(JUMP[slot.kind]);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      }));
    });
    const rows = [
      ["Prefix", state.prefix ? "anime screenshot" : ""],
      ["Year", view.year],
      ["Decade", view.decade],
      ["Characters", state.characters.map((person) => person.prompt).join(", ")],
      ["Series", view.series ? view.series.prompt : ""],
      ["Description", view.description],
      ["Scan", view.source],
      ["Designer", view.designer ? view.designer.prompt : ""],
      ["Quality", view.quality.join(", ")],
    ];
    const table = $("slot-table");
    table.replaceChildren();
    rows.forEach(([label, value]) => {
      const tr = el("tr");
      tr.append(el("th", { text: label, scope: "row" }));
      tr.append(el("td", { class: value ? "" : "empty", text: value || "left out" }));
      table.append(tr);
    });
    $("why").textContent = state.why;
  }

  function renderSeriesCard(view) {
    const host = $("series-card");
    host.replaceChildren();
    const series = view.series;
    if (!series) {
      host.append(el("p", { class: "meta", text: "No series. The caption skips the series name, and automatic year, scan, and designer stay empty." }));
      return;
    }
    const shared = promptUses.get(series.prompt) || [];
    const card = el("div", { class: "choice" });
    card.append(el("span", { class: "badge", text: "In the caption" }));
    card.append(el("h3", { text: series.display }));
    card.append(el("p", { class: "meta" }, [
      "Caption token ",
      el("span", { class: "token", text: series.prompt }),
    ]));
    const bits = [
      series.year || "year unknown",
      series.decade,
      series.format ? series.format.toLowerCase().replace(/_/g, " ") : "",
      series.height ? series.height + "p" : "scan height not recorded",
      series.hires ? "packed as hires" : "packed as lowres",
    ].filter(Boolean);
    card.append(el("p", { class: "meta", text: bits.join(" · ") }));
    if (series.studios && series.studios.length) {
      card.append(el("p", { class: "meta", text: "Studio, not written in the caption: " + series.studios.join(", ") }));
    }
    if (series.native) card.append(el("p", { class: "meta", text: series.native }));
    if (series.display.includes(":") && norm(series.display.split(":")[0]) === series.prompt) {
      card.append(el("p", { class: "warn", text: "Training captions kept only the title before the colon. The token is “" + series.prompt + "”." }));
    }
    if (shared.length > 1) {
      const others = shared.filter((item) => item.id !== series.id).map((item) => item.display + (item.year ? " (" + item.year + ")" : ""));
      card.append(el("p", { class: "warn", text: "This token is shared with " + others.join(", ") + ". The year and the cast are what separate them." }));
    }
    const held = [];
    if (state.yearMode !== "auto") held.push("year");
    if (state.designerMode !== "auto") held.push("designer");
    if (state.sourceMode !== "auto") held.push("scan size");
    if (held.length) {
      card.append(el("p", { class: "meta", text: "This series did not replace your " + held.join(", ") + ". Use the reset control on that slot if you want it to." }));
    }
    card.append(el("div", { class: "row" }, [
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Remove series",
        onclick: () => {
          state.seriesId = null;
          state.template = "";
          setWhy("Series removed. Automatic year, scan, and designer drop out with it unless you set them by hand.");
          render();
        },
      }),
    ]));
    host.append(card);
  }

  function renderYear(view) {
    const input = $("year-input");
    if (document.activeElement !== input) {
      input.value = state.yearMode === "manual" ? state.yearManual : view.year;
    }
    const badge = $("year-badge");
    const series = currentSeries();
    if (state.yearMode === "manual") {
      badge.className = "badge manual";
      badge.textContent = "Manual";
    } else if (state.yearMode === "none") {
      badge.className = "badge none";
      badge.textContent = "Omitted";
    } else if (!series) {
      badge.className = "badge none";
      badge.textContent = "No series yet";
    } else {
      badge.className = "badge";
      badge.textContent = "From series";
    }
    $("decade-toggle").checked = state.includeDecade;
    $("decade-toggle").disabled = !view.year && state.yearMode !== "manual";
    const help = [];
    if (state.yearMode === "manual" && state.yearManual && !/^\d{4}$/.test(state.yearManual)) {
      help.push("Enter a four-digit year.");
    }
    if (view.year && (Number(view.year) < 1977 || Number(view.year) > 1989)) {
      help.push(view.year + " is outside the 1977–1989 training window.");
    }
    if (view.decade) help.push("Decade token: " + view.decade + ".");
    else if (!state.includeDecade && view.year) help.push("Decade omitted.");
    $("year-help").textContent = help.join(" ");
  }

  function renderCast() {
    const host = $("cast-chips");
    host.replaceChildren();
    if (!state.characters.length) {
      host.append(el("p", { class: "meta", text: "No character. The cast slot is left out." }));
    }
    state.characters.forEach((person, index) => {
      const other = state.seriesId && person.seriesId !== state.seriesId;
      const chip = el("span", { class: "chip", title: imageLabel(person.shotCount || 0) + " in the training pack" });
      chip.append(shotDot(person.shotCount || 0));
      chip.append(person.name + (other ? " · " + person.seriesTitle : ""));
      chip.append(el("button", {
        type: "button",
        "aria-label": "Remove " + person.name,
        text: "×",
        onclick: () => {
          state.characters.splice(index, 1);
          render();
        },
      }));
      host.append(chip);
    });
    const suggest = $("cast-suggest");
    suggest.replaceChildren();
    if (!state.characters.length || state.counts.length) return;
    const genders = state.characters.map((person) => (person.gender || "").toLowerCase());
    if (genders.some((gender) => gender !== "female" && gender !== "male")) {
      suggest.textContent = "Some of these names have no gender in the catalog, so a count tag is not suggested.";
      return;
    }
    const women = genders.filter((gender) => gender === "female").length;
    const men = genders.filter((gender) => gender === "male").length;
    let tags = null;
    if (women && !men) tags = [women === 1 ? "1girl" : women === 2 ? "2girls" : women === 3 ? "3girls" : "multiple girls"];
    else if (men && !women) tags = [men === 1 ? "1boy" : men === 2 ? "2boys" : men === 3 ? "3boys" : "multiple boys"];
    else if (women && men) tags = ["1girl", "1boy"];
    if (!tags) return;
    suggest.append("Suggested count tag, not added yet: ");
    suggest.append(el("button", {
      type: "button",
      class: "btn",
      text: "Add " + tags.join(" and "),
      onclick: () => {
        tags.forEach((tag) => {
          if (!state.counts.includes(tag)) state.counts.push(tag);
        });
        setWhy("Count tags sit at the start of the description. They are not character names.");
        render();
      },
    }));
  }

  function renderDesigner(view) {
    const series = view.series;
    const picks = $("designer-picks");
    picks.replaceChildren();
    if (series && series.designers.length) {
      series.designers.forEach((person) => {
        const selected = view.designer && view.designer.prompt === person.prompt;
        const training = series.designer && series.designer.prompt === person.prompt;
        picks.append(el("button", {
          type: "button",
          "aria-pressed": selected ? "true" : "false",
          text: person.name + (training ? " · training default" : person.role ? " · " + person.role : ""),
          onclick: () => {
            if (training) {
              state.designerMode = "auto";
              state.designerManual = null;
              setWhy("Back to the designer written in this series' training captions.");
            } else {
              state.designerMode = "manual";
              state.designerManual = { name: person.name, prompt: person.prompt, role: person.role || "" };
              setWhy("Manual designer. The series stays. Reset returns the training default.");
            }
            render();
          },
        }));
      });
    }
    const card = $("designer-card");
    card.replaceChildren();
    const box = el("div", { class: "choice" });
    const designer = view.designer;
    if (!designer) {
      box.append(el("span", { class: "badge none", text: "Omitted" }));
      box.append(el("h3", { text: "No character designer" }));
      box.append(el("p", { class: "meta", text: "The caption skips this slot. Prompt following stays with the text encoder, which was not trained." }));
    } else if (state.designerMode === "manual") {
      box.append(el("span", { class: "badge manual", text: "Manual" }));
      box.append(el("h3", { text: designer.name }));
      box.append(el("p", { class: "meta" }, [
        "Caption token ",
        el("span", { class: "token", text: designer.prompt }),
        designer.role ? " · " + designer.role : "",
      ]));
    } else {
      box.append(el("span", { class: "badge", text: "From series" }));
      box.append(el("h3", { text: designer.name }));
      box.append(el("p", { class: "meta" }, [
        "Caption token ",
        el("span", { class: "token", text: designer.prompt }),
        designer.role ? " · " + designer.role : "",
      ]));
    }
    const actions = el("div", { class: "row" });
    if (state.designerMode !== "auto") {
      actions.append(el("button", {
        type: "button",
        class: "btn",
        text: "Reset to the series designer",
        disabled: series && series.designer ? null : "disabled",
        onclick: () => {
          state.designerMode = "auto";
          state.designerManual = null;
          setWhy("Designer follows the series again.");
          render();
        },
      }));
    }
    if (state.designerMode !== "none") {
      actions.append(el("button", {
        type: "button",
        class: "btn ghost",
        text: "No designer",
        onclick: () => {
          state.designerMode = "none";
          state.designerManual = null;
          setWhy("Designer removed. The rest of the caption stays.");
          render();
        },
      }));
    }
    box.append(actions);
    card.append(box);
  }

  function renderSource(view) {
    const effective = view.source;
    $("source-hi").setAttribute("aria-pressed", effective === "hires" ? "true" : "false");
    $("source-lo").setAttribute("aria-pressed", effective === "lowres" ? "true" : "false");
    $("source-omit").setAttribute("aria-pressed", state.sourceMode === "none" ? "true" : "false");
    const series = view.series;
    const help = [];
    if (state.sourceMode === "auto" && series) {
      help.push("From this series: " + (series.hires ? "hires" : "lowres") + (series.height ? ", " + series.height + "p scan." : "."));
    } else if (state.sourceMode === "auto") {
      help.push("No series yet, so the scan token is left out until you choose one.");
    } else if (state.sourceMode === "none") {
      help.push("Scan token omitted.");
    } else {
      help.push("Manual " + state.sourceMode + ".");
    }
    $("source-help").textContent = help.join(" ");
  }

  function renderModes() {
    const tags = state.bodyMode === "tags";
    $("mode-tags").setAttribute("aria-pressed", tags ? "true" : "false");
    $("mode-sentence").setAttribute("aria-pressed", tags ? "false" : "true");
    $("sentence").hidden = tags;
    $("sentence-help").hidden = tags;
    $("extra").disabled = !tags;
    if (document.activeElement !== $("sentence")) $("sentence").value = state.sentence;
    if (document.activeElement !== $("extra")) $("extra").value = state.extra;
    $("prefix-toggle").checked = state.prefix;
    document.querySelectorAll("#template-row .template").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.id === state.template ? "true" : "false");
    });
  }

  function renderTagPressed(view) {
    document.querySelectorAll("#tag-board .tag").forEach((button) => {
      const id = button.dataset.tag;
      const group = button.dataset.group;
      const on = group === "count" ? state.counts.includes(id) : (state.tags[group] || []).includes(id);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll("#quality-board .tag").forEach((button) => {
      const tag = TAGS.quality.find((item) => item.id === button.dataset.tag);
      const on = state.quality.includes(tag.id);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      const conflict = on ? qualityConflict(tag, view.source) : "";
      button.classList.toggle("conflict", Boolean(conflict));
      button.title = conflict ? tag.note + " " + conflict : tag.note;
    });
  }

  const FORMAT_LABEL = {
    TV: "TV",
    MOVIE: "Movie",
    OVA: "OVA",
    ONA: "ONA",
    SPECIAL: "Special",
    TV_SHORT: "TV short",
    MUSIC: "Music",
  };
  const ORIGIN_LABEL = {
    ORIGINAL: "Original",
    MANGA: "Manga",
    LIGHT_NOVEL: "Light novel",
    VISUAL_NOVEL: "Visual novel",
    NOVEL: "Novel",
    VIDEO_GAME: "Video game",
    GAME: "Game",
    OTHER: "Other",
    WEB_NOVEL: "Web novel",
    DOUJINSHI: "Doujinshi",
    ANIME: "Anime",
    COMIC: "Comic",
    PICTURE_BOOK: "Picture book",
    MULTIMEDIA_PROJECT: "Multimedia project",
  };
  const ROLE_LABEL = { MAIN: "Main", SUPPORTING: "Supporting", BACKGROUND: "Background" };

  function formatLabel(value) {
    return FORMAT_LABEL[value] || String(value || "").replace(/_/g, " ");
  }

  function extLink(href, text) {
    return el("a", { href: href, target: "_blank", rel: "noopener noreferrer", text: text });
  }

  function letterOf(display) {
    const ch = String(display || "").trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : "#";
  }

  function setView(view) {
    state.view = view;
    document.body.dataset.view = view;
    const index = view === "index";
    const people = view === "characters";
    $("form-stack").hidden = index || people;
    $("dock").hidden = index || people;
    $("index-panel").hidden = !index;
    $("info-dock").hidden = !index;
    $("cast-panel").hidden = !people;
    $("cast-dock").hidden = !people;
    $("view-steps").setAttribute("aria-pressed", view === "steps" ? "true" : "false");
    $("view-quick").setAttribute("aria-pressed", view === "quick" ? "true" : "false");
    $("view-index").setAttribute("aria-pressed", view === "index" ? "true" : "false");
    $("view-characters").setAttribute("aria-pressed", people ? "true" : "false");
    const params = new URLSearchParams(location.search);
    if (view === "steps") params.delete("view");
    else params.set("view", view);
    if (view === "index" && state.indexId) params.set("series", state.indexId);
    else params.delete("series");
    const next = params.toString();
    history.replaceState(null, "", location.pathname + (next ? "?" + next : "") + location.hash);
    if (view === "index") renderIndex();
    if (people && characters.length) {
      renderCastBoard();
      $("cast-panel").scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  function imageLabel(count) {
    const n = Number(count) || 0;
    return n === 1 ? "1 image" : n.toLocaleString() + " images";
  }

  function shotTone(count) {
    const max = Math.max(1, shotMax);
    const t = Math.log1p(Math.max(0, Number(count) || 0)) / Math.log1p(max);
    const blue = [43, 108, 184];
    const yellow = [226, 176, 58];
    const red = [194, 59, 46];
    const mix = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const from = t < 0.5 ? blue : yellow;
    const to = t < 0.5 ? yellow : red;
    const rgb = from.map((value, index) => Math.round(value + (to[index] - value) * mix));
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return {
      bg: "rgb(" + rgb.join(",") + ")",
      ink: lum > 0.64 ? "#231e19" : "#fffaf3",
    };
  }

  function shotDot(count) {
    return el("i", { class: "shot-dot", style: "background:" + shotTone(count).bg, "aria-hidden": "true" });
  }

  function shotPill(count) {
    const n = Number(count) || 0;
    const tone = shotTone(n);
    return el("span", {
      class: "shot-count",
      style: "background:" + tone.bg + ";color:" + tone.ink,
      title: n ? "Named in " + n.toLocaleString() + " training stills." : "This name was not written on a training still.",
      text: imageLabel(n),
    });
  }

  function indexRows() {
    const query = state.indexQuery.trim().toLowerCase();
    return catalog
      .filter((series) => {
        if (!query) return true;
        const fields = [
          series.display,
          series.prompt,
          series.native,
          series.year,
          series.format,
          ...(series.aliases || []),
          ...(series.studios || []),
          series.designer && series.designer.name,
        ];
        return fields.some((field) => String(field || "").toLowerCase().includes(query));
      })
      .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: "base", numeric: true }));
  }

  function paintIndexSelection() {
    document.querySelectorAll("#index-list .index-hit").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.id === state.indexId ? "true" : "false");
    });
  }

  function selectIndex(id) {
    state.indexOpen = state.indexOpen === id ? null : id;
    state.indexId = id;
    renderIndex();
    renderInfo();
    const params = new URLSearchParams(location.search);
    params.set("view", "index");
    params.set("series", id);
    history.replaceState(null, "", location.pathname + "?" + params.toString() + location.hash);
  }

  function renderCastFold(series) {
    const cast = series.characters || [];
    const box = el("div", { class: "cast-fold" });
    if (!cast.length) {
      box.append(el("p", { class: "meta", text: "No characters are listed for this title." }));
      return box;
    }
    const people = el("ul", { class: "cast-fold-list" });
    cast.forEach((person) => {
      const item = el("li");
      if (person.imageUrl) {
        const photo = el("img", { src: person.imageUrl, alt: "", width: "40", height: "40", loading: "lazy" });
        photo.addEventListener("error", () => {
          photo.replaceWith(el("span", { class: "cast-ph", "aria-hidden": "true", text: (person.name || "?").charAt(0) }));
        });
        item.append(photo);
      } else {
        item.append(el("span", { class: "cast-ph", "aria-hidden": "true", text: (person.name || "?").charAt(0) }));
      }
      const bits = [ROLE_LABEL[(person.role || "").toUpperCase()] || person.role, person.gender].filter(Boolean);
      const text = el("div", { class: "cast-id" });
      text.append(person.anilistUrl ? extLink(person.anilistUrl, person.name) : el("span", { class: "cast-name", text: person.name }));
      if (person.native) text.append(el("div", { class: "sub", text: person.native }));
      else if (bits.length) text.append(el("div", { class: "sub", text: bits.join(" · ") }));
      item.append(text);
      item.append(shotPill(person.shotCount || 0));
      people.append(item);
    });
    box.append(people);
    return box;
  }

  function renderIndex() {
    const rows = indexRows();
    const present = new Set(rows.map((series) => letterOf(series.display)));
    const letters = ["#"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    const bar = $("az-bar");
    bar.replaceChildren();
    letters.forEach((letter) => {
      const enabled = present.has(letter);
      bar.append(el("button", {
        type: "button",
        text: letter,
        disabled: enabled ? null : "disabled",
        onclick: () => {
          const node = $("letter-" + (letter === "#" ? "num" : letter));
          if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      }));
    });
    const list = $("index-list");
    list.replaceChildren();
    if (!catalog.length) return;
    if (!rows.length) {
      list.append(el("p", { class: "meta", text: "No title matches that." }));
      return;
    }
    let current = "";
    let block = null;
    rows.forEach((series) => {
      const letter = letterOf(series.display);
      if (letter !== current) {
        current = letter;
        block = el("section", { class: "letter-block" });
        block.append(el("h3", { id: "letter-" + (letter === "#" ? "num" : letter), text: letter }));
        list.append(block);
      }
      const open = state.indexOpen === series.id;
      const entry = el("div", { class: open ? "index-entry open" : "index-entry" });
      const count = (series.characters || []).length;
      entry.append(el("button", {
        type: "button",
        class: "index-hit",
        "data-id": series.id,
        "aria-expanded": open ? "true" : "false",
        "aria-pressed": series.id === state.indexId ? "true" : "false",
        onclick: () => selectIndex(series.id),
      }, [
        el("b", { text: series.display }),
        el("span", { text: [series.year, formatLabel(series.format), count ? count + (count === 1 ? " character" : " characters") : ""].filter(Boolean).join(" · ") }),
      ]));
      if (open) entry.append(renderCastFold(series));
      block.append(entry);
    });
  }

  function countAtFraction(fraction) {
    const max = Math.max(1, shotMax);
    const t = Math.min(1, Math.max(0, fraction));
    return Math.expm1(t * Math.log1p(max));
  }

  function fractionForCount(count) {
    const max = Math.max(1, shotMax);
    return Math.log1p(Math.max(0, Number(count) || 0)) / Math.log1p(max);
  }

  function indexForFraction(fraction) {
    if (!castRows.length) return 0;
    const target = countAtFraction(fraction);
    for (let index = 0; index < castRows.length; index += 1) {
      if ((castRows[index].shotCount || 0) <= target) return index;
    }
    return castRows.length - 1;
  }

  function placeThumb(fraction) {
    const track = $("cast-track");
    const thumb = $("cast-thumb");
    if (!track || !thumb) return;
    const horizontal = track.clientWidth > track.clientHeight;
    thumb.style.background = shotTone(countAtFraction(fraction)).bg;
    if (horizontal) {
      thumb.style.left = (fraction * 100) + "%";
      thumb.style.top = "50%";
    } else {
      thumb.style.left = "50%";
      thumb.style.top = ((1 - fraction) * 100) + "%";
    }
    track.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
    track.setAttribute("aria-valuenow", String(Math.round(fraction * 1000)));
  }

  function writeCastReadout(person) {
    const node = $("cast-readout");
    if (!node) return;
    if (!person) {
      node.textContent = "Drag the color bar to move through the list.";
      return;
    }
    node.textContent = person.name + " · " + person.seriesTitle + " · " + imageLabel(person.shotCount || 0);
    const track = $("cast-track");
    if (track) track.setAttribute("aria-valuetext", node.textContent);
  }

  function focusCast(fraction, scroll) {
    castFraction = Math.min(1, Math.max(0, fraction));
    placeThumb(castFraction);
    const index = indexForFraction(castFraction);
    writeCastReadout(castRows[index]);
    if (!scroll) return;
    const node = $("cast-row-" + index);
    if (!node) return;
    castLockUntil = performance.now() + 160;
    node.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function fractionFromPointer(event) {
    const rect = $("cast-track").getBoundingClientRect();
    if (rect.width > rect.height) {
      const x = Math.min(Math.max(event.clientX, rect.left), rect.right);
      return rect.width ? (x - rect.left) / rect.width : 0;
    }
    const y = Math.min(Math.max(event.clientY, rect.top), rect.bottom);
    return rect.height ? 1 - (y - rect.top) / rect.height : 0;
  }

  function sortedCast(query) {
    const q = query.trim().toLowerCase();
    const rows = characters.filter((person) => {
      if (!q) return true;
      return [person.name, person.prompt, person.native, person.seriesTitle, person.year]
        .some((field) => String(field || "").toLowerCase().includes(q));
    });
    rows.sort((a, b) => (b.shotCount || 0) - (a.shotCount || 0)
      || a.name.localeCompare(b.name)
      || String(a.seriesTitle || "").localeCompare(String(b.seriesTitle || "")));
    return rows;
  }

  function watchCastImages() {
    if (castObserver) castObserver.disconnect();
    const pending = document.querySelectorAll("#cast-list img[data-src]");
    if (!("IntersectionObserver" in window)) {
      pending.forEach((img) => {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      });
      return;
    }
    castObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute("data-src");
        }
        castObserver.unobserve(img);
      });
    }, { rootMargin: "600px 0px" });
    pending.forEach((img) => castObserver.observe(img));
  }

  function paintCastAdded() {
    const seen = new Set(state.characters.map((person) => person.seriesId + ":" + person.prompt));
    document.querySelectorAll("#cast-list .cast-row").forEach((row) => {
      const button = row.querySelector(".cast-add");
      if (!button) return;
      const on = seen.has(row.dataset.key);
      button.textContent = on ? "Added" : "Add to caption";
      button.disabled = on;
    });
  }

  function renderCastBoard() {
    const list = $("cast-list");
    if (!list) return;
    castRows = sortedCast(state.castQuery || "");
    list.replaceChildren();
    if (!castRows.length) {
      list.append(el("p", { class: "meta", text: "No character matches that." }));
    }
    const seen = new Set(state.characters.map((person) => person.seriesId + ":" + person.prompt));
    castRows.forEach((person, index) => {
      const n = person.shotCount || 0;
      const row = el("article", {
        class: "cast-row",
        id: "cast-row-" + index,
        "data-count": String(n),
        "data-key": person.seriesId + ":" + person.prompt,
      });
      row.style.borderLeftColor = shotTone(n).bg;
      if (person.imageUrl) {
        const photo = el("img", { alt: "", width: "56", height: "56", "data-src": person.imageUrl });
        photo.addEventListener("error", () => {
          photo.replaceWith(el("span", { class: "cast-ph", "aria-hidden": "true", text: (person.name || "?").charAt(0) }));
        });
        row.append(photo);
      } else {
        row.append(el("span", { class: "cast-ph", "aria-hidden": "true", text: (person.name || "?").charAt(0) }));
      }
      const text = el("div", { class: "cast-main" });
      const who = el("div", { class: "who" });
      who.append(person.anilistUrl ? extLink(person.anilistUrl, person.name) : el("span", { class: "cast-name", text: person.name }));
      who.append(shotPill(n));
      text.append(who);
      const bits = [
        person.seriesTitle,
        person.year,
        ROLE_LABEL[(person.role || "").toUpperCase()] || person.role,
      ].filter(Boolean);
      text.append(el("div", { class: "sub", text: bits.join(" · ") }));
      if (person.native) text.append(el("div", { class: "sub", text: person.native }));
      row.append(text);
      const key = person.seriesId + ":" + person.prompt;
      row.append(el("button", {
        type: "button",
        class: "btn ghost cast-add",
        text: seen.has(key) ? "Added" : "Add to caption",
        disabled: seen.has(key) ? "disabled" : null,
        onclick: () => {
          addCharacter(person);
          const note = person.name + " is written as “" + person.prompt + "”. " + imageLabel(n) + " in the training pack used that name.";
          setWhy(note);
          render();
          $("cast-status").textContent = person.name + " added. " + imageLabel(n) + " in the training pack used that name.";
        },
      }));
      list.append(row);
    });
    const named = characters.filter((person) => (person.shotCount || 0) > 0).length;
    $("cast-status").textContent = state.castQuery
      ? castRows.length.toLocaleString() + " match."
      : characters.length.toLocaleString() + " characters. " + named.toLocaleString() + " were named on at least one training still.";
    const high = $("cast-high");
    if (high) high.textContent = imageLabel(shotMax);
    watchCastImages();
    focusCast(castRows.length ? 1 : 0, false);
  }

  function syncSliderToScroll() {
    if (state.view !== "characters" || performance.now() < castLockUntil) return;
    const nodes = document.querySelectorAll("#cast-list .cast-row");
    if (!nodes.length) return;
    const line = 140;
    let low = 0;
    let high = nodes.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (nodes[mid].getBoundingClientRect().top <= line) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    castFraction = fractionForCount(Number(nodes[index].dataset.count) || 0);
    placeThumb(castFraction);
    writeCastReadout(castRows[index]);
  }

  function infoRow(table, label, value) {
    if (value == null || value === "") return;
    const tr = el("tr");
    tr.append(el("th", { text: label, scope: "row" }));
    const cell = el("td");
    cell.append(value.nodeType ? value : document.createTextNode(String(value)));
    tr.append(cell);
    table.append(tr);
  }

  function renderInfo() {
    const intro = $("info-dock").querySelector(".explain");
    const host = $("info-body");
    const series = state.indexId ? byId.get(state.indexId) : null;
    host.replaceChildren();
    if (!series) {
      $("info-title").textContent = "Series record";
      intro.hidden = false;
      return;
    }
    intro.hidden = true;
    $("info-title").textContent = series.display;
    if (series.native) host.append(el("p", { class: "meta", text: series.native }));
    if (series.anilistUrl) {
      host.append(el("p", { class: "row" }, [extLink(series.anilistUrl, "Open on Anilist")]));
    }
    host.append(el("p", { class: "meta" }, [
      "Caption token ",
      el("span", { class: "token", text: series.prompt }),
    ]));
    const table = el("table", { class: "slots" });
    infoRow(table, "Year", series.year ? String(series.year) : "");
    infoRow(table, "Decade", series.decade || "");
    infoRow(table, "Format", formatLabel(series.format));
    infoRow(table, "Episodes", series.episodes ? String(series.episodes) : "");
    infoRow(table, "Length", series.episodeMinutes ? series.episodeMinutes + " min" : "");
    const aired = [series.startDate, series.endDate].filter(Boolean).join(" – ");
    infoRow(table, "Aired", aired);
    infoRow(table, "Source", ORIGIN_LABEL[series.origin] || series.origin || "");
    const scan = [
      series.height ? series.height + "p" : "",
      series.hires ? "hires" : "lowres",
      series.scan || "",
    ].filter(Boolean).join(" · ");
    infoRow(table, "Scan", scan);
    const studios = series.studioLinks && series.studioLinks.length
      ? series.studioLinks
      : (series.studios || []).map((name) => ({ name: name, url: "" }));
    if (studios.length) {
      const line = el("span");
      studios.forEach((studio, index) => {
        if (index) line.append(", ");
        line.append(studio.url ? extLink(studio.url, studio.name) : studio.name);
      });
      infoRow(table, studios.length > 1 ? "Studios" : "Studio", line);
    }
    if (series.designers && series.designers.length) {
      const line = el("span");
      series.designers.forEach((person, index) => {
        if (index) line.append(", ");
        line.append(person.anilistUrl ? extLink(person.anilistUrl, person.name) : person.name);
      });
      infoRow(table, "Designer", line);
    }
    const castCount = (series.characters || []).length;
    infoRow(table, "Characters", castCount ? String(castCount) : "");
    host.append(table);
    const aliases = (series.aliases || []).filter((name) => name && name !== series.display);
    if (aliases.length) {
      host.append(el("p", { class: "meta", text: "Also known as " + aliases.join(", ") + "." }));
    }
    const shared = (promptUses.get(series.prompt) || []).filter((item) => item.id !== series.id);
    if (shared.length) {
      host.append(el("p", { class: "warn", text: "The caption token is shared with " + shared.map((item) => item.display).join(", ") + "." }));
    }
    if (state.seriesId === series.id) {
      host.append(el("p", { class: "meta", text: "This series is already in the caption." }));
    }
    host.append(el("button", {
      type: "button",
      class: "btn primary",
      text: "Use in the caption",
      onclick: () => {
        selectSeries(series.id);
        setWhy(series.display + " filled the year, scan size, and character designer, unless those slots were set by hand.");
        setView("steps");
        render();
      },
    }));
  }

  function selectedBodyTags() {
    const rows = [];
    TAGS.counts.forEach((tag) => {
      if (state.counts.includes(tag.id)) rows.push({ id: tag.id, group: "count", note: tag.note });
    });
    TAGS.groups.forEach((group) => {
      const picked = state.tags[group.id] || [];
      group.tags.forEach((tag) => {
        if (picked.includes(tag.id)) rows.push({ id: tag.id, group: group.id, note: tag.note });
      });
    });
    return rows;
  }

  function searchBodyTags(query) {
    const rows = [];
    TAGS.counts.forEach((tag) => rows.push({ id: tag.id, note: tag.note, group: "count", groupTitle: "Count" }));
    TAGS.groups.forEach((group) => {
      group.tags.forEach((tag) => rows.push({ id: tag.id, note: tag.note, group: group.id, groupTitle: group.title }));
    });
    return rows
      .map((tag) => ({ tag: tag, score: rank(query, [tag.id, tag.groupTitle]) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.tag.id.localeCompare(b.tag.id))
      .slice(0, 30)
      .map((row) => row.tag);
  }

  function renderQuickTags() {
    const box = $("quick-desc");
    box.hidden = state.bodyMode !== "tags";
    const chips = $("quick-tag-chips");
    chips.replaceChildren();
    const picked = selectedBodyTags();
    if (!picked.length) {
      chips.append(el("p", { class: "meta", text: "No description tags yet." }));
    }
    picked.forEach((tag) => {
      const chip = el("span", { class: "chip" });
      chip.append(tag.id);
      chip.append(el("button", {
        type: "button",
        "aria-label": "Remove " + tag.id,
        text: "×",
        onclick: () => {
          if (tag.group === "count") toggleList(state.counts, tag.id);
          else toggleList(state.tags[tag.group], tag.id);
          setWhy(tag.note);
          render();
        },
      }));
      chips.append(chip);
    });
  }

  function render() {
    const view = resolved();
    renderCaption(view);
    renderSeriesCard(view);
    renderYear(view);
    renderCast();
    renderDesigner(view);
    renderSource(view);
    renderModes();
    renderTagPressed(view);
    renderQuickTags();
    if (state.view === "index") {
      paintIndexSelection();
      renderInfo();
    }
    if (state.view === "characters") paintCastAdded();
  }

  function toggleList(list, id) {
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
    else list.push(id);
  }

  function insertIntoSentence(text) {
    const box = $("sentence");
    const start = box.selectionStart == null ? box.value.length : box.selectionStart;
    const end = box.selectionEnd == null ? start : box.selectionEnd;
    const before = box.value.slice(0, start);
    const after = box.value.slice(end);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = before + pad + text + after;
    state.sentence = next;
    box.value = next;
    const caret = (before + pad + text).length;
    box.focus();
    box.setSelectionRange(caret, caret);
  }

  function buildTagBoard() {
    const board = $("tag-board");
    const countGroup = el("section", { class: "tag-group", "data-group": "count" });
    countGroup.append(el("h3", { text: "Count" }), el("p", { text: "Goes at the front of a tag description. Leave it empty if you do not want a count." }));
    const countWrap = el("div", { class: "tags" });
    TAGS.counts.forEach((tag) => {
      countWrap.append(el("button", {
        type: "button",
        class: "tag",
        "data-group": "count",
        "data-tag": tag.id,
        text: tag.id,
        title: tag.note,
        onclick: () => {
          if (state.bodyMode === "sentence") {
            insertIntoSentence(tag.id);
            setWhy(tag.note);
            render();
            return;
          }
          toggleList(state.counts, tag.id);
          setWhy(tag.note);
          render();
        },
      }));
    });
    countGroup.append(countWrap);
    board.append(countGroup);

    TAGS.groups.forEach((group) => {
      const section = el("section", { class: "tag-group", "data-group": group.id });
      section.append(el("h3", { text: group.title }), el("p", { text: group.note }));
      const wrap = el("div", { class: "tags" });
      group.tags.forEach((tag) => {
        wrap.append(el("button", {
          type: "button",
          class: "tag",
          "data-group": group.id,
          "data-tag": tag.id,
          text: tag.id,
          title: tag.note,
          onclick: () => {
            if (state.bodyMode === "sentence") {
              insertIntoSentence(tag.id);
              setWhy(tag.note);
              render();
              return;
            }
            toggleList(state.tags[group.id], tag.id);
            setWhy(tag.note);
            render();
          },
        }));
      });
      section.append(wrap);
      board.append(section);
    });

    const quality = $("quality-board");
    const painted = TAGS.quality.filter((tag) => tag.tier !== "lo");
    const tape = TAGS.quality.filter((tag) => tag.tier === "lo");
    [
      ["Painted cel and print", "Kept on hires captions. Grain, dust, and fade were also used on lowres stills.", painted],
      ["Broadcast and tape", "Kept on lowres captions. The pack stripped these from hires stills.", tape],
    ].forEach(([title, note, list]) => {
      const section = el("section");
      section.append(el("h3", { text: title }), el("p", { class: "meta", text: note }));
      const wrap = el("div", { class: "tags" });
      list.forEach((tag) => {
        wrap.append(el("button", {
          type: "button",
          class: "tag",
          "data-tag": tag.id,
          text: tag.id,
          title: tag.note,
          onclick: () => {
            toggleList(state.quality, tag.id);
            const view = resolved();
            const conflict = qualityConflict(tag, view.source);
            setWhy(conflict ? tag.note + " " + conflict : tag.note);
            render();
          },
        }));
      });
      section.append(wrap);
      quality.append(section);
    });
  }

  function applyFilter() {
    const query = $("tag-filter").value.trim().toLowerCase();
    document.querySelectorAll("#tag-board .tag-group").forEach((group) => {
      let shown = 0;
      group.querySelectorAll(".tag").forEach((button) => {
        const match = !query || button.dataset.tag.includes(query);
        button.hidden = !match;
        if (match) shown += 1;
      });
      group.hidden = shown === 0;
    });
  }

  function chooseSource(value) {
    const series = currentSeries();
    const packed = seriesSource(series);
    if (value === "none") state.sourceMode = "none";
    else if (packed && packed === value) state.sourceMode = "auto";
    else state.sourceMode = value;
    setWhy(value === "hires"
      ? "hires marks a 720p-or-taller scan. It is written after the description."
      : value === "lowres"
        ? "lowres marks a smaller television or tape scan."
        : "Scan size removed from the caption.");
    render();
  }

  const TEMPLATES = [
    {
      id: "empty",
      name: "Empty caption",
      blurb: "Prefix only. Add only the slots you want.",
      apply() {
        resetState();
        setWhy("Only the prefix is in the caption. Turn it off in the prefix section if you want the box completely clear.");
      },
    },
    {
      id: "anne",
      name: "Named heroine",
      blurb: "Anne, 1979, hires cel. Edit the description.",
      apply() {
        resetState();
        selectSeries("akage-no-anne");
        const anne = findCharacter("akage-no-anne", "anne shirley");
        if (anne) addCharacter(anne);
        state.counts = ["1girl"];
        state.tags.hair = ["long hair", "red hair"];
        state.tags.clothing = ["dress"];
        state.tags.place = ["outdoors"];
        state.quality = ["hq cel animation"];
        state.template = "anne";
        setWhy("A named character is written before the series. hq cel animation is the default hires quality tag.");
      },
    },
    {
      id: "cats",
      name: "Television frame",
      blurb: "Cat's Eye, three sisters, lowres tape.",
      apply() {
        resetState();
        selectSeries("cats-eye-s2");
        ["hitomi kisugi", "ai kisugi", "rui kisugi"].forEach((prompt) => {
          const person = findCharacter("cats-eye-s2", prompt);
          if (person) addCharacter(person);
        });
        state.counts = ["3girls"];
        state.quality = ["film grain", "soft focus"];
        state.template = "cats";
        setWhy("This series was packed as lowres. Grain and soft focus describe the scan. They do not replace the decade.");
      },
    },
    {
      id: "castle",
      name: "Film still, no name",
      blurb: "Castle in the Sky. Place and shot, no cast.",
      apply() {
        resetState();
        selectSeries("castle-in-the-sky");
        state.tags.shot = ["wide shot"];
        state.tags.place = ["outdoors", "sky"];
        state.quality = ["hq cel animation", "clean lineart"];
        state.template = "castle";
        setWhy("No character is a normal training caption. The designer still comes from the series until you clear it.");
      },
    },
    {
      id: "mecha",
      name: "Mecha, no people",
      blurb: "Char's Counterattack. Cockpit, no cast.",
      apply() {
        resetState();
        selectSeries("gundam-cca");
        state.counts = ["no humans"];
        state.tags.place = ["mecha", "cockpit", "night"];
        state.quality = ["hq cel animation"];
        state.template = "mecha";
        setWhy("no humans keeps a robot frame from growing a person. The series token is the title before the colon.");
      },
    },
    {
      id: "sentence",
      name: "One sentence",
      blurb: "Vampire Hunter D, described in prose.",
      apply() {
        resetState();
        selectSeries("vampire-hunter-d");
        const hunter = findCharacter("vampire-hunter-d", "d");
        if (hunter) addCharacter(hunter);
        state.bodyMode = "sentence";
        state.sentence = "a pale hunter in a wide dark hat and black cape, shown from the chest up against a night sky";
        state.quality = ["hq cel animation"];
        state.template = "sentence";
        setWhy("Sentence captions replace the tag list. The name, series, scan, and designer stay in their own slots.");
      },
    },
  ];

  function renderTemplates() {
    const host = $("template-row");
    TEMPLATES.forEach((template) => {
      host.append(el("button", {
        type: "button",
        class: "template",
        "data-id": template.id,
        "aria-pressed": "false",
        onclick: () => {
          template.apply();
          if (template.id !== "empty") state.template = template.id;
          render();
        },
      }, [el("b", { text: template.name }), el("span", { text: template.blurb })]));
    });
  }

  function wire() {
    renderTemplates();
    buildTagBoard();

    $("view-steps").addEventListener("click", () => {
      setView("steps");
      render();
    });
    $("view-quick").addEventListener("click", () => {
      setView("quick");
      render();
    });
    $("view-index").addEventListener("click", () => {
      setView("index");
      render();
    });
    $("view-characters").addEventListener("click", () => {
      setView("characters");
      render();
    });
    $("index-filter").addEventListener("input", () => {
      state.indexQuery = $("index-filter").value;
      renderIndex();
    });
    $("cast-filter").addEventListener("input", () => {
      state.castQuery = $("cast-filter").value;
      if (state.view === "characters") renderCastBoard();
    });
    const track = $("cast-track");
    let dragging = false;
    track.addEventListener("pointerdown", (event) => {
      dragging = true;
      track.setPointerCapture(event.pointerId);
      focusCast(fractionFromPointer(event), true);
    });
    track.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      focusCast(fractionFromPointer(event), true);
    });
    track.addEventListener("pointerup", () => { dragging = false; });
    track.addEventListener("pointercancel", () => { dragging = false; });
    track.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      if (event.key === "ArrowUp" || event.key === "ArrowRight" || event.key === "PageUp") {
        event.preventDefault();
        focusCast(castFraction + step, true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "PageDown") {
        event.preventDefault();
        focusCast(castFraction - step, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusCast(0, true);
      } else if (event.key === "End") {
        event.preventDefault();
        focusCast(1, true);
      }
    });
    let castFrame = 0;
    window.addEventListener("scroll", () => {
      if (castFrame) return;
      castFrame = requestAnimationFrame(() => {
        castFrame = 0;
        syncSliderToScroll();
      });
    }, { passive: true });
    window.addEventListener("resize", () => {
      if (state.view === "characters") placeThumb(castFraction);
    });
    attachCombo($("quick-tag-input"), $("quick-tag-menu"), {
      empty: "No tag matches that.",
      items: searchBodyTags,
      render(row, tag) {
        renderOption(row, tag.id, tag.groupTitle);
      },
      pick(tag) {
        if (tag.group === "count") {
          if (!state.counts.includes(tag.id)) state.counts.push(tag.id);
        } else if (!(state.tags[tag.group] || []).includes(tag.id)) {
          state.tags[tag.group].push(tag.id);
        }
        setWhy(tag.note);
        render();
      },
    });

    attachCombo($("series-input"), $("series-menu"), {
      empty: "No series matches that.",
      items: searchSeries,
      render(row, series) {
        const shared = (promptUses.get(series.prompt) || []).length > 1;
        renderOption(
          row,
          series.display,
          [series.year, series.hires ? "hires" : "lowres", series.designer && series.designer.name, shared ? "token " + series.prompt : ""]
            .filter(Boolean)
            .join(" · ")
        );
      },
      pick(series) {
        selectSeries(series.id);
        const held = [];
        if (state.yearMode !== "auto") held.push("the year");
        if (state.designerMode !== "auto") held.push("the designer");
        if (state.sourceMode !== "auto") held.push("the scan size");
        setWhy(held.length
          ? series.display + " is selected. It did not replace " + held.join(", ") + ", because those are set by hand."
          : series.display + " filled the year, decade, scan size, and character designer. Change any of them below.");
        render();
      },
    });

    attachCombo($("cast-input"), $("cast-menu"), {
      empty: "No character matches that.",
      items: searchCast,
      render(row, person) {
        const images = imageLabel(person.shotCount || 0);
        renderOption(
          row,
          person.name,
          [person.role && person.role.toLowerCase(), person.gender, person.seriesTitle, person.year, images].filter(Boolean).join(" · ")
        );
        const sub = row.querySelector(".opt-sub");
        if (sub) sub.prepend(shotDot(person.shotCount || 0));
      },
      pick(person) {
        addCharacter(person);
        setWhy(person.name + " is written as “" + person.prompt + "”, before the series name.");
        render();
      },
    });

    attachCombo($("designer-input"), $("designer-menu"), {
      empty: "No designer matches. Press Enter to use what you typed.",
      items: searchDesigners,
      render(row, person) {
        const sample = person.credits.slice(0, 2).map((credit) => credit.title).join(", ");
        renderOption(row, person.name, sample || person.prompt);
      },
      pick(person) {
        const credit = person.credits[0];
        state.designerMode = "manual";
        state.designerManual = { name: person.name, prompt: person.prompt, role: credit ? credit.role : "" };
        setWhy("Manual designer “" + person.prompt + "”. Reset puts the series designer back.");
        render();
      },
      pickRaw(text) {
        const name = text.trim();
        if (!name) return;
        state.designerMode = "manual";
        state.designerManual = { name, prompt: norm(name), role: "" };
        setWhy("Custom designer. The caption uses the lowercased name.");
        render();
      },
    });

    $("prefix-toggle").addEventListener("change", () => {
      state.prefix = $("prefix-toggle").checked;
      setWhy(state.prefix
        ? "anime screenshot is the first token of every training caption."
        : "Prefix removed. The model always saw this word first during training.");
      render();
    });

    $("year-input").addEventListener("input", () => {
      const raw = $("year-input").value.replace(/\D/g, "").slice(0, 4);
      if ($("year-input").value !== raw) $("year-input").value = raw;
      if (!raw) {
        state.yearMode = "none";
        state.yearManual = "";
      } else {
        state.yearMode = "manual";
        state.yearManual = raw;
      }
      setWhy("Manual year. Reset returns the series year. The decade follows a four-digit year.");
      render();
    });
    $("year-reset").addEventListener("click", () => {
      state.yearMode = "auto";
      state.yearManual = "";
      setWhy("Year follows the series again.");
      render();
    });
    $("year-omit").addEventListener("click", () => {
      state.yearMode = "none";
      state.yearManual = "";
      setWhy("Year and decade are both left out.");
      render();
    });
    $("decade-toggle").addEventListener("change", () => {
      state.includeDecade = $("decade-toggle").checked;
      setWhy(state.includeDecade ? "The decade tag is written after the year." : "Decade removed. The year can stay on its own.");
      render();
    });

    $("cast-all").addEventListener("change", () => {
      setWhy($("cast-all").checked
        ? "Character search now covers every series."
        : "Character search is limited to the selected series.");
    });
    $("cast-clear").addEventListener("click", () => {
      state.characters = [];
      setWhy("Cast cleared. Count tags, if you added any, are still in the description.");
      render();
    });

    $("mode-tags").addEventListener("click", () => {
      state.bodyMode = "tags";
      setWhy("Tag mode. The description is the tags you toggle, in a fixed order.");
      render();
    });
    $("mode-sentence").addEventListener("click", () => {
      state.bodyMode = "sentence";
      setWhy("Sentence mode. The tag buttons insert words. They are not added as their own caption.");
      render();
    });
    $("sentence").addEventListener("input", () => {
      state.sentence = $("sentence").value;
      state.bodyMode = "sentence";
      render();
    });
    $("extra").addEventListener("input", () => {
      state.extra = $("extra").value;
      setWhy("Extra words are lowercased and placed at the end of the description, before the scan size.");
      render();
    });
    $("tag-filter").addEventListener("input", applyFilter);

    $("source-hi").addEventListener("click", () => chooseSource("hires"));
    $("source-lo").addEventListener("click", () => chooseSource("lowres"));
    $("source-omit").addEventListener("click", () => chooseSource("none"));
    $("source-reset").addEventListener("click", () => {
      state.sourceMode = "auto";
      setWhy("Scan size follows the series again.");
      render();
    });

    $("copy-btn").addEventListener("click", async () => {
      const text = $("caption-text").value;
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        $("caption-text").focus();
        $("caption-text").select();
        document.execCommand("copy");
      }
      $("copy-status").textContent = "Copied";
      window.setTimeout(() => {
        if ($("copy-status").textContent === "Copied") $("copy-status").textContent = "";
      }, 1600);
    });
  }

  function indexCatalog(data) {
    catalog = data.series || [];
    byId = new Map(catalog.map((series) => [series.id, series]));
    promptUses = new Map();
    characters = [];
    const designerMap = new Map();
    catalog.forEach((series) => {
      const list = promptUses.get(series.prompt) || [];
      list.push(series);
      promptUses.set(series.prompt, list);
      (series.characters || []).forEach((person) => {
        characters.push({
          ...person,
          seriesId: series.id,
          seriesTitle: series.display,
          year: series.year,
        });
      });
      (series.designers || []).forEach((person) => {
        let row = designerMap.get(person.prompt);
        if (!row) {
          row = { name: person.name, prompt: person.prompt, credits: [] };
          designerMap.set(person.prompt, row);
        }
        row.credits.push({
          seriesId: series.id,
          title: series.display,
          role: person.role || "",
          year: series.year,
        });
      });
    });
    designers = [...designerMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    shotMax = characters.reduce((max, person) => Math.max(max, Number(person.shotCount) || 0), 1);
  }

  async function main() {
    if (window.matchMedia("(max-width: 980px)").matches) {
      const details = document.querySelector("#dock details");
      if (details) details.open = false;
    }
    const params = new URLSearchParams(location.search);
    wire();
    const requestedView = params.get("view");
    if (requestedView === "quick" || requestedView === "index" || requestedView === "characters") setView(requestedView);
    try {
      const response = await fetch("assets/data.json");
      if (!response.ok) throw new Error("Catalog request failed");
      const data = await response.json();
      indexCatalog(data);
      const castCount = characters.length;
      const foot = $("foot");
      foot.replaceChildren(
        document.createTextNode(
          catalog.length + " series and " + castCount + " characters from the training catalog. Nothing is uploaded. The same builder is a "
        )
      );
      const nodeLink = document.createElement("a");
      nodeLink.href = "https://github.com/zetaneko/vintageanime-comfyui";
      nodeLink.textContent = "ComfyUI node";
      foot.append(nodeLink, document.createTextNode("."));
      const seriesParam = params.get("series");
      if (seriesParam && byId.has(seriesParam)) {
        state.indexId = seriesParam;
        state.indexOpen = seriesParam;
        if (state.view !== "index" && state.view !== "characters") setView("index");
      }
      renderIndex();
      if (state.view === "characters") renderCastBoard();
      const starter = TEMPLATES.find((item) => item.id === params.get("template"));
      if (starter) {
        starter.apply();
        if (starter.id !== "empty") state.template = starter.id;
      }
      render();
    } catch (error) {
      $("template-row").before(el("p", {
        class: "error",
        text: "The series catalog did not load. Open this page through a local server or GitHub Pages, not as a loose file.",
      }));
    }
  }

  main();
})();
