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

  
