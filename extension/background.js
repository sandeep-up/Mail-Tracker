// Configuration Constants
const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 60_000; // milliseconds
const API_URL = 'http://localhost:5000/store';
const STORAGE_KEY = 'pending_requests';

class TrackerService {
  constructor() {
    this.queue = new Map();
    this.intervalId = null;
    this.isReady = false;
  }

  async start() {
    if (this.isReady) return;

    try {
      // Retrieve saved items
      const saved = await browser.storage.local.get(STORAGE_KEY);
      if (saved[STORAGE_KEY]) {
        for (const { id, payload, attempts } of saved[STORAGE_KEY]) {
          this.queue.set(id, { payload, attempts });
        }
      }

      // Schedule periodic retries
      this.intervalId = setInterval(() => {
        if (this.queue.size > 0) {
          console.log(`Retrying ${this.queue.size} stored messages...`);
          this._retryAll();
        }
      }, RETRY_DELAY);

      // Listen for messages
      browser.runtime.onMessage.addListener(this._onMessage.bind(this));

      this.isReady = true;
      console.log('TrackerService up and running');
    } catch (err) {
      console.error('Startup error:', err);
    }
  }

  async _onMessage(msg) {
    if (msg.action !== 'storeEmail') {
      return { success: false, error: 'Unsupported action' };
    }

    try {
      console.log('Incoming email to track:', msg.id);

      const { id, to, trackingUrl, subject = 'No Subject', timestamp } = msg;
      if (!id || !to || !trackingUrl) {
        throw new Error('Missing required fields');
      }

      const recordTime = timestamp || new Date().toISOString();
      const result = await this._transmit({ ...msg, timestamp: recordTime });

      // Mark as sent in storage
      await browser.storage.local.set({
        [`tracking:${id}`]: { to, subject, url: trackingUrl, timestamp: recordTime, status: 'sent' }
      });

      return { success: true, id };
    } catch (err) {
      console.error('Failed to handle message:', err);

      // Queue for later retry
      this.queue.set(msg.id, { payload: msg, attempts: 0 });
      await this._persistQueue();

      return { success: false, error: err.message, scheduled: true };
    }
  }

  async _transmit(data, attempt = 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const body = JSON.stringify({
        id: data.id,
        to: data.to,
        subject: data.subject,
        content: data.content,
        trackingUrl: data.trackingUrl,
        timestamp: new Date().toISOString(),
        status: 'sent'
      });

      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Version': '1.1.0'
        },
        body,
        signal: controller.signal
      });

      clearTimeout(timer);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      return resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`Attempt ${attempt + 1} for ${data.id} failed, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY / 3));
        return this._transmit(data, attempt + 1);
      }
      throw err;
    }
  }

  async _persistQueue() {
    const items = Array.from(this.queue.entries()).map(
      ([id, { payload, attempts }]) => ({ id, payload, attempts })
    );
    await browser.storage.local.set({ [STORAGE_KEY]: items });
  }

  async _retryAll() {
    for (const [id, { payload, attempts }] of this.queue) {
      try {
        await this._transmit(payload);
        this.queue.delete(id);
        console.log(`Message ${id} sent after retry`);

        await browser.storage.local.set({
          [`tracking:${id}`]: { to: payload.to, subject: payload.subject, url: payload.trackingUrl, timestamp: new Date().toISOString(), status: 'sent' }
        });
      } catch (err) {
        if (attempts + 1 >= MAX_ATTEMPTS) {
          console.error(`Dropping ${id} after ${attempts + 1} attempts`);
          this.queue.delete(id);
        } else {
          this.queue.set(id, { payload, attempts: attempts + 1 });
          console.log(`Retry ${attempts + 1} for ${id} failed`);
        }
      }
    }
    await this._persistQueue();
  }

  async shutdown() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    await this._persistQueue();
  }
}

// Boot up tracker service
const tracker = new TrackerService();
tracker.start();

// Save state when extension unloads
browser.runtime.onSuspend.addListener(() => tracker.shutdown());
