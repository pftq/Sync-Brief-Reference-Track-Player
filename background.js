// Resolves a YouTube search query to the first regular video result.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'SBTP_FIND_VIDEO') return false;

  findFirstYouTubeVideo(message.query)
    .then((video) => sendResponse({ ok: true, video }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

async function findFirstYouTubeVideo(query) {
  const normalized = String(query || '').trim();
  if (!normalized) throw new Error('Empty search query');

  const url = 'https://www.youtube.com/results?search_query='
    + encodeURIComponent(normalized);

  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!response.ok) throw new Error(`YouTube search failed (${response.status})`);

  const html = await response.text();
  const initialData = extractInitialData(html);
  const video = findVideoRenderer(initialData);

  if (video) return video;

  const fallbackId = findWatchId(html);
  if (fallbackId) return { id: fallbackId, title: normalized, channel: '' };

  throw new Error('No video result found');
}

function extractInitialData(html) {
  const markerIndex = html.indexOf('ytInitialData');
  if (markerIndex === -1) return null;

  const firstBrace = html.indexOf('{', markerIndex);
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = firstBrace; i < html.length; i += 1) {
    const char = html[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(firstBrace, i + 1));
    }
  }

  return null;
}

function findVideoRenderer(root) {
  const stack = [root];

  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;

    if (value.videoRenderer && value.videoRenderer.videoId) {
      const renderer = value.videoRenderer;
      return {
        id: renderer.videoId,
        title: textFromRuns(renderer.title),
        channel: textFromRuns(renderer.ownerText) || textFromRuns(renderer.shortBylineText)
      };
    }

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push(value[i]);
    } else {
      for (const key of Object.keys(value)) stack.push(value[key]);
    }
  }

  return null;
}

function textFromRuns(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run.text || '').join('').trim();
  return '';
}

function findWatchId(html) {
  const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  return match ? match[1] : '';
}
