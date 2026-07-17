const dns = require('node:dns');
const axios = require('axios');
const { assertAllowedMediaUrl, isPublicAddress } = require('./security');

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { family: options.family || 0, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error('media host resolved to a non-public address'));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function refererFor(platform) {
  return platform === 'kuaishou' ? 'https://www.kuaishou.com/' : 'https://www.douyin.com/';
}

async function openMediaStream(initialUrl, options = {}) {
  const maxRedirects = options.maxRedirects ?? 5;
  const request = options.request || ((url, requestOptions) => axios.get(url, requestOptions));
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    assertAllowedMediaUrl(currentUrl);
    const response = await request(currentUrl, {
      responseType: 'stream',
      timeout: options.timeoutMs ?? 60_000,
      maxRedirects: 0,
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 400,
      lookup: options.lookup || publicLookup,
      signal: options.signal,
      headers: {
        'User-Agent': options.userAgent,
        Referer: refererFor(options.platform),
        ...(options.range ? { Range: options.range } : {}),
      },
    });

    if (response.status >= 300) {
      response.data.destroy();
      const location = response.headers.location;
      if (!location) throw new Error('media redirect has no location');
      if (redirectCount === maxRedirects) throw new Error('too many media redirects');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error('too many media redirects');
}

module.exports = { openMediaStream, publicLookup, refererFor };
