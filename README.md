# 🧹 Tab Memory Cleaner

> Right-click any tab to free memory. One click to clean LinkedIn's 1.9GB bloat.

A minimal Chrome extension that adds memory-cleaning actions to your right-click context menu. No tracking, no analytics, no bloat — just clean tabs.

## What it does

| Action | What happens | Stay logged in? |
|--------|-------------|:---------------:|
| **⚡ Soft Clean** | Discards inactive tab (or hard-reloads active tab) | ✅ Yes |
| **🧹 Deep Clean** | Clears cache + localStorage + IndexedDB + ServiceWorkers → reload | ✅ Yes |
| **💣 Nuke & Reload** | Clears ALL site data including cookies → reload | ❌ No |
| **💤 Discard Other Tabs** | Puts all other tabs to sleep (keeps active tab) | ✅ Yes |
| **⬅️ Discard Tabs to the Left** | Sleeps all tabs to the left | ✅ Yes |
| **➡️ Discard Tabs to the Right** | Sleeps all tabs to the right | ✅ Yes |

### How each action helps

- **Soft Clean** — Best for background tabs eating RAM. Chrome unloads them completely. Click the tab later to reload.
- **Deep Clean** — Best for sites like LinkedIn/Facebook that accumulate huge caches and IndexedDB data. Clears storage but keeps your cookies (you stay logged in).
- **Nuke & Reload** — Nuclear option. Like visiting the site for the first time. Use when a site is completely broken.
- **Discard Others** — One click to free RAM from all background tabs. Perfect when your PC is struggling.

## Install (Developer Mode — 30 seconds)

1. Download or clone this repo:
   ```bash
   git clone https://github.com/salencar-lang/tab-memory-cleaner.git
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right corner)

4. Click **Load unpacked**

5. Select the `tab-memory-cleaner` folder

6. Done! Right-click anywhere on a page to see the **Tab Memory Cleaner** menu.

### Update

```bash
cd tab-memory-cleaner
git pull
```
Then go to `chrome://extensions/` and click the refresh icon on the extension card.

## How to use

### Via right-click (context menu)
Right-click anywhere on a page → **Tab Memory Cleaner** → choose action.

### Via popup
Click the extension icon in the toolbar to see:
- Tab stats (total / active / sleeping)
- Quick action buttons
- List of all tabs with status
- Recent action history

## Why this exists

Sites like LinkedIn, Facebook, and Twitter can consume 1-2GB+ of RAM through:
- JavaScript memory leaks (objects that never get garbage collected)
- Massive IndexedDB/Cache Storage (offline data, feed caches)
- Service Workers running in background

Chrome's built-in Memory Saver only handles inactive tabs. This extension gives you **manual control** over active tabs too.

### What this CAN'T do (being honest)

- **Force JavaScript garbage collection** — No extension can do this. The V8 engine controls GC.
- **Reduce memory of a running tab without reload** — Impossible due to Chrome's sandbox.
- **Prevent sites from re-accumulating memory** — After reload, the site will slowly grow again.

The best strategy: **Deep Clean** heavy sites periodically, and **Discard** tabs you're not actively using.

## Permissions explained

| Permission | Why |
|-----------|-----|
| `contextMenus` | Add items to the right-click menu |
| `tabs` | Read tab info (title, URL, status) to show in popup |
| `browsingData` | Clear cache, cookies, storage for specific sites |
| `storage` | Save action history (last 50 actions, local only) |
| `<all_urls>` | Required to clear browsing data for any site |

**No data leaves your browser.** Zero network requests. Zero tracking. Zero analytics.

## Tech details

- **Manifest V3** (latest Chrome extension standard)
- **Service Worker** background script (no persistent background page)
- **Zero dependencies** — no npm, no build step, no frameworks
- **~300 lines of JS** total
- **Minimum Chrome 116** (for stable Manifest V3 + tabs.discard API)

## Chrome Web Store

Coming soon. For now, use Developer Mode install above.

To publish yourself:
1. Zip the folder: `zip -r tab-memory-cleaner.zip tab-memory-cleaner/ -x "*.git*"`
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Pay the one-time $5 developer fee
4. Upload the zip
5. Fill in listing details and submit for review

## License

MIT — do whatever you want with it.

## Contributing

PRs welcome. Keep it minimal — the whole point is zero bloat.

Ideas for future:
- [ ] Auto-discard tabs after X minutes of inactivity
- [ ] Per-site memory usage estimates (when Chrome exposes the API)
- [ ] Keyboard shortcuts
- [ ] Badge showing number of sleeping tabs
