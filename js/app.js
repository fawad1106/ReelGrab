const { createClient } = window.supabase;
const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

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

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function showDownloadLink(url) {
  if (!url) return;
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
  return new Date(value).toLocaleString();
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadUser() {
  const { data: { user } } = await supabase.auth.getUser();
  loginBtn.classList.toggle("hidden", !!user);
  logoutBtn.classList.toggle("hidden", !user);
  await loadHistory(user);
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
    historyEl.innerHTML = '<div class="empty-state">Could not load history.</div>';
    return;
  }

  if (!data.length) {
    historyEl.innerHTML = '<div class="empty-state">No downloads yet.</div>';
    return;
  }

  historyEl.innerHTML = data.map(item => `
    <article class="history-card">
      <h3>${escapeHtml(item.file_name || "Untitled video")}</h3>
      <p>${escapeHtml(item.reel_url)}</p>
      <p>${formatDate(item.created_at)}</p>
      <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      ${item.file_url ? `<a class="download-link" href="${escapeAttr(item.file_url)}" target="_blank" rel="noopener">Open MP4</a>` : ""}
    </article>
  `).join("");
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setMessage("Sign in first.", "error");
    authDialog.showModal();
    return;
  }

  const reelUrl = safeUrl(urlInput.value.trim());
  if (!reelUrl) {
    setMessage("Enter a valid URL.", "error");
    return;
  }

  if (!window.DOWNLOAD_API_URL || window.DOWNLOAD_API_URL.startsWith("YOUR_")) {
    setMessage("The download API is not configured yet.", "error");
    return;
  }

  downloadBtn.disabled = true;
  downloadBtn.textContent = "Processing…";

  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) {
      throw new Error("Your session expired. Please sign in again.");
    }

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

    await loadHistory(user);

    if (result.file_url) {
      showDownloadLink(result.file_url);
      // Keep the pasted URL visible so the user knows which request succeeded.
    } else {
      setMessage("Processing finished, but no MP4 link was returned.", "error");
    }
  } catch (error) {
    setMessage(error.message || "Something went wrong.", "error");
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Download MP4";
  }
});

loginBtn.addEventListener("click", () => authDialog.showModal());
$("#closeAuth").addEventListener("click", () => authDialog.close());

$("#refreshBtn").addEventListener("click", async () => {
  const { data: { user } } = await supabase.auth.getUser();
  await loadHistory(user);
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await loadUser();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "Sending…";
  const email = $("#email").value.trim();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  authMessage.textContent = error
    ? error.message
    : "Check your email for the sign-in link.";
});

supabase.auth.onAuthStateChange(() => loadUser());
loadUser();
