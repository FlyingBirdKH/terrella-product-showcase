export function newEventId() {
  if (!globalThis.crypto || typeof crypto.randomUUID !== 'function') throw new Error('event_id');
  return crypto.randomUUID();
}

export function failureText(reason) {
  if (reason === 'revision_conflict') return '有人同时改了这张图。已重新读取共享记录，这次没有覆盖。没有写成保存成功。';
  if (reason === 'brand-admin-missing') return '已用现有账号登录，但没有服务端的 terralla 品牌管理声明。预览没有保存。本页不能补这个声明。';
  if (reason === 'anonymous' || reason === 'auth-rejected' || reason === 'role' || reason === 'sub') return '没有可用的登录会话。没有保存，也没有写入正式商城。';
  if (reason === 'store-not-configured' || reason === 'store-not-writable') return '共享预览没有配置或暂时不可用，已失败关闭。没有保存，也没有写入正式商城。';
  return '没有保存。勾选已退回。没有写入共享预览，也没有写入正式商城。';
}

export function readStatus(result) {
  if (!result || result.ok !== true || result.durable !== true || result.store !== 'supabase' || result.saved === true || !Array.isArray(result.selected)) {
    return { ok: false, text: failureText(result && result.reason) };
  }
  const count = result.selected.length;
  return {
    ok: true,
    text: count
      ? `已从共享内部预览读回 ${count} 张。这不是正式商城，没有改商品状态。`
      : '共享内部预览里还没有勾选。这不是正式商城。'
  };
}

export function writeStatus(result, selected) {
  if (!result || result.ok !== true || result.saved !== true || result.durable !== true || result.store !== 'supabase' || !Array.isArray(result.selected)) {
    return { ok: false, text: failureText(result && result.reason) };
  }
  if (result.selected.includes(selected.sha256) !== selected.want) return { ok: false, text: failureText('readback') };
  const count = result.selected.length;
  const text = selected.want
    ? `已写入共享内部预览，共 ${count} 张。另一位已登录的管理人可以读回同一份。这不是正式商城，没有改商品状态，也没有删除 Bunny 原图。`
    : `已从共享内部预览解绑这张图，还剩 ${count} 张。Bunny 原图和商品都还在。这不是正式商城，没有改商品状态。`;
  return { ok: true, text };
}
