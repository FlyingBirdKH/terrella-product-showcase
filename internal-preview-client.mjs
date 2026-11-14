const SELECTION_STORE = 'terrella-product-db';

export async function previewFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
  return fetch(url, { ...options, credentials: 'same-origin', headers });
}

export function failureText(reason) {
  if (reason === 'access-not-configured') return '预览写入没有打开，已失败关闭。没有保存，也没有使用服务角色密钥。';
  if (reason === 'access-rejected' || reason === 'anonymous') return '没有通过具名账号登录。没有保存。';
  if (reason === 'identity') return '登录身份和令牌不一致。没有保存。';
  if (reason === 'brand-access-missing') return '这个账号没有 Terralla 预览权限。没有保存。';
  if (reason === 'brand-admin-missing') return '这个账号只能读取，不能写入勾选。没有保存。';
  if (reason === 'expected') return '缺少写入前读到的勾选状态。没有保存。';
  if (reason === 'conflict') return '勾选和数据库里的当前状态冲突。已按读回退回，没有覆盖别人的修改。';
  if (reason === 'csrf' || reason === 'origin') return '这次请求没有通过同源检查。没有保存。';
  if (reason === 'product') return '这个商品不在已核允许名单里。没有写入勾选，也没有新建商品。';
  if (reason === 'sha256') return '这张图的 SHA-256 不在已核允许名单里。没有保存。';
  if (reason === 'readback') return '写入之后没有读回 terrella-product-db。没有把这次当成已保存，也没有写入正式商城。';
  if (reason === 'store-not-configured' || reason === 'store-not-writable') {
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
  if (result && result.readback === true && result.saved !== true && Array.isArray(result.selected)) {
    return {
      ok: false,
      readback: true,
      present: result.selected.includes(selected.sha256),
      text: failureText(result.reason)
    };
  }
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
