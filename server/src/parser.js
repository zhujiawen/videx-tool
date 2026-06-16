const axios = require('axios');
const { execFile } = require('child_process');

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

const SHORT_LINK_RE = /https?:\/\/v\.douyin\.com\/[\w\-]+/;
const FULL_LINK_RE = /https?:\/\/(?:www\.)?(?:iesdouyin|douyin)\.com\/(?:share\/)?video\/(\d+)/;
const AWEME_ID_RE = /\/video\/(\d+)/;
const URL_EXTRACT_RE = /https?:\/\/[^\s一-鿿]*douyin\.com\/[^\s一-鿿]*/;
const KUAISHOU_URL_RE = /https?:\/\/[^\s一-鿿]*kuaishou\.com\/[^\s一-鿿]*/;
const KUAISHOU_SHORT_RE = /https?:\/\/v\.kuaishou\.com\/[\w\-]+/;

function extractUrl(text) {
  const km = text.match(KUAISHOU_URL_RE) || text.match(KUAISHOU_SHORT_RE);
  if (km) return km[0];
  const dm = text.match(URL_EXTRACT_RE);
  return dm ? dm[0] : text.trim();
}

async function resolveAwemeId(url) {
  const fullMatch = url.match(FULL_LINK_RE);
  if (fullMatch) return fullMatch[1];

  const shortMatch = url.match(SHORT_LINK_RE);
  if (!shortMatch) return null;

  const resp = await axios.get(shortMatch[0], {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': IPHONE_UA },
    timeout: 15000,
  });

  const location = resp.headers.location || '';
  const idMatch = location.match(AWEME_ID_RE);
  return idMatch ? idMatch[1] : null;
}

function parseWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    // Request all formats so we can offer quality selection
    const args = [
      '-m', 'yt_dlp',
      '--dump-json',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '--restrict-filenames',
      '--no-check-certificates',
      '-f', 'bestvideo+bestaudio/best',
      url
    ];

    execFile('python', args, { timeout: 45000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('yt-dlp json parse failed'));
      }
    });
  });
}

