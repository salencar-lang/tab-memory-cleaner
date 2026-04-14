/**
 * Tab Memory Cleaner v2.0 — Background Service Worker
 *
 * NEW in v2:
 *   - Real memory per tab via chrome.processes API
 *   - Badge showing total memory or tab count
 *   - Auto-discard tabs exceeding threshold
 *   - Notifications when a tab is memory-hogging
 *   - Whitelist support (never auto-discard certain sites)
 *   - Periodic memory monitoring via alarms
 */

// ─── Default Settings ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  autoDiscard: false,
  autoDiscardThresholdMB: 500,
  autoDiscardAfterMinutes: 10,
  badgeMode: "memory", // "memory" | "tabs" | "off"
  notifyOnHeavyTab: true,
  heavyTabThresholdMB: 800,
  whitelist: ["meet.google.com", "zoom.us", "spotify.com", "music.youtube.com"],
};

let settings = { ...DEFAULT_SETTINGS };

// ─── Init ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  createContextMenus();
  setupAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  setupAlarms();
});

// ─── Settings ──────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.sync.get({ settings: DEFAULT_SETTINGS });
  settings = { ...DEFAULT_SETTINGS, ...data.settings };
}

async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await chrome.storage.sync.set({ settings });
}

// ─── Alarms (periodic monitoring) ──────────────────────────────────

function setupAlarms() {
  chrome.alarms.create("memory-check", { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "memory-check") {
    await updateBadge();
    if (settings.autoDiscard) {
      await autoDiscardHeavyTabs();
    }
  }
});

// ─── Memory Monitoring ─────────────────────────────────────────────

/**
 * Get memory info for all tabs by mapping processes to tabs.
 * Returns array of { tabId, title, url, hostname, memoryMB, processId, active, discarded, pinned }
 */
async function getTabsWithMemory() {
  const tabs = await chrome.tabs.query({});
  const tabsInfo = [];

  try {
    // Get all process info with memory
    const processInfo = await chrome.processes.getProcessInfo([], true);

    // Build processId -> memory map
    const processMemory = {};
    for (const [pid, proc] of Object.entries(processInfo)) {
      if (proc.privateMemory) {
        processMemory[pid] = proc.privateMemory / (1024 * 1024); // bytes -> MB
      }
    }

    // Map tabs to their processes
    for (const tab of tabs) {
      let memoryMB = 0;
      let processId = null;

      // Try to find the process for this tab
      for (const [pid, proc] of Object.entries(processInfo)) {
        if (proc.tasks) {
          for (const task of proc.tasks) {
            if (task.tabId === tab.id) {
              processId = parseInt(pid);
              memoryMB = processMemory[pid] || 0;
              break;
            }
          }
        }
        if (processId) break;
      }

      let hostname = "";
      try {
        hostname = new URL(tab.url || "").hostname;
      } catch {}

      tabsInfo.push({
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title || "Untitled",
        url: tab.url || "",
        hostname,
        memoryMB: Math.round(memoryMB * 10) / 10,
        processId,
        active: tab.active,
        discarded: tab.discarded,
        pinned: tab.pinned,
      });
    }
  } catch (err) {
    // Fallback: processes API not available (e.g., some Chrome builds)
    console.warn("[TMC] chrome.processes not available:", err.message);
    for (const tab of tabs) {
      let hostname = "";
      try {
        hostname = new URL(tab.url || "").hostname;
      } catch {}

      tabsInfo.push({
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title || "Untitled",
        url: tab.url || "",
        hostname,
        memoryMB: 0,
        processId: null,
        active: tab.active,
        discarded: tab.discarded,
        pinned: tab.pinned,
      });
    }
  }

  // Sort by memory descending
  tabsInfo.sort((a, b) => b.memoryMB - a.memoryMB);
  return tabsInfo;
}

/**
 * Get system memory info
 */
async function getSystemMemory() {
  try {
    const info = await chrome.system.memory.getInfo();
    return {
      totalGB: Math.round((info.capacity / (1024 * 1024 * 1024)) * 10) / 10,
      availableGB:
        Math.round(
          (info.availableCapacity / (1024 * 1024 * 1024)) * 10
        ) / 10,
      usedPercent: Math.round(
        ((info.capacity - info.availableCapacity) / info.capacity) * 100
      ),
    };
  } catch {
    return { totalGB: 0, availableGB: 0, usedPercent: 0 };
  }
}

// ─── Badge ─────────────────────────────────────────────────────────

