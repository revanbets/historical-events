// ============================================================
// Historical Events Research Assistant — Content Script
// Runs on every page. Handles text selection bubble + timecode.
// ============================================================

(function () {
  'use strict';

  let bubble = null;
  let currentSelection = null;
  let bubbleHideTimer = null;

  // ─── YouTube timecode helper ──────────────────────────────
  function getYouTubeTimecode() {
    try {
      const video = document.querySelector('video.html5-main-video') ||
                    document.querySelector('video');
      if (!video || isNaN(video.currentTime)) return null;
      const secs = Math.floor(video.currentTime);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
    } catch {
      return null;
    }
  }

  function isVideoPage() {
    return window.location.hostname.includes('youtube.com') ||
           window.location.hostname.includes('youtu.be') ||
           window.location.hostname.includes('vimeo.com') ||
           document.querySelector('video') !== null;
  }

  // ─── Build the floating capture bubble ───────────────────
  function createBubble() {
    const el = document.createElement('div');
    el.className = 'hdb-capture-bubble';
    el.id = 'hdb-capture-bubble';

    const btn = document.createElement('button');
    btn.className = 'hdb-capture-btn';
    btn.innerHTML = `
      <span class="hdb-icon">📎</span>
      <span class="hdb-label">Save to DB</span>
    `;
    el.appendChild(btn);

    // Timecode badge (hidden by default, shown on video pages)
    const tcBadge = document.createElement('span');
    tcBadge.className = 'hdb-timecode-badge';
    tcBadge.id = 'hdb-timecode-badge';
    el.appendChild(tcBadge);

    // Feedback state element
    const feedback = document.createElement('span');
    feedback.className = 'hdb-feedback';
    feedback.id = 'hdb-feedback';
    el.appendChild(feedback);

    document.body.appendChild(el);
    return el;
  }

  function getBubble() {
    if (!bubble || !document.body.contains(bubble)) {
      bubble = createBubble();
      // Attach save handler
      bubble.querySelector('.hdb-capture-btn').addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      });
    }
    return bubble;
  }

  // ─── Position bubble near selection ──────────────────────
  function positionBubble(el, range) {
    const rect = range.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    let top = rect.bottom + scrollY + 8;
    let left = rect.left + scrollX + (rect.width / 2) - 60;

    // Keep inside viewport horizontally
    const vw = window.innerWidth;
    if (left + 140 > vw + scrollX) left = vw + scrollX - 148;
    if (left < scrollX + 4) left = scrollX + 4;

    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.display = 'flex';
    el.classList.add('hdb-visible');
  }

  function hideBubble() {
    if (bubble) {
      bubble.classList.remove('hdb-visible');
      setTimeout(() => {
        if (bubble) bubble.style.display = 'none';
      }, 180);
    }
    currentSelection = null;
  }

  // ─── Save handler ─────────────────────────────────────────
  async function handleSave() {
    if (!currentSelection) return;

    const btn = bubble.querySelector('.hdb-capture-btn');
    const feedback = document.getElementById('hdb-feedback');

    btn.disabled = true;
    btn.querySelector('.hdb-label').textContent = 'Saving…';

    try {
      await chrome.runtime.sendMessage({
        type: 'CAPTURE_TEXT',
        text: currentSelection.text,
        url: window.location.href,
        pageTitle: document.title,
        favIconUrl: getFavicon(),
        timecode: currentSelection.timecode
      });

      // Success state
      btn.style.display = 'none';
      feedback.textContent = '✓ Saved';
      feedback.style.display = 'inline';
      if (currentSelection.timecode) {
        document.getElementById('hdb-timecode-badge').style.display = 'none';
      }

      // Auto-hide after 1.5 seconds
      setTimeout(() => {
        hideBubble();
        btn.style.display = '';
        btn.querySelector('.hdb-label').textContent = 'Save to DB';
        feedback.style.display = 'none';
        btn.disabled = false;
      }, 1500);

    } catch (err) {
      btn.querySelector('.hdb-label').textContent = 'Error — retry';
      btn.disabled = false;
      console.error('[HDB] Save failed:', err);
    }
  }

  function getFavicon() {
    const link = document.querySelector('link[rel~="icon"]');
    return link ? link.href : '';
  }

  // ─── Selection listener ───────────────────────────────────
  document.addEventListener('mouseup', (e) => {
    // Ignore clicks inside our own bubble
    if (bubble && bubble.contains(e.target)) return;

    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (!text || text.length < 5) {
      hideBubble();
      return;
    }

    const range = sel.getRangeAt(0);
    const timecode = isVideoPage() ? getYouTubeTimecode() : null;

    currentSelection = { text, timecode };

    const el = getBubble();

    // Update timecode badge
    const tcBadge = document.getElementById('hdb-timecode-badge');
    if (timecode) {
      tcBadge.textContent = '⏱ ' + timecode;
      tcBadge.style.display = 'inline';
    } else {
      tcBadge.style.display = 'none';
    }

    // Reset button state
    const btn = el.querySelector('.hdb-capture-btn');
    btn.style.display = '';
    btn.querySelector('.hdb-label').textContent = 'Save to DB';
    btn.disabled = false;
    const fb = document.getElementById('hdb-feedback');
    if (fb) fb.style.display = 'none';

    positionBubble(el, range);
  });

  // Hide bubble when clicking elsewhere (but not on bubble)
  document.addEventListener('mousedown', (e) => {
    if (bubble && !bubble.contains(e.target)) {
      hideBubble();
    }
  });

  // Hide bubble on scroll
  document.addEventListener('scroll', () => {
    if (bubble && bubble.classList.contains('hdb-visible')) {
      hideBubble();
    }
  }, { passive: true });

  // ─── Listen for messages from background/popup ────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_INFO') {
      sendResponse({
        url: window.location.href,
        title: document.title,
        favIconUrl: getFavicon(),
        timecode: isVideoPage() ? getYouTubeTimecode() : null
      });
    }
  });

})();
