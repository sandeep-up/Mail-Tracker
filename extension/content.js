// content-script.js - Mail Tracker Injection Logic
(() => {
  const ENABLE_LOGS = true;
  const API_ROOT = 'http://127.0.0.1:5000';
  const ATTACH_DELAY = 1000;
  const MAX_ATTEMPTS = 3;
  let attempts = 0;

  const logInfo = (...args) => ENABLE_LOGS && console.log('%c[MailTracker]', 'color: green; font-weight:bold;', ...args);
  const logError = (...args) => console.error('%c[MailTracker]', 'color: red; font-weight:bold;', ...args);

  // Locate compose dialog
  function getComposeDialog() {
    const patterns = [
      '[role="dialog"][aria-label^="New Message"]',
      '[role="dialog"][aria-label^="Compose"]',
      '.nH.Hd',
      '.aYF'
    ];
    for (const sel of patterns) {
      const node = document.querySelector(sel);
      if (node) {
        logInfo('Found compose dialog:', sel);
        return node;
      }
    }
    logError('Compose dialog not found');
    return null;
  }

  // Get email body area
  function getBodyElement() {
    const dialog = getComposeDialog();
    if (!dialog) return null;
    const patterns = ['[aria-label="Message Body"]', '[role="textbox"]', 'div[contenteditable]',' .editable'];
    for (const sel of patterns) {
      const el = dialog.querySelector(sel);
      if (el) {
        logInfo('Located body element:', sel);
        return el;
      }
    }
    logError('Email body not located');
    return null;
  }

  // Find send button
  function getSendBtn() {
    const dialog = getComposeDialog();
    if (!dialog) return null;
    const patterns = ['div[role="button"][aria-label*="Send"]', 'div[data-tooltip*="Send"]', '.T-I.aoO'];
    for (const sel of patterns) {
      const button = dialog.querySelector(sel);
      if (button && button.offsetParent) {
        logInfo('Send button selector:', sel);
        return button;
      }
    }
    logError('Send button missing');
    return null;
  }

  // Extract subject & recipient
  async function fetchDetails() {
    const dialog = getComposeDialog();
    if (!dialog) return {};
    const subj = dialog.querySelector('[name="subjectbox"]')?.value || 'No Subject';
    const { recipientEmail } = await browser.storage.sync.get('recipientEmail');
    return { subject: subj, recipient: recipientEmail || 'unknown@example.com' };
  }

  // Insert invisible tracking pixel
  function addTrackingPixel(url) {
    const body = getBodyElement();
    if (!body) return false;
    body.querySelectorAll(`img[src^="${API_ROOT}/track"]`).forEach(img => img.remove());
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div style="position:relative; width:1px; height:1px; opacity:0;">
        <img src="${url}" width="1" height="1" alt="">
      </div>`;
    body.appendChild(wrapper.firstElementChild);
    logInfo('Inserted pixel:', url);
    return true;
  }

  // Send tracking info to background
  async function sendToBackground() {
    const { subject, recipient } = await fetchDetails();
    const id = `trk_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const pixelUrl = `${API_ROOT}/track?id=${id}`;
    const text = getBodyElement()?.innerText || '';
    if (!addTrackingPixel(pixelUrl)) {
      logError('Failed to add pixel');
      return;
    }
    const msg = { action: 'storeEmail', subject, to: recipient, content: text, id, trackingUrl: pixelUrl };
    logInfo('Dispatching message:', msg);
    const resp = await browser.runtime.sendMessage(msg).catch(e => (logError('Message error:', e), {}));
    resp.success ? logInfo('Tracked:', id) : logError('Tracking failed:', resp.error);
  }

  // Attach click handler to send button
  function attachListener() {
    const btn = getSendBtn();
    if (!btn) {
      if (attempts++ < MAX_ATTEMPTS) {
        logInfo(`Retry send btn (${attempts})`);
        return setTimeout(attachListener, ATTACH_DELAY);
      }
      return logError('Could not locate send btn after retries');
    }
    if (btn._trackerBound) return;
    btn._trackerBound = true;
    btn.addEventListener('click', () => setTimeout(sendToBackground, ATTACH_DELAY));
    logInfo('Listener bound to send btn');
  }

  // Observe DOM changes for compose dialogs
  const obs = new MutationObserver(() => getComposeDialog() && attachListener());
  obs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', () => { logInfo('Script loaded'); attachListener(); });
})();