// Safari exposes the WebExtension API as `browser`; Chrome as `chrome`.
const api = globalThis.browser ?? globalThis.chrome;

const view = document.querySelector('#wrapper');

// Pattern to match KHU video embed endpoints
const VIDEO_PATTERN = /^https:\/\/commons\.khu\.ac\.kr\/em\/[a-zA-Z0-9]+/;

// Error messages
const ERRORS = {
  NOT_LEARNINGX: 'LearningX 페이지가 아닙니다',
  NO_VIDEOS: '강의영상 없음',
  FETCH_ERROR: '강의 정보를 가져오는 중 오류가 발생했습니다',
  DOWNLOAD_ERROR: '다운로드 중 오류가 발생했습니다',
  PARSE_ERROR: '강의 정보를 파싱하는 중 오류가 발생했습니다'
};

// Cache for video metadata to avoid redundant fetches
const videoMetadataCache = new Map();
// Base URL for backend downloader
const BACKEND_URL = 'http://localhost:52022/download';

// Download queue to serialize downloads in popup
const downloadQueue = [];
let isDownloading = false;
let currentTabId = null;

// Main function
(async () => {
  try {
    // Get the active tab
    const tab = await getActiveTab();
    if (!tab) {
      showError('탭 정보를 가져올 수 없습니다');
      return;
    }
    currentTabId = tab.id;

    // Check if the current page is a LearningX course
    const isLearningX = await checkIfLearningX(tab.id);
    if (!isLearningX) {
      view.innerHTML = ERRORS.NOT_LEARNINGX;
      return;
    }

    // Request video scan from content script
    await scanForVideos(tab.id);
  } catch (error) {
    console.error('Extension error:', error);
    showError(`확장 프로그램 오류: ${error.message}`);
  }
})();

// Helper functions
async function getActiveTab() {
  try {
    const tabs = await api.tabs.query({active: true, currentWindow: true});
    return tabs[0];
  } catch (error) {
    console.error('Error getting active tab:', error);
    return null;
  }
}

async function checkIfLearningX(tabId) {
  try {
    // First check if we can access the tab's URL directly
    const tab = await api.tabs.get(tabId);
    
    // Check for restricted URLs that we can't inject into
    if (!tab.url || 
        tab.url.startsWith('chrome://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:') || 
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('safari-web-extension://')) {
      return false;
    }

    // If URL is accessible and from khcanvas, no need to inject script
    if (tab.url.includes('khcanvas.khu.ac.kr')) {
      return true;
    }

    // For other URLs, try executing the script
    const results = await api.scripting.executeScript({
      target: {tabId: tabId},
      func: () => window.location.href.includes('khcanvas.khu.ac.kr')
    });
    
    return results?.[0]?.result || false;
  } catch (error) {
    console.error('Error checking if LearningX:', error);
    return false;
  }
}

async function scanForVideos(tabId) {
  console.log(`[popup.js] scanForVideos called with tabId: ${tabId}`);
  try {
    // 1) URLs captured by the background via webRequest (Chrome only;
    //    Safari has no webRequest in MV3 and may unload the background at any time)
    let fromBackground = [];
    try {
      const response = await api.runtime.sendMessage({ action: 'getVideos', tabId });
      fromBackground = response?.videos || [];
    } catch (e) {
      console.warn('[popup.js] getVideos from background failed:', e);
    }

    // 2) URLs found by scanning the tab's frames directly (works in Safari and Chrome)
    const fromFrames = await scanFramesForVideos(tabId);

    // Deduplicate by content id
    const byId = new Map();
    for (const url of [...fromBackground, ...fromFrames]) {
      const id = url.split('?')[0].split('/').pop();
      if (!byId.has(id)) byId.set(id, url);
    }
    const videos = Array.from(byId.values());
    console.log('[popup.js] scanForVideos: videos array:', videos);
    if (videos.length === 0) {
      view.innerHTML = ERRORS.NO_VIDEOS;
      return;
    }

    await listVideos(videos);
  } catch (error) {
    console.error('Error scanning for videos:', error);
    showError(`비디오 스캔 오류: ${error.message}`);
  }
}

// Inject into every frame we have host permission for and collect video
// embed URLs (the frame's own URL plus any matching iframe src attributes).
async function scanFramesForVideos(tabId) {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const urls = [window.location.href];
        document.querySelectorAll('iframe[src]').forEach(f => urls.push(f.src));
        return urls;
      }
    });
    const urls = (results || []).flatMap(r => r?.result || []);
    return urls.filter(u => VIDEO_PATTERN.test(u));
  } catch (error) {
    console.warn('[popup.js] frame scan failed:', error);
    return [];
  }
}

// Fetch metadata XML from inside a commons.khu.ac.kr frame (same-origin request).
// Used as a fallback when the background fetch is unavailable or blocked (e.g. Safari).
async function fetchMetadataInFrame(tabId, id) {
  const results = await api.scripting.executeScript({
    target: { tabId, allFrames: true },
    args: [id],
    func: async (contentId) => {
      if (window.location.hostname !== 'commons.khu.ac.kr') return null;
      const res = await fetch(`/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}`);
      if (!res.ok) return null;
      return await res.text();
    }
  });
  const xml = (results || []).map(r => r?.result).find(Boolean);
  if (!xml) throw new Error('metadata fetch in frame failed');
  return xml;
}

