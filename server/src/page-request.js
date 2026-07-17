const axios = require('axios');
const { publicLookup } = require('./download');
const { assertSupportedPageUrl } = require('./security');

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

async function requestSupportedPage(initialUrl, options = {}) {
  const request = options.request || ((url, requestOptions) => axios.get(url, requestOptions));
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    assertSupportedPageUrl(currentUrl);
    const response = await request(currentUrl, {
      maxRedirects: 0,
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { 'User-Agent': IPHONE_UA },
      timeout: options.timeoutMs ?? 15_000,
      responseType: 'text',
      transformResponse: [(data) => data],
      lookup: options.lookup || publicLookup,
    });
    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location) throw new Error('platform redirect has no location');
      if (redirectCount === maxRedirects) throw new Error('too many platform redirects');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { ...response, url: currentUrl };
  }
  throw new Error('too many platform redirects');
}

module.exports = { requestSupportedPage };