async function fetchItemInfoFromHtml(awemeId) {
  const url = `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const resp = await axios.get(url, {
    headers: { 'User-Agent': IPHONE_UA },
    timeout: 15000,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
  const m = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!m) throw new Error('router data not found');

  let routerData;
  try {
    routerData = JSON.parse(m[1]);
  } catch (e) {
    throw new Error('router data parse failed');
  }

  const loader = routerData.loaderData || {};
  const page = loader['video_(id)/page'] || loader['note_(id)/page'] || null;
  const item =
    page && page.videoInfoRes && page.videoInfoRes.item_list && page.videoInfoRes.item_list[0];
  if (!item) throw new Error('item_list empty');
  return item;
}

function extractFormats(info) {
  const formats = (info.formats || []).filter(f => {
    const vcodec = (f.vcodec || '');
    return vcodec !== 'none' && f.url;
  });

  // Group by height, pick best per height
  const byHeight = new Map();
  for (const f of formats) {
    const h = f.height || 0;
    if (h === 0) continue;
    if (!byHeight.has(h)) byHeight.set(h, f);
  }

  const result = [];
  for (const [height, f] of byHeight) {
    const note = f.format_note || '';
    let label = height + 'p';
    if (note.toLowerCase().includes('watermark') || note.includes('水印')) {
      label += '（含水印）';
    }
    if (note.toLowerCase().includes('direct')) {
      label += '（直链）';
    }
    result.push({
      formatId: f.format_id,
      label,
      height,
      url: f.url,
      filesize: f.filesize || f.content_length || null,
    });
  }

  // Sort by height ascending (lowest first)
  result.sort((a, b) => a.height - b.height);
  return result;
}

function buildResultFromYtDlp(info) {
  const best = info.requested_downloads && info.requested_downloads[0];
  const videoUrl = (best && best.url) || info.url || '';

  // yt-dlp: "uploader" is often the user ID, "channel" or "creator" is the display name
  // Try multiple fields to get the display nickname
  const author = info.channel || info.creator || info.uploader || '';

  const formats = extractFormats(info);

  return {
    videoUrl,
    cover: info.thumbnail || '',
    title: info.title || info.fulltitle || '抖音视频',
    author,
    duration: info.duration || null,
    durationFormatted: formatDuration(info.duration),
    likeCount: info.like_count || null,
    saveCount: info.save_count || null,
    commentCount: info.comment_count || null,
    repostCount: info.repost_count || null,
    viewCount: info.view_count || null,
    width: info.width || null,
    height: info.height || null,
    awemeId: info.id || '',
    formats,
    method: 'yt-dlp',
  };
}

function buildResultFromHtml(item) {
  const playAddrList =
    (item.video && item.video.play_addr && item.video.play_addr.url_list) || [];
  if (playAddrList.length === 0) throw new Error('play_addr missing');

  const wmUrl = playAddrList[0];
  const videoUrl = wmUrl.replace('/playwm/', '/play/');
  const stats = (item.statistics) || {};
  const height = (item.video && item.video.height) || 0;

  return {
    videoUrl,
    cover: (item.video && item.video.cover && item.video.cover.url_list && item.video.cover.url_list[0]) || '',
    title: item.desc || '视频',
    author: (item.author && item.author.nickname) || '',
    duration: (item.video && item.video.duration) ? Math.round(item.video.duration / 1000) : null,
    durationFormatted: formatDuration(
      (item.video && item.video.duration) ? Math.round(item.video.duration / 1000) : null
    ),
    likeCount: stats.digg_count || null,
    saveCount: stats.collect_count || null,
    commentCount: stats.comment_count || null,
    repostCount: stats.share_count || null,
    viewCount: stats.play_count || null,
    width: (item.video && item.video.width) || null,
    height,
    awemeId: (item.aweme_id) || '',
    formats: height ? [{ formatId: 'default', label: height + 'p', height, url: videoUrl, filesize: null }] : [],
    method: 'html',
  };
}

function buildKuaishouResult(info) {
  const best = info.requested_downloads && info.requested_downloads[0];
  const videoUrl = (best && best.url) || info.url || '';
  const author = info.channel || info.creator || info.uploader || '';
  const formats = extractFormats(info);

  return {
    videoUrl,
    cover: info.thumbnail || '',
    title: info.title || info.fulltitle || '快手视频',
    author,
    duration: info.duration || null,
    durationFormatted: formatDuration(info.duration),
    likeCount: info.like_count || null,
    saveCount: null,
    commentCount: info.comment_count || null,
    repostCount: info.repost_count || null,
    viewCount: info.view_count || null,
    width: info.width || null,
    height: info.height || null,
    awemeId: info.id || '',
    formats,
    method: 'yt-dlp',
    platform: 'kuaishou',
  };
}

async function resolveKuaishouShortUrl(url) {
  const resp = await axios.get(url, {
    maxRedirects: 5,
    headers: { 'User-Agent': IPHONE_UA },
    timeout: 15000,
  });
  return resp.request.res.responseUrl || url;
}

async function parseKuaishouHtml(url) {
  const finalUrl = await resolveKuaishouShortUrl(url);

  const resp = await axios.get(finalUrl, {
    headers: { 'User-Agent': IPHONE_UA },
    timeout: 15000,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const html = typeof resp.data === 'string' ? resp.data : String(resp.data);

  // Parse window.INIT_STATE
  const initStateMatch = html.match(/window\.INIT_STATE\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!initStateMatch) throw new Error('快手页面数据未找到');

  let initState;
  try {
    initState = JSON.parse(initStateMatch[1]);
  } catch (e) {
    throw new Error('快手页面数据解析失败');
  }

  // Find the photo object in INIT_STATE
  let photo = null;
  for (const key of Object.keys(initState)) {
    const obj = initState[key];
    if (obj && typeof obj === 'object' && obj.photo && obj.photo.mainMvUrls) {
      photo = obj.photo;
      break;
    }
  }

  if (!photo) throw new Error('快手视频信息未找到');

  // Extract video URL from mainMvUrls
  const mainMvUrls = photo.mainMvUrls || [];
  const videoUrl = mainMvUrls.length > 0 ? mainMvUrls[0].url : '';

  // Extract cover
  const coverUrls = photo.coverUrls || [];
  const cover = coverUrls.length > 0 ? coverUrls[0].url : '';

  // Extract multi-quality formats from manifest
  const formats = [];
  const manifest = photo.manifest || {};
  const adaptationSet = manifest.adaptationSet || [];
  for (const as of adaptationSet) {
    const reps = as.representation || [];
    for (const rep of reps) {
      const url = rep.url || '';
      if (!url) continue;
      const qualityType = rep.qualityType || '';
      const w = rep.width || 0;
      const h = rep.height || 0;
      let label = qualityType || (h ? h + 'p' : '原画');
      formats.push({
        formatId: rep.id || String(formats.length),
        label,
        height: h,
        url,
        filesize: null,
      });
    }
  }

  // If no formats from manifest, use mainMvUrls
  if (formats.length === 0 && videoUrl) {
    formats.push({
      formatId: 'default',
      label: (photo.height || 0) + 'p',
      height: photo.height || 0,
      url: videoUrl,
      filesize: null,
    });
  }

  // Fetch file sizes via HEAD requests (parallel, best-effort)
  await Promise.all(formats.map(async (f) => {
    try {
      const head = await axios.head(f.url, {
        timeout: 8000,
        headers: { 'User-Agent': IPHONE_UA, 'Referer': 'https://www.kuaishou.com/' },
        maxRedirects: 3,
      });
      const cl = head.headers['content-length'];
      if (cl) f.filesize = parseInt(cl, 10);
    } catch (_) {}
  }));

  const durationMs = photo.duration || null;
  const durationSec = durationMs ? Math.round(durationMs / 1000) : null;

  return {
    videoUrl: videoUrl || (formats.length > 0 ? formats[0].url : ''),
    cover,
    title: photo.caption || '快手视频',
    author: photo.userName || '',
    duration: durationSec,
    durationFormatted: formatDuration(durationSec),
    likeCount: photo.likeCount != null ? photo.likeCount : null,
    saveCount: null,
    commentCount: photo.commentCount != null ? photo.commentCount : null,
    repostCount: photo.forwardCount != null ? photo.forwardCount : null,
    viewCount: photo.viewCount != null ? photo.viewCount : null,
    width: photo.width || null,
    height: photo.height || null,
    awemeId: photo.photoId || '',
    formats,
    method: 'html',
    platform: 'kuaishou',
  };
}

function isKuaishouUrl(url) {
  return KUAISHOU_URL_RE.test(url) || KUAISHOU_SHORT_RE.test(url);
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return `${h}:${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${mm}:${String(sec).padStart(2, '0')}`;
}

async function parseDouyin(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('empty input');
  }

  const url = extractUrl(text);
  if (!url.startsWith('http')) {
    throw new Error('no valid url');
  }

  try {
    const info = await parseWithYtDlp(url);
    return buildResultFromYtDlp(info);
  } catch (e) {
    console.warn('[yt-dlp failed]', e.message.slice(0, 120), '— falling back to html parser');
  }

  const awemeId = await resolveAwemeId(url);
  if (!awemeId) throw new Error('aweme id not found');

  const item = await fetchItemInfoFromHtml(awemeId);
  return buildResultFromHtml(item);
}

async function parseKuaishou(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('empty input');
  }

  const url = extractUrl(text);
  if (!url.startsWith('http')) {
    throw new Error('no valid url');
  }

  try {
    const info = await parseWithYtDlp(url);
    return buildKuaishouResult(info);
  } catch (e) {
    console.warn('[yt-dlp kuaishou failed]', e.message.slice(0, 120), '— falling back to html parser');
  }

  return parseKuaishouHtml(url);
}

async function parse(text) {
  const url = extractUrl(text || '');
  if (isKuaishouUrl(url)) return parseKuaishou(text);
  return parseDouyin(text);
}

module.exports = { parseDouyin, parseKuaishou, parse };
