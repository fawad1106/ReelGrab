(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");
  const signInBtn = $("#signInBtn");
  const authDialog = $("#authDialog");
  const closeAuthBtn = $("#closeAuthBtn");
  const authForm = $("#authForm");
  const authUsername = $("#authUsername");
  const authEmail = $("#authEmail");
  const authEmailLabel = $("#authEmailLabel");
  const authPassword = $("#authPassword");
  const authSwitch = $("#authSwitch");
  const authSubmit = $("#authSubmit");
  const authMessage = $("#authMessage");
  const authTitle = $("#authTitle");
  const authSubtitle = $("#authSubtitle");

  const API_BASE = window.DOWNLOAD_API_URL.replace(/\/api\/download\/?$/, "");
  let registerMode = false;
  let currentUser = null;

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = `message ${type}`;
  }

  function setAuthMessage(text, type = "") {
    authMessage.textContent = text;
    authMessage.className = `message ${type}`;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || `Request failed (HTTP ${response.status}).`);
    }
    return result;
  }

  async function downloadMp4(fileUrl) {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Could not fetch the MP4 (HTTP ${response.status}).`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `reelgrab-${Date.now()}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function openAuth(mode = "login") {
    registerMode = mode === "register";
    authTitle.textContent = registerMode ? "Create your ReelGrab account" : "Welcome back";
    authSubtitle.textContent = registerMode
      ? "Set up your free ReelGrab account."
      : "Log in to continue to ReelGrab.";
    authEmail.hidden = !registerMode;
    authEmailLabel.hidden = !registerMode;
    authEmail.required = registerMode;
    authPassword.autocomplete = registerMode ? "new-password" : "current-password";
    authSubmit.textContent = registerMode ? "Register" : "Log in";
    authSwitch.textContent = registerMode
      ? "Already have an account? Log in"
      : "Need an account? Register";
    setAuthMessage("");
    authDialog.showModal();
    authUsername.focus();
  }

  async function refreshAuthState() {
    try {
      currentUser = await api("/api/auth/me");
      signInBtn.textContent = "Log out";
      signInBtn.title = currentUser.username || "Signed-in account";
    } catch {
      currentUser = null;
      signInBtn.textContent = "Log in";
      signInBtn.title = "";
    }
  }

  signInBtn.addEventListener("click", async () => {
    if (currentUser) {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } finally {
        currentUser = null;
        signInBtn.textContent = "Log in";
        signInBtn.title = "";
      }
      return;
    }
    openAuth("login");
  });

  closeAuthBtn.addEventListener("click", () => authDialog.close());

  authSwitch.addEventListener("click", () => {
    openAuth(registerMode ? "login" : "register");
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthMessage("");
    authSubmit.disabled = true;
    authSubmit.textContent = registerMode ? "Creating…" : "Signing in…";

    try {
      const payload = {
        username: authUsername.value.trim(),
        password: authPassword.value
      };
      if (registerMode) payload.email = authEmail.value.trim();

      currentUser = await api(registerMode ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      authDialog.close();
      signInBtn.textContent = "Log out";
      signInBtn.title = currentUser.username;
      setMessage(registerMode ? "Account created. You are now signed in." : "Signed in successfully.", "success");
      authForm.reset();
    } catch (error) {
      setAuthMessage(error.message || "Authentication failed.", "error");
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = registerMode ? "Register" : "Log in";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const reelUrl = safeUrl(urlInput.value.trim());
    if (!reelUrl) {
      setMessage("Enter a valid URL.", "error");
      return;
    }

    if (!currentUser) {
      setMessage("Log in before downloading.", "error");
      openAuth("login");
      setAuthMessage("Log in with your username and password to use ReelGrab.");
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Processing…";

    try {
      const result = await api("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: reelUrl })
      });

      if (!result.file_url) {
        throw new Error("Processing finished, but no MP4 was returned.");
      }

      setMessage("Your MP4 is ready. Starting download…", "success");
      await downloadMp4(result.file_url);
    } catch (error) {
      if (/please log in|invalid or expired/i.test(error.message || "")) {
        currentUser = null;
        await refreshAuthState();
        openAuth("login");
      }
      console.error("ReelGrab download:", error);
      setMessage(error.message || "Something went wrong.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download MP4";
    }
  });

  refreshAuthState();
})();