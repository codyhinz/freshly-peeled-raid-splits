/**
 * login.js
 * Handles the login form submission: stores URL + password, verifies
 * them against the backend, then redirects to the roster page.
 */

(function () {
  const form = document.getElementById("login-form");
  const urlInput = document.getElementById("script-url");
  const pwInput = document.getElementById("password");
  const alertBox = document.getElementById("login-alert");
  const submitBtn = document.getElementById("login-submit");

  // Pre-fill if a URL was already saved this session (e.g. user logged
  // out and is logging back in).
  const savedUrl = getScriptUrl();
  if (savedUrl) urlInput.value = savedUrl;

  function showAlert(message, type) {
    alertBox.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  }

  function clearAlert() {
    alertBox.innerHTML = "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearAlert();

    const url = urlInput.value.trim();
    const pw = pwInput.value;

    if (!url || !pw) {
      showAlert("Both fields are required.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";

    try {
      await attemptLogin(url, pw);
      showAlert("Success — loading roster…", "success");
      window.location.href = "roster.html";
    } catch (err) {
      clearSession();
      showAlert(
        "Couldn't log in: " + err.message + ". Double-check the URL and password.",
        "error"
      );
      submitBtn.disabled = false;
      submitBtn.textContent = "Enter";
    }
  });
})();
