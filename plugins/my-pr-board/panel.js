(() => {
  const channel = new BroadcastChannel('my-pr-board-v1');
  const pending = new Map();
  const listEl = document.getElementById('list');
  const summaryEl = document.getElementById('summary');
  const noticeEl = document.getElementById('notice');
  const refreshButton = document.getElementById('refresh');
  const statusLabels = {
    passed: 'CI 通过', failed: 'CI 失败', running: 'CI 运行中',
    none: '无 CI', unknown: 'CI 未知',
  };

  function requestId() {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function notice(text, error = false) {
    noticeEl.textContent = text;
    noticeEl.classList.toggle('error', error);
  }

  async function call(action, extra = {}) {
    const id = requestId();
    const message = { type: 'request', requestId: id, action, ...extra };
    const wake = await fetch('cindy-ghost://my-pr-board/wake');
    if (!wake.ok) throw new Error('无法唤醒插件，请确认插件已启用');
    return new Promise((resolve, reject) => {
      const send = () => channel.postMessage(message);
      const retry = setInterval(() => {
        if (!pending.get(id)?.acked) send();
      }, 400);
      const timeout = setTimeout(() => {
        clearInterval(retry);
        pending.delete(id);
        reject(new Error('插件响应超时，请稍后重试；如已点击分析，请先检查任务列表，避免重复创建'));
      }, 120000);
      pending.set(id, { resolve, reject, retry, timeout, acked: false });
      send();
    });
  }

  channel.onmessage = (event) => {
    const message = event.data;
    const item = pending.get(message?.requestId);
    if (!item) return;
    if (message.type === 'ack') {
      item.acked = true;
      clearInterval(item.retry);
      return;
    }
    if (message.type !== 'reply') return;
    clearInterval(item.retry);
    clearTimeout(item.timeout);
    pending.delete(message.requestId);
    if (message.ok) item.resolve(message.data);
    else item.reject(new Error(message.error || '操作失败'));
  };

  function githubLink(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === 'github.com' ? parsed.href : '';
    } catch { return ''; }
  }

  function renderCard(card) {
    const root = document.createElement('article');
    root.className = 'card';
    const top = document.createElement('div');
    top.className = 'top';
    const heading = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = card.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${card.repo} #${card.number} · ${card.role}${card.draft ? ' · 草稿' : ''}`;
    heading.append(title, meta);
    const status = document.createElement('span');
    status.className = `status ${statusLabels[card.ci] ? card.ci : 'unknown'}`;
    status.textContent = statusLabels[card.ci] || statusLabels.unknown;
    top.append(heading, status);
    root.append(top);

    if (card.ciError) {
      const detail = document.createElement('p');
      detail.className = 'detail';
      detail.textContent = card.ciError;
      root.append(detail);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const link = githubLink(card.url);
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.textContent = '打开 PR';
      actions.append(anchor);
    }
    const analyzeButton = document.createElement('button');
    analyzeButton.type = 'button';
    analyzeButton.textContent = '让 AI 查看 CI';
    analyzeButton.addEventListener('click', async () => {
      analyzeButton.disabled = true;
      notice(`正在把 ${card.repo} #${card.number} 交给 Cindy…`);
      try {
        const task = await call('analyze', { repo: card.repo, number: card.number });
        notice(`已创建任务：${task.title}（${task.taskId}）。可在 Cindy 任务列表中查看。`);
      } catch (error) {
        notice(error.message || '任务创建失败', true);
      } finally {
        analyzeButton.disabled = false;
      }
    });
    actions.append(analyzeButton);
    root.append(actions);
    return root;
  }

  async function refresh() {
    refreshButton.disabled = true;
    notice('正在读取 GitHub PR 和 CI 状态…');
    try {
      const result = await call('list');
      summaryEl.textContent = `${result.login} · ${result.cards.length} 个待处理 PR`;
      listEl.replaceChildren();
      if (result.cards.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = '没有我创建或待我审阅的未关闭 PR。';
        listEl.append(empty);
      } else {
        for (const card of result.cards) listEl.append(renderCard(card));
      }
      notice(result.warning || '已更新');
    } catch (error) {
      notice(error.message || '读取失败', true);
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', refresh);
  refresh();
})();
