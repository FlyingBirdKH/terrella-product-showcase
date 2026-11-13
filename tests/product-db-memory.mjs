// In-memory PostgREST stand-in. It does not open a network connection or a real database.
export function createProductDbMemory({ products = [], selections = [], serviceRoleKey = '' } = {}) {
  const productRows = products.map((row) => ({ id: row.id, sku: row.sku }));
  const selectionRows = selections.map((row) => ({ product_id: row.product_id, image_sha256: row.image_sha256 }));
  const calls = [];

  function json(status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return text; },
      async json() { return text ? JSON.parse(text) : null; }
    };
  }

  function filterValue(params, name) {
    const value = params.get(name);
    if (!value) return null;
    if (value.startsWith('eq.')) return { op: 'eq', value: decodeURIComponent(value.slice(3)) };
    if (value.startsWith('in.(') && value.endsWith(')')) {
      return { op: 'in', value: value.slice(4, -1).split(',').filter(Boolean).map((item) => decodeURIComponent(item)) };
    }
    return { op: 'unknown', value };
  }

  function matches(row, filters) {
    for (const [key, filter] of filters) {
      if (!filter) continue;
      if (filter.op === 'eq' && row[key] !== filter.value) return false;
      if (filter.op === 'in' && !filter.value.includes(row[key])) return false;
      if (filter.op !== 'eq' && filter.op !== 'in') return false;
    }
    return true;
  }

  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    const target = new URL(url);
    const headers = options.headers || {};
    calls.push({
      method,
      path: target.pathname,
      search: target.search,
      body: options.body || '',
      authorization: headers.authorization || '',
      keyInUrl: Boolean(serviceRoleKey) && target.href.includes(serviceRoleKey)
    });
    if (target.pathname.startsWith('/storage') || target.pathname.includes('bunny')) return json(500, { message: 'files' });
    const prefix = '/rest/v1/';
    if (!target.pathname.startsWith(prefix)) return json(404, { message: 'missing' });
    const table = target.pathname.slice(prefix.length);
    if (table === 'products' || table === 'product_assets') {
      if (method !== 'GET' || table !== 'products') return json(405, { message: 'products-readonly' });
      const filters = [['id', filterValue(target.searchParams, 'id')], ['sku', filterValue(target.searchParams, 'sku')]];
      return json(200, productRows.filter((row) => matches(row, filters)).map((row) => ({ id: row.id, sku: row.sku })));
    }
    if (table !== 'product_image_selections') return json(404, { message: 'table' });
    if (method === 'GET') {
      const filters = [['product_id', filterValue(target.searchParams, 'product_id')], ['image_sha256', filterValue(target.searchParams, 'image_sha256')]];
      return json(200, selectionRows.filter((row) => matches(row, filters)).map((row) => ({ ...row })));
    }
    if (method === 'POST') {
      const row = JSON.parse(options.body || '{}');
      const keys = Object.keys(row).sort();
      if (keys.join(',') !== 'image_sha256,product_id') return json(400, { message: 'columns' });
      const exists = selectionRows.some((item) => item.product_id === row.product_id && item.image_sha256 === row.image_sha256);
      if (!exists) {
        if (!productRows.some((item) => item.id === row.product_id)) return json(409, { message: 'product_id' });
        selectionRows.push({ product_id: row.product_id, image_sha256: row.image_sha256 });
      }
      return json(201, []);
    }
    if (method === 'DELETE') {
      const productFilter = filterValue(target.searchParams, 'product_id');
      const shaFilter = filterValue(target.searchParams, 'image_sha256');
      if (!productFilter || productFilter.op !== 'eq' || !shaFilter || shaFilter.op !== 'eq') return json(400, { message: 'delete-filter' });
      for (let index = selectionRows.length - 1; index >= 0; index -= 1) {
        const row = selectionRows[index];
        if (row.product_id === productFilter.value && row.image_sha256 === shaFilter.value) selectionRows.splice(index, 1);
      }
      return json(204);
    }
    return json(405, { message: 'method' });
  }

  return { products: productRows, selections: selectionRows, calls, fetchImpl };
}
