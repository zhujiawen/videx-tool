const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/parser');

for (const [platform, variable] of [['douyin', 'DOUYIN_TEST_URL'], ['kuaishou', 'KUAISHOU_TEST_URL']]) {
  test(`live ${platform} parser`, { skip: !process.env[variable], timeout: 60_000 }, async () => {
    const result = await parse(process.env[variable]);
    assert.ok(result.videoUrl);
    assert.ok(result.title);
    if (platform === 'kuaishou') assert.equal(result.platform, 'kuaishou');
  });
}
