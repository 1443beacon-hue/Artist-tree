import { validateSavedMap } from './saved-maps.js';

const TABLE = 'artistree_saved_trees';
const failure = () => new Error('Account maps could not be reached. No browser saves were changed. Please try again.');
export function createCloudMapStore({ account, scope = 'main', makeId = () => crypto.randomUUID(),
  now = () => new Date().toISOString() }) {
  if (!['main', 'spotify'].includes(scope)) throw new Error('Invalid map view.');
  function checked(value) {
    const map = validateSavedMap(value, scope);
    if (!map || new TextEncoder().encode(JSON.stringify(map)).length > 1_800_000) {
      throw new Error('This map is invalid or too large to save safely.');
    }
    return map;
  }
  async function insert(map, importing = false) {
    const owner = account.capture();
    const row = { owner_id: owner.id, scope, id: map.id, name: map.name, saved_at: map.savedAt,
      artist_count: map.graph.artists.length, snapshot: map };
    let query = owner.client.from(TABLE);
    query = importing ? query.upsert(row, { onConflict: 'owner_id,scope,id', ignoreDuplicates: true }) : query.insert(row);
    let result;
    try { result = await query.select('id'); } catch { owner.assertCurrent(); throw failure(); }
    owner.assertCurrent();
    if (result.error) {
      if (result.error.code === 'P0001') throw new Error('You can save up to 20 account maps in this view. Delete one before saving another.');
      throw failure();
    }
    if (!result.data?.length) throw new Error('This browser map is already in your account. Nothing was replaced.');
    return map;
  }
  return {
    async list() {
      const owner = account.capture();
      let result;
      try { result = await owner.client.from(TABLE).select('id,name,saved_at,artist_count')
        .eq('owner_id', owner.id).eq('scope', scope).order('saved_at', { ascending: false }).limit(20); }
      catch { owner.assertCurrent(); throw failure(); }
      owner.assertCurrent();
      if (result.error || !Array.isArray(result.data)) throw failure();
      return result.data.map(row => ({ id: row.id, name: row.name, savedAt: row.saved_at, artistCount: row.artist_count }));
    },
    async get(id) {
      const owner = account.capture();
      let result;
      try { result = await owner.client.from(TABLE).select('snapshot').eq('owner_id', owner.id).eq('scope', scope).eq('id', id).single(); }
      catch { owner.assertCurrent(); throw failure(); }
      owner.assertCurrent();
      if (result.error || !result.data) throw failure();
      const map = checked(result.data.snapshot);
      if (map.id !== id) throw failure();
      return map;
    },
    save(value) { return insert(checked({ ...value, version: 1, scope, id: makeId(), savedAt: now() })); },
    // An explicit copy. The local ID makes retries idempotent; local storage is never written.
    import(value) { return insert(checked(value), true); },
    async remove(id) {
      const owner = account.capture();
      let result;
      try { result = await owner.client.from(TABLE).delete().eq('owner_id', owner.id).eq('scope', scope).eq('id', id).select('id'); }
      catch { owner.assertCurrent(); throw failure(); }
      owner.assertCurrent();
      if (result.error || !result.data?.length) throw failure();
    }
  };
}