async function updateBadge() {
  if (settings.badgeMode === "off") {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  try {
    const tabsInfo = await getTabsWithMemory();
    const totalMemoryMB = tabsInfo.reduce((sum, t) => sum + t.memoryMB, 0);
    const activeCount = tabsInfo.filter((t) => !t.discarded).length;

    let text, color;

    if (settings.badgeMode === "memory") {
      if (totalMemoryMB >= 1000) {
        text = `${(totalMemoryMB / 1000).toFixed(1)}G`;
      } else {
        text = `${Math.round(totalMemoryMB)}M`;
      }
      // Color based on memory pressure
      if (totalMemoryMB > 4000) {
        color = "#d32f2f"; // red
      } else if (totalMemoryMB > 2000) {
        color = "#f57c00"; // orange
      } else {
        color = "#388e3c"; // green
      }
    } else {
      // tabs mode
      text = `${activeCount}`;
      color = activeCount > 20 ? "#d32f2f" : activeCount > 10 ? "#f57c00" : "#388e3c";
    }

    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });

    // Check for heavy tabs and notify
    if (settings.notifyOnHeavyTab) {
      for (const tab of tabsInfo) {
        if (
          tab.memoryMB > settings.heavyTabThresholdMB &&
          !tab.discarded &&
          !tab.active
        ) {
          await notifyHeavyTab(tab);
        }
      }
    }
  } catch (err) {
    console.error("[TMC] Badge update failed:", err.message);
  }
}

// ─── Notifications ─────────────────────────────────────────────────

const notifiedTabs = new Set();

