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
  const emailAuthForm = $("#emailAuthForm");
  const authEmail = $("#authEmail");
  const authPassword = $("#authPassword");
  const emailSignUpBtn = $("#emailSignUpBtn");
  const emailSignInBtn = $("#emailSignInBtn");
  const authMessage = $("#authMessage");
  const authTitle = $("#authTitle");
  const authSubtitle = $("#authSubtitle");

  let authMode = "signin";

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

  async function getSession() {
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function refreshAuthState() {
    const session = await getSession();
    if (session?.user) {
      signInBtn.textContent = "Signed in";
      signInBtn.title = session.user.email || "Signed-in account";
    } else {
      signInBtn.textContent = "Sign in";
      signInBtn.title = "";
    }
  }

  function openAuth(mode = "signin") {
    authMode = mode;
    const signingUp = mode === "signup";

    authTitle.textContent = signingUp ? "Create your ReelGrab account" : "Sign in to ReelGrab";
    authSubtitle.textContent = signingUp
      ? "Enter an email address and create a ReelGrab password."
      : "Use your email address and ReelGrab password.";
    emailSignInBtn.textContent = signingUp ? "Create account" : "Sign in";
    emailSignUpBtn.textContent = signingUp ? "Back to sign in" : "Create account";
    authEmail.autocomplete = signingUp ? "email" : "email";
    authPassword.autocomplete = signingUp ? "new-password" : "current-password";
    authMessage.textContent = "";
    authDialog.showModal();
    authEmail.focus();
  }

  signInBtn.addEventListener("click", async () => {
    if (!supabaseClient) {
      authMessage.textContent = "Sign-in service is unavailable.";
      authDialog.showModal();
      return;
    }

    const session = await getSession();
    if (session?.user) {
      await supabaseClient.auth.signOut();
      await refreshAuthState();
      return;
    }

    openAuth("signin");
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

      if (!email || !password) {
        throw new Error("Enter your email and password.");
      }

      const result = mode === "signup"
        ? await supabaseClient.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin }
          })
        : await supabaseClient.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (mode === "signup" && !result.data.session) {
        authMessage.textContent = "Account created. Check your email to confirm your address before downloading.";
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
    emailAuth(authMode);
  });

  emailSignUpBtn.addEventListener("click", () => {
    openAuth(authMode === "signup" ? "signin" : "signup");
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

    let session;
    try {
      session = await getSession();
    } catch {
      setMessage("Could not check your sign-in status. Please try again.", "error");
      return;
    }

    if (!session?.access_token) {
      setMessage("Sign in with your email before downloading.", "error");
      openAuth("signin");
      authMessage.textContent = "Sign in with your email to use ReelGrab.";
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Processing…";

    try {
      const response = await fetch(window.DOWNLOAD_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
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