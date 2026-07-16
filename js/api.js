/**
 * api.js
 *
 * Shared layer for talking to the Apps Script backend, plus session
 * (password) handling. Every page includes this before its own script.
 */

const CONFIG_STORAGE_KEY = "rs_apps_script_url";
const SESSION_PASSWORD_KEY = "rs_session_password";

/**
 * The Apps Script web app URL. This is set once via the Settings page
 * and stored in sessionStorage (not committed to source, since it's
 * specific to each deployment).
 */
function getScriptUrl() {
  return sessionStorage.getItem(CONFIG_STORAGE_KEY) || "";
}

function setScriptUrl(url) {
  sessionStorage.setItem(CONFIG_STORAGE_KEY, url.trim());
}

function getSessionPassword() {
  return sessionStorage.getItem(SESSION_PASSWORD_KEY) || "";
}

function setSessionPassword(pw) {
  sessionStorage.setItem(SESSION_PASSWORD_KEY, pw);
}

function clearSession() {
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
}

function isLoggedIn() {
  return Boolean(getSessionPassword()) && Boolean(getScriptUrl());
}

/**
 * Redirect to login if there's no active session. Call this at the top
 * of every protected page's script.
 */
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = "index.html";
  }
}

/**
 * GET the current roster + splits data from the backend.
 * Returns a parsed object: { status, roster, splits } or throws.
 */
async function fetchData() {
  const url = getScriptUrl();
  if (!url) throw new Error("No backend URL configured. Set it on the Login page.");

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);

  const json = await res.json();
  if (json.status === "error") throw new Error(json.message || "Unknown server error");
  return json;
}

/**
 * POST an action + payload to the backend, with the session password
 * attached automatically.
 */
async function postData(action, data) {
  const url = getScriptUrl();
  if (!url) throw new Error("No backend URL configured. Set it on the Login page.");

  const body = {
    action,
    password: getSessionPassword(),
    data
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Server returned ${res.status}`);

  const json = await res.json();
  if (json.status === "error") throw new Error(json.message || "Unknown server error");
  return json;
}

async function saveRoster(rosterArray) {
  return postData("saveRoster", rosterArray);
}

async function saveSplits(splitsObject) {
  return postData("saveSplits", splitsObject);
}

async function saveSnapshot(name, splitsObject) {
  return postData("saveSnapshot", { name, splits: splitsObject });
}

async function loadSnapshot(name) {
  return postData("loadSnapshot", { name });
}

async function deleteSnapshot(name) {
  return postData("deleteSnapshot", { name });
}

/**
 * Attempt a login: store the URL + password, then verify both work
 * before declaring success.
 *
 * Read access doesn't require a password (GET is unauthenticated by
 * design), so a successful fetchData() only confirms the URL is valid.
 * To verify the password, we re-save the EXACT splits data we just
 * read — a true no-op write — rather than risk clobbering it with `{}`
 * if nothing has been saved yet.
 */
async function attemptLogin(scriptUrl, password) {
  setScriptUrl(scriptUrl);
  setSessionPassword(password);

  const current = await fetchData(); // throws if the URL itself is bad

  if (current.splits !== null && current.splits !== undefined) {
    await saveSplits(current.splits); // no-op re-save, verifies password
  } else {
    // Nothing saved yet — do a no-op roster re-save instead, which is
    // always safe since we write back exactly what we just read.
    await saveRoster(current.roster || []);
  }

  return true;
}
