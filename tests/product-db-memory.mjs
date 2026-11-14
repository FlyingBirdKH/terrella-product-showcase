// In-memory Auth and PostgREST stand-in. It does not open a network connection or a real database.
const DEFAULT_ADMIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.test',
  password: 'test-password-not-a-secret',
  app_metadata: { terrella_brand_admin: 'terralla' },
  user_metadata: { terrella_brand_admin: 'ignored' }
};

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createProductDbMemory({
  products = [],
  selections = [],
  anonKey = 'test-anon-key-not-a-secret',
  serviceRoleKey = '',
  users = [DEFAULT_ADMIN]
} = {}) {
  const productRows = products.map((row) => ({ id: row.id, sku: row.sku }));
  const selectionRows = selections.map((row) => ({ product_id: row.product_id, image_sha256: row.image_sha256 }));
  const calls = [];
  const live = new Map();
  const state = {
    products: productRows,
    selections: selectionRows,
    calls,
    anonKey,
    readsUntilFailure: Infinity,
    beforeWrite: null,
    afterRead: null
  };

  function issue(user) {
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: user.tokenSub || user.id,
      role: user.tokenRole || 'authenticated'
    })}.sig`;
    live.set(token, user);
    return token;
  }

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

  function bearer(headers) {
    const value = headers.authorization || '';
    return value.startsWith('Bearer ') ? value.slice(7) : '';
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
      apikey: headers.apikey || '',
      keyInUrl: Boolean(serviceRoleKey) && target.href.includes(serviceRoleKey) || target.href.includes(anonKey)
    });
    if (headers.apikey !== anonKey) return json(401, { message: 'apikey' });
    if (target.pathname === '/auth/v1/token') {
      const body = JSON.parse(options.body || '{}');
      const user = users.find((item) => item.email === body.email && item.password === body.password);
      if (!user) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: issue(user), token_type: 'bearer', expires_in: 3600 });
    }
    if (target.pathname === '/auth/v1/logout') {
      live.delete(bearer(headers));
      return json(204);
    }
    if (target.pathname === '/auth/v1/user') {
      const user = live.get(bearer(headers));
      if (!user) return json(401, { message: 'jwt' });
      return json(200, {
        id: user.reportedId || user.id,
        app_metadata: user.app_metadata || {},
        user_metadata: user.user_metadata || {}
      });
    }
    if (target.pathname.startsWith('/storage') || target.pathname.includes('bunny')) return json(500, { message: 'files' });
    const prefix = '/rest/v1/';
    if (!target.pathname.startsWith(prefix)) return json(404, { message: 'missing' });
    if (!live.has(bearer(headers)) || bearer(headers) === serviceRoleKey) return json(401, { message: 'jwt' });
    const table = target.pathname.slice(prefix.length);
    if (table === 'products' || table === 'product_assets') return json(401, { message: 'products-closed' });
    if (table === 'rpc/apply_image_selection') {
      if (method !== 'POST') return json(405, { message: 'method' });
      if (state.beforeWrite) {
        const outcome = state.beforeWrite({ method, table });
        if (outcome && outcome.status) return json(outcome.status, outcome.body || { message: 'injected' });
      }
      const row = JSON.parse(options.body || '{}');
      const keys = Object.keys(row).sort();
      if (keys.join(',') !== 'expected_selected,image_sha256,product_id,selected') return json(400, { message: 'columns' });
      if (typeof row.expected_selected !== 'boolean' || typeof row.selected !== 'boolean') return json(400, { message: 'expected' });
      if (!productRows.some((item) => item.id === row.product_id)) return json(409, { code: '23503', message: 'product_id' });
      const index = selectionRows.findIndex((item) => item.product_id === row.product_id && item.image_sha256 === row.image_sha256);
      const present = index !== -1;
      if (present !== row.expected_selected) return json(200, { applied: false });
      if (row.selected && !present) selectionRows.push({ product_id: row.product_id, image_sha256: row.image_sha256 });
      if (!row.selected && present) selectionRows.splice(index, 1);
      return json(200, { applied: true });
    }
    if (table !== 'product_image_selections') return json(404, { message: 'table' });
    if (method === 'GET') {
      if (state.readsUntilFailure <= 0) return json(500, { message: 'read' });
      if (Number.isFinite(state.readsUntilFailure)) state.readsUntilFailure -= 1;
      const filters = [['product_id', filterValue(target.searchParams, 'product_id')], ['image_sha256', filterValue(target.searchParams, 'image_sha256')]];
      const snapshot = selectionRows.filter((row) => matches(row, filters)).map((row) => ({ ...row }));
      if (state.afterRead) {
        const hook = state.afterRead;
        state.afterRead = null;
        hook();
      }
      return json(200, snapshot);
    }
    if (state.beforeWrite) {
      const outcome = state.beforeWrite({ method, table });
      if (outcome && outcome.status) return json(outcome.status, outcome.body || { message: 'injected' });
    }
    if (method === 'POST') {
      const row = JSON.parse(options.body || '{}');
      const keys = Object.keys(row).sort();
      if (keys.join(',') !== 'image_sha256,product_id') return json(400, { message: 'columns' });
      const exists = selectionRows.some((item) => item.product_id === row.product_id && item.image_sha256 === row.image_sha256);
      if (exists) return json(409, { code: '23505', message: 'duplicate' });
      if (!productRows.some((item) => item.id === row.product_id)) return json(409, { code: '23503', message: 'product_id' });
      selectionRows.push({ product_id: row.product_id, image_sha256: row.image_sha256 });
      return json(201, [{ ...selectionRows[selectionRows.length - 1] }]);
    }
    if (method === 'DELETE') {
      const productFilter = filterValue(target.searchParams, 'product_id');
      const shaFilter = filterValue(target.searchParams, 'image_sha256');
      if (!productFilter || productFilter.op !== 'eq' || !shaFilter || shaFilter.op !== 'eq') return json(400, { message: 'delete-filter' });
      const deleted = [];
      for (let index = selectionRows.length - 1; index >= 0; index -= 1) {
        const row = selectionRows[index];
        if (row.product_id === productFilter.value && row.image_sha256 === shaFilter.value) deleted.push(selectionRows.splice(index, 1)[0]);
      }
      return json(200, deleted);
    }
    return json(405, { message: 'method' });
  }

  state.fetchImpl = fetchImpl;
  state.accessToken = issue(users[0]);
  return state;
}
