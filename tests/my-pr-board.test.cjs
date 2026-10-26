const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pluginDir = path.join(__dirname, '..', 'plugins', 'my-pr-board');
const sha = 'a'.repeat(40);
const issue = {
  number: 12,
  repository_url: 'https://api.github.com/repos/example/project',
};

test('PR board lists authored/review PR once, summarizes CI, and hands it to a visible task', async () => {
  const requests = [];
  const created = [];
  const sent = [];
  let channel;
  let receiveReply;
  const responses = (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/user') return { login: 'tester' };
    if (parsed.pathname === '/search/issues') return { total_count: 1, items: [issue] };
    if (parsed.pathname === '/repos/example/project/pulls/12') return {
      title: 'Fix failing CI', html_url: 'https://github.com/example/project/pull/12',
      head: { sha }, draft: false,
    };
    if (parsed.pathname.endsWith('/check-runs')) return {
      total_count: 1,
      check_runs: [{ name: 'unit', status: 'completed', conclusion: 'failure',
        output: { summary: 'A test failed' }, html_url: 'https://github.com/example/project/actions/runs/1' }],
    };
    if (parsed.pathname.endsWith('/status')) return { statuses: [] };
    throw new Error(`Unexpected URL: ${url}`);
  };
  class FakeChannel {
    constructor() { channel = this; }
    postMessage(message) { if (message.type === 'reply') receiveReply(message); }
  }
  const cindy = {
    fetch: async (request) => {
      requests.push(request);
      return { ok: true, status: 200, body: JSON.stringify(responses(request.url)) };
    },
    tasks: {
      capabilities: async () => ({ operations: { create: true, send: true } }),
      create: async (request) => {
        created.push(request);
        return { taskId: 'task-1', revision: 1 };
      },
      send: async (request) => { sent.push(request); return { runId: 'run-1' }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8'), {
    BroadcastChannel: FakeChannel, cindy, URL, encodeURIComponent, Map, Set,
    Promise, Number, String, Array, Object, JSON, Error, Date,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
  });
  const call = (action, extra = {}) => new Promise((resolve) => {
    receiveReply = resolve;
    channel.onmessage({ data: { type: 'request', requestId: `request-${action}`, action, ...extra } });
  });

  const listed = await call('list');
  assert.equal(listed.ok, true);
  assert.equal(listed.data.cards.length, 1);
  assert.equal(listed.data.cards[0].ci, 'failed');
  assert.equal(listed.data.cards[0].role, '我创建');

  const analyzed = await call('analyze', { repo: 'example/project', number: 12 });
  assert.equal(analyzed.ok, true);
  assert.equal(analyzed.data.taskId, 'task-1');
  assert.equal(created.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /A test failed/);
  assert.match(sent[0].text, /不可信外部内容/);
  assert.ok(requests.every((request) => request.url.startsWith('https://api.github.com/')));
  assert.ok(requests.every((request) => !request.headers.Authorization));
});

test('manifest declares autonomous GitHub access and Host managed secret', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  assert.deepEqual(manifest.network.hosts, ['api.github.com']);
  assert.equal(manifest.network.secrets[0].source, 'user');
  assert.equal(manifest.agent.tasks, true);
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.panel.html)));
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.settingsHtml)));
});
