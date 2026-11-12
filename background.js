// background.js

// Safari exposes the WebExtension API as `browser`; Chrome as `chrome`.
const api = globalThis.browser ?? globalThis.chrome;

// Pattern to match KHU video endpoints
const VIDEO_PATTERN = /^https:\/\/commons\.khu\.ac\.kr\/em\/[a-zA-Z0-9]+/;

// Map of tabId -> Set of video URLs
const videoMap = {};

// Listen to all web requests to KHU commons video paths
// webRequest is unavailable in Safari (MV3); the popup scans frames instead.
if (api.webRequest?.onBeforeRequest) api.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId } = details;
    console.log(`[background.js] onBeforeRequest - url: ${url}, tabId: ${tabId}`);
    if (tabId < 0) return;
    if (VIDEO_PATTERN.test(url)) {
      console.log(`[background.js] matched video URL for tab ${tabId}: ${url}`);
      if (!videoMap[tabId]) {
        console.log(`[background.js] initializing videoMap for tab ${tabId}`);
        videoMap[tabId] = new Set();
      }
      console.log(`[background.js] adding URL to videoMap[${tabId}]: ${url}`);
      videoMap[tabId].add(url);
    }
  },
  { urls: ["*://commons.khu.ac.kr/em/*"] }
);

// Declarative Net Request handles Referer modification; remove webRequest listener
// chrome.webRequest.onBeforeSendHeaders.addListener(
//   (details) => {
//     const headers = details.requestHeaders.filter(h => h.name.toLowerCase() !== 'referer');
//     headers.push({ name: 'Referer', value: 'https://commons.khu.ac.kr/' });
//     return { requestHeaders: headers };
//   },
//   { urls: ['https://khu-cms-object.cdn.gov-ntruss.com/*'] },
//   ['blocking', 'requestHeaders']
// );

// Clear video URLs when a tab starts loading a new page
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  console.log(`[background.js] onUpdated - tab: ${tabId}, status: ${changeInfo.status}`);
  if (changeInfo.status === 'loading' && videoMap[tabId]) {
    console.log(`[background.js] clearing videoMap for tab ${tabId} on loading`);
    delete videoMap[tabId];
  }
});

// Clean up when a tab is closed
api.tabs.onRemoved.addListener((tabId) => {
  console.log(`[background.js] onRemoved - tab: ${tabId}`);
  if (videoMap[tabId]) {
    console.log(`[background.js] deleting videoMap for closed tab ${tabId}`);
    delete videoMap[tabId];
  }
});

// Respond to popup requests for videos
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`[background.js] onMessage - request: ${JSON.stringify(request)}, sender: ${JSON.stringify(sender)}`);
  if (request.action === 'getVideos') {
    console.log(`[background.js] getVideos for tabId: ${request.tabId}`);
    const urls = videoMap[request.tabId] 
      ? Array.from(videoMap[request.tabId])
      : [];
    console.log(`[background.js] responding with ${urls.length} videos for tab ${request.tabId}`);
    sendResponse({ videos: urls });
  }
});

// Respond to popup requests for metadata
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getMetadata') {
    const id = request.id;
    const url = `https://commons.khu.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=${id}`;
    console.log(`[background.js] getMetadata for content_id: ${id}`);
    fetch(url, { headers: { 'Referer': 'https://commons.khu.ac.kr/' } })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(text => {
        console.log(`[background.js] fetched metadata XML for ${id}`);
        sendResponse({ xml: text });
      })
      .catch(err => {
        console.error(`[background.js] getMetadata error for ${id}:`, err);
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

// Respond to log requests
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'log') {
    console.log(`[${message.data.type}]`, message.data.details);
  }
});

// Download logic moved to popup; remove unused queue and listeners
// const downloadQueue = [];
// let isDownloading = false;
// async function processNextDownload() { /*...*/ }
// chrome.downloads.onCreated.addListener(item => {});
// chrome.downloads.onChanged.addListener(delta => {});
// function handleDownload(request, sendResponse) { /*...*/ }
// api.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === 'downloadVideo') {
//     handleDownload(request, sendResponse);
//     return true;
//   }
// });