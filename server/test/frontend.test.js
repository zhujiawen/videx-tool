const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('frontend uses the primary token when no quality formats exist', () => {
  assert.match(html, /var videoToken = '';/);
  assert.match(html, /formats\.length > 0 \? formats\[0\]\.url : videoToken/);
});

test('frontend clears stale formats before starting a new parse', () => {
  const parseStart = html.slice(html.indexOf("$('parseBtn').onclick"), html.indexOf("fetch('/api/parse'"));
  assert.match(parseStart, /formats = \[\]/);
  assert.match(parseStart, /qualitySelect.*innerHTML = ''/s);
  assert.match(parseStart, /qualityRow.*display = 'none'/s);
});

test('clear action removes the primary token and disables download actions', () => {
  const clearAction = html.slice(html.indexOf('clearBtn.onclick'), html.indexOf('// State'));
  assert.match(clearAction, /videoToken = ''/);
  assert.match(clearAction, /saveBtn.*disabled = true/s);
  assert.match(clearAction, /videoEl.*removeAttribute\('src'\)/s);
});
