/**
 * roster.js
 * Loads, renders, and edits the character roster. Talks to the backend
 * via api.js, and uses constants.js for class/spec/role metadata.
 */

(function () {
  requireLogin();

  let roster = []; // in-memory working copy
  let viewMode = "flat"; // "flat" | "grouped"

  const tableWrap = document.getElementById("roster-table-wrap");
  const countEl = document.getElementById("roster-count");
  const alertEl = document.getElementById("roster-alert");
  const viewToggleSelect = document.getElementById("view-toggle-select");

  const modal = document.getElementById("char-modal");
  const modalTitle = document.getElementById("modal-title");
  const form = document.getElementById("char-form");
  const modalAlert = document.getElementById("modal-alert");

  const fPlayerName = document.getElementById("f-player-name");
  const fCharName = document.getElementById("f-char-name");
  const fClass = document.getElementById("f-class");
  const fSpec = document.getElementById("f-spec");
  const fRole = document.getElementById("f-role");
  const fOffspecRole = document.getElementById("f-offspec-role");
  const fMainAlt = document.getElementById("f-main-alt");
  const fDst = document.getElementById("f-dst");
  const fAbsent = document.getElementById("f-absent");
  const fCharId = document.getElementById("char-id");
  const dstAltNote = document.getElementById("dst-alt-note");

  // ---------- Init ----------

  document.getElementById("logout-link").addEventListener("click", (e) => {
    e.preventDefault();
    clearSession();
    window.location.href = "index.html";
  });

  document.getElementById("refresh-btn").addEventListener("click", load);
  document.getElementById("add-char-btn").addEventListener("click", () => openModal());
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  viewToggleSelect.addEventListener("change", () => {
    viewMode = viewToggleSelect.value;
    render();
  });

  fMainAlt.addEventListener("change", syncDstLockState);
  fClass.addEventListener("change", () => {
    populateSpecOptions(fClass.value);
    populateRoleOptions(fClass.value, fSpec.value);
  });
  fSpec.addEventListener("change", () => {
    populateRoleOptions(fClass.value, fSpec.value);
  });

  form.addEventListener("submit", onSubmit);

  populateClassOptions();
  load();

  // ---------- Data loading ----------

  async function load() {
    tableWrap.innerHTML = `<div class="empty-state">Loading roster…</div>`;
    try {
      const data = await fetchData();
      roster = data.roster || [];
      clearAlert(alertEl);
      render();
    } catch (err) {
      showAlert("Failed to load roster: " + err.message, "error", alertEl);
      tableWrap.innerHTML = "";
    }
  }

  // ---------- Rendering ----------

  function render() {
    countEl.textContent = `${roster.length} character${roster.length === 1 ? "" : "s"}`;

    if (roster.length === 0) {
      tableWrap.innerHTML = `<div class="empty-state">No characters yet. Click "Add Character" to get started.</div>`;
      return;
    }

    if (viewMode === "grouped") {
      renderGroupedView();
    } else {
      renderFlatView();
    }
  }

  function renderFlatView() {
    const rows = roster.map((char, index) => renderRow(char, index)).join("");

    tableWrap.innerHTML = `
      <table class="roster-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Player</th>
            <th>Role</th>
            <th>Offspec</th>
            <th>Main/Alt</th>
            <th>DST</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Wire up row action buttons (event delegation would also work, but
    // with a modest roster size direct binding is simpler to follow).
    roster.forEach((char, index) => {
      const editBtn = document.getElementById(`edit-${index}`);
      const delBtn = document.getElementById(`del-${index}`);
      if (editBtn) editBtn.addEventListener("click", () => openModal(char, index));
      if (delBtn) delBtn.addEventListener("click", () => deleteCharacter(index));
    });
  }

  /**
   * Grouped-by-player card view. Each card lists one player's characters.
   * A card is greyed out only when EVERY character belonging to that
   * player is marked Absent — one absent alt alongside an active main
   * shouldn't grey out the whole card, since the player is still around.
   */
  function renderGroupedView() {
    // Group roster entries by PlayerName, tracking original roster
    // indices so edit/delete buttons can still target the right row.
    const groups = {}; // playerNameLower -> { displayName, entries: [{char, index}] }

    roster.forEach((char, index) => {
      const key = (char.PlayerName || "").trim().toLowerCase() || "(unknown)";
      if (!groups[key]) {
        groups[key] = { displayName: char.PlayerName || "(unknown)", entries: [] };
      }
      groups[key].entries.push({ char, index });
    });

    const sortedKeys = Object.keys(groups).sort((a, b) =>
      groups[a].displayName.localeCompare(groups[b].displayName)
    );

    const cardsHtml = sortedKeys.map((key) => playerCardHtml(groups[key])).join("");

    tableWrap.innerHTML = `<div class="player-cards-grid">${cardsHtml}</div>`;

    // Wire up action buttons across all cards
    roster.forEach((char, index) => {
      const editBtn = document.getElementById(`edit-${index}`);
      const delBtn = document.getElementById(`del-${index}`);
      if (editBtn) editBtn.addEventListener("click", () => openModal(char, index));
      if (delBtn) delBtn.addEventListener("click", () => deleteCharacter(index));
    });
  }

  function playerCardHtml(group) {
    const { displayName, entries } = group;
    const allAbsent = entries.every(({ char }) => char.Absent === true);

    const charsHtml = entries
      .map(({ char, index }) => {
        const classKey = char.Class ? char.Class.toLowerCase() : "";
        const specKey = char.Spec ? char.Spec.toLowerCase().replace(/\s+/g, "") : "";
        const iconPath = getSpecIconPath(classKey, specKey) || getClassIconPath(classKey) || "";
        const specLabel =
          (CLASSES[classKey] && CLASSES[classKey].specs[specKey] && CLASSES[classKey].specs[specKey].label) ||
          char.Spec || "Unknown";
        const classLabel = (CLASSES[classKey] && CLASSES[classKey].label) || char.Class || "Unknown";
        const isAbsent = char.Absent === true;
        const isAlt = char.MainOrAlt === "Alt";
        const dstShown = char.DSTEligible === true && !isAlt;

        return `
          <div class="player-card-char-row ${isAbsent ? "char-is-absent" : ""}">
            ${iconPath ? `<img class="spec-icon" src="${iconPath}" alt="" onerror="this.style.display='none'">` : ""}
            <div class="player-card-char-info">
              <div class="player-card-char-name class-${classKey}">${escapeHtml(char.CharName || "")}</div>
              <div class="player-card-char-meta">${classLabel} — ${specLabel}${isAlt ? " · Alt" : ""}</div>
            </div>
            <div class="player-card-char-tags">
              ${dstShown ? '<span class="chip-mini-tag tag-dst">DST</span>' : ""}
              ${isAbsent ? '<span class="chip-mini-tag tag-absent">OUT</span>' : ""}
            </div>
            <div class="player-card-char-actions">
              <button class="btn btn-sm" id="edit-${index}" title="Edit">Edit</button>
              <button class="btn btn-sm btn-danger" id="del-${index}" title="Remove">×</button>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="player-card ${allAbsent ? "is-fully-absent" : ""}">
        <div class="player-card-header">
          <span class="player-card-name">${escapeHtml(displayName)}</span>
          <span class="player-card-char-count">${entries.length} char${entries.length === 1 ? "" : "s"}</span>
        </div>
        ${charsHtml}
      </div>
    `;
  }

  function renderRow(char, index) {
    const classKey = char.Class ? char.Class.toLowerCase() : "";
    const specKey = char.Spec ? char.Spec.toLowerCase().replace(/\s+/g, "") : "";
    const iconPath = getSpecIconPath(classKey, specKey) || getClassIconPath(classKey) || "";
    const classLabel = (CLASSES[classKey] && CLASSES[classKey].label) || char.Class || "Unknown";
    const specLabel =
      (CLASSES[classKey] && CLASSES[classKey].specs[specKey] && CLASSES[classKey].specs[specKey].label) ||
      char.Spec || "Unknown";

    const isAbsent = char.Absent === true;
    const isAlt = char.MainOrAlt === "Alt";
    const dstShown = char.DSTEligible === true && !isAlt;

    return `
      <tr class="${isAbsent ? "is-absent" : ""}">
        <td>
          <div class="char-cell">
            ${iconPath ? `<img class="spec-icon" src="${iconPath}" alt="${specLabel}" onerror="this.style.display='none'">` : ""}
            <div>
              <div class="char-name class-${classKey}">${escapeHtml(char.CharName || "")}</div>
              <div class="text-muted text-sm">${classLabel} — ${specLabel}</div>
            </div>
          </div>
        </td>
        <td class="player-name">${escapeHtml(char.PlayerName || "")}</td>
        <td>${roleLabel(char.Role)}</td>
        <td>${char.OffspecRole ? roleLabel(char.OffspecRole) : "<span class=\"text-muted\">—</span>"}</td>
        <td><span class="tag ${isAlt ? "tag-alt" : "tag-main"}">${isAlt ? "Alt" : "Main"}</span></td>
        <td>${dstShown ? '<span class="tag tag-dst">DST</span>' : "<span class=\"text-muted\">—</span>"}</td>
        <td>${isAbsent ? '<span class="tag tag-absent">Absent</span>' : '<span class="text-muted">Active</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm" id="edit-${index}">Edit</button>
            <button class="btn btn-sm btn-danger" id="del-${index}">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }

  function roleLabel(roleKey) {
    if (!roleKey) return "—";
    const role = ROLES[roleKey.toLowerCase()];
    return role ? role.label : roleKey;
  }

  // ---------- Modal: dropdown population ----------

  function populateClassOptions() {
    fClass.innerHTML = Object.keys(CLASSES)
      .map((key) => `<option value="${key}">${CLASSES[key].label}</option>`)
      .join("");
    populateSpecOptions(fClass.value);
  }

  function populateSpecOptions(classKey) {
    const specs = (CLASSES[classKey] && CLASSES[classKey].specs) || {};
    fSpec.innerHTML = Object.keys(specs)
      .map((key) => `<option value="${key}">${specs[key].label}</option>`)
      .join("");
  }

  function populateRoleOptions(classKey, specKey) {
    const spec = CLASSES[classKey] && CLASSES[classKey].specs[specKey];
    if (!spec) {
      fRole.innerHTML = `<option value="tank">Tank</option><option value="healer">Healer</option><option value="dps">DPS</option>`;
      return;
    }

    if (spec.role === "flex" && spec.flexRoles) {
      // e.g. Feral Druid — let the user pick which role they're playing tonight
      fRole.innerHTML = spec.flexRoles
        .map((r) => `<option value="${r}">${ROLES[r].label}</option>`)
        .join("");
    } else {
      fRole.innerHTML = `<option value="${spec.role}">${ROLES[spec.role].label}</option>`;
    }
  }

  // ---------- Modal: open/close ----------

  function openModal(char, index) {
    form.reset();
    clearAlert(modalAlert);

    if (char) {
      modalTitle.textContent = "Edit Character";
      fCharId.value = index;
      fPlayerName.value = char.PlayerName || "";
      fCharName.value = char.CharName || "";

      const classKey = char.Class ? char.Class.toLowerCase() : Object.keys(CLASSES)[0];
      fClass.value = classKey;
      populateSpecOptions(classKey);

      const specKey = char.Spec ? char.Spec.toLowerCase().replace(/\s+/g, "") : "";
      if (specKey) fSpec.value = specKey;
      populateRoleOptions(classKey, fSpec.value);

      if (char.Role) fRole.value = char.Role.toLowerCase();
      fOffspecRole.value = char.OffspecRole ? char.OffspecRole.toLowerCase() : "";
      fMainAlt.value = char.MainOrAlt || "Main";
      fDst.checked = char.DSTEligible === true;
      fAbsent.checked = char.Absent === true;
    } else {
      modalTitle.textContent = "Add Character";
      fCharId.value = "";
      populateSpecOptions(fClass.value);
      populateRoleOptions(fClass.value, fSpec.value);
      fMainAlt.value = "Main";
      fDst.checked = false;
      fAbsent.checked = false;
    }

    syncDstLockState();
    modal.classList.add("open");
    fPlayerName.focus();
  }

  function closeModal() {
    modal.classList.remove("open");
  }

  function syncDstLockState() {
    const isAlt = fMainAlt.value === "Alt";
    fDst.disabled = isAlt;
    if (isAlt) fDst.checked = false;
    dstAltNote.style.display = isAlt ? "block" : "none";
  }

  // ---------- Save / delete ----------

  async function onSubmit(e) {
    e.preventDefault();
    clearAlert(modalAlert);

    const classKey = fClass.value;
    const specKey = fSpec.value;
    const classLabel = CLASSES[classKey].label;
    const specLabel = CLASSES[classKey].specs[specKey].label;

    const charData = {
      PlayerName: fPlayerName.value.trim(),
      CharName: fCharName.value.trim(),
      Class: classLabel,
      Spec: specLabel,
      Role: fRole.value,
      OffspecRole: fOffspecRole.value || "",
      MainOrAlt: fMainAlt.value,
      DSTEligible: fMainAlt.value === "Alt" ? false : fDst.checked,
      Absent: fAbsent.checked
    };

    const editIndex = fCharId.value;
    const editingIndexNum = editIndex !== "" ? parseInt(editIndex, 10) : null;

    // A character name can only have one roster row — it's the same
    // toon regardless of who's piloting it that night. "Piloting" is
    // handled by editing the Player Name on this same row, not by
    // creating a second row with the same Character Name.
    const duplicateIndex = roster.findIndex(
      (c, i) =>
        i !== editingIndexNum &&
        c.CharName.trim().toLowerCase() === charData.CharName.toLowerCase()
    );

    if (duplicateIndex !== -1) {
      showAlert(
        `"${charData.CharName}" is already on the roster (Player: ${roster[duplicateIndex].PlayerName}). ` +
          `A character can only have one roster entry — if someone else is piloting it tonight, edit that ` +
          `existing entry's Player Name instead of adding a new one.`,
        "error",
        modalAlert
      );
      return;
    }

    if (editingIndexNum !== null) {
      roster[editingIndexNum] = charData;
    } else {
      roster.push(charData);
    }

    const saveBtn = document.getElementById("modal-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await saveRoster(roster);
      closeModal();
      render();
    } catch (err) {
      showAlert("Failed to save: " + err.message, "error", modalAlert);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Character";
    }
  }

  async function deleteCharacter(index) {
    const char = roster[index];
    const confirmed = window.confirm(`Remove ${char.CharName} from the roster?`);
    if (!confirmed) return;

    const previous = roster.slice();
    roster.splice(index, 1);
    render();

    try {
      await saveRoster(roster);
    } catch (err) {
      roster = previous;
      render();
      showAlert("Failed to remove character: " + err.message, "error", alertEl);
    }
  }

  // ---------- Helpers ----------

  function showAlert(message, type, target) {
    target.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  }

  function clearAlert(target) {
    target.innerHTML = "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
