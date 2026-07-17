const test = require('node:test');
const assert = require('node:assert/strict');

const { requestSupportedPage } = require('../src/page-request');

test('rejects a supported page redirect to an internal target', async () => {
  const requests = [];
  const request = async (url) => {
    requests.push(url);
    return { status: 302, headers: { location: 'http://127.0.0.1/admin' }, data: '' };
  };
  await assert.rejects(
    requestSupportedPage('https://v.kuaishou.com/abc123', { request }),
    /protocol|unsupported/i,
  );
  assert.deepEqual(requests, ['https://v.kuaishou.com/abc123']);
});

test('follows supported redirects and returns the final URL', async () => {
  const request = async (url) => {
    if (url.includes('v.kuaishou.com')) {
      return { status: 302, headers: { location: 'https://www.kuaishou.com/short-video/fixture' }, data: '' };
    }
    return { status: 200, headers: {}, data: '<html>fixture</html>' };
  };
  const response = await requestSupportedPage('https://v.kuaishou.com/abc123', { request });
  assert.equal(response.url, 'https://www.kuaishou.com/short-video/fixture');
  assert.equal(response.data, '<html>fixture</html>');
});

test('follows Kuaishou redirect to its official chenzhongtech photo page', async () => {
  const finalUrl = 'https://v.m.chenzhongtech.com/fw/photo/3x24hiay4irfakm?photoId=3x24hiay4irfakm';
  const request = async (url) => {
    if (url.includes('v.kuaishou.com')) {
      return { status: 302, headers: { location: finalUrl }, data: '' };
    }
    return { status: 200, headers: {}, data: '<html>kuaishou fixture</html>' };
  };

  const response = await requestSupportedPage('https://v.kuaishou.com/nZ11jciL', { request });
  assert.equal(response.url, finalUrl);
});
