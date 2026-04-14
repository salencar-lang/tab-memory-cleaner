/**
 * Tab Memory Cleaner v2.1 — Popup UI
 * Works on Chrome stable (no chrome.processes dependency)
 */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadData();
  bindActions();

  // Settings button — open options page
  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage
      ? chrome.runtime.openOptionsPage()
      : chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html") });
  });
}

// ─── Load data ─────────────────────────────────────────────────────

async function loadData() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "get-tabs-memory" });
    if (!data || data.error) {
      document.getElementById("tabList").innerHTML =
        `<div class="loading" style="color:#e53935">Error: ${data?.error || "No response from background"}</div>`;
      return;
    }
    renderSystemBar(data);
    renderTabList(data.tabs, data.memoryAvailable);
  } catch (err) {
    document.getElementById("tabList").innerHTML =
      `<div class="loading" style="color:#e53935">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSystemBar(data) {
  const { system, tabs, totalMB, memoryAvailable } = data;

  // Memory ring
  const percent = system.usedPercent || 0;
  const ring = document.getElementById("memRing");
  const circumference = 125.6;
  ring.style.strokeDashoffset = circumference - (circumference * percent) / 100;

  if (percent > 85) ring.style.stroke = "#d32f2f";
  else if (percent > 70) ring.style.stroke = "#f57c00";
  else ring.style.stroke = "#388e3c";

  document.getElementById("memPercent").textContent = percent > 0 ? `${percent}%` : "--";

  document.getElementById("sysRam").textContent =
    system.totalGB > 0
      ? `${system.availableGB}GB free / ${system.totalGB}GB`
      : "System memory unavailable";

  const activeCount = tabs.filter((t) => !t.discarded).length;
  const sleepCount = tabs.filter((t) => t.discarded).length;
  document.getElementById("tabCount").textContent =
    `${activeCount} active, ${sleepCount} sleeping`;

  if (memoryAvailable && totalMB > 0) {
    const totalFormatted = totalMB >= 1000
      ? `${(totalMB / 1000).toFixed(1)} GB`
      : `${Math.round(totalMB)} MB`;
    document.getElementById("tabMem").textContent = totalFormatted;
    document.getElementById("totalMem").textContent = totalFormatted;
    document.getElementById("sectionTitle").textContent = "Tabs by memory usage";
  } else {
    document.getElementById("tabMem").textContent = `${activeCount + sleepCount} total`;
    document.getElementById("totalMem").textContent = `${activeCount} active`;
    document.getElementById("sectionTitle").textContent = "Open tabs";
  }
}

function renderTabList(tabs, memoryAvailable) {
  const container = document.getElementById("tabList");

  if (!tabs || tabs.length === 0) {
    container.innerHTML = '<div class="loading">No tabs found</div>';
    return;
  }

  const maxMem = memoryAvailable ? Math.max(...tabs.map((t) => t.memoryMB), 100) : 0;

  container.innerHTML = tabs
    .map((t) => {
      // Status dot
      let dotClass = "dot-active";
      if (t.active) dotClass = "dot-current";
      else if (t.discarded) dotClass = "dot-sleeping";
      else if (memoryAvailable && t.memoryMB > 500) dotClass = "dot-heavy";

      // Memory bar (only show when data is available)
      let barHtml = "";
      if (memoryAvailable) {
        if (t.memoryMB > 0) {
          const barPercent = Math.min(100, (t.memoryMB / maxMem) * 100);
          let barColor = "#4caf50";
          if (t.memoryMB > 800) barColor = "#d32f2f";
          else if (t.memoryMB > 400) barColor = "#f57c00";
          else if (t.memoryMB > 200) barColor = "#ffc107";

          const memText = t.memoryMB >= 1000
            ? `${(t.memoryMB / 1000).toFixed(1)}G`
            : `${Math.round(t.memoryMB)}M`;

          barHtml = `
            <div class="mem-bar">
              <div class="fill" style="width:${barPercent}%;background:${barColor}"></div>
              <span class="mem-text">${memText}</span>
            </div>`;
        } else if (t.discarded) {
          barHtml = `<div class="mem-bar"><span class="mem-text">💤</span></div>`;
        }
      } else if (t.discarded) {
        barHtml = `<span class="status-label sleeping">sleeping</span>`;
      }

      const itemClass = t.discarded ? "tab-item discarded" : "tab-item";
      const pinned = t.pinned ? "📌 " : "";
      const title = truncate(t.title, 35);

      // Per-tab action buttons (only for non-active, non-discarded tabs)
      let actionsHtml = "";
      if (!t.discarded && !t.active) {
        actionsHtml = `
          <div class="tab-actions">
            <button data-tab-action="deep" data-tab-id="${t.tabId}" title="Deep Clean">🧹</button>
            <button data-tab-action="discard" data-tab-id="${t.tabId}" title="Discard">💤</button>
          </div>`;
      }

      return `
        <div class="${itemClass}" data-tab-id="${t.tabId}">
          <span class="status-dot ${dotClass}"></span>
          ${barHtml}
          <div class="tab-info">
            <div class="tab-title">${pinned}${escapeHtml(title)}</div>
            <div class="tab-host">${escapeHtml(t.hostname)}</div>
          </div>
          ${actionsHtml}
        </div>`;
    })
    .join("");

  // Bind per-tab actions
  container.querySelectorAll("[data-tab-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      const action = btn.dataset.tabAction;

      btn.style.opacity = "0.3";
      btn.style.pointerEvents = "none";

      try {
        await chrome.runtime.sendMessage({ type: "action-tab", tabId, action });
        showToast(action === "deep" ? "🧹 Cleaned!" : "💤 Discarded!");
        setTimeout(loadData, 600);
      } catch (err) {
        showToast("Failed: " + err.message);
      }
    });
  });
}

// ─── Action buttons ────────────────────────────────────────────────

function bindActions() {
  document.querySelectorAll(".action-btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;

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

      setTimeout(async () => {
        await loadData();
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
      }, 800);
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function getToastMessage(action) {
  return {
    soft: "⚡ Hard reloaded",
    deep: "🧹 Cache + storage cleared",
    nuke: "💣 All site data nuked",
    "discard-others": "💤 Other tabs sleeping",
  }[action] || "Done!";
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
