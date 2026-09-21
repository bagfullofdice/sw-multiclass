const MODULE_ID = "sw-multiclass";
const FLAG_ROOT = "classProgression";

const DEFAULTS = {
  enabled: false,
  mode: "multiclass",
  syncSystemFields: true,
  collapsed: true,
  sharedXp: 0,
  xpRemainderCursor: 0,
  lastDistributedSharedXp: -1,
  classes: []
};

const MODE_LABELS = {
  multiclass: "Multi-Class",
  dualclass: "Dual-Class"
};

function getRoot(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html[0] instanceof HTMLElement) return html[0];
  return null;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeId() {
  return foundry.utils.randomID(8);
}

function normalizeClassEntry(entry = {}) {
  return {
    id: entry.id || makeId(),
    name: String(entry.name || "").trim(),
    level: Math.max(0, asNumber(entry.level, 1)),
    xp: Math.max(0, asNumber(entry.xp, 0)),
    nextLevelXp: Math.max(0, asNumber(entry.nextLevelXp, 0)),
    xpBonus: asNumber(entry.xpBonus, 0),
    status: entry.status === "former" ? "former" : "active"
  };
}

function getProgression(actor) {
  const stored = actor.getFlag(MODULE_ID, FLAG_ROOT) ?? {};
  const data = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), stored, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });

  data.classes = Array.isArray(data.classes)
    ? data.classes.map(normalizeClassEntry)
    : [];
  data.sharedXp = Math.max(0, asNumber(data.sharedXp, 0));
  data.mode = data.mode === "dualclass" ? "dualclass" : "multiclass";
  data.enabled = Boolean(data.enabled);
  data.syncSystemFields = data.syncSystemFields !== false;
  data.collapsed = data.collapsed !== false;
  data.xpRemainderCursor = Math.max(0, Math.floor(asNumber(data.xpRemainderCursor, 0)));
  data.lastDistributedSharedXp = Math.floor(asNumber(data.lastDistributedSharedXp, -1));
  return data;
}

function seedFromActor(actor, data) {
  if (data.classes.length) return data;

  const className = String(actor.system?.class || "").trim() || "Fighter";
  const level = Math.max(1, asNumber(actor.system?.level?.value, 1));
  const xp = Math.max(0, asNumber(actor.system?.xp?.value, 0));
  const xpBonus = asNumber(actor.system?.xpBonus?.value, 0);

  data.classes = [{
    id: makeId(),
    name: className,
    level,
    xp,
    nextLevelXp: 0,
    xpBonus,
    status: "active"
  }];
  data.sharedXp = xp;
  data.xpRemainderCursor = 0;
  data.lastDistributedSharedXp = xp;
  return data;
}

async function saveProgression(actor, data) {
  const clean = {
    enabled: Boolean(data.enabled),
    mode: data.mode === "dualclass" ? "dualclass" : "multiclass",
    syncSystemFields: data.syncSystemFields !== false,
    collapsed: data.collapsed !== false,
    sharedXp: Math.max(0, Math.floor(asNumber(data.sharedXp, 0))),
    xpRemainderCursor: Math.max(0, Math.floor(asNumber(data.xpRemainderCursor, 0))),
    lastDistributedSharedXp:
      data.lastDistributedSharedXp < 0
        ? -1
        : Math.max(0, Math.floor(asNumber(data.lastDistributedSharedXp, 0))),
    classes: (data.classes || []).map(normalizeClassEntry)
  };

  await actor.setFlag(MODULE_ID, FLAG_ROOT, clean);
  if (clean.enabled && clean.syncSystemFields) await syncCompatibilityFields(actor, clean);
  return clean;
}

