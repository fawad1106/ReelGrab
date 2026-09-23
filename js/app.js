(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");
  const signInBtn = $("#signInBtn");
  const adminBtn = $("#adminBtn");
  const adminDialog = $("#adminDialog");
  const closeAdminBtn = $("#closeAdminBtn");
  const adminStats = $("#adminStats");
  const adminUsers = $("#adminUsers");
  const adminDownloads = $("#adminDownloads");
  const adminMessage = $("#adminMessage");
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
  let authReady = null;

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
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        ...options,
        headers: {
          ...(options.headers || {})
        }
      });
    } catch (error) {
      console.error("ReelGrab API network error:", error);
      throw new Error(
        "Could not connect to ReelGrab. Please refresh the page and try again. If it keeps happening, the API connection is unavailable."
      );
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || `Request failed (HTTP ${response.status}).`);
    }
    return result;
  }

  async function downloadMp4(fileUrl) {
    let response;
    try {
      response = await fetch(fileUrl);
    } catch (error) {
      console.error("ReelGrab MP4 network error:", error);
      throw new Error("The MP4 could not be reached from your browser.");
    }
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function updateAccountUi() {
    if (currentUser) {
      signInBtn.textContent = currentUser.username || "Account";
      adminBtn.classList.toggle("hidden", (currentUser.username || "").trim().toLowerCase() !== "fawad malik");
      signInBtn.title = "Signed in. Click to log out.";
      signInBtn.setAttribute("aria-label", `Signed in as ${currentUser.username || "your account"}`);
      return;
    }
    signInBtn.textContent = "Log in";
    signInBtn.title = "";
    adminBtn.classList.add("hidden");
    signInBtn.setAttribute("aria-label", "Log in");
  }

  async function refreshAuthState() {
    try {
      currentUser = await api("/api/auth/me");
    } catch {
      currentUser = null;
    } finally {
      updateAccountUi();
    }
    return currentUser;
  }

  authReady = refreshAuthState();


  async function loadAdminDashboard() {
    adminMessage.textContent = "Loading dashboard…";
    adminStats.innerHTML = "";
    adminUsers.innerHTML = "";
    adminDownloads.innerHTML = "";

    try {
      const data = await api("/api/admin/dashboard");
      const stats = data.stats || {};
      adminStats.innerHTML = [
        ["Users", stats.total_users],
        ["Downloads", stats.total_downloads],
        ["Completed", stats.completed_downloads],
        ["Failed", stats.failed_downloads],
        ["Processing", stats.processing_downloads]
      ].map(([label, value]) => `
        <div class="admin-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      `).join("");

      adminUsers.innerHTML = data.users?.length
        ? `<table><thead><tr><th>Username</th><th>Email</th><th>Joined</th></tr></thead><tbody>${
            data.users.map(user => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email || "—")}</td><td>${escapeHtml(formatDate(user.created_at))}</td></tr>`).join("")
          }</tbody></table>`
        : '<div class="empty-state">No users yet.</div>';

      adminDownloads.innerHTML = data.downloads?.length
        ? `<table><thead><tr><th>User</th><th>Instagram link</th><th>Status</th><th>File</th><th>Created</th><th>Completed</th><th>Error</th></tr></thead><tbody>${
            data.downloads.map(item => {
              const user = item.app_users || {};
              return `<tr>
                <td>${escapeHtml(user.username || item.user_id || "—")}</td>
                <td class="url-cell"><a href="${escapeHtml(item.reel_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.reel_url)}</a></td>
                <td><span class="status ${escapeHtml(item.status || "")}">${escapeHtml(item.status || "—")}</span></td>
                <td>${escapeHtml(item.file_name || "—")}</td>
                <td>${escapeHtml(formatDate(item.created_at))}</td>
                <td>${escapeHtml(formatDate(item.completed_at))}</td>
                <td>${escapeHtml(item.error_message || "—")}</td>
              </tr>`;
            }).join("")
          }</tbody></table>`
        : '<div class="empty-state">No downloads recorded yet.</div>';

      adminMessage.textContent = `Showing ${data.downloads?.length || 0} recent download records.`;
    } catch (error) {
      adminMessage.textContent = error.message || "Could not load the admin dashboard.";
      adminMessage.className = "message error";
    }
  }

  adminBtn.addEventListener("click", async () => {
    if (!currentUser || currentUser.username.trim().toLowerCase() !== "fawad malik") return;
    adminDialog.showModal();
    await loadAdminDashboard();
  });

  closeAdminBtn.addEventListener("click", () => adminDialog.close());

  signInBtn.addEventListener("click", async () => {
    if (currentUser) {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } finally {
        currentUser = null;
        updateAccountUi();
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
      updateAccountUi();
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

    await authReady;
    if (!currentUser) {
      await refreshAuthState();
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

})();