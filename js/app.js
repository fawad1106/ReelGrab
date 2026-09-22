(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");
  const historyEl = $("#history");
  const loginBtn = $("#loginBtn");
  const logoutBtn = $("#logoutBtn");
  const authDialog = $("#authDialog");
  const authForm = $("#authForm");
  const authMessage = $("#authMessage");
  const closeAuth = $("#closeAuth");
  const refreshBtn = $("#refreshBtn");

  let supabase = null;
  let initializing = true;

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = `message ${type}`;
  }

  function setAuthMessage(text, type = "") {
    authMessage.textContent = text;
    authMessage.className = `message ${type}`;
  }

  function openAuthDialog() {
    if (!authDialog) return;
    if (typeof authDialog.showModal === "function") {
      if (!authDialog.open) authDialog.showModal();
    } else {
      authDialog.setAttribute("open", "");
      authDialog.style.display = "block";
    }
    $("#email")?.focus();
  }

  function closeAuthDialog() {
    if (!authDialog) return;
    if (typeof authDialog.close === "function") {
      if (authDialog.open) authDialog.close();
    } else {
      authDialog.removeAttribute("open");
      authDialog.style.display = "";
    }
  }

  function showDownloadLink(url) {
    message.innerHTML = "";
    message.className = "message success";

    const text = document.createElement("span");
    text.textContent = "Your MP4 is ready. ";

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open / Download MP4";
    link.className = "download-link";

    message.append(text, link);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;"
    }[c]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function loadUser() {
    if (!supabase) {
      loginBtn.classList.remove("hidden");
      logoutBtn.classList.add("hidden");
      historyEl.innerHTML = '<div class="empty-state">Sign-in service is still loading. Refresh if this persists.</div>';
      return null;
    }

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn("ReelGrab auth check:", error.message);
    }

    const user = data?.user || null;
    loginBtn.classList.toggle("hidden", !!user);
    logoutBtn.classList.toggle("hidden", !user);
    await loadHistory(user);
    return user;
  }

  async function loadHistory(user) {
    if (!user) {
      historyEl.innerHTML = '<div class="empty-state">Sign in to see your download history.</div>';
      return;
    }

    const { data, error } = await supabase
      .from("downloads")
      .select("id,reel_url,file_name,status,file_url,created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("ReelGrab history:", error);
      historyEl.innerHTML = '<div class="empty-state">Could not load history. Check your connection and refresh.</div>';
      return;
    }

    if (!data?.length) {
      historyEl.innerHTML = '<div class="empty-state">No downloads yet.</div>';
      return;
    }

    historyEl.innerHTML = data.map(item => `
      <article class="history-card">
        <h3>${escapeHtml(item.file_name || "Untitled video")}</h3>
        <p>${escapeHtml(item.reel_url)}</p>
        <p>${formatDate(item.created_at)}</p>
        <span class="status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span>
        ${item.file_url ? `<a class="download-link" href="${escapeAttr(item.file_url)}" target="_blank" rel="noopener">Open MP4</a>` : ""}
      </article>
    `).join("");
  }

  async function loadSupabaseClient() {
    if (window.supabase?.createClient) {
      supabase = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );
      return true;
    }

    // Fallback CDN if the primary jsDelivr request was blocked or unavailable.
    await new Promise(resolve => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@supabase/supabase-js@2";
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });

    if (!window.supabase?.createClient) return false;

    supabase = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
    return true;
  }

  loginBtn.addEventListener("click", () => {
    setAuthMessage("");
    openAuthDialog();
  });

  closeAuth.addEventListener("click", closeAuthDialog);

  authDialog.addEventListener("click", event => {
    if (event.target === authDialog) closeAuthDialog();
  });

  refreshBtn.addEventListener("click", async () => {
    if (!supabase) {
      setMessage("Sign-in service is unavailable. Refresh the page and try again.", "error");
      return;
    }
    const user = await loadUser();
    if (user) setMessage("History refreshed.", "success");
  });

  logoutBtn.addEventListener("click", async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage(error.message, "error");
      return;
    }
    await loadUser();
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!supabase) {
      setAuthMessage("Sign-in service could not load. Please refresh and try again.", "error");
      return;
    }

    const email = $("#email").value.trim();
    if (!email) {
      setAuthMessage("Enter your email address.", "error");
      return;
    }

    setAuthMessage("Sending magic link…");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (error) {
      console.error("ReelGrab sign-in:", error);
      setAuthMessage(error.message, "error");
      return;
    }

    setAuthMessage("Check your email for the sign-in link.", "success");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("");

    if (initializing || !supabase) {
      setMessage("Sign-in service is still loading. Please wait a moment and try again.", "error");
      return;
    }

    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setMessage(sessionError.message, "error");
      return;
    }

    const session = data?.session;
    if (!session?.access_token) {
      setMessage("Sign in first.", "error");
      openAuthDialog();
      return;
    }

    const reelUrl = safeUrl(urlInput.value.trim());
    if (!reelUrl) {
      setMessage("Enter a valid URL.", "error");
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Processing…";

    try {
      const response = await fetch(window.DOWNLOAD_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ url: reelUrl })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.detail || result.error || `Download service failed (HTTP ${response.status}).`);
      }

      await loadHistory(session.user);
      if (result.file_url) {
        showDownloadLink(result.file_url);
      } else {
        setMessage("Processing finished, but no MP4 link was returned.", "error");
      }
    } catch (error) {
      console.error("ReelGrab download:", error);
      setMessage(error.message || "Something went wrong.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download MP4";
    }
  });

  async function init() {
    try {
      if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
        throw new Error("Supabase configuration is missing.");
      }

      const loaded = await loadSupabaseClient();
      if (!loaded) {
        initializing = false;
        setAuthMessage("Could not load the sign-in service. Please refresh and try again.", "error");
        return;
      }

      supabase.auth.onAuthStateChange(() => {
        // Avoid doing auth/network work inside the callback itself.
        setTimeout(() => loadUser(), 0);
      });

      await loadUser();
      initializing = false;
    } catch (error) {
      console.error("ReelGrab initialization:", error);
      initializing = false;
      setAuthMessage(error.message || "ReelGrab failed to initialize.", "error");
      historyEl.innerHTML = '<div class="empty-state">ReelGrab could not initialize. Refresh the page and try again.</div>';
    }
  }

  window.addEventListener("error", event => {
    console.error("ReelGrab browser error:", event.error || event.message);
  });

  init();
})();