function distributeSharedXp(data, { reset = false } = {}) {
  if (data.mode !== "multiclass") return;
  const activeClasses = data.classes.filter(c => c.status === "active");
  if (!activeClasses.length) return;

  const totalXp = Math.max(0, Math.floor(asNumber(data.sharedXp, 0)));
  const count = activeClasses.length;
  let cursor = Math.max(0, Math.floor(asNumber(data.xpRemainderCursor, 0))) % count;

  if (reset || data.lastDistributedSharedXp < 0) {
    const share = Math.floor(totalXp / count);
    const remainder = totalXp % count;

    for (const entry of activeClasses) entry.xp = share;
    for (let i = 0; i < remainder; i++) {
      activeClasses[(cursor + i) % count].xp += 1;
    }

    data.xpRemainderCursor = (cursor + remainder) % count;
    data.lastDistributedSharedXp = totalXp;
    return;
  }

  const previousTotal = Math.max(0, Math.floor(asNumber(data.lastDistributedSharedXp, totalXp)));
  const delta = totalXp - previousTotal;

  if (delta > 0) {
    const share = Math.floor(delta / count);
    const remainder = delta % count;

    for (const entry of activeClasses) entry.xp += share;
    for (let i = 0; i < remainder; i++) {
      activeClasses[(cursor + i) % count].xp += 1;
    }

    cursor = (cursor + remainder) % count;
  } else if (delta < 0) {
    const share = Math.floor(totalXp / count);
    const remainder = totalXp % count;

    for (const entry of activeClasses) entry.xp = share;
    for (let i = 0; i < remainder; i++) {
      activeClasses[(cursor + i) % count].xp += 1;
    }

    cursor = (cursor + remainder) % count;
  }

  data.xpRemainderCursor = cursor;
  data.lastDistributedSharedXp = totalXp;
}

function getActiveClasses(data) {
  if (data.mode === "multiclass") return data.classes.filter(c => c.status !== "former");
  const active = data.classes.filter(c => c.status === "active");
  return active.length ? [active[active.length - 1]] : [];
}

function displayClassName(data) {
  if (!data.classes.length) return "";
  if (data.mode === "multiclass") {
    return data.classes
      .filter(c => c.status !== "former")
      .map(c => c.name || "Unnamed")
      .join(" / ");
  }

  const former = data.classes.filter(c => c.status === "former").map(c => c.name || "Unnamed");
  const active = getActiveClasses(data).map(c => c.name || "Unnamed");
  if (!former.length) return active.join(" / ");
  return `${former.join(" → ")} → ${active.join(" / ")}`;
}

function displayLevel(data) {
  if (!data.classes.length) return "";
  if (data.mode === "multiclass") {
    return data.classes
      .filter(c => c.status !== "former")
      .map(c => Math.max(0, asNumber(c.level, 0)))
      .join(" / ");
  }

  const former = data.classes.filter(c => c.status === "former").map(c => Math.max(0, asNumber(c.level, 0)));
  const active = getActiveClasses(data).map(c => Math.max(0, asNumber(c.level, 0)));
  if (!former.length) return active.join(" / ");
  return `${former.join(" → ")} → ${active.join(" / ")}`;
}

