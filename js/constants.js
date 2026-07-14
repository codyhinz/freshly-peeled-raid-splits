/**
 * constants.js
 *
 * Single source of truth for class/spec metadata, role definitions,
 * TBC raid buffs/debuffs, and validation thresholds.
 *
 * No frameworks, no build step — plain globals attached to window so
 * every page's <script> tags can use them directly.
 */

// ---------- CLASS COLORS (standard WoW class colors) ----------

const CLASS_COLORS = {
  warrior:    "#C79C6E",
  paladin:    "#F58CBA",
  hunter:     "#ABD473",
  rogue:      "#FFF569",
  priest:     "#FFFFFF",
  shaman:     "#0070DE",
  mage:       "#69CCF0",
  warlock:    "#9482C9",
  druid:      "#FF7D0A"
};

// ---------- CLASS + SPEC DEFINITIONS ----------
// `role` = primary role this spec is built for.
// `canTank` / `canHeal` / `canDPS` = which roles this spec can flex into
// (used for validation, e.g. Feral Druid counting toward tank OR dps).

const CLASSES = {
  warrior: {
    label: "Warrior",
    armor: "Plate",
    specs: {
      arms:       { label: "Arms",       role: "dps",  icon: "warrior-arms.png" },
      fury:       { label: "Fury",       role: "dps",  icon: "warrior-fury.png" },
      protection: { label: "Protection", role: "tank", icon: "warrior-protection.png" }
    }
  },
  paladin: {
    label: "Paladin",
    armor: "Plate",
    specs: {
      holy:        { label: "Holy",        role: "healer", icon: "paladin-holy.png" },
      protection:  { label: "Protection",  role: "tank",   icon: "paladin-protection.png" },
      retribution: { label: "Retribution", role: "dps",    icon: "paladin-retribution.png" }
    }
  },
  hunter: {
    label: "Hunter",
    armor: "Mail",
    specs: {
      beastmastery: { label: "Beast Mastery", role: "dps", icon: "hunter-beastmastery.png" },
      marksman:     { label: "Marksmanship",  role: "dps", icon: "hunter-marksman.png" },
      survival:     { label: "Survival",      role: "dps", icon: "hunter-survival.png" }
    }
  },
  shaman: {
    label: "Shaman",
    armor: "Mail",
    specs: {
      elemental:   { label: "Elemental",   role: "dps",    icon: "shaman-elemental.png" },
      enhancement: { label: "Enhancement", role: "dps",    icon: "shaman-enhancement.png" },
      restoration: { label: "Restoration", role: "healer", icon: "shaman-restoration.png" }
    }
  },
  rogue: {
    label: "Rogue",
    armor: "Leather",
    specs: {
      assassination: { label: "Assassination", role: "dps", icon: "rogue-assassination.png" },
      combat:         { label: "Combat",        role: "dps", icon: "rogue-combat.png" },
      subtlety:       { label: "Subtlety",       role: "dps", icon: "rogue-subtlety.png" }
    }
  },
  druid: {
    label: "Druid",
    armor: "Leather",
    specs: {
      balance:     { label: "Balance",     role: "dps",    icon: "druid-balance.png" },
      feral:       { label: "Feral",       role: "flex",   icon: "druid-guardian.png", flexRoles: ["tank", "dps"] },
      restoration: { label: "Restoration", role: "healer", icon: "druid-restoration.png" }
    }
  },
  priest: {
    label: "Priest",
    armor: "Cloth",
    specs: {
      holy:       { label: "Holy",       role: "healer", icon: "priest-holy.png" },
      discipline: { label: "Discipline", role: "healer", icon: "priest-discipline.png" },
      shadow:     { label: "Shadow",     role: "dps",     icon: "priest-shadow.png" }
    }
  },
  mage: {
    label: "Mage",
    armor: "Cloth",
    specs: {
      arcane: { label: "Arcane", role: "dps", icon: "mage-arcane.png" },
      fire:   { label: "Fire",   role: "dps", icon: "mage-fire.png" },
      frost:  { label: "Frost",  role: "dps", icon: "mage-frost.png" }
    }
  },
  warlock: {
    label: "Warlock",
    armor: "Cloth",
    specs: {
      affliction:  { label: "Affliction",  role: "dps", icon: "warlock-affliction.png" },
      demonology:  { label: "Demonology",  role: "dps", icon: "warlock-demonology.png" },
      destruction: { label: "Destruction", role: "dps", icon: "warlock-destruction.png" }
    }
  }
};

// ---------- ROLE METADATA ----------

const ROLES = {
  tank:   { label: "Tank",   icon: "assets/icons/roles/tank.png" },
  healer: { label: "Healer", icon: "assets/icons/roles/healer.png" },
  dps:    { label: "DPS",    icon: "assets/icons/roles/dps.png" }
};

// ---------- RAID STRUCTURE ----------

