/**
 * validation.js
 *
 * Evaluates a single split's group assignments against the fixed
 * VALIDATION_RULES checklist from constants.js. Pure functions only —
 * no DOM access here, so this can be tested/reasoned about in isolation
 * from the drag-and-drop rendering code in splits.js.
 *
 * A "split" is represented as: groups = [ [slot,slot,slot,slot,slot], ... x5 ]
 * where each slot is either null (empty) or a roster character object
 * (the same shape used in roster.html: PlayerName, CharName, Class, Spec,
 * Role, OffspecRole, MainOrAlt, DSTEligible, Absent).
 */

/**
 * Flatten a split's groups into a single array of non-null characters.
 */
function flattenSplit(groups) {
  return groups.flat().filter((slot) => slot !== null && slot !== undefined);
}

/**
 * Effective role for validation purposes. Flex specs (e.g. Feral Druid)
 * are recorded with whatever role the roster entry specifies (tank or
 * dps), so this just normalizes casing.
 */
function effectiveRole(character) {
  return (character.Role || "").toLowerCase();
}

function classKeyOf(character) {
  return (character.Class || "").toLowerCase();
}

function specKeyOf(character) {
  return (character.Spec || "").toLowerCase().replace(/\s+/g, "");
}

/**
 * Count how many characters in the split match a given class.
 */
function countByClass(characters, classKey) {
  return characters.filter((c) => classKeyOf(c) === classKey).length;
}

/**
 * Count how many characters in the split have a given role as their
 * PRIMARY role. (Offspec roles intentionally don't count toward hard
 * minimums — an offspec tank only "counts" if explicitly slotted as
 * Role: tank for that split, matching how a real raid leader would
 * actually assign someone for the night.)
 */
function countByRole(characters, role) {
  return characters.filter((c) => effectiveRole(c) === role).length;
}

function countBySpec(characters, classKey, specKey) {
  return characters.filter((c) => classKeyOf(c) === classKey && specKeyOf(c) === specKey).length;
}

/**
 * Run every rule in VALIDATION_RULES against a split's groups.
 * Returns { errors: [...], warnings: [...] } where each entry is
 * { rule, message, suggestion }.
 */
function validateSplit(groups) {
  const characters = flattenSplit(groups);
  const errors = [];
  const warnings = [];

  VALIDATION_RULES.forEach((rule) => {
    const result = runRule(rule, characters, groups);
    if (result === true) return; // rule passed, nothing to report

    const entry = { rule, message: result.message, suggestion: result.suggestion || null };
    if (rule.type === "hard") errors.push(entry);
    else warnings.push(entry);
  });

  return { errors, warnings, totalPlayers: characters.length };
}

/**
 * Run a single rule. Returns `true` if it passes, or an object
 * { message, suggestion } describing the failure if it doesn't.
 */
function runRule(rule, characters, groups) {
  switch (rule.check) {
    case "minPlayers": {
      const count = characters.length;
      if (count >= rule.value) return true;
      return {
        message: `${rule.label} (currently ${count}/${rule.value})`,
        suggestion: count === 0 ? null : `Add ${rule.value - count} more player(s) to this split.`
      };
    }

    case "minClassCount": {
      const count = countByClass(characters, rule.class);
      if (count >= rule.value) return true;
      return {
        message: `${rule.label} (currently ${count}/${rule.value})`,
        suggestion: suggestAddClass(rule.class, characters)
      };
    }

    case "minRoleCount": {
      const count = countByRole(characters, rule.role);
      if (count >= rule.value) return true;
      return {
        message: `${rule.label} (currently ${count}/${rule.value})`,
        suggestion: suggestAddRole(rule.role, characters)
      };
    }

    case "minSpecCount": {
      const count = countBySpec(characters, rule.class, rule.spec);
      if (count >= rule.value) return true;
      return {
        message: rule.label,
        suggestion: suggestAddSpec(rule.class, rule.spec, characters)
      };
    }

    case "oneOfEachClass": {
      const missing = Object.keys(CLASSES).filter((key) => countByClass(characters, key) === 0);
      if (missing.length === 0) return true;
      const missingLabels = missing.map((k) => CLASSES[k].label).join(", ");
      return {
        message: `No representation from: ${missingLabels}`,
        suggestion: null
      };
    }

    case "shamanPerGroup": {
      const groupsMissingShaman = groups
        .map((group, i) => ({ i, hasShaman: group.some((slot) => slot && classKeyOf(slot) === "shaman") }))
        .filter((g) => !g.hasShaman)
        .map((g) => g.i + 1);

      if (groupsMissingShaman.length === 0) return true;
      return {
        message: `Group${groupsMissingShaman.length > 1 ? "s" : ""} ${groupsMissingShaman.join(", ")} ${groupsMissingShaman.length > 1 ? "have" : "has"} no Shaman`,
        suggestion: null
      };
    }

    default:
      return true; // unknown rule type — fail open rather than block on a bug
  }
}

/**
 * Look in the unassigned pool (passed in via a global the splits page
 * sets) for a character matching the given criteria, to power "move X
 * here to fix this" suggestions. Falls back to a generic suggestion if
 * no matching character is currently available.
 */
function suggestAddClass(classKey, currentSplitChars) {
  const candidate = findUnassignedCandidate((c) => classKeyOf(c) === classKey);
  if (candidate) {
    return `Add ${candidate.CharName} (${CLASSES[classKey].label}) from the unassigned pool.`;
  }
  return `No unassigned ${CLASSES[classKey].label} available — you may need to pull one from the other split.`;
}

function suggestAddRole(role, currentSplitChars) {
  const candidate = findUnassignedCandidate((c) => effectiveRole(c) === role);
  if (candidate) {
    return `Add ${candidate.CharName} (${roleLabelFor(role)}) from the unassigned pool.`;
  }
  // Check offspec candidates as a secondary suggestion
  const offspecCandidate = findUnassignedCandidate((c) => (c.OffspecRole || "").toLowerCase() === role);
  if (offspecCandidate) {
    return `${offspecCandidate.CharName} can offspec into ${roleLabelFor(role)} if needed.`;
  }
  return `No unassigned ${roleLabelFor(role)} available — consider an offspec swap or pulling from the other split.`;
}

function suggestAddSpec(classKey, specKey, currentSplitChars) {
  const candidate = findUnassignedCandidate((c) => classKeyOf(c) === classKey && specKeyOf(c) === specKey);
  if (candidate) {
    const specLabel = CLASSES[classKey].specs[specKey].label;
    return `Add ${candidate.CharName} (${specLabel} ${CLASSES[classKey].label}) from the unassigned pool.`;
  }
  return `No unassigned candidate available for this — check the other split's roster.`;
}

function roleLabelFor(role) {
  return (ROLES[role] && ROLES[role].label) || role;
}

/**
 * The splits page sets window.__unassignedPool before calling validation
 * so suggestion logic can search it. Kept as a simple global rather than
 * threading it through every function call, since this file has no other
 * state of its own.
 */
function findUnassignedCandidate(predicate) {
  const pool = window.__unassignedPool || [];
  return pool.find((c) => !c.Absent && predicate(c)) || pool.find(predicate) || null;
}
