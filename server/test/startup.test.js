const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { listen } = require('../src/index');

test('listen rejects when the server emits a startup error', async () => {
  const server = new EventEmitter();
  const app = {
    listen() {
      process.nextTick(() => server.emit('error', Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })));
      return server;
    },
  };
  await assert.rejects(listen(app, 8787), /address in use/);
});
