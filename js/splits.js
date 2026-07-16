/**
 * splits.js
 *
 * Drag-and-drop raid split builder. Two splits, each 5 groups of 5.
 * Dragging onto an occupied slot SWAPS the two characters (the occupant
 * goes back to wherever the dragged character came from — either the
 * unassigned pool or another slot).
 *
 * Offspec overrides are stored per-split in splitsState.specOverrides:
 *   { "Split A": { charKey: true }, "Split B": { charKey: true } }
 * The roster objects are NEVER mutated for spec/role — rendering derives
 * the effective spec from the override bucket for the split being drawn.
 */

(function () {
  requireLogin();

  // ---------- State ----------

  let roster = [];               // full roster from backend
  let splitsState = null;        // { "Split A": groups[][], "Split B": groups[][], specOverrides: {...} }
  let snapshotsList = [];        // [{ name, savedAt }, ...]
  let activeSplitKey = RAID_CONFIG.splitNames[0];
  let pilotMode = false;
  let poolFilterText = "";
  let poolSortMode = "class"; // "class" | "alpha" | "role"

  // Tracks the in-progress drag: where the dragged character came from,
  // so a drop can either move it or swap it.
  let dragSource = null; // { type: "pool" } | { type: "slot", splitKey, groupIndex, slotIndex }
  let draggedCharKey = null; // unique key of the character being dragged

  // ---------- DOM refs ----------

  const poolList = document.getElementById("pool-list");
  const poolSearch = document.getElementById("pool-search");
  const poolSortSelect = document.getElementById("pool-sort-select");
  const splitTabsEl = document.getElementById("split-tabs");
  const groupsGrid = document.getElementById("groups-grid");
  const validationPanel = document.getElementById("validation-panel");
  const splitSummaryLine = document.getElementById("split-summary-line");
  const lastSavedNote = document.getElementById("last-saved-note");
  const pilotToggle = document.getElementById("pilot-mode-toggle");
  const pilotBanner = document.getElementById("pilot-banner");
  const roleStatBar = document.getElementById("role-stat-bar");
  const bothSplitsBtn = document.getElementById("both-splits-btn");
  const bothSplitsOverlay = document.getElementById("both-splits-overlay");
  const bothSplitsCloseBtn = document.getElementById("both-splits-close-btn");
  const bothSplitsBody = document.getElementById("both-splits-body");
  const snapshotsBtn = document.getElementById("snapshots-btn");
  const snapshotsOverlay = document.getElementById("snapshots-overlay");
  const snapshotsCloseBtn = document.getElementById("snapshots-close-btn");
  const snapshotNameInput = document.getElementById("snapshot-name-input");
  const snapshotSaveBtn = document.getElementById("snapshot-save-btn");
  const snapshotSaveStatus = document.getElementById("snapshot-save-status");
  const snapshotList = document.getElementById("snapshot-list");

  // ---------- Init ----------

  document.getElementById("logout-link").addEventListener("click", (e) => {
    e.preventDefault();
    clearSession();
    window.location.href = "index.html";
  });

  document.getElementById("reload-btn").addEventListener("click", load);
  document.getElementById("save-splits-btn").addEventListener("click", persistSplits);

  pilotToggle.addEventListener("change", () => {
    pilotMode = pilotToggle.checked;
    pilotBanner.classList.toggle("active", pilotMode);
  });

  bothSplitsBtn.addEventListener("click", () => {
    renderBothSplitsModal();
    bothSplitsOverlay.classList.add("open");
  });

  bothSplitsCloseBtn.addEventListener("click", closeBothSplitsModal);

  snapshotsBtn.addEventListener("click", openSnapshotsModal);
  snapshotsCloseBtn.addEventListener("click", closeSnapshotsModal);
  snapshotsOverlay.addEventListener("click", (e) => {
    if (e.target === snapshotsOverlay) closeSnapshotsModal();
  });
  snapshotSaveBtn.addEventListener("click", handleSnapshotSave);
  snapshotNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSnapshotSave();
  });

  bothSplitsOverlay.addEventListener("click", (e) => {
    if (e.target === bothSplitsOverlay) closeBothSplitsModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && bothSplitsOverlay.classList.contains("open")) closeBothSplitsModal();
  });

  function closeBothSplitsModal() {
    bothSplitsOverlay.classList.remove("open");
  }

  poolSearch.addEventListener("input", () => {
    poolFilterText = poolSearch.value.trim().toLowerCase();
    renderPool();
  });

  poolSortSelect.addEventListener("change", () => {
    poolSortMode = poolSortSelect.value;
    renderPool();
  });

  poolList.addEventListener("click", handleAbsentToggleClick);
  poolList.addEventListener("click", handleSpecSwapClick);
  groupsGrid.addEventListener("click", handleAbsentToggleClick);
  groupsGrid.addEventListener("click", handleSpecSwapClick);
  groupsGrid.addEventListener("click", handleRemoveSlotClick);

  renderSplitTabs();
  load();

  // ---------- Data loading ----------

  async function load() {
    try {
      const data = await fetchData();
      roster = data.roster || [];
      splitsState = normalizeSplitsState(data.splits);
      snapshotsList = data.snapshots || [];
      lastSavedNote.textContent = data.splits ? "Loaded saved splits" : "No saved splits yet — starting fresh";
      renderAll();
    } catch (err) {
      groupsGrid.innerHTML = `<div class="alert alert-error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Returns true if the character is on offspec in the given split,
   * by reading the per-split override bucket. Never reads character._onOffspec.
   */
  function isCharOnOffspec(character, splitKey) {
    const overrides = splitsState && splitsState.specOverrides && splitsState.specOverrides[splitKey];
    return !!(overrides && overrides[charKey(character)]);
  }

  /**
   * Build a blank splits structure, or reconcile a loaded one against
   * the current roster (in case characters were removed/renamed since
   * the splits were last saved — those slots just become empty rather
   * than crashing the page).
   */
  function normalizeSplitsState(loaded) {
    const blank = { specOverrides: {} };
    RAID_CONFIG.splitNames.forEach((name) => {
      blank[name] = makeBlankGroups();
      blank.specOverrides[name] = {};
    });

    if (!loaded) return blank;

    // Carry over per-split override buckets, with legacy flat-format upgrade.
    const rawOverrides = loaded.specOverrides || {};
    const isNewFormat = RAID_CONFIG.splitNames.some(
      (name) => rawOverrides[name] && typeof rawOverrides[name] === "object"
    );
    if (isNewFormat) {
      RAID_CONFIG.splitNames.forEach((name) => {
        blank.specOverrides[name] = rawOverrides[name] || {};
      });
    } else {
      // Legacy: flat { charKey: true } — apply to all splits as best-effort migration.
      RAID_CONFIG.splitNames.forEach((name) => {
        blank.specOverrides[name] = Object.assign({}, rawOverrides);
      });
    }

    RAID_CONFIG.splitNames.forEach((name) => {
      const loadedGroups = loaded[name];
      if (!Array.isArray(loadedGroups)) return;

      blank[name] = loadedGroups.map((group) =>
        (Array.isArray(group) ? group : []).map((slot) => {
          if (!slot) return null;
          // Re-link to the live roster entry by CharName so edits made on
          // the Roster page (spec changes, absent toggle, even who the
          // PlayerName/pilot is) are reflected here without needing to
          // re-save splits. Matches by CharName alone since a character
          // can only have one "true" roster entry at a time.
          const match = roster.find(
            (c) => (c.CharName || "").trim().toLowerCase() === (slot.CharName || "").trim().toLowerCase()
          );
          return match || null;
        }).concat(Array(RAID_CONFIG.playersPerGroup).fill(null)).slice(0, RAID_CONFIG.playersPerGroup)
      ).concat(makeBlankGroups()).slice(0, RAID_CONFIG.groupsPerSplit);
    });

    return blank;
  }

  function makeBlankGroups() {
    return Array.from({ length: RAID_CONFIG.groupsPerSplit }, () =>
      Array(RAID_CONFIG.playersPerGroup).fill(null)
    );
  }

  // ---------- Character key helper ----------
  // A character (by CHARACTER NAME) can only physically be in one raid
  // at a time, regardless of who is piloting it that night. So the key
  // is CharName alone — NOT PlayerName+CharName — matching the real
  // constraint: one toon, one seat.

  function charKey(character) {
    return (character.CharName || "").trim().toLowerCase();
  }

  /**
   * Every character currently placed in EITHER split, across all groups.
   * Used to compute the unassigned pool and to detect duplicates.
   */
  function allPlacedCharacters() {
    const placed = [];
    RAID_CONFIG.splitNames.forEach((name) => {
      splitsState[name].forEach((group) => {
        group.forEach((slot) => {
          if (slot) placed.push({ ...slot, __splitKey: name });
        });
      });
    });
    return placed;
  }

  function getUnassignedPool() {
    const placedKeys = new Set(allPlacedCharacters().map(charKey));
    return roster.filter((c) => !placedKeys.has(charKey(c)));
  }

  /**
   * Set of PlayerNames (lowercased) that already have a character seated
   * in the given split. Used to flag a player's OTHER characters as a
   * conflict — one person can't physically play two characters in the
   * same raid at once, but the restriction is per-split: the same
   * person can have a different character seated in the other split.
   */
  function getSeatedPlayerNames(splitKey) {
    const names = new Set();
    splitsState[splitKey].forEach((group) => {
      group.forEach((slot) => {
        if (slot && slot.PlayerName) names.add(slot.PlayerName.trim().toLowerCase());
      });
    });
    return names;
  }

  // ---------- Rendering: top-level ----------

  function renderAll() {
    window.__unassignedPool = getUnassignedPool(); // for validation.js suggestions
    renderPool();
    renderSplitTabs();
    renderGroups();
    renderValidation();
  }

  function renderSplitTabs() {
    splitTabsEl.innerHTML = RAID_CONFIG.splitNames
      .map(
        (name) => `
        <button class="split-tab-btn ${name === activeSplitKey ? "active" : ""}" data-split="${name}">
          ${name}
        </button>`
      )
      .join("");

    splitTabsEl.querySelectorAll(".split-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSplitKey = btn.dataset.split;
        renderSplitTabs();
        renderPool();
        renderGroups();
        renderValidation();
      });
    });
  }

  // ---------- Rendering: unassigned pool ----------

  // Fixed class order, matching the order used elsewhere in the app
  // (constants.js's CLASSES object), so "Sort: Class" groups consistently
  // rather than relying on insertion order or alphabetical class names.
  const CLASS_SORT_ORDER = Object.keys(CLASSES);
  const ROLE_SORT_ORDER = ["tank", "healer", "dps"];

  function renderPool() {
    let pool = getUnassignedPool().filter((c) =>
      !poolFilterText || c.CharName.toLowerCase().includes(poolFilterText) || c.PlayerName.toLowerCase().includes(poolFilterText)
    );

    if (pool.length === 0) {
      poolList.innerHTML = `<div class="text-muted text-sm">No unassigned characters.</div>`;
      return;
    }

    const seatedPlayers = getSeatedPlayerNames(activeSplitKey);

    if (poolSortMode === "alpha") {
      pool = pool.slice().sort((a, b) => a.CharName.localeCompare(b.CharName));
      poolList.innerHTML = pool
        .map((c) => playerChipHtml(c, { type: "pool" }, hasPlayerConflict(c, seatedPlayers), activeSplitKey))
        .join("");
    } else {
      // "class" or "role" — both are grouped-with-labels renders
      const groupOrder = poolSortMode === "role" ? ROLE_SORT_ORDER : CLASS_SORT_ORDER;
      const groupKeyFn = poolSortMode === "role" ? (c) => effectiveRoleOf(c) : (c) => classKeyOf(c);
      const groupLabelFn = poolSortMode === "role"
        ? (key) => (ROLES[key] && ROLES[key].label) || key
        : (key) => (CLASSES[key] && CLASSES[key].label) || key;

      const grouped = {};
      pool.forEach((c) => {
        const key = groupKeyFn(c);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c);
      });

      // Sort within each group alphabetically by character name
      Object.values(grouped).forEach((list) => list.sort((a, b) => a.CharName.localeCompare(b.CharName)));

      // Render in fixed order, skipping empty groups, falling back to
      // any keys not in the predefined order (defensive, shouldn't
      // normally happen) appended at the end.
      const orderedKeys = [...groupOrder, ...Object.keys(grouped).filter((k) => !groupOrder.includes(k))];

      poolList.innerHTML = orderedKeys
        .filter((key) => grouped[key] && grouped[key].length > 0)
        .map((key) => {
          const label = groupLabelFn(key);
          const chips = grouped[key]
            .map((c) => playerChipHtml(c, { type: "pool" }, hasPlayerConflict(c, seatedPlayers), activeSplitKey))
            .join("");
          return `<div class="pool-group-label">${escapeHtml(label)}</div>${chips}`;
        })
        .join("");
    }

    wireChipDragHandlers(poolList);
  }

  function effectiveRoleOf(c) {
    return (c.Role || "").toLowerCase();
  }

  /**
   * True if this character's PLAYER already has a different character
   * seated in the given split's seated-players set.
   */
  function hasPlayerConflict(character, seatedPlayerNamesSet) {
    if (!character.PlayerName) return false;
    return seatedPlayerNamesSet.has(character.PlayerName.trim().toLowerCase());
  }

  // ---------- Rendering: chip (shared between pool + slots) ----------

  /**
   * Renders a player chip. splitKey is required to look up whether this
   * character is on offspec for the split being rendered — the roster
   * object itself is never mutated for spec state.
   */
  function playerChipHtml(character, source, hasConflict, splitKey) {
    const onOffspec = isCharOnOffspec(character, splitKey);

    // Derive the effective spec/role for display without mutating the roster object.
    const classKey = classKeyOf(character);
    const activeSpecKey = effectiveSpecKey(character, splitKey);
    const iconPath = getSpecIconPath(classKey, activeSpecKey) || "";

    const isAbsent = character.Absent === true;
    const isAlt = character.MainOrAlt === "Alt";
    const dstShown = character.DSTEligible === true && !isAlt;

    // Offspec swap button (only when character has an OffspecSpec defined)
    const offspecKey = character.OffspecSpec && typeof character.OffspecSpec === "string"
      ? resolveOffspecKey(classKey, character.OffspecSpec)
      : "";
    const mainSpecKey = (character.Spec || "").toLowerCase().replace(/\s+/g, "");
    const mainIconPath = getSpecIconPath(classKey, mainSpecKey) || "";
    const offspecIconPath = offspecKey ? (getSpecIconPath(classKey, offspecKey) || "") : "";
    const offspecLabel = offspecKey
      ? ((CLASSES[classKey] && CLASSES[classKey].specs[offspecKey] && CLASSES[classKey].specs[offspecKey].label) || character.OffspecSpec)
      : "";

    const isPool = source.type === "pool";

    const specIconHtml = offspecKey
      ? isPool
        // Pool: both icons always visible side by side
        ? `<div class="spec-icon-dual-wrap" draggable="false">
             <div class="spec-icon-slot ${!onOffspec ? "spec-slot-active" : "spec-slot-inactive"}"
                  title="${onOffspec ? "Swap to main spec" : "Main spec"}">
               <img src="${mainIconPath}" alt="" onerror="this.style.display='none'">
               ${onOffspec ? `<button type="button" class="chip-offspec-btn" draggable="false" data-spec-swap="${escapeAttr(charKey(character))}" data-split-key="${escapeAttr(splitKey)}" title="Swap back to main spec"></button>` : ""}
             </div>
             <div class="spec-icon-slot ${onOffspec ? "spec-slot-active" : "spec-slot-inactive"}"
                  title="${!onOffspec ? "Swap to " + escapeAttr(offspecLabel) : "Offspec"}">
               <img src="${offspecIconPath || mainIconPath}" alt="" onerror="this.style.display='none'">
               ${!onOffspec ? `<button type="button" class="chip-offspec-btn" draggable="false" data-spec-swap="${escapeAttr(charKey(character))}" data-split-key="${escapeAttr(splitKey)}" title="Swap to ${escapeAttr(offspecLabel)}"></button>` : ""}
             </div>
           </div>`
        // Slot: active spec icon only; offspec swap button appears on chip hover
        : `<div class="spec-icon-swap-wrap" draggable="false">
             <img class="spec-icon" src="${onOffspec ? offspecIconPath || mainIconPath : mainIconPath}" alt="" onerror="this.style.display='none'">
             <button type="button"
                     class="chip-offspec-btn chip-offspec-btn--slot"
                     draggable="false"
                     data-spec-swap="${escapeAttr(charKey(character))}"
                     data-split-key="${escapeAttr(splitKey)}"
                     title="${onOffspec ? "Swap back to main spec" : "Swap to " + escapeAttr(offspecLabel)}">
               <img src="${onOffspec ? mainIconPath : offspecIconPath}" alt="" onerror="this.style.display='none'">
             </button>
           </div>`
      : (iconPath ? `<img class="spec-icon" src="${iconPath}" alt="" onerror="this.style.display='none'">` : "");

    const conflictTitle = hasConflict
      ? `title="${escapeAttr(character.PlayerName)} already has a character seated in this split"`
      : "";

    const removeBtnHtml =
      source.type === "slot"
        ? `<button type="button"
                class="chip-remove-btn"
                draggable="false"
                data-remove-slot="${source.groupIndex}:${source.slotIndex}"
                title="Remove from split">&times;</button>`
        : "";

    return `
      <div class="player-chip ${isAbsent ? "chip-absent" : ""} ${hasConflict ? "chip-player-conflict" : ""} ${onOffspec ? "chip-on-offspec" : ""}"
           draggable="true"
           ${conflictTitle}
           data-char-key="${escapeAttr(charKey(character))}"
           data-source="${escapeAttr(JSON.stringify(source))}">
         ${removeBtnHtml}
         <button type="button"
                class="chip-absent-toggle ${isAbsent ? "is-absent" : ""}"
                draggable="false"
                data-absent-toggle="${escapeAttr(charKey(character))}"
                title="${isAbsent ? "Mark as present" : "Mark as absent"}">
          ${isAbsent ? "IN" : "OUT"}
        </button>
        ${specIconHtml}
        <span class="chip-name class-${classKey}">${escapeHtml(character.CharName)}</span>
        <span class="chip-tags">
          ${onOffspec ? `<span class="chip-mini-tag tag-offspec">${escapeHtml(offspecLabel)}</span>` : ""}
          ${dstShown ? '<span class="chip-mini-tag tag-dst">DST</span>' : ""}
          ${isAbsent ? '<span class="chip-mini-tag tag-absent">OUT</span>' : ""}
          ${hasConflict ? '<span class="chip-mini-tag tag-warn">DUP</span>' : ""}
        </span>
      </div>
    `;
  }

  function classKeyOf(c) { return (c.Class || "").toLowerCase(); }
  function specKeyOf(c) { return (c.Spec || "").toLowerCase().replace(/\s+/g, ""); }

  /**
   * Resolves an OffspecSpec value (which may be stored as a display label
   * like "Beast Mastery" or as a key like "beastmastery") to the actual
   * key used in CLASSES, by searching the class's spec definitions.
   */
  function resolveOffspecKey(classKey, offspecSpecValue) {
    if (!offspecSpecValue) return "";
    const specs = (CLASSES[classKey] && CLASSES[classKey].specs) || {};
    const stripped = offspecSpecValue.toLowerCase().replace(/\s+/g, "");
    // Direct key match
    if (specs[stripped]) return stripped;
    // Match by label (OffspecSpec stored as label e.g. "Beast Mastery")
    const byLabel = Object.keys(specs).find(
      (k) => specs[k].label.toLowerCase().replace(/\s+/g, "") === stripped
    );
    return byLabel || stripped;
  }

  /**
   * Returns the spec key to use for rendering/validation for a character
   * in a given split, accounting for offspec overrides without mutating
   * the roster object.
   */
  function effectiveSpecKey(character, splitKey) {
    if (isCharOnOffspec(character, splitKey) && character.OffspecSpec) {
      return resolveOffspecKey(classKeyOf(character), character.OffspecSpec);
    }
    return specKeyOf(character);
  }

  /**
   * Returns the role to use for validation for a character in a given split.
   */
  function effectiveRoleForSplit(character, splitKey) {
    if (isCharOnOffspec(character, splitKey) && character.OffspecRole) {
      return character.OffspecRole.toLowerCase();
    }
    return (character.Role || "").toLowerCase();
  }

  /**
   * Returns a copy of the groups array where each character object is
   * a shallow clone with Role and Spec set to their effective values
   * for the given split. Used to pass offspec-aware data to validateSplit
   * without mutating the real roster objects.
   */
  function groupsWithEffectiveSpecs(splitKey) {
    return splitsState[splitKey].map((group) =>
      group.map((slot) => {
        if (!slot) return null;
        if (!isCharOnOffspec(slot, splitKey)) return slot;
        return Object.assign({}, slot, {
          Spec: slot.OffspecSpec || slot.Spec,
          Role: slot.OffspecRole || slot.Role
        });
      })
    );
  }

  // ---------- Rendering: groups grid ----------

  function renderGroups() {
    const groups = splitsState[activeSplitKey];
    const flatChars = groups.flat().filter(Boolean);
    splitSummaryLine.textContent = `${flatChars.length} / ${RAID_CONFIG.maxPerSplit} players assigned`;

    groupsGrid.innerHTML = groups
      .map((group, groupIndex) => groupBoxHtml(group, groupIndex))
      .join("");

    // Wire slot drag targets
    groups.forEach((group, groupIndex) => {
      group.forEach((slot, slotIndex) => {
        const slotEl = document.getElementById(slotElId(groupIndex, slotIndex));
        wireSlotDropHandlers(slotEl, groupIndex, slotIndex);
      });
    });

    // Wire chip drag handlers for any chips currently rendered in slots
    wireChipDragHandlers(groupsGrid);
  }

  function slotElId(groupIndex, slotIndex) {
    return `slot-${groupIndex}-${slotIndex}`;
  }

  function groupBoxHtml(group, groupIndex) {
    const slotsHtml = group
      .map((slot, slotIndex) => {
        const inner = slot
          ? playerChipHtml(slot, { type: "slot", splitKey: activeSplitKey, groupIndex, slotIndex }, false, activeSplitKey)
          : `<span class="slot-empty-label">Drop here</span>`;
        return `<div class="group-slot ${slot ? "filled" : ""}" id="${slotElId(groupIndex, slotIndex)}">${inner}</div>`;
      })
      .join("");

    return `
      <div class="group-box">
        <div class="group-header"><span>Group ${groupIndex + 1}</span></div>
        <div class="group-slots">${slotsHtml}</div>
        <div class="group-buffs-row">${buffIconsForGroup(group, activeSplitKey)}</div>
      </div>
    `;
  }

  // ---------- Buff icon row ----------

  function buffIconsForGroup(group, splitKey) {
    const members = group.filter(Boolean);
    if (members.length === 0) return "";

    const covered = RAID_BUFFS.filter((buff) =>
      buff.providers.some((provider) =>
        members.some((member) => {
          const classMatch = classKeyOf(member) === provider.class;
          if (!classMatch) return false;
          if (provider.spec) return effectiveSpecKey(member, splitKey) === provider.spec;
          return true;
        })
      )
    );

    if (covered.length === 0) return `<span class="text-muted text-sm">No notable buffs</span>`;

    return covered
      .map(
        (buff) => `
        <img class="buff-icon"
             src="${getBuffIconUrl(buff.icon, "small")}"
             alt="${escapeAttr(buff.label)}"
             title="${escapeAttr(buff.label)}"
             onerror="this.outerHTML = '<span class=&quot;buff-icon-fallback&quot; title=&quot;${escapeAttr(buff.label)}&quot;>${escapeHtml(initials(buff.label))}</span>'">`
      )
      .join("");
  }

  function initials(label) {
    return label
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  }

  // ---------- Drag and drop ----------

  function wireChipDragHandlers(container) {
    container.querySelectorAll(".player-chip[draggable]").forEach((chip) => {
      chip.addEventListener("dragstart", onChipDragStart);
      chip.addEventListener("dragend", onChipDragEnd);
    });
  }

  function onChipDragStart(e) {
    const chip = e.currentTarget;
    draggedCharKey = chip.dataset.charKey;
    dragSource = JSON.parse(chip.dataset.source);
    chip.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedCharKey); // required by some browsers for DnD to fire
  }

  function onChipDragEnd(e) {
    e.currentTarget.classList.remove("dragging");
    dragSource = null;
    draggedCharKey = null;
    document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  }

  function wireSlotDropHandlers(slotEl, groupIndex, slotIndex) {
    if (!slotEl) return;

    slotEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      slotEl.classList.add("drag-over");
    });

    slotEl.addEventListener("dragleave", () => {
      slotEl.classList.remove("drag-over");
    });

    slotEl.addEventListener("drop", (e) => {
      e.preventDefault();
      slotEl.classList.remove("drag-over");
      handleDrop({ type: "slot", splitKey: activeSplitKey, groupIndex, slotIndex });
    });
  }

  // Also allow dropping back onto the pool to unassign a character.
  poolList.addEventListener("dragover", (e) => {
    e.preventDefault();
    poolList.classList.add("drag-over");
  });
  poolList.addEventListener("dragleave", () => poolList.classList.remove("drag-over"));
  poolList.addEventListener("drop", (e) => {
    e.preventDefault();
    poolList.classList.remove("drag-over");
    handleDrop({ type: "pool" });
  });

  /**
   * Core drop logic. Handles:
   *  - pool -> slot (place)
   *  - slot -> slot (move or SWAP if target occupied)
   *  - slot -> pool (unassign)
   *  - duplicate detection, honoring pilotMode override
   */
  function handleDrop(target) {
    if (!dragSource || !draggedCharKey) return;

    const draggedChar = findCharacterByKey(draggedCharKey);
    if (!draggedChar) return;

    // Duplicate check: a character can only be in ONE raid (split) at a
    // time, regardless of who's piloting it. If this CharName already
    // has a seat somewhere else, that's a real conflict unless someone
    // is intentionally double-booking it (Pilot Mode).
    if (!pilotMode) {
      const existingLocation = findPlacementOf(draggedCharKey, dragSource);
      if (existingLocation) {
        const proceed = window.confirm(
          `${draggedChar.CharName} already has a seat in ${existingLocation.splitKey}, Group ${existingLocation.groupIndex + 1}. ` +
            `A character can only be in one raid at a time — enable Pilot Mode if this is intentional. Place anyway?`
        );
        if (!proceed) return;
      }
    }

    if (target.type === "pool") {
      removeFromSource(dragSource);
      renderAll();
      return;
    }

    // target.type === "slot"
    const { splitKey, groupIndex, slotIndex } = target;

    // Player-conflict check: does this character's PLAYER already have
    // a different character seated in the TARGET split? One person can't
    // play two characters in the same raid. Skip the check if the
    // dragged character is itself the one already occupying a slot for
    // that player (e.g. just moving them within the same split).
    if (!pilotMode && draggedChar.PlayerName) {
      const seated = getSeatedPlayerNames(splitKey);
      const draggedFromThisSplit = dragSource.type === "slot" && dragSource.splitKey === splitKey;
      const playerAlreadySeatedElsewhere =
        seated.has(draggedChar.PlayerName.trim().toLowerCase()) &&
        !(draggedFromThisSplit && charKey(draggedChar) === charKey(
            splitsState[splitKey][dragSource.groupIndex] ? splitsState[splitKey][dragSource.groupIndex][dragSource.slotIndex] : {}
          ));

      if (playerAlreadySeatedElsewhere) {
        const proceed = window.confirm(
          `${draggedChar.PlayerName} already has another character seated in ${splitKey}. ` +
            `One person can't play two characters in the same raid — enable Pilot Mode if this is intentional. Place anyway?`
        );
        if (!proceed) return;
      }
    }

    const targetGroup = splitsState[splitKey][groupIndex];
    const occupant = targetGroup[slotIndex];

    // Remove dragged char from its source first.
    removeFromSource(dragSource);

    // Place dragged char into target slot.
    splitsState[splitKey][groupIndex][slotIndex] = draggedChar;

    // If the target slot had someone in it, send them to wherever the
    // dragged character came FROM (swap), or to the pool if it came
    // from the pool itself (simple displacement).
    if (occupant && charKey(occupant) !== draggedCharKey) {
      if (dragSource.type === "slot") {
        splitsState[dragSource.splitKey][dragSource.groupIndex][dragSource.slotIndex] = occupant;
      }
      // if dragSource was "pool", the occupant simply becomes unassigned
      // (falls back into the pool automatically since pool = roster minus placed)
    }

    renderAll();
  }

  function findCharacterByKey(key) {
    return roster.find((c) => charKey(c) === key) || null;
  }

  /**
   * Returns the location object if `key` is currently placed in a slot
   * that is NOT the same as `excludeSource` (used to detect true
   * duplicates vs. the character's own current slot).
   */
  function findPlacementOf(key, excludeSource) {
    for (const splitKey of RAID_CONFIG.splitNames) {
      const groups = splitsState[splitKey];
      for (let g = 0; g < groups.length; g++) {
        for (let s = 0; s < groups[g].length; s++) {
          const slot = groups[g][s];
          if (slot && charKey(slot) === key) {
            const isExcluded =
              excludeSource &&
              excludeSource.type === "slot" &&
              excludeSource.splitKey === splitKey &&
              excludeSource.groupIndex === g &&
              excludeSource.slotIndex === s;
            if (!isExcluded) return { splitKey, groupIndex: g, slotIndex: s };
          }
        }
      }
    }
    return null;
  }

  function removeFromSource(source) {
    if (source.type === "slot") {
      splitsState[source.splitKey][source.groupIndex][source.slotIndex] = null;
    }
    // type === "pool": nothing to remove, pool is derived automatically
  }


  function computeRoleStats(splitKey) {
    const characters = splitsState[splitKey].flat().filter(Boolean);
    // Use effective role: check offspec override for this split
    const tankCount = characters.filter((c) => {
      if (isCharOnOffspec(c, splitKey)) {
        return (c.OffspecRole || c.Role || "").toLowerCase() === "tank";
      }
      return (c.Role || "").toLowerCase() === "tank";
    }).length;
    const healerCount = characters.filter((c) => {
      if (isCharOnOffspec(c, splitKey)) {
        return (c.OffspecRole || c.Role || "").toLowerCase() === "healer";
      }
      return (c.Role || "").toLowerCase() === "healer";
    }).length;
    return { tankCount, healerCount };
  }

  function renderRoleStatBar() {
  const { tankCount, healerCount } = computeRoleStats(activeSplitKey);

  const stats = [
    { label: "Tanks", value: tankCount },
    { label: "Healers", value: healerCount }
  ];

  roleStatBar.innerHTML = stats
    .map(
      (s) => `
      <div class="role-stat-chip">
        <span class="stat-label">${escapeHtml(s.label)}</span>
        <span class="stat-value">${s.value}</span>
      </div>`
    )
    .join("");
  }

  // ---------- Rendering: Both Splits modal ----------

  function renderBothSplitsModal() {
    bothSplitsBody.innerHTML = RAID_CONFIG.splitNames
      .map((splitKey) => bothSplitsPanelHtml(splitKey))
      .join("");
  }

  function bothSplitsPanelHtml(splitKey) {
    const groups = splitsState[splitKey];
    const { tankCount, healerCount } = computeRoleStats(splitKey);

    const groupsHtml = groups
      .map((group, groupIndex) => modalGroupBoxHtml(group, groupIndex, splitKey))
      .join("");

    return `
      <div class="both-splits-panel">
        <div class="both-splits-panel-header">
          <h3>${escapeHtml(splitKey)}</h3>
          <div class="role-stat-bar" style="margin-bottom:0;">
            <div class="role-stat-chip">
              <span class="stat-label">Tanks</span>
              <span class="stat-value">${tankCount}</span>
            </div>
            <div class="role-stat-chip">
              <span class="stat-label">Healers</span>
              <span class="stat-value">${healerCount}</span>
            </div>
          </div>
        </div>
        <div class="both-splits-groups-grid">${groupsHtml}</div>
      </div>
    `;
  }

  function modalGroupBoxHtml(group, groupIndex, splitKey) {
    const slotsHtml = group
      .map((slot) => {
        const inner = slot ? modalChipHtml(slot, splitKey) : `<span class="slot-empty-label">—</span>`;
        return `<div class="group-slot ${slot ? "filled" : ""}">${inner}</div>`;
      })
      .join("");

    return `
      <div class="group-box">
        <div class="group-header"><span>Group ${groupIndex + 1}</span></div>
        <div class="group-slots">${slotsHtml}</div>
        <div class="group-buffs-row">${buffIconsForGroup(group, splitKey)}</div>
      </div>
    `;
  }

  function modalChipHtml(character, splitKey) {
    const classKey = classKeyOf(character);
    const onOffspec = isCharOnOffspec(character, splitKey);
    const iconPath = getSpecIconPath(classKey, effectiveSpecKey(character, splitKey)) || "";
    const isAbsent = character.Absent === true;

    return `
      <div class="modal-chip ${isAbsent ? "chip-absent" : ""} ${onOffspec ? "chip-on-offspec" : ""}">
        ${iconPath ? `<img class="spec-icon" src="${iconPath}" alt="" onerror="this.style.display='none'">` : ""}
        <span class="chip-name class-${classKey}">${escapeHtml(character.CharName)}</span>
      </div>
    `;
  }
  
  // ---------- Validation rendering ----------

  function renderValidation() {
    window.__unassignedPool = getUnassignedPool();
    renderRoleStatBar();
    const result = validateSplit(groupsWithEffectiveSpecs(activeSplitKey));

    if (result.errors.length === 0 && result.warnings.length === 0) {
      validationPanel.innerHTML = `<div class="alert alert-success">All checks passed for ${escapeHtml(activeSplitKey)}.</div>`;
      return;
    }

    const errorHtml = result.errors
      .map((e) => alertHtml(e, "error"))
      .join("");
    const warnHtml = result.warnings
      .map((w) => alertHtml(w, "warn"))
      .join("");

    validationPanel.innerHTML = errorHtml + warnHtml;
  }

  function alertHtml(entry, type) {
    return `
      <div class="alert alert-${type}">
        <div>
          <div>${escapeHtml(entry.message)}</div>
          ${entry.suggestion ? `<div class="text-muted text-sm" style="margin-top:2px;">${escapeHtml(entry.suggestion)}</div>` : ""}
        </div>
      </div>
    `;
  }

  // ---------- Save ----------

  async function persistSplits() {
    const btn = document.getElementById("save-splits-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      await saveSplits(splitsState);
      lastSavedNote.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      lastSavedNote.textContent = "Save failed: " + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Splits";
    }
  }

  // ---------- Snapshots ----------

  function openSnapshotsModal() {
    renderSnapshotList();
    snapshotsOverlay.classList.add("open");
    snapshotNameInput.focus();
  }

  function closeSnapshotsModal() {
    snapshotsOverlay.classList.remove("open");
    snapshotSaveStatus.textContent = "";
    snapshotNameInput.value = "";
  }

  function renderSnapshotList() {
    if (snapshotsList.length === 0) {
      snapshotList.innerHTML = `<p style="padding:12px 20px; color:var(--text-muted); font-size:13px;">No snapshots saved yet.</p>`;
      return;
    }

    snapshotList.innerHTML = snapshotsList
      .slice()
      .reverse() // newest first
      .map(s => {
        const dateStr = s.savedAt ? new Date(s.savedAt).toLocaleString() : "";
        return `
          <div class="snapshot-row" data-name="${escapeAttr(s.name)}">
            <div class="snapshot-info">
              <span class="snapshot-name">${escapeHtml(s.name)}</span>
              ${dateStr ? `<span class="snapshot-date">${dateStr}</span>` : ""}
            </div>
            <div class="snapshot-actions">
              <button class="btn btn-sm snapshot-load-btn" data-action="load" data-name="${escapeAttr(s.name)}">Load</button>
              <button class="btn btn-sm snapshot-delete-btn" data-action="delete" data-name="${escapeAttr(s.name)}">Delete</button>
            </div>
          </div>`;
      })
      .join("");

    snapshotList.addEventListener("click", handleSnapshotListClick, { once: true });
    // Re-attach each render since we use {once:true}
    snapshotList.onclick = handleSnapshotListClick;
  }

  function handleSnapshotListClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const name = btn.dataset.name;
    if (action === "load") handleSnapshotLoad(name);
    if (action === "delete") handleSnapshotDelete(name);
  }

  async function handleSnapshotSave() {
    const name = snapshotNameInput.value.trim();
    if (!name) {
      snapshotSaveStatus.textContent = "Please enter a name for this snapshot.";
      snapshotSaveStatus.style.color = "var(--color-error, #e55)";
      return;
    }

    const existing = snapshotsList.find(s => s.name === name);
    if (existing) {
      const ok = confirm(`A snapshot named "${name}" already exists. Overwrite it?`);
      if (!ok) return;
    }

    snapshotSaveBtn.disabled = true;
    snapshotSaveBtn.textContent = "Saving…";
    snapshotSaveStatus.textContent = "";

    try {
      await saveSnapshot(name, splitsState);
      const now = new Date().toISOString();
      const idx = snapshotsList.findIndex(s => s.name === name);
      if (idx >= 0) {
        snapshotsList[idx].savedAt = now;
      } else {
        snapshotsList.push({ name, savedAt: now });
      }
      snapshotNameInput.value = "";
      snapshotSaveStatus.textContent = `✓ Saved "${name}"`;
      snapshotSaveStatus.style.color = "var(--color-success, #5a5)";
      renderSnapshotList();
    } catch (err) {
      snapshotSaveStatus.textContent = "Save failed: " + err.message;
      snapshotSaveStatus.style.color = "var(--color-error, #e55)";
    } finally {
      snapshotSaveBtn.disabled = false;
      snapshotSaveBtn.textContent = "Save Current";
    }
  }

  async function handleSnapshotLoad(name) {
    const ok = confirm(`Load snapshot "${name}"? Your current unsaved splits will be replaced.`);
    if (!ok) return;

    const row = snapshotList.querySelector(`[data-name="${escapeAttr(name)}"] .snapshot-load-btn`);
    if (row) { row.disabled = true; row.textContent = "Loading…"; }

    try {
      const result = await loadSnapshot(name);
      splitsState = normalizeSplitsState(result.result.splits);
      renderAll();
      lastSavedNote.textContent = `Loaded snapshot: ${name}`;
      closeSnapshotsModal();
    } catch (err) {
      alert("Failed to load snapshot: " + err.message);
      if (row) { row.disabled = false; row.textContent = "Load"; }
    }
  }

  async function handleSnapshotDelete(name) {
    const ok = confirm(`Delete snapshot "${name}"? This cannot be undone.`);
    if (!ok) return;

    const row = snapshotList.querySelector(`[data-name="${escapeAttr(name)}"] .snapshot-delete-btn`);
    if (row) { row.disabled = true; row.textContent = "Deleting…"; }

    try {
      await deleteSnapshot(name);
      snapshotsList = snapshotsList.filter(s => s.name !== name);
      renderSnapshotList();
    } catch (err) {
      alert("Failed to delete snapshot: " + err.message);
      if (row) { row.disabled = false; row.textContent = "Delete"; }
    }
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---------- Absent toggle (roster-backed, editable right from Splits) ----------

  function handleAbsentToggleClick(e) {
    const btn = e.target.closest("[data-absent-toggle]");
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
  
    const key = btn.dataset.absentToggle;
    const character = roster.find((c) => charKey(c) === key);
    if (character) toggleAbsent(character);
  }

  function handleRemoveSlotClick(e) {
    const btn = e.target.closest("[data-remove-slot]");
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();

    const [groupIndex, slotIndex] = btn.dataset.removeSlot.split(":").map(Number);
    removeFromSource({ type: "slot", splitKey: activeSplitKey, groupIndex, slotIndex });
    renderAll();
  }
  
  async function toggleAbsent(character) {
    const previous = character.Absent === true;
    character.Absent = !previous;
  
    renderPool();
    renderGroups();
    if (bothSplitsOverlay.classList.contains("open")) renderBothSplitsModal();
  
    try {
      await saveRoster(roster);
      lastSavedNote.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      character.Absent = previous;
      renderPool();
      renderGroups();
      if (bothSplitsOverlay.classList.contains("open")) renderBothSplitsModal();
      alert("Failed to save absent status: " + err.message);
    }
  }

  // ---------- Spec swap ----------

  function handleSpecSwapClick(e) {
    const btn = e.target.closest("[data-spec-swap]");
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();

    const key = btn.dataset.specSwap;
    // data-split-key is set on every swap button to the split being rendered.
    // Fall back to activeSplitKey for safety.
    const splitKey = btn.dataset.splitKey || activeSplitKey;
    const character = roster.find((c) => charKey(c) === key);
    if (character) toggleSpec(character, splitKey);
  }

  async function toggleSpec(character, splitKey) {
    // Derive current state from the override bucket — never from character object.
    const wasOnOffspec = isCharOnOffspec(character, splitKey);

    if (!splitsState.specOverrides) splitsState.specOverrides = {};
    if (!splitsState.specOverrides[splitKey]) splitsState.specOverrides[splitKey] = {};

    const key = charKey(character);
    if (wasOnOffspec) {
      delete splitsState.specOverrides[splitKey][key];
    } else {
      splitsState.specOverrides[splitKey][key] = true;
    }

    renderPool();
    renderGroups();
    if (bothSplitsOverlay.classList.contains("open")) renderBothSplitsModal();

    try {
      await saveSplits(splitsState);
      lastSavedNote.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      // Rollback
      if (wasOnOffspec) {
        splitsState.specOverrides[splitKey][key] = true;
      } else {
        delete splitsState.specOverrides[splitKey][key];
      }
      renderPool();
      renderGroups();
      if (bothSplitsOverlay.classList.contains("open")) renderBothSplitsModal();
      alert("Failed to save spec swap: " + err.message);
    }
  }

  // ---------- Helpers ----------

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }
})();
