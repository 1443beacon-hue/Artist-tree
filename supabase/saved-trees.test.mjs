import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('./migrations/20261123133854_artistree_saved_trees.sql', import.meta.url), 'utf8');
test('database enforces owner isolation, immutability, limits and anonymous denial (local Postgres)', async () => {
  const db = new PGlite();
  const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');
    `);
    await db.exec(migration);
    const row = (owner = alice, id = 'tree-1', scope = 'main') => {
      const snapshot = { version: 1, id, scope, name: 'My tree', savedAt: '2026-11-23T12:00:00Z',
        graph: { artists: [{}], edges: [], explorer: {} }, camera: {} };
      return [owner, scope, id, 'My tree', snapshot.savedAt, 1, JSON.stringify(snapshot)];
    };
    const insert = values => db.query(`insert into public.artistree_saved_trees
      (owner_id,scope,id,name,saved_at,artist_count,snapshot) values ($1,$2,$3,$4,$5,$6,$7)`, values);
    const as = async (role, id = '') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec(`set role ${role}`);
    };
    await as('anon');
    await assert.rejects(db.query('select * from public.artistree_saved_trees'), /permission denied/);
    await assert.rejects(insert(row()), /permission denied/);
    await as('authenticated', alice);
    await insert(row());
    assert.equal((await db.query('select * from public.artistree_saved_trees')).rows.length, 1);
    await assert.rejects(insert(row(bob, 'forged-owner')), /row-level security/);
    await assert.rejects(db.query('update public.artistree_saved_trees set owner_id = $1', [bob]), /permission denied/);
    await as('authenticated', bob);
    assert.equal((await db.query('select * from public.artistree_saved_trees')).rows.length, 0);
    assert.equal((await db.query("delete from public.artistree_saved_trees where id = 'tree-1' returning id")).rows.length, 0);
    await insert(row(bob));
    await as('authenticated', alice);
    for (let i = 2; i <= 20; i++) await insert(row(alice, `tree-${i}`));
    await assert.rejects(insert(row(alice, 'tree-21')), /limit reached/);
    await db.query(`insert into public.artistree_saved_trees (owner_id,scope,id,name,saved_at,artist_count,snapshot)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`, row());
    await insert(row(alice, 'spotify-tree', 'spotify'));
    assert.equal((await db.query("select count(*)::int as count from public.artistree_saved_trees where scope = 'main'")).rows[0].count, 20);
    await db.query("delete from public.artistree_saved_trees where scope = 'main' and id = 'tree-1'");
    await insert(row(alice, 'tree-21'));
    const bad = row(alice, 'bad'); bad[6] = '{}';
    await assert.rejects(insert(bad));
    await as('authenticated', '');
    assert.equal((await db.query('select * from public.artistree_saved_trees')).rows.length, 0);
    await as('postgres');
    await db.query('delete from auth.users where id = $1', [alice]);
    assert.equal((await db.query('select owner_id from public.artistree_saved_trees')).rows[0].owner_id, bob);
  } finally { await db.close(); }
});