async function syncCompatibilityFields(actor, data) {
  const activeClasses = getActiveClasses(data);
  const current = activeClasses[0] ?? data.classes[0];

  // S&W 4.2.x defines level/xp as StringFields, but its character-sheet
  // inputs use data-dtype="Number". Foundry therefore coerces those fields
  // numerically on submission. Composite values such as "3 / 2" become NaN.
  // Keep the stock fields numeric-only and use this module's panel for the
  // real per-class display.
  const update = {
    "system.class": displayClassName(data)
  };

  if (data.mode === "multiclass") {
    const levels = activeClasses.map(c => Math.max(0, asNumber(c.level, 0)));
    const compatibilityLevel = levels.length ? Math.max(...levels) : 0;

    update["system.level.value"] = String(compatibilityLevel);
    update["system.xp.value"] = String(Math.max(0, asNumber(data.sharedXp, 0)));

    const bonuses = activeClasses.map(c => asNumber(c.xpBonus, 0));
    if (bonuses.length && bonuses.every(v => v === bonuses[0])) {
      update["system.xpBonus.value"] = String(bonuses[0]);
    }
  } else if (current) {
    update["system.level.value"] = String(Math.max(0, asNumber(current.level, 0)));
    update["system.xp.value"] = String(Math.max(0, asNumber(current.xp, 0)));
    update["system.xpBonus.value"] = String(asNumber(current.xpBonus, 0));
  }

  await actor.update(update);
}

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function classRow(entry, index, mode) {
  return `
    <div class="mbrc-class-row" data-class-id="${esc(entry.id)}">
      <div class="mbrc-class-drag">${index + 1}</div>
      <label class="mbrc-class-name">
        <span>Class</span>
        <input type="text" data-mbrc-class-field="name" value="${esc(entry.name)}" placeholder="Class name">
      </label>
      <label>
        <span>Level</span>
        <input type="number" min="0" step="1" data-mbrc-class-field="level" value="${entry.level}">
      </label>
      <label>
        <span>XP</span>
        <input type="number" min="0" step="1" data-mbrc-class-field="xp" value="${entry.xp}">
      </label>
      <label>
        <span>Next Level XP</span>
        <input type="number" min="0" step="1" data-mbrc-class-field="nextLevelXp" value="${entry.nextLevelXp}">
      </label>
      <label>
        <span>XP Bonus %</span>
        <input type="number" step="1" data-mbrc-class-field="xpBonus" value="${entry.xpBonus}">
      </label>
      <label class="mbrc-active-field">
        <span>Active</span>
        <input type="checkbox" data-mbrc-class-field="active" ${entry.status === "active" ? "checked" : ""}>
      </label>
      <button type="button" class="mbrc-icon-button mbrc-remove-class" title="Remove class" aria-label="Remove class">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;
}

function makeProgressionPanel(actor, data) {
  const section = document.createElement("section");
  section.className = "mbrc-progression";
  section.dataset.mbrcProgressionActor = actor.id;

  section.innerHTML = `
    <div class="mbrc-progression-title">
      <span class="mbrc-progression-icon"><i class="fas fa-layer-group"></i></span>
      <strong>Class Progression</strong>
      <div class="mbrc-title-summary">
        <span>${esc(displayClassName(data) || "No classes")}</span>
        <span>Lvl ${esc(displayLevel(data) || "—")}</span>
      </div>
      <button type="button" class="mbrc-collapse-toggle" title="${data.collapsed ? "Expand" : "Collapse"} class progression" aria-label="${data.collapsed ? "Expand" : "Collapse"} class progression">
        <i class="fas fa-chevron-${data.collapsed ? "down" : "up"}"></i>
      </button>
      <label class="mbrc-enable-toggle">
        <input type="checkbox" data-mbrc-progression-field="enabled" ${data.enabled ? "checked" : ""}>
        <span>Enable</span>
      </label>
    </div>

    <div class="mbrc-progression-body ${data.enabled ? "" : "mbrc-progression-disabled"} ${data.collapsed ? "mbrc-collapsed" : ""}">
      <div class="mbrc-progression-controls">
        <label>
          <span>Mode</span>
          <select data-mbrc-progression-field="mode">
            <option value="multiclass" ${data.mode === "multiclass" ? "selected" : ""}>${MODE_LABELS.multiclass}</option>
            <option value="dualclass" ${data.mode === "dualclass" ? "selected" : ""}>${MODE_LABELS.dualclass}</option>
          </select>
        </label>

        <label class="mbrc-shared-xp ${data.mode === "multiclass" ? "" : "mbrc-hidden"}">
          <span>Shared XP</span>
          <input type="number" min="0" step="1" data-mbrc-progression-field="sharedXp" value="${data.sharedXp}">
        </label>

        <label class="mbrc-sync-toggle">
          <input type="checkbox" data-mbrc-progression-field="syncSystemFields" ${data.syncSystemFields ? "checked" : ""}>
          <span>Sync S&amp;W Class/Level/XP fields</span>
        </label>
      </div>

      <div class="mbrc-class-list">
        ${data.classes.map((c, i) => classRow(c, i, data.mode)).join("")}
      </div>

      <div class="mbrc-progression-footer">
        <button type="button" class="mbrc-add-class"><i class="fas fa-plus"></i> Add Class</button>
        <div class="mbrc-progression-summary">
          <span class="mbrc-summary-mode">${MODE_LABELS[data.mode]}</span>
          <strong class="mbrc-summary-class">${esc(displayClassName(data) || "No classes")}</strong>
          <span class="mbrc-summary-level">Level ${esc(displayLevel(data) || "—")}</span>
        </div>
      </div>

      <p class="mbrc-progression-help">
        Multi-Class tracks concurrent classes. Shared XP is divided evenly among checked Active classes using whole numbers. Remainder XP rotates round-robin through the active class list so the same class does not always receive the extra point. Dual-Class keeps former classes and one current active class. This panel stores progression in module flags so the S&amp;W system schema remains untouched.
      </p>
    </div>
  `;

  return section;
}

function findInsertionTarget(root) {
  const bloodline = root.querySelector(".mbrc-bloodline");
  if (bloodline?.parentElement) return { target: bloodline, position: "after" };

  const selectors = [
    ".sheet-header",
    "header.sheet-header",
    ".sheet-body"
  ];

  for (const sel of selectors) {
    const target = root.querySelector(sel);
    if (target) return { target, position: target.classList?.contains("sheet-body") ? "prepend" : "after" };
  }
  return { target: root, position: "prepend" };
}

function insertPanel(panel, insertion) {
  const { target, position } = insertion;
  if (position === "after") target.insertAdjacentElement("afterend", panel);
  else if (position === "prepend") target.prepend(panel);
  else target.append(panel);
}

function enforceDualClassStatus(data, changedId) {
  if (data.mode !== "dualclass") return;
  const changed = data.classes.find(c => c.id === changedId);
  if (!changed || changed.status !== "active") return;
  for (const c of data.classes) {
    if (c.id !== changedId) c.status = "former";
  }
}

async function rerenderActor(actor) {
  for (const app of Object.values(actor.apps ?? {})) {
    try { app.render(false); } catch (_) {}
  }
}

async function wirePanel(panel, actor) {
  const persist = async (mutator, { rerender = true } = {}) => {
    let data = getProgression(actor);
    mutator(data);
    data = await saveProgression(actor, data);
    if (rerender) await rerenderActor(actor);
    return data;
  };

  panel.querySelector(".mbrc-collapse-toggle")?.addEventListener("click", async () => {
    await persist(data => {
      data.collapsed = !data.collapsed;
    });
  });

  panel.querySelectorAll("[data-mbrc-progression-field]").forEach(input => {
    input.addEventListener("change", async () => {
      const field = input.dataset.mbrcProgressionField;
      await persist(data => {
        if (field === "enabled") {
          data.enabled = input.checked;
          if (data.enabled) seedFromActor(actor, data);
        } else if (field === "syncSystemFields") {
          data.syncSystemFields = input.checked;
        } else if (field === "sharedXp") {
          data.sharedXp = Math.max(0, asNumber(input.value, 0));
          distributeSharedXp(data);
        } else if (field === "mode") {
          data.mode = input.value === "dualclass" ? "dualclass" : "multiclass";
          if (data.mode === "dualclass") {
            const active = data.classes.filter(c => c.status === "active");
            if (active.length > 1) {
              const keep = active[active.length - 1].id;
              for (const c of data.classes) if (c.id !== keep) c.status = "former";
            }
          } else {
            for (const c of data.classes) c.status = "active";
            distributeSharedXp(data, { reset: true });
          }
        }
      });
    });
  });

  panel.querySelectorAll("[data-mbrc-class-field]").forEach(input => {
    input.addEventListener("change", async () => {
      const row = input.closest(".mbrc-class-row");
      if (!row) return;
      const classId = row.dataset.classId;
      const field = input.dataset.mbrcClassField;

      await persist(data => {
        const entry = data.classes.find(c => c.id === classId);
        if (!entry) return;
        if (field === "name") entry.name = input.value.trim();
        else if (field === "level") entry.level = Math.max(0, asNumber(input.value, 0));
        else if (field === "xp") entry.xp = Math.max(0, asNumber(input.value, 0));
        else if (field === "nextLevelXp") entry.nextLevelXp = Math.max(0, asNumber(input.value, 0));
        else if (field === "xpBonus") entry.xpBonus = asNumber(input.value, 0);
        else if (field === "active") {
          entry.status = input.checked ? "active" : "former";
          enforceDualClassStatus(data, classId);
          if (data.mode === "multiclass") distributeSharedXp(data, { reset: true });
        }
      });
    });
  });

  panel.querySelector(".mbrc-add-class")?.addEventListener("click", async () => {
    await persist(data => {
      if (!data.enabled) data.enabled = true;
      if (data.mode === "dualclass") {
        for (const c of data.classes) c.status = "former";
      }
      data.classes.push({
        id: makeId(),
        name: "New Class",
        level: 1,
        xp: 0,
        nextLevelXp: 0,
        xpBonus: 0,
        status: "active"
      });
      if (data.mode === "multiclass") distributeSharedXp(data, { reset: true });
    });
  });

  panel.querySelectorAll(".mbrc-remove-class").forEach(button => {
    button.addEventListener("click", async () => {
      const row = button.closest(".mbrc-class-row");
      if (!row) return;
      const classId = row.dataset.classId;
      await persist(data => {
        data.classes = data.classes.filter(c => c.id !== classId);
        if (data.mode === "dualclass" && data.classes.length && !data.classes.some(c => c.status === "active")) {
          data.classes[data.classes.length - 1].status = "active";
        }
        if (data.mode === "multiclass") distributeSharedXp(data, { reset: true });
      });
    });
  });
}

async function injectProgression(app, html) {
  try {
    const actor = app?.actor ?? app?.document;
    if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;
    if (game.system.id !== "swords-wizardry") return;

    const root = getRoot(html);
    if (!root || root.querySelector(".mbrc-progression")) return;

    const data = getProgression(actor);
    const panel = makeProgressionPanel(actor, data);
    insertPanel(panel, findInsertionTarget(root));
    await wirePanel(panel, actor);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to inject Class Progression panel`, error);
  }
}



