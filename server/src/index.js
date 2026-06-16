require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { parse } = require('./parser');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Download log + IP geolocation ──

const downloadLogs = [];
const ipCache = new Map();

async function getIpLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '本地';
  }
  if (ipCache.has(ip)) return ipCache.get(ip);

  try {
    const res = await axios.get(
      `http://ip-api.com/json/${ip}?fields=status,regionName,city&lang=zh-CN`,
      { timeout: 3000 }
    );
    if (res.data && res.data.status === 'success') {
      const r = res.data.regionName || '';
      const c = res.data.city || '';
      const loc = (r === c) ? r : r + c;
      ipCache.set(ip, loc);
      return loc;
    }
  } catch (_) {}
  ipCache.set(ip, '未知地区');
  return '未知地区';
}

function addLog(ip, location) {
  downloadLogs.unshift({
    location: location + '用户',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  if (downloadLogs.length > 20) downloadLogs.length = 20;
}

// ── Routes ──

app.post('/api/parse', async (req, res) => {
  const text = (req.body && req.body.text) || '';
  try {
    const data = await parse(text);
    res.json({ code: 0, data });
  } catch (err) {
    console.error('[parse error]', err.message);
    res.json({ code: 1, msg: '解析失败：' + err.message });
  }
});

// Proxy: browser can't fetch douyin CDN directly (403 without proper Referer/UA)
app.get('/api/download', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ code: 1, msg: 'missing url param' });
    return;
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) ' +
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.douyin.com/',
      },
      maxRedirects: 5,
    });

    const ct = upstream.headers['content-type'] || 'video/mp4';
    const cl = upstream.headers['content-length'];
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    upstream.data.pipe(res);
  } catch (err) {
    console.error('[download proxy error]', err.message);
    res.status(502).json({ code: 1, msg: '下载代理失败：' + err.message });
  }
});

// Lightweight: log a download event
app.post('/api/log-download', async (req, res) => {
  const clientIp = (req.headers['x-forwarded-for'] || req.ip || '').replace(/,.*/, '');
  const location = await getIpLocation(clientIp);
  addLog(clientIp, location);
  res.json({ code: 0 });
});

app.get('/api/logs', (_req, res) => {
  res.json({ code: 0, data: downloadLogs });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`douyin-parse-server listening on ${port}`);
});
