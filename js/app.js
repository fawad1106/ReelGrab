(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const urlLabel = $("#urlLabel");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");
  const progressArea = $("#progressArea");
  const progressBar = $("#progressBar");
  const progressPercent = $("#progressPercent");
  const progressLabel = $("#progressLabel");
  const progressTrack = progressArea?.querySelector(".progress-track");
  const sourceTabs = [...document.querySelectorAll(".source-tab")];
  const configuredApiUrl = typeof window.DOWNLOAD_API_URL === "string" ? window.DOWNLOAD_API_URL.trim() : "";
  const API_BASE = (configuredApiUrl || "https://reelgrab-api-79yl.onrender.com/api/download").replace(/\/api\/download\/?$/, "");
  let selectedSource = "instagram";
  let progressTimer = null;
  let progressValue = 0;

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = "message " + type;
  }

  function setSource(source) {
    selectedSource = source;
    sourceTabs.forEach((tab) => {
      const active = tab.dataset.source === source;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });

    if (source === "youtube") {
      urlLabel.textContent = "YouTube Video URL";
      urlInput.placeholder = "https://www.youtube.com/watch?v=...";
    } else {
      urlLabel.textContent = "Instagram Reel URL";
      urlInput.placeholder = "https://www.instagram.com/reel/...";
    }
    urlInput.value = "";
    setMessage("");
    resetProgress();
  }

  function setProgress(value, label) {
    progressValue = Math.max(0, Math.min(100, Math.round(value)));
    progressBar.style.width = progressValue + "%";
    progressPercent.textContent = progressValue + "%";
    progressLabel.textContent = label;
    if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(progressValue));
  }

  function startProgress() {
    progressArea.classList.remove("hidden");
    const source = selectedSource === "youtube" ? "YouTube" : "Instagram";
    setProgress(5, "Connecting to " + source + "…");
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (progressValue >= 90) return;
      const remaining = 90 - progressValue;
      const step = remaining > 45 ? 5 : remaining > 20 ? 3 : 1;
      const next = Math.min(90, progressValue + step);
      let label = "Downloading video…";
      if (next < 25) label = "Connecting to " + source + "…";
      else if (next < 65) label = "Downloading video…";
      else if (next < 90) label = "Preparing MP4…";
      else label = "Finalizing download…";
      setProgress(next, label);
    }, 650);
  }

  function finishProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
    setProgress(100, "Download ready!");
  }

  function resetProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
    progressArea.classList.add("hidden");
    setProgress(0, "Preparing download…");
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  function isSelectedSourceUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (selectedSource === "youtube") {
        const youtubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"].includes(host);
        return youtubeHost && (host.includes("youtu.be") ? url.pathname.length > 1 : /\/(watch|shorts|live|embed)\//.test(url.pathname));
      }
      return ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)
        && /^\/(reel|reels|p)\/[^/?#]+/.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(API_BASE + path, {
        ...options,
        headers: { ...(options.headers || {}) }
      });
    } catch (error) {
      console.error("ReelGrab API network error:", error);
      throw new Error("Could not connect to ReelGrab. Please refresh and try again.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Request failed (HTTP " + response.status + ").");
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
      throw new Error("Could not fetch the MP4 (HTTP " + response.status + ").");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "reelgrab-" + Date.now() + ".mp4";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  sourceTabs.forEach((tab) => {
    tab.addEventListener("click", () => setSource(tab.dataset.source));
    tab.setAttribute("aria-pressed", String(tab.classList.contains("active")));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");
    resetProgress();

    const inputValue = urlInput.value.trim();
    const videoUrl = safeUrl(inputValue);
    if (!videoUrl) {
      setMessage("Enter a valid URL.", "error");
      return;
    }
    if (!isSelectedSourceUrl(videoUrl)) {
      const expected = selectedSource === "youtube" ? "a YouTube video URL" : "an Instagram Reel or post URL";
      setMessage("Please paste " + expected + ".", "error");
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading…";
    startProgress();

    try {
      const result = await api("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl })
      });
      if (!result.file_url) {
        throw new Error("Processing finished, but no MP4 was returned.");
      }
      finishProgress();
      setMessage("Your MP4 is ready. Starting download…", "success");
      await downloadMp4(result.file_url);
    } catch (error) {
      clearInterval(progressTimer);
      progressTimer = null;
      setMessage(error.message || "Something went wrong.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download MP4";
    }
  });
})();