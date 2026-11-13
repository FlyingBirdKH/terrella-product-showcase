const SELECTION_STORE = 'terrella-product-db';

export async function previewFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
  return fetch(url, { ...options, credentials: 'same-origin', headers });
}

export function failureText(reason) {
  if (reason === 'product') return '没有在 terrella-product-db 找到这个商品。没有写入勾选，也没有新建商品，也没有写入 crm-core。';
  if (reason === 'sha256') return '这张图的 SHA-256 不能写入这条勾选。没有保存。';
  if (reason === 'selected' || reason === 'content-type') return '这次请求没有写成勾选。没有保存。';
  if (reason === 'store-not-configured' || reason === 'store-not-writable' || reason === 'readback') {
    return 'terrella-product-db 的勾选没有配置或暂时不可用，已失败关闭。没有保存，也没有写入正式商城。';
  }
  return '没有保存。勾选已退回。没有写入 terrella-product-db，也没有写入正式商城。';
}

function confirmed(result) {
  return Boolean(result) && result.ok === true && result.durable === true && result.store === SELECTION_STORE;
}

export function readStatus(result) {
  if (!confirmed(result) || result.saved === true) return { ok: false, text: failureText(result && result.reason) };
  if (Array.isArray(result.selections)) {
    const count = result.selections.length;
    return {
      ok: true,
      text: count
        ? `已从 terrella-product-db 读回 ${count} 条勾选。这不是正式商城，没有改商品状态。`
        : 'terrella-product-db 里还没有勾选。这不是正式商城。'
    };
  }
  if (!Array.isArray(result.selected)) return { ok: false, text: failureText(result && result.reason) };
  const count = result.selected.length;
  return {
    ok: true,
    text: count
      ? `已从 terrella-product-db 读回 ${count} 张。这不是正式商城，没有改商品状态。`
      : 'terrella-product-db 里还没有这个商品的勾选。这不是正式商城。'
  };
}

export function writeStatus(result, selected) {
  if (!confirmed(result) || result.saved !== true || !Array.isArray(result.selected)) {
    return { ok: false, text: failureText(result && result.reason) };
  }
  if (result.selected.includes(selected.sha256) !== selected.want) return { ok: false, text: failureText('readback') };
  const count = result.selected.length;
  const text = selected.want
    ? `已写入 terrella-product-db 的勾选，这个商品共 ${count} 张。这不是正式商城，没有改商品状态，也没有删除 Bunny 原图。`
    : `已从 terrella-product-db 去掉这张图的勾选，这个商品还剩 ${count} 张。Bunny 原图和商品行都还在。这不是正式商城。`;
  return { ok: true, text };
}
