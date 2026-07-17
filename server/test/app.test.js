const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');

const { createApp } = require('../src/index');
const { createDownloadToken } = require('../src/security');

async function request(server, path, options = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: address.port, path, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('download endpoint rejects the legacy arbitrary URL parameter', async (t) => {
  const app = createApp({ downloadTokenSecret: 'test-secret' });
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await request(server, '/api/download?url=' + encodeURIComponent('http://127.0.0.1:8787/api/logs'));
  assert.equal(result.status, 400);
  assert.match(result.body, /token/i);
});

test('health endpoint reports service status', async (t) => {
  const app = createApp({ downloadTokenSecret: 'test-secret' });
  const server = app.listen(0);
  t.after(() => server.close());

  const result = await request(server, '/api/health');
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { code: 0, status: 'ok' });
});

test('parse endpoint replaces media URLs with signed download tokens', async (t) => {
  const app = createApp({
    downloadTokenSecret: 'test-secret',
    parse: async () => ({
      videoUrl: 'https://v26-web.douyinvod.com/video.mp4',
      formats: [{ formatId: '720', url: 'https://v26-web.douyinvod.com/720.mp4' }],
    }),
  });
  const server = app.listen(0);
  t.after(() => server.close());

  const body = JSON.stringify({ text: 'https://v.douyin.com/test' });
  const result = await request(server, '/api/parse', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  });
  assert.equal(result.status, 200);
  const data = JSON.parse(result.body).data;
  assert.doesNotMatch(data.videoUrl, /^https?:/);
  assert.match(data.videoUrl, /\./);
  assert.doesNotMatch(data.formats[0].url, /^https?:/);
});

test('download endpoint forwards Range and streams valid token content', async (t) => {
  const secret = 'test-secret';
  let receivedOptions;
  const app = createApp({
    downloadTokenSecret: secret,
    openMediaStream: async (_url, options) => {
      receivedOptions = options;
      return {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 0-3/10', 'accept-ranges': 'bytes' },
        data: Readable.from(Buffer.from('test')),
      };
    },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const token = createDownloadToken({ url: 'https://v26-web.douyinvod.com/video.mp4', platform: 'douyin' }, secret);
  const result = await request(server, '/api/download?token=' + encodeURIComponent(token), { headers: { range: 'bytes=0-3' } });
  assert.equal(result.status, 206);
  assert.equal(result.body, 'test');
  assert.equal(receivedOptions.range, 'bytes=0-3');
});

test('download endpoint rejects content length above the configured maximum', async (t) => {
  const secret = 'test-secret';
  const app = createApp({
    downloadTokenSecret: secret,
    maxDownloadBytes: 3,
    openMediaStream: async () => ({
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '4' },
      data: Readable.from(Buffer.from('test')),
    }),
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const token = createDownloadToken({ url: 'https://v26-web.douyinvod.com/video.mp4', platform: 'douyin' }, secret);
  const result = await request(server, '/api/download?token=' + encodeURIComponent(token));
  assert.equal(result.status, 413);
});

test('rate limit returns 429 after the configured request count', async (t) => {
  const app = createApp({ downloadTokenSecret: 'test-secret', rateLimitMax: 1 });
  const server = app.listen(0);
  t.after(() => server.close());
  assert.equal((await request(server, '/api/logs')).status, 200);
  const limited = await request(server, '/api/logs');
  assert.equal(limited.status, 429);
  assert.equal(JSON.parse(limited.body).code, 1);
});

test('malformed API JSON and unknown API routes use JSON errors', async (t) => {
  const app = createApp({ downloadTokenSecret: 'test-secret' });
  const server = app.listen(0);
  t.after(() => server.close());
  const malformed = await request(server, '/api/parse', {
    method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
  });
  assert.equal(malformed.status, 400);
  assert.equal(JSON.parse(malformed.body).code, 1);

  const missing = await request(server, '/api/not-found');
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).code, 1);
});
