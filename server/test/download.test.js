const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { openMediaStream } = require('../src/download');

test('validates every redirect target before requesting it', async () => {
  const requested = [];
  const request = async (url) => {
    requested.push(url);
    return {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
      data: Readable.from([]),
    };
  };

  await assert.rejects(
    openMediaStream('https://v26-web.douyinvod.com/video.mp4', { request, userAgent: 'test' }),
    /protocol|media host/i,
  );
  assert.deepEqual(requested, ['https://v26-web.douyinvod.com/video.mp4']);
});
