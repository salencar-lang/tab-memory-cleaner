/**
 * Tab Memory Cleaner v2.1 — Background Service Worker
 *
 * Works on Chrome stable (Windows/Mac/Linux).
 * Uses chrome.processes when available (Chrome OS/Dev),
 * falls back gracefully on stable Chrome.
 */

// ─── Default Settings ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  autoDiscard: false,
  autoDiscardThresholdMB: 500,
  badgeMode: "tabs", // "tabs" | "off"
  notifyOnHeavyTab: true,
  heavyTabThresholdMB: 800,
  whitelist: ["meet.google.com", "zoom.us", "spotify.com", "music.youtube.com"],
};

let settings = { ...DEFAULT_SETTINGS };

// Track if chrome.processes is available
const HAS_PROCESSES = typeof chrome.processes !== "undefined";

// ─── Init ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  createContextMenus();
  setupAlarms();
  updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  setupAlarms();
  updateBadge();
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

// ─── Alarms ────────────────────────────────────────────────────────

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
 * Get tab info. Uses chrome.processes if available (Chrome OS/Dev),
 * otherwise returns tabs without memory data (Chrome stable).
 */
async function getTabsWithMemory() {
  const tabs = await chrome.tabs.query({});
  const tabsInfo = [];

  // Try chrome.processes (only works on Chrome OS / Dev channel)
  let processMemoryMap = null;
  if (HAS_PROCESSES) {
    try {
      const processInfo = await chrome.processes.getProcessInfo([], true);
      processMemoryMap = {};

      for (const [pid, proc] of Object.entries(processInfo)) {
        if (proc.tasks) {
          for (const task of proc.tasks) {
            if (task.tabId && proc.privateMemory) {
              processMemoryMap[task.tabId] = proc.privateMemory / (1024 * 1024);
            }
          }
        }
      }
    } catch {
      processMemoryMap = null;
    }
  }

  for (const tab of tabs) {
    let hostname = "";
    try {
      hostname = new URL(tab.url || "").hostname;
    } catch {}

    const memoryMB = processMemoryMap ? (processMemoryMap[tab.id] || 0) : 0;

    tabsInfo.push({
      tabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title || "Untitled",
      url: tab.url || "",
      hostname,
      memoryMB: Math.round(memoryMB * 10) / 10,
      memoryAvailable: processMemoryMap !== null,
      active: tab.active,
      discarded: tab.discarded,
      pinned: tab.pinned,
    });
  }

  // Sort: active first, then by memory (if available), then by index
  tabsInfo.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.discarded !== b.discarded) return a.discarded ? 1 : -1;
    if (processMemoryMap) return b.memoryMB - a.memoryMB;
    return a.index - b.index;
  });

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
      availableGB: Math.round((info.availableCapacity / (1024 * 1024 * 1024)) * 10) / 10,
      usedPercent: Math.round(((info.capacity - info.availableCapacity) / info.capacity) * 100),
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
    const tabs = await chrome.tabs.query({});
    const activeCount = tabs.filter((t) => !t.discarded).length;
    const total = tabs.length;

    const text = `${activeCount}`;
    const color = activeCount > 20 ? "#d32f2f" : activeCount > 10 ? "#f57c00" : "#388e3c";

    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch (err) {
    console.error("[TMC] Badge update failed:", err.message);
  }
}

// ─── Notifications ─────────────────────────────────────────────────

const notifiedTabs = new Set();

async function notifyHeavyTab(tab) {
  if (notifiedTabs.has(tab.tabId)) return;
  notifiedTabs.add(tab.tabId);

  try {
    chrome.notifications.create(`heavy-${tab.tabId}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${tab.hostname} is using ${Math.round(tab.memoryMB)}MB`,
      message: "This tab is consuming excessive memory. Click to deep clean it.",
      priority: 1,
    });
  } catch {}
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
  if (!HAS_PROCESSES) return; // Can't auto-discard without memory data

  const tabsInfo = await getTabsWithMemory();
  for (const tab of tabsInfo) {
    if (tab.active || tab.pinned || tab.discarded) continue;
    if (tab.memoryMB < settings.autoDiscardThresholdMB) continue;
    if (isWhitelisted(tab.hostname)) continue;
    if (!isDiscardableUrl(tab.url)) continue;

    try {
      await chrome.tabs.discard(tab.tabId);
      logAction(`auto-discard (${Math.round(tab.memoryMB)}MB)`, tab);
    } catch {}
  }
}

