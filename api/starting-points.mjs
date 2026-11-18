import { publicError } from './http.mjs';
import { validId } from './providers.mjs';

// Verified Genius identities for the original search suggestions, not a chart.
export const DEFAULT_STARTING_ARTISTS = [
  { id: '1672290', name: 'Tohji' },
  { id: '83959', name: 'Bladee' },
  { id: '48326', name: 'Yung Lean' },
  { id: '3021045', name: 'Lucy Bedroque' },
  { id: '3528032', name: 'prettifun' }
];
export const GENIUS_CHART_URL = 'https://genius.com/#top-songs';

export function validateChartSnapshot(value, now = Date.now()) {
  if (!value || value.period !== 'day' || !Array.isArray(value.artistIds) || value.artistIds.length !== 5) return null;
  const captured = typeof value.capturedAt === 'string' ? Date.parse(value.capturedAt) : NaN;
  if (!Number.isFinite(captured) || captured > now + 300_000 || now - captured >= 86_400_000) return null;
  if (!value.artistIds.every(id => validId('genius', id)) || new Set(value.artistIds).size !== 5) return null;
  const positions = value.positions === undefined ? [1, 2, 3, 4, 5] : value.positions;
  if (!Array.isArray(positions) || positions.length !== 5 || !positions.every((rank, index) => Number.isSafeInteger(rank) && rank > 0 && (index === 0 || rank > positions[index - 1]))) return null;
  if (value.scope !== undefined && !['recording_artists', 'all_artists'].includes(value.scope)) return null;
  return { artistIds: [...value.artistIds], positions: [...positions], capturedAt: new Date(captured).toISOString(),
    scope: value.scope === 'recording_artists' ? 'recording_artists' : 'all_artists' };
}

// Genius's supported OAuth API has no artist search-rank/chart endpoint.
// Only an explicitly supplied, recently checked daily chart snapshot may be
// labelled as chart data. A fallback is always clearly labelled suggestions.
export function createStartingPointsService(genius, { loadSnapshot = async () => null, now = Date.now } = {}) {
  let cached, pending;
  async function profiles(entries) {
    return Promise.all(entries.map(async entry => {
      try {
        if (!genius.configured) throw new Error('Credentials unavailable');
        const profile = await genius.artist(entry.id);
        if (profile?.providerIds?.genius !== entry.id) throw new Error('Mismatched artist identity');
        return { artist: profile };
      } catch (error) {
        return { artist: entry.name ? { id: `genius:${entry.id}`, name: entry.name, providerIds: { genius: entry.id }, tags: ['ARTIST'], links: {}, image: '', origin: 'reference' } : null,
          warning: publicError(error) };
      }
    }));
  }
  async function collect() {
    let snapshot;
    try { snapshot = validateChartSnapshot(await loadSnapshot(), now()); } catch { /* Never expose server paths or file contents. */ }
    let results = snapshot ? await profiles(snapshot.artistIds.map(id => ({ id }))) : null;
    const isChart = Boolean(snapshot && validateChartSnapshot({ ...snapshot, period: 'day' }, now())
      && results.every(result => result.artist?.name && result.artist.image && !result.warning));
    if (!isChart) results = await profiles(DEFAULT_STARTING_ARTISTS);
    return {
      artists: results.map((result, index) => ({ ...result.artist, rank: isChart ? snapshot.positions[index] : null })),
      source: { provider: 'genius', url: GENIUS_CHART_URL, kind: isChart ? 'daily_artist_chart_snapshot' : 'suggestions', period: isChart ? 'day' : null,
        capturedAt: isChart ? snapshot.capturedAt : null, fetchedAt: new Date(now()).toISOString(), scope: isChart ? snapshot.scope : null, live: false },
      chartAvailable: isChart,
      note: isChart ? `Imported Genius daily artist-chart snapshot, not search frequency and not a live feed.${snapshot.scope === 'recording_artists' ? ' Translation/editorial accounts excluded; original chart positions retained.' : ''}`
        : 'Genius chart unavailable. These are suggested searches, not ranked artists.',
      warnings: results.filter(result => result.warning).map(result => result.warning)
    };
  }
  return async function startingPoints() {
    if (cached && cached.until > now()) return cached.value;
    if (!pending) pending = collect().then(value => {
      cached = { value, until: Math.min(now() + (value.warnings.length ? 120_000 : 600_000),
        value.chartAvailable ? Date.parse(value.source.capturedAt) + 86_400_000 : Infinity) };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}
