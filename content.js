// Sync Brief Track Preview - Content Script
// Detects track references in Gmail sync brief emails and previews on hover

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let playerContainer = null;
  let iframe = null;
  let loading = null;
  let currentQuery = null;
  let currentVideoUrl = null;
  let searchToken = 0;
  let hideTimer = null;
  let pinned = false;

  // ─── Track Reference Patterns ─────────────────────────────────────────────
  // Matches:  "Policy of Truth" by Depeche Mode
  //           'Some Song' by Some Artist
  //           Song Name by Artist (bare, capitalized, up to 6 words)
  const PATTERNS = [
    // Quoted title by Artist  (most reliable)
    /\u201c([^""]{2,60})\u201d\s+by\s+([\w][\w\s&,.'-]{1,50})/gi,   // curly quotes
    /"([^"]{2,60})"\s+by\s+([\w][\w\s&,.'-]{1,50})/gi,               // straight quotes
    /\u2018([^\u2019]{2,60})\u2019\s+by\s+([\w][\w\s&,.'-]{1,50})/gi, // single curly
    // Unquoted: "soundalike style of [Title] by [Artist]" — tricky, skip for safety
  ];

  // ─── Build Player UI ──────────────────────────────────────────────────────
  function buildPlayer() {
    if (playerContainer) return;

    playerContainer = document.createElement('div');
    playerContainer.id = 'sbtp-player-container';
    playerContainer.innerHTML = `
      <div id="sbtp-header">
        <div id="sbtp-track-info">
          <div id="sbtp-track-name">Loading…</div>
          <div id="sbtp-artist-name"></div>
        </div>
        <div id="sbtp-controls">
          <button class="sbtp-btn" id="sbtp-pin-btn" title="Pin player">📌</button>
          <button class="sbtp-btn" id="sbtp-yt-btn" title="Open on YouTube">↗</button>
          <button class="sbtp-btn" id="sbtp-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div id="sbtp-iframe-wrap">
        <div id="sbtp-loading">
          <div class="sbtp-spinner"></div>
          <span>Searching YouTube…</span>
        </div>
        <iframe
          id="sbtp-iframe"
          allow="autoplay; encrypted-media"
          allowfullscreen
          frameborder="0"
        ></iframe>
      </div>
      <div id="sbtp-footer">
        <span id="sbtp-yt-logo">▶ YouTube</span>
        <span id="sbtp-hint">Sync Brief Track Player by pftq</span>
      </div>
    `;

    document.body.appendChild(playerContainer);

    iframe = playerContainer.querySelector('#sbtp-iframe');
    loading = playerContainer.querySelector('#sbtp-loading');

    // ── iframe load event: hide spinner
    iframe.addEventListener('load', () => {
      if (iframe.src && iframe.src !== 'about:blank') {
        setTimeout(() => loading.classList.add('sbtp-hidden'), 600);
      }
    });

    // ── Pin button
    playerContainer.querySelector('#sbtp-pin-btn').addEventListener('click', () => {
      pinned = !pinned;
      playerContainer.querySelector('#sbtp-pin-btn').style.color = pinned ? '#ffd700' : '';
    });

    // ── YouTube open button
    playerContainer.querySelector('#sbtp-yt-btn').addEventListener('click', () => {
      if (currentVideoUrl) {
        window.open(currentVideoUrl, '_blank');
      } else if (currentQuery) {
        window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(currentQuery), '_blank');
      }
    });

    // ── Close button
    playerContainer.querySelector('#sbtp-close-btn').addEventListener('click', () => {
      pinned = false;
      hidePlayer();
    });

    // ── Keep player alive while hovering it
    playerContainer.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
    });
  }

  // ─── Show / Hide ──────────────────────────────────────────────────────────
  function showPlayer(trackName, artistName) {
    buildPlayer();
    clearTimeout(hideTimer);

    const query = artistName
      ? `${trackName} ${artistName}`
      : trackName;

    if (query === currentQuery) {
      // Already playing — just keep visible
      revealContainer();
      return;
    }

    currentQuery = query;
    currentVideoUrl = null;

    // Update header
    playerContainer.querySelector('#sbtp-track-name').textContent = trackName;
    playerContainer.querySelector('#sbtp-artist-name').textContent = artistName || '';
    loading.querySelector('span').textContent = 'Searching YouTube...';

    // Reset iframe & show spinner
    loading.classList.remove('sbtp-hidden');
    iframe.src = 'about:blank';

    revealContainer();

    const token = ++searchToken;

    findYouTubeVideo(query)
      .then((video) => {
        if (token !== searchToken) return;
        if (!video || !video.id) throw new Error('No playable video found');

        currentVideoUrl = `https://www.youtube.com/watch?v=${video.id}`;
        if (video.title) playerContainer.querySelector('#sbtp-track-name').textContent = video.title;
        if (video.channel) playerContainer.querySelector('#sbtp-artist-name').textContent = video.channel;

        const embedUrl = `https://www.youtube-nocookie.com/embed/${video.id}`
          + '?autoplay=1'
          + '&rel=0'
          + '&modestbranding=1'
          + '&playsinline=1';

        setTimeout(() => {
          if (token === searchToken) iframe.src = embedUrl;
        }, 120);
      })
      .catch((error) => {
        if (token !== searchToken) return;
        loading.classList.remove('sbtp-hidden');
        loading.querySelector('span').textContent = error.message || 'Could not load YouTube video';
      });
  }

  function findYouTubeVideo(query) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'SBTP_FIND_VIDEO', query }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || 'YouTube search failed'));
          return;
        }
        resolve(response.video);
      });
    });
  }

  function revealContainer() {
    playerContainer.style.display = '';
    playerContainer.classList.add('sbtp-animating');
    // Force reflow so animation triggers even if already "visible"
    playerContainer.offsetHeight; // eslint-disable-line
    playerContainer.classList.add('sbtp-visible');

    // Remove animating class after transition
    setTimeout(() => playerContainer.classList.remove('sbtp-animating'), 250);
  }

  function hidePlayer() {
    if (!playerContainer) return;
    playerContainer.classList.remove('sbtp-visible');
    setTimeout(() => {
      if (!playerContainer.classList.contains('sbtp-visible')) {
        playerContainer.classList.remove('sbtp-animating');
        playerContainer.style.display = 'none';
        // Kill audio by blanking iframe
        if (iframe) iframe.src = 'about:blank';
        currentQuery = null;
        currentVideoUrl = null;
        searchToken += 1;
        loading.classList.remove('sbtp-hidden');
      }
    }, 220);
  }

  function scheduleHide(delay = 800) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pinned) hidePlayer();
    }, delay);
  }

  // ─── Inject Highlights into Email Text ────────────────────────────────────
  function highlightTextNode(textNode) {
    const text = textNode.nodeValue;
    let result = null;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let anyMatch = false;

    // Try each pattern
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      // Reset and try on the full original text
      const fresh = text; // patterns are applied on full text each iteration
      pattern.lastIndex = 0;

      while ((match = pattern.exec(fresh)) !== null) {
        anyMatch = true;
        const before = fresh.slice(lastIndex, match.index);
        if (before) fragment.appendChild(document.createTextNode(before));

        const trackName = match[1].trim();
        const artistRaw = match[2];
        // Trim artist: stop at sentence-ending punctuation or common terminators
        const artistName = artistRaw.split(/[.!?;,\n]/)[0].trim();

        const span = document.createElement('span');
        span.className = 'sbtp-track-ref';
        span.textContent = match[0].trim();
        span.dataset.track = trackName;
        span.dataset.artist = artistName;

        span.addEventListener('mouseenter', () => {
          clearTimeout(hideTimer);
          showPlayer(trackName, artistName);
        });
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          pinned = true;
          showPlayer(trackName, artistName);
          playerContainer.querySelector('#sbtp-pin-btn').style.color = '#ffd700';
        });

        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;

        // Only match first occurrence per pattern per text node to avoid infinite loops
        break;
      }

      if (anyMatch) break; // use only first matching pattern
    }

    if (!anyMatch) return false;

    const tail = text.slice(lastIndex);
    if (tail) fragment.appendChild(document.createTextNode(tail));

    textNode.parentNode.replaceChild(fragment, textNode);
    return true;
  }

  function walkAndHighlight(root) {
    // Skip scripts, styles, our own player, already-processed nodes
    if (!root || root.id === 'sbtp-player-container') return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(tag))
            return NodeFilter.FILTER_REJECT;
          if (parent.closest('.sbtp-track-ref')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('#sbtp-player-container')) return NodeFilter.FILTER_REJECT;
          // Only process nodes that contain "by" (fast pre-filter)
          if (!node.nodeValue.includes(' by ') && !node.nodeValue.includes(' By '))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(highlightTextNode);
  }

  // ─── Observe Gmail's Dynamic Email Loading ────────────────────────────────
  function observeGmail() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Gmail email body usually lands in .a3s or [data-message-id]
            const emailBody = node.querySelector
              ? node.querySelector('.a3s, .adn, [data-message-id]')
              : null;
            if (emailBody) {
              walkAndHighlight(emailBody);
            } else if (
              node.classList &&
              (node.classList.contains('a3s') ||
               node.classList.contains('adn') ||
               node.dataset.messageId)
            ) {
              walkAndHighlight(node);
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Scan any already-rendered email content
    document.querySelectorAll('.a3s, .adn').forEach(walkAndHighlight);
    observeGmail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
