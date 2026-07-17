const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parser = require('../src/parser');

test('extractUrl returns a supported URL from share text', () => {
  assert.equal(parser.extractUrl('复制打开 https://v.douyin.com/abc-123/ 看视频'), 'https://v.douyin.com/abc-123/');
});

test('extractFormats keeps muxed formats and sorts highest quality first', () => {
  const formats = parser.extractFormats({ formats: [
    { format_id: 'audio', vcodec: 'none', acodec: 'aac', height: 0, url: 'https://a' },
    { format_id: 'video-only', vcodec: 'h264', acodec: 'none', height: 1080, url: 'https://v' },
    { format_id: '720', vcodec: 'h264', acodec: 'aac', height: 720, url: 'https://muxed-720' },
    { format_id: '1080', vcodec: 'h264', acodec: 'aac', height: 1080, url: 'https://muxed-1080' },
  ] });

  assert.deepEqual(formats.map((format) => format.formatId), ['1080', '720']);
});

test('parses Douyin router data fixture', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/douyin.html'), 'utf8');
  const result = parser.parseDouyinHtml(html);
  assert.equal(result.awemeId, 'douyin-fixture-1');
  assert.equal(result.videoUrl, 'https://v26-web.douyinvod.com/play/fixture');
  assert.equal(result.author, 'Fixture author');
  assert.equal(result.duration, 12);
});

test('parses Kuaishou init state fixture', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/kuaishou.html'), 'utf8');
  const result = parser.parseKuaishouHtmlDocument(html);
  assert.equal(result.awemeId, 'kuaishou-fixture-1');
  assert.equal(result.videoUrl, 'https://txmov2.a.kwimgs.com/fixture.mp4');
  assert.equal(result.duration, 8);
});

test('keeps the highest bitrate Kuaishou representation for each resolution', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/kuaishou-duplicate-formats.html'), 'utf8');
  const result = parser.parseKuaishouHtmlDocument(html);
  assert.equal(result.formats.length, 1);
  assert.equal(result.formats[0].url, 'https://abc.djvod.ndcimgs.com/high.mp4');
});

test('rejects incomplete Kuaishou yt-dlp results without selectable formats', () => {
  assert.equal(parser.hasSelectableKuaishouFormat({
    videoUrl: 'https://txmov2.a.kwimgs.com/fallback.mp4',
    formats: [],
  }), false);
  assert.equal(parser.hasSelectableKuaishouFormat({
    videoUrl: 'https://txmov2.a.kwimgs.com/video.mp4',
    formats: [{ url: 'https://v23-3.kwaicdn.com/video.mp4' }],
  }), true);
});
