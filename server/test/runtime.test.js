const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRuntimeDependencies } = require('../src/runtime');

test('runtime check uses configured Python and verifies yt-dlp module', async () => {
  let invocation;
  const result = await checkRuntimeDependencies({
    pythonBin: '/custom/python3',
    execFile: (file, args, _options, callback) => {
      invocation = { file, args };
      callback(null, '2026.07.01\n', '');
    },
  });
  assert.deepEqual(invocation, { file: '/custom/python3', args: ['-m', 'yt_dlp', '--version'] });
  assert.equal(result.ytDlpVersion, '2026.07.01');
});
