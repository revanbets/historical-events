// ============================================================
// Historical Events Research Assistant — Content Script
// Runs on every page. Handles text selection bubble + timecode.
// ============================================================

(function () {
  'use strict';

  let bubble = null;
  let currentSelection = null;
  let currentEndTimecode = null;
  let bubbleHideTimer = null;

  // ─── YouTube timecode helper ──────────────────────────────
  function getYouTubeTimecode() {
    try {
      const video = document.querySelector('video.html5-main-video') ||
                    document.querySelector('video');
      if (!video || isNaN(video.currentTime)) return null;
      return secondsToTimecode(Math.floor(video.currentTime));
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

  // ─── Timecode conversion helpers ─────────────────────────
  function secondsToTimecode(secs) {
    secs = Math.floor(secs);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  function timecodeToSeconds(tc) {
    if (!tc) return 0;
    const parts = tc.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + (parts[1] || 0);
  }

  // ─── Frame capture helpers ────────────────────────────────

  // Smart interval: ~15 frames target, 1s min, 30s max
  function computeFrameTimestamps(startSecs, endSecs) {
    const duration = Math.max(0, endSecs - startSecs);
    if (duration < 1) return [startSecs];
    const interval = Math.max(1, Math.min(30, duration / 15));
    const stamps = [];
    for (let t = startSecs; t < endSecs - 0.1; t += interval) {
      stamps.push(Math.round(t * 10) / 10);
    }
    stamps.push(endSecs);
    // Deduplicate
    return [...new Set(stamps)];
  }

  // Perceptual hash: sample a 4×4 grid of pixels
  function getFrameHash(ctx, w, h) {
    const hash = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        try {
          const px = ctx.getImageData(
            Math.floor(x * w / 4), Math.floor(y * h / 4), 1, 1
          ).data;
          hash.push((px[0] + px[1] + px[2]) >> 2);
        } catch { hash.push(0); }
      }
    }
    return hash;
  }

  function hashesAreSimilar(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return false;
    const diffs = h1.filter((v, i) => Math.abs(v - h2[i]) > 15).length;
    return diffs <= 2; // at most 2 of 16 sample points differ significantly
  }

  // Seek the video to timeSecs, draw to a 320×180 canvas, return frame object
  async function captureVideoFrame(video, timeSecs) {
    return new Promise(resolve => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) { done = true; resolve(null); }
      }, 3500);

      const onSeeked = () => {
        if (done) return;
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timeout);
        done = true;
        try {
          const W = 320, H = 180;
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, W, H);
          const hash = getFrameHash(ctx, W, H);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          resolve({ time: timeSecs, timecode: secondsToTimecode(timeSecs), dataUrl, hash });
        } catch (e) {
          console.warn('[HDB] Frame canvas error:', e.message);
          resolve(null);
        }
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = timeSecs;
    });
  }

  // Capture frames across the given range, deduplicate, restore video position
  async function captureFramesForRange(startSecs, endSecs) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return [];

    const origTime = video.currentTime;
    const wasPaused = video.paused;
    if (!wasPaused) video.pause();

    const stamps = computeFrameTimestamps(startSecs, endSecs);
    const frames = [];
    let lastHash = null;

    for (const t of stamps) {
      const frame = await captureVideoFrame(video, t);
      if (frame && (!lastHash || !hashesAreSimilar(lastHash, frame.hash))) {
        frames.push({ time: frame.time, timecode: frame.timecode, dataUrl: frame.dataUrl });
        lastHash = frame.hash;
      }
    }

    // Restore video position
    try { video.currentTime = origTime; } catch {}
    if (!wasPaused) { try { video.play(); } catch {} }

    return frames;
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

    // Start timecode badge (hidden by default, shown on video pages)
    const tcBadge = document.createElement('span');
    tcBadge.className = 'hdb-timecode-badge';
    tcBadge.id = 'hdb-timecode-badge';
    el.appendChild(tcBadge);

    // "→ End" button: marks the current video time as the end of the capture range
    const setEndBtn = document.createElement('button');
    setEndBtn.className = 'hdb-set-end-btn';
    setEndBtn.id = 'hdb-set-end-btn';
    setEndBtn.textContent = '→ End';
    setEndBtn.title = 'Mark current video position as end of range';
    setEndBtn.style.display = 'none';
    el.appendChild(setEndBtn);

    // End timecode badge (shown after end is marked)
    const tcEndBadge = document.createElement('span');
    tcEndBadge.className = 'hdb-timecode-end-badge';
    tcEndBadge.id = 'hdb-timecode-end-badge';
    tcEndBadge.style.display = 'none';
    el.appendChild(tcEndBadge);

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

      // Save handler
      bubble.querySelector('.hdb-capture-btn').addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      });

      // Set-end handler — clicking this does NOT close the bubble (it's inside it)
      bubble.querySelector('#hdb-set-end-btn').addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const tc = getYouTubeTimecode();
        if (tc) {
          currentEndTimecode = tc;
          const endBadge = document.getElementById('hdb-timecode-end-badge');
          endBadge.textContent = '→ ' + tc;
          endBadge.style.display = 'inline';
          document.getElementById('hdb-set-end-btn').style.display = 'none';
        }
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
    currentEndTimecode = null;
  }

  // ─── Save handler ─────────────────────────────────────────
  async function handleSave() {
    if (!currentSelection) return;

    const btn = bubble.querySelector('.hdb-capture-btn');
    const feedback = document.getElementById('hdb-feedback');
    const tcBadge = document.getElementById('hdb-timecode-badge');
    const tcEndBadge = document.getElementById('hdb-timecode-end-badge');
    const setEndBtn = document.getElementById('hdb-set-end-btn');

    btn.disabled = true;

    // Capture frames if on a video page with a start timecode
    let frames = [];
    const startTc = currentSelection.timecode;
    const endTc = currentEndTimecode;

    if (startTc && isVideoPage()) {
      btn.querySelector('.hdb-label').textContent = 'Capturing…';
      try {
        const startSecs = timecodeToSeconds(startTc);
        const endSecs = endTc ? timecodeToSeconds(endTc) : startSecs;
        frames = await captureFramesForRange(startSecs, endSecs);
      } catch (e) {
        console.warn('[HDB] Frame capture failed:', e);
      }
    }

    btn.querySelector('.hdb-label').textContent = 'Saving…';

    try {
      await chrome.runtime.sendMessage({
        type: 'CAPTURE_TEXT',
        text: currentSelection.text,
        url: window.location.href,
        pageTitle: document.title,
        favIconUrl: getFavicon(),
        timecode: startTc,
        timecodeEnd: endTc || null,
        frames
      });

      // Success state
      btn.style.display = 'none';
      feedback.textContent = frames.length > 0
        ? `✓ Saved · ${frames.length} frame${frames.length !== 1 ? 's' : ''}`
        : '✓ Saved';
      feedback.style.display = 'inline';
      tcBadge.style.display = 'none';
      tcEndBadge.style.display = 'none';
      setEndBtn.style.display = 'none';

      setTimeout(() => {
        hideBubble();
        btn.style.display = '';
        btn.querySelector('.hdb-label').textContent = 'Save to DB';
        feedback.style.display = 'none';
        btn.disabled = false;
      }, 1800);

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
    currentEndTimecode = null; // reset end time on new selection

    const el = getBubble();

    // Update badges
    const tcBadge = document.getElementById('hdb-timecode-badge');
    const setEndBtn = document.getElementById('hdb-set-end-btn');
    const tcEndBadge = document.getElementById('hdb-timecode-end-badge');

    if (timecode) {
      tcBadge.textContent = '⏱ ' + timecode;
      tcBadge.style.display = 'inline';
      setEndBtn.style.display = 'inline'; // show "→ End" on video pages
      tcEndBadge.style.display = 'none';
    } else {
      tcBadge.style.display = 'none';
      setEndBtn.style.display = 'none';
      tcEndBadge.style.display = 'none';
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

  document.addEventListener('mousedown', (e) => {
    if (bubble && !bubble.contains(e.target)) {
      hideBubble();
    }
  });

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
    } else if (msg.type === 'GET_VIDEO_TIME') {
      // Returns current video position (for popup Mark Start / Mark End)
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && !isNaN(video.currentTime)) {
        const secs = video.currentTime;
        sendResponse({ secs, timecode: secondsToTimecode(Math.floor(secs)) });
      } else {
        sendResponse({ secs: null, timecode: null });
      }
    } else if (msg.type === 'CAPTURE_FRAMES_IN_RANGE') {
      // Called by popup when user uses the Video Range Capture panel
      captureFramesForRange(msg.startSecs, msg.endSecs || msg.startSecs).then(frames => {
        sendResponse({ frames });
      });
      return true; // keep message channel open for async response
    }
  });

})();
