(() => {
  const token = document.getElementById('token');
  const state = document.getElementById('state');
  const save = document.getElementById('save');
  const remove = document.getElementById('remove');

  async function refresh() {
    try {
      const response = await fetch('/secrets');
      if (!response.ok) throw new Error('无法读取凭证状态');
      const list = await response.json();
      const item = list.find((entry) => entry.key === 'github_token');
      state.textContent = item?.saved ? `已配置${item.tail ? `（尾号 ${item.tail}）` : ''}` : '尚未配置';
    } catch (error) {
      state.textContent = error.message || '无法读取凭证状态';
    }
  }

  save.addEventListener('click', async () => {
    const value = token.value.trim();
    if (!value) { state.textContent = '请先输入 Token'; return; }
    save.disabled = true;
    try {
      const response = await fetch('/secrets/github_token', {
        method: 'PUT', body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error('保存失败，请检查 Token 格式');
      token.value = '';
      await refresh();
    } catch (error) {
      state.textContent = error.message || '保存失败';
    } finally {
      save.disabled = false;
    }
  });

  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      const response = await fetch('/secrets/github_token', { method: 'DELETE' });
      if (!response.ok) throw new Error('删除失败');
      token.value = '';
      await refresh();
    } catch (error) {
      state.textContent = error.message || '删除失败';
    } finally {
      remove.disabled = false;
    }
  });

  refresh();
})();
