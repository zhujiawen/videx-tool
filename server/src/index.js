require('dotenv').config();
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('node:path');
const { Transform } = require('node:stream');
const { parse } = require('./parser');
const { openMediaStream } = require('./download');
const { assertAllowedMediaUrl, createDownloadToken, verifyDownloadToken } = require('./security');
const { checkRuntimeDependencies } = require('./runtime');

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

function createLimiter(maxConcurrent) {
  let active = 0;
  return async function withLimit(work) {
    if (active >= maxConcurrent) {
      const error = new Error('server is busy');
      error.status = 503;
      throw error;
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
    }
  };
}

function rateLimit({ windowMs, max }) {
  const clients = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const record = clients.get(key);
    if (!record || record.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ code: 1, msg: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

function tokenizeMediaResult(data, secret, ttlMs) {
  const platform = data.platform === 'kuaishou' ? 'kuaishou' : 'douyin';
  const makeToken = (url) => {
    assertAllowedMediaUrl(url);
    return createDownloadToken({ url, platform }, secret, ttlMs);
  };
  const formats = (data.formats || []).flatMap((format) => {
    try {
      return [{ ...format, url: makeToken(format.url) }];
    } catch (_) {
      return [];
    }
  });
  return { ...data, videoUrl: makeToken(data.videoUrl), formats };
}

function createApp(options = {}) {
  const app = express();
  const downloadLogs = [];
  const ipCache = new Map();
  const parseFn = options.parse || parse;
  const openStream = options.openMediaStream || openMediaStream;
  const tokenSecret = options.downloadTokenSecret || process.env.DOWNLOAD_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
  const tokenTtlMs = Number(process.env.DOWNLOAD_TOKEN_TTL_MS) || 10 * 60 * 1000;
  const maxDownloadBytes = options.maxDownloadBytes ?? (Number(process.env.MAX_DOWNLOAD_BYTES) || 500 * 1024 * 1024);
  const withParseLimit = createLimiter(options.maxParseConcurrency ?? (Number(process.env.MAX_PARSE_CONCURRENCY) || 2));
  const withDownloadLimit = createLimiter(options.maxDownloadConcurrency ?? (Number(process.env.MAX_DOWNLOAD_CONCURRENCY) || 4));

  app.set('trust proxy', options.trustProxy ?? 'loopback');
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/api/health', (_req, res) => res.json({ code: 0, status: 'ok' }));
  app.use('/api', rateLimit({
    windowMs: options.rateLimitWindowMs ?? (Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000),
    max: options.rateLimitMax ?? (Number(process.env.RATE_LIMIT_MAX) || 60),
  }));

  async function getIpLocation(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return '本地';
    if (ipCache.has(ip)) return ipCache.get(ip);
    try {
      const response = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,regionName,city&lang=zh-CN`, { timeout: 3000 });
      if (response.data?.status === 'success') {
        const region = response.data.regionName || '';
        const city = response.data.city || '';
        const location = region === city ? region : region + city;
        ipCache.set(ip, location);
        return location;
      }
    } catch (_) {}
    ipCache.set(ip, '未知地区');
    return '未知地区';
  }

  app.post('/api/parse', async (req, res) => {
    const text = req.body?.text || '';
    try {
      const data = await withParseLimit(() => parseFn(text));
      res.json({ code: 0, data: tokenizeMediaResult(data, tokenSecret, tokenTtlMs) });
    } catch (error) {
      console.error('[parse error]', error.message);
      const inputError = /empty input|no valid url|unsupported|protocol|invalid URL/i.test(error.message);
      res.status(error.status || (inputError ? 400 : 422)).json({ code: 1, msg: '解析失败：' + error.message });
    }
  });

  app.get('/api/download', async (req, res) => {
    if (!req.query.token) return res.status(400).json({ code: 1, msg: 'missing token param' });
    let payload;
    try {
      payload = verifyDownloadToken(req.query.token, tokenSecret);
      assertAllowedMediaUrl(payload.url);
    } catch (error) {
      return res.status(403).json({ code: 1, msg: '无效或已过期的下载令牌' });
    }

    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      await withDownloadLimit(async () => {
        const upstream = await openStream(payload.url, {
          platform: payload.platform,
          range: req.headers.range,
          signal: controller.signal,
          userAgent: IPHONE_UA,
        });
        const contentLength = Number(upstream.headers['content-length']) || 0;
        if (contentLength > maxDownloadBytes) {
          upstream.data.destroy();
          return res.status(413).json({ code: 1, msg: '视频文件超过下载大小限制' });
        }

        res.status(upstream.status);
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
          if (upstream.headers[header]) res.setHeader(header, upstream.headers[header]);
        }
        res.setHeader('Content-Disposition', 'attachment');

        let transferred = 0;
        const sizeGuard = new Transform({
          transform(chunk, _encoding, callback) {
            transferred += chunk.length;
            if (transferred > maxDownloadBytes) return callback(new Error('download size limit exceeded'));
            callback(null, chunk);
          },
        });
        upstream.data.on('error', (error) => sizeGuard.destroy(error));
        sizeGuard.on('error', () => {
          controller.abort();
          if (!res.headersSent) res.status(502).json({ code: 1, msg: '下载代理失败' });
          else res.destroy();
        });
        upstream.data.pipe(sizeGuard).pipe(res);
        await new Promise((resolve, reject) => {
          res.on('finish', resolve);
          res.on('close', resolve);
          sizeGuard.on('error', reject);
        });
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('[download proxy error]', error.message);
      if (!res.headersSent) res.status(error.status || 502).json({ code: 1, msg: '下载代理失败：' + error.message });
    }
  });

  app.post('/api/log-download', async (req, res) => {
    const location = await getIpLocation(req.ip);
    downloadLogs.unshift({ location: location + '用户', time: new Date().toLocaleString('zh-CN', { hour12: false }) });
    if (downloadLogs.length > 20) downloadLogs.length = 20;
    res.json({ code: 0 });
  });

  app.get('/api/logs', (_req, res) => res.json({ code: 0, data: downloadLogs }));

  app.use('/api', (_req, res) => res.status(404).json({ code: 1, msg: 'API endpoint not found' }));
  app.use((error, req, res, next) => {
    if (!req.path.startsWith('/api')) return next(error);
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error('[api error]', error.message);
    res.status(status).json({ code: 1, msg: status === 400 ? '请求格式错误' : '服务器内部错误' });
  });
  return app;
}

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function startServer() {
  const runtime = await checkRuntimeDependencies();
  const port = Number(process.env.PORT) || 8787;
  const server = await listen(createApp(), port);
  console.log(`videx server listening on ${port} (yt-dlp ${runtime.ytDlpVersion} via ${runtime.pythonBin})`);
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[startup error]', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp, createLimiter, rateLimit, listen, startServer, tokenizeMediaResult };
