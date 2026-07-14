/**
 * Raid Splits Tool — Apps Script Backend
 *
 * This script is bound to a Google Sheet with three tabs:
 *   - "Roster"  : one row per character
 *   - "Splits"  : current split A/B group assignments (stored as JSON blob)
 *   - "Config"  : holds the shared access password
 *
 * Deploy this as a Web App (Deploy > New deployment > Web app).
 * Set "Execute as: Me" and "Who has access: Anyone with the link".
 * The resulting URL is what the frontend's fetch() calls will hit.
 */

// ---------- CONSTANTS ----------

const ROSTER_SHEET_NAME = "Roster";
const SPLITS_SHEET_NAME = "Splits";
const CONFIG_SHEET_NAME = "Config";

// Roster column order — must match the header row in the Roster sheet exactly.
const ROSTER_HEADERS = [
  "PlayerName",
  "CharName",
  "Class",
  "Spec",
  "Role",
  "OffspecRole",
  "OffspecSpec",
  "MainOrAlt",
  "DSTEligible",
  "Absent"
];

// ---------- ENTRY POINTS ----------

function doGet(e) {
  try {
    const roster = readRoster_();
    const splits = readSplits_();
    return jsonResponse_({ status: "ok", roster: roster, splits: splits });
  } catch (err) {
    return jsonResponse_({ status: "error", message: err.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (!checkPassword_(payload.password)) {
      return jsonResponse_({ status: "error", message: "Unauthorized: incorrect password." });
    }

    let result;
    switch (payload.action) {
      case "saveRoster":
        result = saveRoster_(payload.data);
        break;
      case "saveSplits":
        result = saveSplits_(payload.data);
        break;
      default:
        return jsonResponse_({ status: "error", message: "Unknown action: " + payload.action });
    }

    return jsonResponse_({ status: "ok", result: result });
  } catch (err) {
    return jsonResponse_({ status: "error", message: err.message });
  }
}

// ---------- AUTH ----------

function checkPassword_(submittedPassword) {
  const sheet = getSheet_(CONFIG_SHEET_NAME);
  // Config sheet expects: A1 = "Password", B1 = the actual password value
  const storedPassword = sheet.getRange("B1").getValue().toString();
  return submittedPassword === storedPassword;
}

// ---------- ROSTER READ/WRITE ----------

function readRoster_() {
  const sheet = getSheet_(ROSTER_SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return []; // no data rows beyond header
  }

  // Use ROSTER_HEADERS as the authoritative column order, not the sheet
  // header row — this means adding a new column to ROSTER_HEADERS is
  // enough; the sheet header row is just a human-readable label.
  const numCols = ROSTER_HEADERS.length;
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  return values
    .filter(row => row.some(cell => cell !== "" && cell !== null && cell !== false))
    .map(row => {
      const obj = {};
      ROSTER_HEADERS.forEach((header, i) => {
        obj[header] = normalizeCell_(row[i]);
      });
      return obj;
    });
}

function saveRoster_(rosterArray) {
  const sheet = getSheet_(ROSTER_SHEET_NAME);

  // Clear existing data (but keep header row)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, ROSTER_HEADERS.length).clearContent();
  }

  if (!rosterArray || rosterArray.length === 0) {
    return { rowsWritten: 0 };
  }

  const rows = rosterArray.map(char =>
    ROSTER_HEADERS.map(header => {
      const val = char[header];
      return val === undefined || val === null ? "" : val;
    })
  );

  sheet.getRange(2, 1, rows.length, ROSTER_HEADERS.length).setValues(rows);

  return { rowsWritten: rows.length };
}

// ---------- SPLITS READ/WRITE ----------
// Splits are stored as a single JSON blob in cell B1 of the Splits sheet.
// This keeps the structure (groups, slots, players) flexible without
// having to map nested data into spreadsheet rows/columns.

function readSplits_() {
  const sheet = getSheet_(SPLITS_SHEET_NAME);
  const raw = sheet.getRange("B1").getValue().toString();

  if (!raw) {
    return null; // no splits saved yet
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveSplits_(splitsObject) {
  const sheet = getSheet_(SPLITS_SHEET_NAME);
  sheet.getRange("A1").setValue("SplitsData");
  sheet.getRange("B1").setValue(JSON.stringify(splitsObject));
  return { saved: true };
}

// ---------- HELPERS ----------

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error("Sheet not found: " + name);
  }
  return sheet;
}

function normalizeCell_(value) {
  // Google Sheets sometimes returns booleans as actual booleans, sometimes
  // as strings depending on entry method. Normalize TRUE/FALSE-ish values.
  if (value === true || value === "TRUE" || value === "true") return true;
  if (value === false || value === "FALSE" || value === "false") return false;
  return value;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