async function handleExternalSharedXpUpdate(actor, changed, options) {
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;
  if (game.system.id !== "swords-wizardry") return;
  if (options?.swMulticlassInternal) return;

  const path = `flags.${MODULE_ID}.${FLAG_ROOT}.sharedXp`;
  const flatChanged = Object.prototype.hasOwnProperty.call(changed ?? {}, path);
  const nestedChanged = foundry.utils.hasProperty(changed ?? {}, path);
  if (!flatChanged && !nestedChanged) return;

  const data = getProgression(actor);
  if (!data.enabled || data.mode !== "multiclass") return;

  distributeSharedXp(data);

  const clean = {
    enabled: Boolean(data.enabled),
    mode: data.mode,
    syncSystemFields: data.syncSystemFields !== false,
    collapsed: data.collapsed !== false,
    sharedXp: Math.max(0, Math.floor(asNumber(data.sharedXp, 0))),
    xpRemainderCursor: Math.max(0, Math.floor(asNumber(data.xpRemainderCursor, 0))),
    lastDistributedSharedXp:
      data.lastDistributedSharedXp < 0
        ? -1
        : Math.max(0, Math.floor(asNumber(data.lastDistributedSharedXp, 0))),
    classes: data.classes.map(normalizeClassEntry)
  };

  await actor.update(
    { [`flags.${MODULE_ID}.${FLAG_ROOT}`]: clean },
    { swMulticlassInternal: true }
  );

  if (clean.syncSystemFields) await syncCompatibilityFields(actor, clean);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing multi-class and dual-class support`);
});

Hooks.on("renderActorSheet", injectProgression);
Hooks.on("renderActorSheetV2", injectProgression);
Hooks.on("updateActor", handleExternalSharedXpUpdate);
