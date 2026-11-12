import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

export const PRODUCT_ID = '426bf18c-8649-4aa5-939c-f0b33eca95f8';
export const FIRST_SHA = 'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342';
export const SECOND_SHA = 'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4';
export const BRAND_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function brandClaims(extra = {}) {
  return {
    sub: BRAND_USER,
    role: 'authenticated',
    app_metadata: { terrella_brand_admin: 'terralla' },
    ...extra
  };
}

async function dropFictionalRoles() {
  const names = ['kevin_admin', 'terralla_admin', 'terralla_team', 'sourcing_manager', 'admin'];
  const databases = await psql('postgres', 'select datname from pg_database where datallowconn');
  for (const name of databases.stdout.split('\n').filter(Boolean)) {
    for (const role of names) {
      await psql(name, `do $$ begin if exists (select 1 from pg_roles where rolname = '${role}' and not rolcanlogin) then execute 'drop owned by ${role}'; end if; end $$;`);
    }
  }
  for (const role of names) {
    await psql('postgres', `do $$ begin if exists (select 1 from pg_roles where rolname = '${role}' and not rolcanlogin) then execute 'drop role ${role}'; end if; end $$;`);
  }
}

export async function recreateDatabase(name) {
  await dropFictionalRoles();
  await exec('dropdb', ['--if-exists', '--force', name]);
  await exec('createdb', [name]);
  await exec('psql', ['-d', name, '-v', 'ON_ERROR_STOP=1', '-f', `${root}/tests/sql/local-prelude.sql`]);
  await exec('psql', ['-d', name, '-v', 'ON_ERROR_STOP=1', '-f', `${root}/supabase/migrations/20261112160000_internal_preview_shared.sql`]);
  await psql(name, `
    create table public.products (id uuid primary key, status text not null, deleted_at timestamptz);
    insert into public.products (id, status, deleted_at) values ('${PRODUCT_ID}', 'paused', null);
    create table public.terralla_skus (id uuid primary key, sku text unique, handle text unique, external_id text, brand_id text, status text not null, deleted_at timestamptz);
    insert into public.terralla_skus (id, sku, handle, external_id, brand_id, status, deleted_at)
      values ('${PRODUCT_ID}', 'CAT-001', 'eastern-heritage-tr260002', 'TR260002', 'terralla', 'paused', null);
  `);
}

export function psql(db, sql, variables = {}) {
  const args = ['-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`);
  return new Promise((resolve) => {
    const child = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code };
      resolve(result);
    });
    child.stdin.end(sql);
  });
}

export function lastJson(stdout) {
  const line = stdout.split('\n').map((item) => item.trim()).filter((item) => item.startsWith('{')).pop();
  if (!line) throw new Error(`no json in ${stdout}`);
  return JSON.parse(line);
}

export function sqlReason(stderr) {
  const match = stderr.match(/ERROR:\s+([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

const DB_ROLES = new Set(['authenticated', 'anon', 'service_role']);

function sessionSql(claims, claimSub) {
  const role = claims.role;
  if (!DB_ROLES.has(role)) throw new Error('role');
  const json = JSON.stringify(claims).replace(/'/g, "''");
  const sub = claimSub === undefined ? (claims.sub || '') : claimSub;
  if (sub && !/^[0-9a-f-]{36}$/i.test(sub)) throw new Error('sub');
  return `
    begin;
    select set_config('request.jwt.claims', '${json}', true);
    select set_config('request.jwt.claim.sub', '${sub}', true);
    set local role ${role};
  `;
}

export function applySql(db, { claims = brandClaims(), claimSub, eventId, productId = PRODUCT_ID, sha = FIRST_SHA, selected = true, base = 0 }) {
  return psql(db, `
    ${sessionSql(claims, claimSub)}
    select public.internal_preview_apply_event(:'event_id', :'product_id'::uuid, :'sha256', :'selected'::boolean, :'base_revision'::bigint);
    commit;
  `, {
    event_id: eventId,
    product_id: productId,
    sha256: sha,
    selected: String(selected),
    base_revision: String(base)
  });
}

export function readSql(db, { claims = brandClaims(), claimSub, productId = PRODUCT_ID } = {}) {
  return psql(db, `
    ${sessionSql(claims, claimSub)}
    select public.internal_preview_read(:'product_id'::uuid);
    commit;
  `, { product_id: productId });
}
