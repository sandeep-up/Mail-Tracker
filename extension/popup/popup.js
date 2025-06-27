// popup.js - Firefox Mail Tracker UI Logic
const BTN_TEXT_LOADING = 'Loading...';
const STORAGE_KEYS = {
  ENABLED: 'trackingEnabled',
  EMAIL: 'recipientEmail'
};
const SERVER_BASE = 'http://127.0.0.1:5000';

class PopupUI {
  constructor() {
    // Reference UI elements
    this.toggleEl = document.getElementById('trackingToggle');
    this.statusEl = document.getElementById('statusText');
    this.emailEl = document.getElementById('recipientEmail');
    this.saveBtn = document.getElementById('saveBtn');
    this.dashboardBtn = document.getElementById('dashboardBtn');
    this.busy = false;
  }

  init() {
    document.addEventListener('DOMContentLoaded', () => this.loadPrefs());
    this.toggleEl.addEventListener('change', () => this.onToggle());
    this.saveBtn.addEventListener('click', () => this.onSave());
    this.dashboardBtn.addEventListener('click', () => this.openDashboard());
    this.emailEl.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.saveBtn.click();
    });
    console.log('Popup UI initialized');
    this.pingServer();
  }

  async loadPrefs() {
    const oldLabel = this.setLoading(this.saveBtn);
    try {
      const prefs = await browser.storage.sync.get([STORAGE_KEYS.ENABLED, STORAGE_KEYS.EMAIL]);
      const isEnabled = prefs[STORAGE_KEYS.ENABLED] || false;
      this.toggleEl.checked = isEnabled;
      this.renderStatus(isEnabled);
      this.emailEl.value = prefs[STORAGE_KEYS.EMAIL] || '';
    } catch (err) {
      console.error('Could not load preferences:', err);
      this.showToast('Error loading settings', true);
    } finally {
      this.resetLoading(this.saveBtn, oldLabel);
    }
  }

  async onToggle() {
    if (this.busy) return;
    const enabled = this.toggleEl.checked;
    const oldLabel = this.setLoading(this.saveBtn);
    try {
      await browser.storage.sync.set({ [STORAGE_KEYS.ENABLED]: enabled });
      this.renderStatus(enabled);
      this.showToast(`Tracking ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error('Toggle error:', err);
      this.showToast('Failed to update tracking', true);
      this.toggleEl.checked = !enabled;
    } finally {
      this.resetLoading(this.saveBtn, oldLabel);
    }
  }

  async onSave() {
    if (this.busy) return;
    const address = this.emailEl.value.trim();
    const oldLabel = this.setLoading(this.saveBtn);

    if (!address) {
      this.showToast('Email address required', true);
      return this.resetLoading(this.saveBtn, oldLabel);
    }
    if (!this.validateEmail(address)) {
      this.showToast('Invalid email format', true);
      return this.resetLoading(this.saveBtn, oldLabel);
    }

    try {
      await browser.storage.sync.set({ [STORAGE_KEYS.EMAIL]: address });
      this.showToast('Settings saved');
    } catch (err) {
      console.error('Save error:', err);
      this.showToast('Could not save settings', true);
    } finally {
      this.resetLoading(this.saveBtn, oldLabel);
    }
  }

  async openDashboard() {
    const oldLabel = this.setLoading(this.dashboardBtn);
    try {
      await browser.tabs.create({ url: `${SERVER_BASE}/dashboard` });
    } catch (primaryErr) {
      console.warn('Direct open failed:', primaryErr);
      try {
        const resp = await fetch(`${SERVER_BASE}/`, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('Server offline');
        await browser.tabs.create({ url: `${SERVER_BASE}/dashboard` });
      } catch (fallbackErr) {
        console.error('Dashboard fallback failed:', fallbackErr);
        this.showToast('Please start the server: python server.py', true);
      }
    } finally {
      this.resetLoading(this.dashboardBtn, oldLabel);
    }
  }

  renderStatus(enabled) {
    this.statusEl.textContent = enabled ? 'ON' : 'OFF';
    this.statusEl.classList.toggle('status-on', enabled);
    this.statusEl.classList.toggle('status-off', !enabled);
  }

  setLoading(btn) {
    this.busy = true;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = BTN_TEXT_LOADING;
    return label;
  }

  resetLoading(btn, label) {
    this.busy = false;
    btn.disabled = false;
    btn.textContent = label;
  }

  showToast(msg, error = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${error ? 'error' : 'success'}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3010);
    setTimeout(() => toast.remove(), 3310);
  }

  validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  pingServer() {
    fetch(`${SERVER_BASE}/`)
      .then(r => console.log('Server response:', r.status))
      .catch(e => console.error('Server unreachable:', e));
  }
}

// Launch UI
new PopupUI().init();
