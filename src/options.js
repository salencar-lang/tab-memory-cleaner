/**
 * Tab Memory Cleaner v2.0 — Options Page
 */

const DEFAULT_SETTINGS = {
  autoDiscard: false,
  autoDiscardThresholdMB: 500,
  autoDiscardAfterMinutes: 10,
  badgeMode: "memory",
  notifyOnHeavyTab: true,
  heavyTabThresholdMB: 800,
  whitelist: ["meet.google.com", "zoom.us", "spotify.com", "music.youtube.com"],
};

document.addEventListener("DOMContentLoaded", loadSettings);

async function loadSettings() {
  const { settings } = await chrome.runtime.sendMessage({ type: "get-settings" });
  const s = { ...DEFAULT_SETTINGS, ...settings };

  document.getElementById("badgeMode").value = s.badgeMode;
  document.getElementById("autoDiscard").checked = s.autoDiscard;
  document.getElementById("autoDiscardThresholdMB").value = s.autoDiscardThresholdMB;
  document.getElementById("notifyOnHeavyTab").checked = s.notifyOnHeavyTab;
  document.getElementById("heavyTabThresholdMB").value = s.heavyTabThresholdMB;
  document.getElementById("whitelist").value = (s.whitelist || []).join("\n");

  document.getElementById("saveBtn").addEventListener("click", saveSettings);
  document.getElementById("resetBtn").addEventListener("click", resetSettings);
}

async function saveSettings() {
  const newSettings = {
    badgeMode: document.getElementById("badgeMode").value,
    autoDiscard: document.getElementById("autoDiscard").checked,
    autoDiscardThresholdMB: parseInt(document.getElementById("autoDiscardThresholdMB").value) || 500,
    notifyOnHeavyTab: document.getElementById("notifyOnHeavyTab").checked,
    heavyTabThresholdMB: parseInt(document.getElementById("heavyTabThresholdMB").value) || 800,
    whitelist: document
      .getElementById("whitelist")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  await chrome.runtime.sendMessage({ type: "save-settings", settings: newSettings });

  const msg = document.getElementById("saveMsg");
  msg.classList.add("show");
  setTimeout(() => msg.classList.remove("show"), 2000);
}

async function resetSettings() {
  if (!confirm("Reset all settings to defaults?")) return;

  document.getElementById("badgeMode").value = DEFAULT_SETTINGS.badgeMode;
  document.getElementById("autoDiscard").checked = DEFAULT_SETTINGS.autoDiscard;
  document.getElementById("autoDiscardThresholdMB").value = DEFAULT_SETTINGS.autoDiscardThresholdMB;
  document.getElementById("notifyOnHeavyTab").checked = DEFAULT_SETTINGS.notifyOnHeavyTab;
  document.getElementById("heavyTabThresholdMB").value = DEFAULT_SETTINGS.heavyTabThresholdMB;
  document.getElementById("whitelist").value = DEFAULT_SETTINGS.whitelist.join("\n");

  await saveSettings();
}
