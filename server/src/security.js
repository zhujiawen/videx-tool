const crypto = require('node:crypto');
const ipaddr = require('ipaddr.js');

const PAGE_RULES = new Map([
  ['v.douyin.com', /^\/[\w-]+\/?$/],
  ['douyin.com', /^\/(?:share\/)?video\/\d+\/?$/],
  ['www.douyin.com', /^\/(?:share\/)?video\/\d+\/?$/],
  ['iesdouyin.com', /^\/share\/video\/\d+\/?$/],
  ['www.iesdouyin.com', /^\/share\/video\/\d+\/?$/],
  ['v.kuaishou.com', /^\/[\w-]+\/?$/],
  ['kuaishou.com', /^\/short-video\/[\w-]+\/?$/],
  ['www.kuaishou.com', /^\/short-video\/[\w-]+\/?$/],
  ['v.m.chenzhongtech.com', /^\/fw\/(?:photo|long-video)\/[\w-]+\/?$/],
]);
const DEFAULT_MEDIA_HOST_SUFFIXES = [
  'douyinvod.com',
  'douyin.com',
  'bytecdn.cn',
  'byteimg.com',
  'zjcdn.com',
  'aweme.snssdk.com',
  'amemv.com',
  'kwimgs.com',
  'kwaicdn.com',
  'kuaishou.com',
  'ksapisrv.com',
  'djvod.ndcimgs.com',
  'a.yximgs.com',
];

function hostnameMatches(hostname, suffix) {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedSuffix = suffix.toLowerCase().replace(/^\./, '');
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith('.' + normalizedSuffix);
}

function parseHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error('invalid URL');
  }
  if (url.protocol !== 'https:') throw new Error('unsupported URL protocol');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  return url;
}

function assertSupportedPageUrl(value) {
  const url = parseHttpsUrl(value);
  const pathRule = PAGE_RULES.get(url.hostname.toLowerCase());
  if (!pathRule) {
    throw new Error('unsupported video platform URL');
  }
  if (!pathRule.test(url.pathname)) throw new Error('unsupported video platform path');
  return url;
}

function mediaHostSuffixes() {
  const extra = (process.env.MEDIA_HOST_ALLOWLIST || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return [...DEFAULT_MEDIA_HOST_SUFFIXES, ...extra];
}

function assertAllowedMediaUrl(value) {
  const url = parseHttpsUrl(value);
  if (!mediaHostSuffixes().some((suffix) => hostnameMatches(url.hostname, suffix))) {
    throw new Error('media host is not allowed');
  }
  return url;
}

function isPublicAddress(address) {
  let parsed;
  try {
    parsed = ipaddr.parse(address.split('%')[0]);
  } catch (_) {
    return false;
  }
  const range = parsed.range();
  if (parsed.kind() === 'ipv4') return range === 'unicast';
  if (range === 'ipv4Mapped') return isPublicAddress(parsed.toIPv4Address().toString());
  if (range === 'ipv4Comp' || range === 'rfc6052') {
    const bytes = parsed.toByteArray();
    return isPublicAddress(bytes.slice(-4).join('.'));
  }
  if (range === '6to4') {
    const bytes = parsed.toByteArray();
    return isPublicAddress([bytes[2], bytes[3], bytes[4], bytes[5]].join('.'));
  }
  if (range === 'teredo') {
    const bytes = parsed.toByteArray();
    return isPublicAddress(bytes.slice(-4).map((byte) => 255 - byte).join('.'));
  }
  return range === 'unicast';
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createDownloadToken(data, secret, ttlMs = 10 * 60 * 1000, now = Date.now()) {
  if (!secret) throw new Error('download token secret is required');
  const payload = encode(JSON.stringify({ ...data, exp: now + ttlMs }));
  return payload + '.' + sign(payload, secret);
}

function verifyDownloadToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') throw new Error('invalid token');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('invalid token');
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('invalid token');
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    throw new Error('invalid token');
  }
  if (!data.url || !data.exp) throw new Error('invalid token');
  if (now > data.exp) throw new Error('download token expired');
  return data;
}

module.exports = {
  assertSupportedPageUrl,
  assertAllowedMediaUrl,
  hostnameMatches,
  isPublicAddress,
  createDownloadToken,
  verifyDownloadToken,
};
