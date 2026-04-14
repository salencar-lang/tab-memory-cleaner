/**
 * Tab Memory Cleaner — Background Service Worker
 *
 * Context-menu actions available on right-click of any tab:
 *   1. Soft Clean  — discard the tab (frees RAM, keeps tab in bar)
 *   2. Deep Clean  — clear site cache/storage + reload
 *   3. Nuke & Reload — clear ALL site data + hard reload (like fresh visit)
 *   4. Discard Other Tabs — discard every tab except the active one
 *
 * Uses only official chrome.* APIs — no hacks, no content scripts.
 */

// ─── Context Menu Setup ────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Parent menu
  chrome.contextMenus.create({
    id: "tmc-parent",
    title: "Tab Memory Cleaner",
    contexts: ["all"],
  });

  chrome.contextMenus.create({
    id: "tmc-soft",
    parentId: "tmc-parent",
    title: "\u26a1 Soft Clean (discard tab — frees RAM)",
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
    title: "\ud83d\udca3 Nuke & Reload (clear ALL site data + reload)",
    contexts: ["all"],
  });

  chrome.contextMenus.create({
    id: "tmc-separator",
    parentId: "tmc-parent",
    type: "separator",
    contexts: ["all"],
  });

  chrome.contextMenus.create({
    id: "tmc-discard-others",
    parentId: "tmc-parent",
    title: "\ud83d\udca4 Discard Other Tabs (keep only active)",
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

// ─── Menu Click Handler ────────────────────────────────────────────

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
  }
});

// ─── Actions ───────────────────────────────────────────────────────

/**
 * Soft Clean: discard the tab.
 * Chrome unloads it from memory but keeps it in the tab bar.
 * Clicking the tab later reloads it from scratch.
 */
async function softClean(tab) {
  try {
    // Can't discard the active tab — need to switch away first or just reload
    if (tab.active) {
      // For active tab: reload with cache bypass is the best we can do
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      logAction("soft-clean (active tab → hard reload)", tab);
    } else {
      await chrome.tabs.discard(tab.id);
      logAction("soft-clean (discarded)", tab);
    }
  } catch (err) {
    console.error("[TMC] Soft clean failed:", err.message);
  }
}

/**
 * Deep Clean: clear cache for the site's origin, then reload.
 * Removes cached files, localStorage, sessionStorage.
 * Keeps cookies (so you stay logged in).
 */
async function deepClean(tab) {
  try {
    const origin = extractOrigin(tab.url);
    if (!origin) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      return;
    }

    await chrome.browsingData.remove(
      {
        origins: [origin],
      },
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

/**
 * Nuke & Reload: clear EVERYTHING for the site (including cookies), then reload.
 * You WILL be logged out of the site.
 */
async function nukeAndReload(tab) {
  try {
    const origin = extractOrigin(tab.url);
    if (!origin) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      return;
    }

    await chrome.browsingData.remove(
      {
        origins: [origin],
      },
      {
        cache: true,
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        passwords: false, // never touch saved passwords
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

/**
 * Discard all tabs in the current window except the active one.
 */
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
        } catch {
          // tab may have been closed between query and discard
        }
      }
    }

    logAction(`discard-others (${count} tabs)`, activeTab);
  } catch (err) {
    console.error("[TMC] Discard others failed:", err.message);
  }
}

/**
 * Discard tabs to the left or right of the current tab.
 */
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
        } catch {
          // tab may have been closed
        }
      }
    }

    logAction(`discard-${direction} (${count} tabs)`, activeTab);
  } catch (err) {
    console.error(`[TMC] Discard ${direction} failed:`, err.message);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function extractOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") {
      return null;
    }
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
    url: tab.url ? new URL(tab.url).hostname : "unknown",
    timestamp: new Date().toISOString(),
  };

  // Store last 50 actions for the popup stats
  chrome.storage.local.get({ history: [] }, (data) => {
    const history = data.history;
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    chrome.storage.local.set({ history });
  });

  console.log(`[TMC] ${action} → ${entry.url}`);
}

// ─── Message handler for popup ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-tab-info") {
    getTabMemoryInfo().then(sendResponse);
    return true; // async response
  }

  if (msg.type === "action") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const tab = tabs[0];

      switch (msg.action) {
        case "soft":
          softClean(tab).then(() => sendResponse({ ok: true }));
          break;
        case "deep":
          deepClean(tab).then(() => sendResponse({ ok: true }));
          break;
        case "nuke":
          nukeAndReload(tab).then(() => sendResponse({ ok: true }));
          break;
        case "discard-others":
          discardOtherTabs(tab).then(() => sendResponse({ ok: true }));
          break;
      }
    });
    return true;
  }
});

/**
 * Get memory info for all tabs in the current window.
 * Note: chrome.processes API is only available in Chrome OS / dev channel.
 * We use tab count + discarded status as proxy.
 */
async function getTabMemoryInfo() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const total = tabs.length;
  const discarded = tabs.filter((t) => t.discarded).length;
  const active = total - discarded;

  return {
    total,
    active,
    discarded,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title || "Untitled",
      url: t.url ? new URL(t.url).hostname : "",
      discarded: t.discarded,
      pinned: t.pinned,
      active: t.active,
    })),
  };
}