const RAID_CONFIG = {
  splitNames: ["Split A", "Split B"],
  maxPerSplit: 25,
  groupsPerSplit: 5,
  playersPerGroup: 5,
  minViablePerSplit: 18
};

// ---------- VALIDATION THRESHOLDS (fixed checklist) ----------
// `type: "hard"` blocks/flags the split as invalid.
// `type: "soft"` shows as a warning only, never blocks.

const VALIDATION_RULES = [
  {
    id: "min-players",
    type: "hard",
    label: "Needs at least 18 players",
    check: "minPlayers",
    value: RAID_CONFIG.minViablePerSplit
  },
  {
    id: "min-paladins",
    type: "hard",
    label: "Needs at least 3 Paladins (for Blessings)",
    check: "minClassCount",
    class: "paladin",
    value: 3
  },
  {
    id: "min-tanks",
    type: "hard",
    label: "Needs at least 3 tanks",
    check: "minRoleCount",
    role: "tank",
    value: 3
  },
  {
    id: "min-healers",
    type: "hard",
    label: "Needs at least 4 healers",
    check: "minRoleCount",
    role: "healer",
    value: 4
  },
  {
    id: "needs-boomkin",
    type: "hard",
    label: "Needs at least 1 Balance Druid (3% physical hit debuff)",
    check: "minSpecCount",
    class: "druid",
    spec: "balance",
    value: 1
  },
  {
    id: "one-of-each-class",
    type: "soft",
    label: "Missing representation from at least one class",
    check: "oneOfEachClass"
  },
  {
    id: "shaman-per-group",
    type: "soft",
    label: "One or more groups has no Shaman",
    check: "shamanPerGroup"
  }
];

// ---------- TBC RAID BUFFS & DEBUFFS ----------
// Only group-scoped buffs are listed here — raid-wide buffs (Fortitude,
// MotW, AI, Blessings, etc.) and boss debuffs are omitted since they
// don't affect group composition decisions.
// `icon` is the zamimg icon stem (loaded from wow.zamimg.com at runtime).
// `providers` lists which class/spec combos can bring this buff.

const RAID_BUFFS = [
  {
    id: "bloodlust",
    label: "Totems",
    icon: "spell_nature_bloodlust",
    category: "buff",
    providers: [{ class: "shaman" }]
  },
  {
    id: "unleashed-rage",
    label: "Unleashed Rage",
    icon: "spell_nature_unleashedrage",
    category: "buff",
    providers: [{ class: "shaman", spec: "enhancement" }]
  },
  {
    id: "totem-of-wrath",
    label: "Totem of Wrath",
    icon: "spell_fire_totemofwrath",
    category: "buff",
    providers: [{ class: "shaman", spec: "elemental" }]
  },
  {
    id: "mana-tide",
    label: "Mana Tide Totem",
    icon: "spell_frost_summonwaterelemental",
    category: "buff",
    providers: [{ class: "shaman", spec: "restoration" }]
  },
  {
    id: "ferocious-inspiration",
    label: "Ferocious Inspiration",
    icon: "ability_hunter_ferociousinspiration",
    category: "buff",
    providers: [{ class: "hunter", spec: "beastmastery" }]
  },
  {
    id: "trueshot-aura",
    label: "Trueshot Aura",
    icon: "ability_trueshot",
    category: "buff",
    providers: [{ class: "hunter", spec: "marksman" }]
  },
  {
    id: "leader-of-the-pack",
    label: "Leader of the Pack",
    icon: "spell_nature_unyeildingstamina",
    category: "buff",
    providers: [{ class: "druid", spec: "feral" }]
  },
  {
    id: "moonkin-form",
    label: "Moonkin Aura (5% Spell Crit)",
    icon: "spell_nature_forceofnature",
    category: "buff",
    providers: [{ class: "druid", spec: "balance" }]
  },
  {
    id: "battle-shout",
    label: "Battle Shout (AP)",
    icon: "ability_warrior_battleshout",
    category: "buff",
    providers: [{ class: "warrior" }]
  },
  {
    id: "vampiric-touch",
    label: "Vampiric Touch (Mana)",
    icon: "spell_holy_stoicism",
    category: "buff",
    providers: [{ class: "priest", spec: "shadow" }]
  },
  {
    id: "improved-sanctity-aura",
    label: "Imp. Sanctity Aura (2% Dmg)",
    icon: "spell_holy_auraoflight",
    category: "buff",
    providers: [{ class: "paladin", spec: "retribution" }]
  }
];

const ICON_BASE_URL = "https://wow.zamimg.com/images/wow/icons";

function getBuffIconUrl(iconStem, size) {
  size = size || "small";
  return `${ICON_BASE_URL}/${size}/${iconStem}.jpg`;
}

function getSpecIconPath(className, specKey) {
  const spec = CLASSES[className] && CLASSES[className].specs[specKey];
  if (!spec) return null;
  return `assets/icons/spec/${spec.icon}`;
}

function getClassIconPath(className) {
  return `assets/icons/class/${className}.png`;
}
