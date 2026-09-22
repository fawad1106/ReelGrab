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
  const googleSignInBtn = $("#googleSignInBtn");
  const emailAuthForm = $("#emailAuthForm");
  const authEmail = $("#authEmail");
  const authPassword = $("#authPassword");
  const emailSignUpBtn = $("#emailSignUpBtn");
  const emailSignInBtn = $("#emailSignInBtn");
  const authMessage = $("#authMessage");

  const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = `message ${type}`;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
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

  async function refreshAuthState() {
    if (!supabaseClient) {
      signInBtn.textContent = "Sign in";
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.user) {
      signInBtn.textContent = "Signed in";
      signInBtn.title = data.session.user.email || "Google account";
    } else {
      signInBtn.textContent = "Sign in";
      signInBtn.title = "";
    }
  }

  signInBtn.addEventListener("click", async () => {
    if (!supabaseClient) {
      authMessage.textContent = "Sign-in service is unavailable.";
      authDialog.showModal();
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.user) {
      await supabaseClient.auth.signOut();
      await refreshAuthState();
      return;
    }

    authMessage.textContent = "";
    authDialog.showModal();
  });

  closeAuthBtn.addEventListener("click", () => authDialog.close());

  async function emailAuth(mode) {
    if (!supabaseClient) return;
    authMessage.textContent = "";
    emailSignInBtn.disabled = true;
    emailSignUpBtn.disabled = true;
    try {
      const email = authEmail.value.trim();
      const password = authPassword.value;
      const result = mode === "signup"
        ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        : await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) {
        authMessage.textContent = "Account created. Check your email to confirm your address.";
      } else {
        authDialog.close();
        await refreshAuthState();
      }
    } catch (error) {
      authMessage.textContent = error.message || "Authentication failed.";
    } finally {
      emailSignInBtn.disabled = false;
      emailSignUpBtn.disabled = false;
    }
  }

  emailAuthForm.addEventListener("submit", (event) => {
    event.preventDefault();
    emailAuth("signin");
  });

  emailSignUpBtn.addEventListener("click", () => emailAuth("signup"));

  googleSignInBtn.addEventListener("click", async () => {
    if (!supabaseClient) return;

    googleSignInBtn.disabled = true;
    googleSignInBtn.textContent = "Redirecting…";
    authMessage.textContent = "";

    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      authMessage.textContent = error.message;
      googleSignInBtn.disabled = false;
      googleSignInBtn.textContent = "Continue with Google";
    }
  });

  supabaseClient?.auth.onAuthStateChange(() => refreshAuthState());
  refreshAuthState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const reelUrl = safeUrl(urlInput.value.trim());
    if (!reelUrl) {
      setMessage("Enter a valid URL.", "error");
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Processing…";

    try {
      const headers = { "Content-Type": "application/json" };
      const { data } = supabaseClient ? await supabaseClient.auth.getSession() : { data: { session: null } };
      if (data.session?.access_token) {
        headers.Authorization = `Bearer ${data.session.access_token}`;
      }

      const response = await fetch(window.DOWNLOAD_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: reelUrl })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.detail ||
          result.error ||
          `Download service failed (HTTP ${response.status}).`
        );
      }

      if (!result.file_url) {
        throw new Error("Processing finished, but no MP4 was returned.");
      }

      setMessage("Your MP4 is ready. Starting download…", "success");
      await downloadMp4(result.file_url);
    } catch (error) {
      console.error("ReelGrab download:", error);
      setMessage(error.message || "Something went wrong.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download MP4";
    }
  });
})();