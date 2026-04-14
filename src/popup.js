/**
 * Tab Memory Cleaner — Popup UI
 */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadTabInfo();
  await loadHistory();
  bindActions();
}

// ─── Load tab info ─────────────────────────────────────────────────

async function loadTabInfo() {
  const info = await chrome.runtime.sendMessage({ type: "get-tab-info" });
  if (!info) return;

  document.getElementById("total").textContent = info.total;
  document.getElementById("active").textContent = info.active;
  document.getElementById("discarded").textContent = info.discarded;

  const container = document.getElementById("tabs");
  if (!info.tabs || info.tabs.length === 0) {
    container.innerHTML = '<div class="empty">No tabs found</div>';
    return;
  }

  container.innerHTML = info.tabs
    .map((t) => {
      const dotClass = t.active ? "current" : t.discarded ? "discarded" : "active";
      const itemClass = t.discarded ? "tab-item is-discarded" : "tab-item";
      const title = truncate(t.title, 35);
      const status = t.active ? " (current)" : t.discarded ? " (sleeping)" : "";
      const pinned = t.pinned ? "📌 " : "";

      return `
        <div class="${itemClass}">
          <span class="dot ${dotClass}"></span>
          <span class="tab-title">${pinned}${escapeHtml(title)}${status}</span>
          <span class="tab-host">${escapeHtml(t.url)}</span>
        </div>
      `;
    })
    .join("");
}

// ─── Load action history ───────────────────────────────────────────

async function loadHistory() {
  const data = await chrome.storage.local.get({ history: [] });
  const container = document.getElementById("history");

  if (!data.history || data.history.length === 0) {
    container.innerHTML = '<div class="empty">No actions yet. Right-click a tab or use the buttons above.</div>';
    return;
  }

  container.innerHTML = data.history
    .slice(0, 10)
    .map((h) => {
      const time = new Date(h.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `
        <div class="history-item">
          <span>${escapeHtml(h.action)} — ${escapeHtml(h.url)}</span>
          <span class="time">${time}</span>
        </div>
      `;
    })
    .join("");
}

// ─── Bind action buttons ───────────────────────────────────────────

function bindActions() {
  document.querySelectorAll(".btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;

      // Confirm nuke
      if (action === "nuke") {
        const confirmed = confirm(
          "This will clear ALL data for this site (cookies, cache, storage). You will be logged out. Continue?"
        );
        if (!confirmed) return;
      }

      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "none";

      try {
        await chrome.runtime.sendMessage({ type: "action", action });
        showToast(getToastMessage(action));
      } catch (err) {
        showToast("Failed: " + err.message);
      }

      // Refresh data after a short delay
      setTimeout(async () => {
        await loadTabInfo();
        await loadHistory();
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
      }, 800);
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function getToastMessage(action) {
  const messages = {
    soft: "⚡ Tab reloaded (cache bypassed)",
    deep: "🧹 Cache + storage cleared & reloaded",
    nuke: "💣 All site data nuked & reloaded",
    "discard-others": "💤 Other tabs put to sleep",
  };
  return messages[action] || "Done!";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.substring(0, max) + "..." : str;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