async function notifyHeavyTab(tab) {
  // Don't spam — notify once per tab per session
  if (notifiedTabs.has(tab.tabId)) return;
  notifiedTabs.add(tab.tabId);

  chrome.notifications.create(`heavy-${tab.tabId}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `${tab.hostname} is using ${Math.round(tab.memoryMB)}MB`,
    message: `This tab is consuming excessive memory. Click to deep clean it.`,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith("heavy-")) {
    const tabId = parseInt(notificationId.replace("heavy-", ""));
    try {
      const tab = await chrome.tabs.get(tabId);
      await deepClean(tab);
    } catch {}
  }
});

// ─── Auto-Discard ──────────────────────────────────────────────────

async function autoDiscardHeavyTabs() {
  const tabsInfo = await getTabsWithMemory();

  for (const tab of tabsInfo) {
    // Skip: active, pinned, discarded, whitelisted, or below threshold
    if (tab.active || tab.pinned || tab.discarded) continue;
    if (tab.memoryMB < settings.autoDiscardThresholdMB) continue;
    if (isWhitelisted(tab.hostname)) continue;
    if (!isDiscardable(tab)) continue;

    try {
      await chrome.tabs.discard(tab.tabId);
      logAction(`auto-discard (${Math.round(tab.memoryMB)}MB)`, tab);
    } catch {}
  }
}

function isWhitelisted(hostname) {
  return settings.whitelist.some(
    (pattern) =>
      hostname === pattern ||
      hostname.endsWith(`.${pattern}`)
  );
}

// ─── Context Menu ──────────────────────────────────────────────────

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "tmc-parent",
      title: "Tab Memory Cleaner",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-soft",
      parentId: "tmc-parent",
      title: "\u26a1 Soft Clean (hard reload)",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-deep",
      parentId: "tmc-parent",
      title: "\ud83e\uddf9 Deep Clean (clear cache + reload)",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-nuke",
      parentId: "tmc-parent",
      title: "\ud83d\udca3 Nuke & Reload (clear ALL site data)",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-sep1",
      parentId: "tmc-parent",
      type: "separator",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-discard-others",
      parentId: "tmc-parent",
      title: "\ud83d\udca4 Discard Other Tabs",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-discard-left",
      parentId: "tmc-parent",
      title: "\u2b05\ufe0f Discard Tabs to the Left",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-discard-right",
      parentId: "tmc-parent",
      title: "\u27a1\ufe0f Discard Tabs to the Right",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-sep2",
      parentId: "tmc-parent",
      type: "separator",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "tmc-discard-by-memory",
      parentId: "tmc-parent",
      title: "\ud83d\udcc9 Discard Heaviest Tabs (>500MB)",
      contexts: ["all"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  switch (info.menuItemId) {
    case "tmc-soft":
      await softClean(tab);
      break;
    case "tmc-deep":
      await deepClean(tab);
      break;
    case "tmc-nuke":
      await nukeAndReload(tab);
      break;
    case "tmc-discard-others":
      await discardOtherTabs(tab);
      break;
    case "tmc-discard-left":
      await discardDirectionalTabs(tab, "left");
      break;
    case "tmc-discard-right":
      await discardDirectionalTabs(tab, "right");
      break;
    case "tmc-discard-by-memory":
      await discardByMemory();
      break;
  }
});

// ─── Keyboard Shortcuts ────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case "soft-clean":
      await softClean(tab);
      break;
    case "deep-clean":
      await deepClean(tab);
      break;
    case "nuke-reload":
      await nukeAndReload(tab);
      break;
    case "discard-others":
      await discardOtherTabs(tab);
      break;
  }
});

// ─── Clean Actions ─────────────────────────────────────────────────

async function softClean(tab) {
  try {
    if (tab.active) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      logAction("soft-clean (hard reload)", tab);
    } else {
      await chrome.tabs.discard(tab.id);
      logAction("soft-clean (discarded)", tab);
    }
  } catch (err) {
    console.error("[TMC] Soft clean failed:", err.message);
  }
}

async function deepClean(tab) {
  try {
    const origin = extractOrigin(tab.url);
    if (!origin) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      return;
    }

    await chrome.browsingData.remove(
      { origins: [origin] },
      {
        cache: true,
        cacheStorage: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      }
    );

    await chrome.tabs.reload(tab.id, { bypassCache: true });
    logAction("deep-clean", tab);
  } catch (err) {
    console.error("[TMC] Deep clean failed:", err.message);
  }
}

async function nukeAndReload(tab) {
  try {
    const origin = extractOrigin(tab.url);
    if (!origin) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      return;
    }

    await chrome.browsingData.remove(
      { origins: [origin] },
      {
        cache: true,
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        passwords: false,
        serviceWorkers: true,
        webSQL: true,
      }
    );

    await chrome.tabs.reload(tab.id, { bypassCache: true });
    logAction("nuke-and-reload", tab);
  } catch (err) {
    console.error("[TMC] Nuke failed:", err.message);
  }
}

async function discardOtherTabs(activeTab) {
  try {
    const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
    let count = 0;
    for (const t of tabs) {
      if (t.id === activeTab.id || t.active || t.pinned) continue;
      if (isDiscardable(t)) {
        try {
          await chrome.tabs.discard(t.id);
          count++;
        } catch {}
      }
    }
    logAction(`discard-others (${count} tabs)`, activeTab);
  } catch (err) {
    console.error("[TMC] Discard others failed:", err.message);
  }
}

async function discardDirectionalTabs(activeTab, direction) {
  try {
    const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
    let count = 0;
    for (const t of tabs) {
      const isTarget =
        direction === "left"
          ? t.index < activeTab.index
          : t.index > activeTab.index;
      if (!isTarget || t.active || t.pinned) continue;
      if (isDiscardable(t)) {
        try {
          await chrome.tabs.discard(t.id);
          count++;
        } catch {}
      }
    }
    logAction(`discard-${direction} (${count} tabs)`, activeTab);
  } catch (err) {
    console.error(`[TMC] Discard ${direction} failed:`, err.message);
  }
}

async function discardByMemory() {
  try {
    const tabsInfo = await getTabsWithMemory();
    let count = 0;
    for (const tab of tabsInfo) {
      if (tab.active || tab.pinned || tab.discarded) continue;
      if (tab.memoryMB < 500) continue;
      if (isWhitelisted(tab.hostname)) continue;
      try {
        await chrome.tabs.discard(tab.tabId);
        count++;
      } catch {}
    }
    logAction(`discard-by-memory (${count} tabs >500MB)`, { url: "bulk" });
  } catch (err) {
    console.error("[TMC] Discard by memory failed:", err.message);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function extractOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isDiscardable(tab) {
  if (!tab.url) return false;
  const url = tab.url;
  return (
    !url.startsWith("chrome://") &&
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("devtools://") &&
    !url.startsWith("edge://") &&
    !tab.discarded
  );
}

function logAction(action, tab) {
  const entry = {
    action,
    url: tab.url ? (() => { try { return new URL(tab.url).hostname; } catch { return "unknown"; } })() : "unknown",
    timestamp: new Date().toISOString(),
  };

  chrome.storage.local.get({ history: [] }, (data) => {
    const history = data.history;
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    chrome.storage.local.set({ history });
  });

  console.log(`[TMC] ${action} → ${entry.url}`);
}

// ─── Message handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-tabs-memory") {
    (async () => {
      const tabs = await getTabsWithMemory();
      const system = await getSystemMemory();
      const totalMB = tabs.reduce((s, t) => s + t.memoryMB, 0);
      sendResponse({ tabs, system, totalMB });
    })();
    return true;
  }

  if (msg.type === "get-settings") {
    sendResponse({ settings });
    return false;
  }

  if (msg.type === "save-settings") {
    saveSettings(msg.settings).then(() => {
      updateBadge();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "action") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const tab = tabs[0];
      const actions = {
        soft: softClean,
        deep: deepClean,
        nuke: nukeAndReload,
        "discard-others": discardOtherTabs,
        "discard-by-memory": discardByMemory,
      };
      const fn = actions[msg.action];
      if (fn) fn(tab).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === "get-history") {
    chrome.storage.local.get({ history: [] }, (data) => {
      sendResponse({ history: data.history });
    });
    return true;
  }
});

// Initial badge update
loadSettings().then(() => updateBadge());
