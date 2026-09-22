(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#downloadForm");
  const urlInput = $("#videoUrl");
  const downloadBtn = $("#downloadBtn");
  const message = $("#message");

  function setMessage(text, type = "") {
    message.textContent = text;
    message.className = `message ${type}`;
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

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
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
      const response = await fetch(window.DOWNLOAD_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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
})();