function isWhitelisted(hostname) {
  return settings.whitelist.some(
    (pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`)
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
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  switch (info.menuItemId) {
    case "tmc-soft": await softClean(tab); break;
    case "tmc-deep": await deepClean(tab); break;
    case "tmc-nuke": await nukeAndReload(tab); break;
    case "tmc-discard-others": await discardOtherTabs(tab); break;
    case "tmc-discard-left": await discardDirectionalTabs(tab, "left"); break;
    case "tmc-discard-right": await discardDirectionalTabs(tab, "right"); break;
  }
});

// ─── Keyboard Shortcuts ────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case "soft-clean": await softClean(tab); break;
    case "deep-clean": await deepClean(tab); break;
    case "nuke-reload": await nukeAndReload(tab); break;
    case "discard-others": await discardOtherTabs(tab); break;
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
    updateBadge();
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
    updateBadge();
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
    updateBadge();
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
      if (isDiscardableUrl(t.url) && !t.discarded) {
        try { await chrome.tabs.discard(t.id); count++; } catch {}
      }
    }
    logAction(`discard-others (${count} tabs)`, activeTab);
    updateBadge();
  } catch (err) {
    console.error("[TMC] Discard others failed:", err.message);
  }
}

async function discardDirectionalTabs(activeTab, direction) {
  try {
    const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
    let count = 0;
    for (const t of tabs) {
      const isTarget = direction === "left" ? t.index < activeTab.index : t.index > activeTab.index;
      if (!isTarget || t.active || t.pinned || t.discarded) continue;
      if (isDiscardableUrl(t.url)) {
        try { await chrome.tabs.discard(t.id); count++; } catch {}
      }
    }
    logAction(`discard-${direction} (${count} tabs)`, activeTab);
    updateBadge();
  } catch (err) {
    console.error(`[TMC] Discard ${direction} failed:`, err.message);
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

function isDiscardableUrl(url) {
  if (!url) return false;
  return (
    !url.startsWith("chrome://") &&
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("devtools://") &&
    !url.startsWith("edge://")
  );
}

function logAction(action, tab) {
  const hostname = (() => {
    try { return new URL(tab.url || "").hostname; } catch { return "unknown"; }
  })();

  const entry = { action, url: hostname, timestamp: new Date().toISOString() };

  chrome.storage.local.get({ history: [] }, (data) => {
    const history = data.history;
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    chrome.storage.local.set({ history });
  });

  console.log(`[TMC] ${action} → ${hostname}`);
}

// ─── Message handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-tabs-memory") {
    (async () => {
      try {
        const tabs = await getTabsWithMemory();
        const system = await getSystemMemory();
        const totalMB = tabs.reduce((s, t) => s + t.memoryMB, 0);
        const memoryAvailable = tabs.length > 0 && tabs[0].memoryAvailable;
        sendResponse({ tabs, system, totalMB, memoryAvailable });
      } catch (err) {
        console.error("[TMC] get-tabs-memory failed:", err);
        sendResponse({ tabs: [], system: { totalGB: 0, availableGB: 0, usedPercent: 0 }, totalMB: 0, memoryAvailable: false, error: err.message });
      }
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
      if (!tabs[0]) { sendResponse({ ok: false }); return; }
      const tab = tabs[0];
      const actions = {
        soft: softClean,
        deep: deepClean,
        nuke: nukeAndReload,
        "discard-others": discardOtherTabs,
      };
      const fn = actions[msg.action];
      if (fn) {
        fn(tab).then(() => sendResponse({ ok: true }));
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  if (msg.type === "action-tab") {
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        if (msg.action === "deep") {
          await deepClean(tab);
        } else if (msg.action === "discard") {
          await chrome.tabs.discard(msg.tabId);
          logAction("discard (manual)", tab);
          updateBadge();
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "get-history") {
    chrome.storage.local.get({ history: [] }, (data) => {
      sendResponse({ history: data.history });
    });
    return true;
  }
});

// Initial load
loadSettings().then(() => updateBadge());
