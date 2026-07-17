const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSupportedPageUrl,
  assertAllowedMediaUrl,
  isPublicAddress,
  createDownloadToken,
  verifyDownloadToken,
} = require('../src/security');

test('accepts supported Douyin and Kuaishou page URLs', () => {
  assert.doesNotThrow(() => assertSupportedPageUrl('https://v.douyin.com/abc-123'));
  assert.doesNotThrow(() => assertSupportedPageUrl('https://www.kuaishou.com/short-video/abc'));
});

test('rejects lookalike and unsupported page hosts', () => {
  assert.throws(() => assertSupportedPageUrl('https://douyin.com.evil.example/video/1'), /unsupported/i);
  assert.throws(() => assertSupportedPageUrl('http://127.0.0.1:8787/api/logs'), /unsupported/i);
  assert.throws(() => assertSupportedPageUrl('file:///etc/passwd'), /protocol/i);
  assert.throws(() => assertSupportedPageUrl('https://www.douyin.com/redirect?url=http://127.0.0.1'), /path/i);
  assert.throws(() => assertSupportedPageUrl('https://www.kuaishou.com/arbitrary/path'), /path/i);
});

test('accepts known media CDN hosts and rejects arbitrary hosts', () => {
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://v26-web.douyinvod.com/video/tos/test'));
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://txmov2.a.kwimgs.com/upic/test.mp4'));
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://aweme.snssdk.com/aweme/v1/play/?video_id=test'));
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://v5-dy-ov-experiment.zjcdn.com/video/tos/test'));
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://abc.djvod.ndcimgs.com/test.mp4'));
  assert.doesNotThrow(() => assertAllowedMediaUrl('https://hwmov.a.yximgs.com/test.mp4'));
  assert.throws(() => assertAllowedMediaUrl('https://example.com/video.mp4'), /media host/i);
});

test('rejects loopback, private, link-local, and mapped private addresses', () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1',
    '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::127.0.0.1',
    '64:ff9b::127.0.0.1', '2001:db8::1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('download tokens are tamper evident and expire', () => {
  const secret = 'test-secret-with-enough-entropy';
  const token = createDownloadToken({ url: 'https://v26-web.douyinvod.com/a.mp4', platform: 'douyin' }, secret, 1000, 10_000);
  assert.deepEqual(verifyDownloadToken(token, secret, 10_500), {
    url: 'https://v26-web.douyinvod.com/a.mp4',
    platform: 'douyin',
    exp: 11_000,
  });
  assert.throws(() => verifyDownloadToken(token + 'x', secret, 10_500), /invalid token/i);
  assert.throws(() => verifyDownloadToken(token, secret, 11_001), /expired/i);
});