async function getMetadataXml(id) {
  try {
    const response = await api.runtime.sendMessage({ action: 'getMetadata', id });
    if (response?.xml) return response.xml;
    throw new Error(response?.error || 'No XML returned from background');
  } catch (error) {
    console.warn(`[popup.js] background metadata fetch failed for ${id}, trying in-frame:`, error);
    return await fetchMetadataInFrame(currentTabId, id);
  }
}

async function listVideos(videos) {
  console.log(`[popup.js] listVideos: rendering ${videos.length} videos`);
  view.innerHTML = '';
  
  // Create a container for the video list
  const videoList = document.createElement('div');
  videoList.className = 'video-list';
  view.appendChild(videoList);
  
  // Add a loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'loading';
  loadingIndicator.textContent = '강의 정보를 가져오는 중...';
  videoList.appendChild(loadingIndicator);
  
  try {
    // Process videos in batches to avoid overwhelming the UI
    const batchSize = 5;
    for (let i = 0; i < videos.length; i += 1) {
      await processVideo(videos[i], videoList);
    }
    
    // Remove loading indicator
    loadingIndicator.remove();
    
    // If no videos were successfully processed, show error
    if (videoList.children.length === 0) {
      console.log('[popup.js] listVideos: no processed videos, showing NO_VIDEOS error');
      videoList.innerHTML = `<div class="error">${ERRORS.NO_VIDEOS}</div>`;
    }
  } catch (error) {
    console.error('Error listing videos:', error);
    videoList.innerHTML = `<div class="error">${ERRORS.FETCH_ERROR}</div>`;
  }
}

async function processVideo(video, container) {
  try {
    // Extract video ID
    const id = video.toString().split('?')[0].split('/').pop();
    console.log(`[popup.js] processVideo: request metadata for id: ${id}`);

    // Original embed URL
    const embedUrl = video;

    // Check cache first
    if (videoMetadataCache.has(id)) {
      const metadata = videoMetadataCache.get(id);
      console.log(`[popup.js] processVideo: using cached metadata for id: ${id}`);
      addVideoLink(metadata, container);
      return;
    }

    // Request metadata XML (background first, in-frame fallback)
    const xmlText = await getMetadataXml(id);

    // Parse XML
    const dom = (new DOMParser()).parseFromString(xmlText, 'text/xml');

    // Extract lecture name
    let titleEl = dom.querySelector('content_metadata title');
    if (!titleEl) titleEl = dom.querySelector('title');
    if (!titleEl) throw new Error('Missing title element in metadata XML');
    const lectName = titleEl.textContent.trim();

    // Determine metadata URL logic
    const contentTypeEl = dom.querySelector('content_playing_info content_type');
    const contentType = contentTypeEl?.textContent.trim() || '';
    let videoUrl, ext;
    if (contentType.toLowerCase() !== 'upf') {
      console.log('[popup.js] processVideo: using new metadata format');
      const cpi = dom.querySelector('content_playing_info');
      const mediaUriEl = Array.from(cpi.getElementsByTagName('media_uri'))
        .find(el => el.hasAttribute('auth_value')) || cpi.getElementsByTagName('media_uri')[0];
      if (!mediaUriEl) throw new Error('No media_uri element found in new format');
      const authValue = mediaUriEl.getAttribute('auth_value');
      videoUrl = mediaUriEl.textContent.trim() + '?token=' + authValue;
      ext = mediaUriEl.textContent.trim().split('.').pop();
    } else {
      console.log('[popup.js] processVideo: using old metadata format');
      const mainMediaEl = dom.querySelector('main_media');
      const mediaUriEl = dom.querySelector('media_uri');
      if (!mainMediaEl || !mediaUriEl) throw new Error('Missing media elements in old metadata format');
      const mediaFile = mainMediaEl.textContent.trim();
      const mediaUri = mediaUriEl.textContent.trim();
      const authValue = mainMediaEl.getAttribute('auth_value');
      if (!mediaFile || !mediaUri || !authValue) throw new Error('Incomplete video metadata fields in old format');
      videoUrl = mediaUri.replace('[MEDIA_FILE]', mediaFile) + '?token=' + authValue;
      ext = mediaFile.split('.').pop().trim();
    }

    const metadata = { lectName, url: videoUrl, ext, embedUrl };
    console.log('[popup.js] processVideo: parsed metadata:', metadata);

    videoMetadataCache.set(id, metadata);
    addVideoLink(metadata, container);
  } catch (error) {
    console.error(`Error processing video ${video}:`, error);
  }
}

async function addVideoLink(metadata, container) {
  const { lectName, url, ext } = metadata;
  const videoItem = document.createElement('div');
  videoItem.className = 'video-item';
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = lectName;
  link.className = 'video-link';
  link.onclick = (event) => {
    event.preventDefault();
    const statusElement = document.createElement('div');
    statusElement.className = 'download-status';
    videoItem.appendChild(statusElement);
    // enqueue download via backend proxy -> send to backend
    const host = new URL(metadata.embedUrl).origin;
    statusElement.textContent = '다운로드 요청 중...';
    fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename: `${lectName}.${ext}`, host })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'queued') {
        statusElement.textContent = '다운로드 요청 완료';
      } else {
        statusElement.textContent = `오류: ${data.error || 'Unknown'}`;
        statusElement.className = 'download-status error';
      }
    })
    .catch(err => {
      statusElement.textContent = `오류: ${err.message}`;
      statusElement.className = 'download-status error';
    });
  };
  videoItem.appendChild(link);
  container.appendChild(videoItem);
}

function showError(message) {
  view.innerHTML = `<div class="error">${message}</div>`;
}