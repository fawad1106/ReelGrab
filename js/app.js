(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");

  const configuredApiUrl = typeof window.DOWNLOAD_API_URL === "string"
    ? window.DOWNLOAD_API_URL.trim()
    : "";
  const API_BASE = (configuredApiUrl || "https://reelgrab-api-79yl.onrender.com/api/download")
    .replace(/\/api\/download\/?$/, "");

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

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {})
        }
      });
    } catch (error) {
      console.error("ReelGrab API network error:", error);
      throw new Error("Could not connect to ReelGrab. Please refresh and try again.");
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

    if (!response.ok) {
      throw new Error(`Could not fetch the MP4 (HTTP ${response.status}).`);
    }

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
      console.error("ReelGrab download:", error);
      setMessage(error.message || "Something went wrong.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download MP4";
    }
  });
})();
