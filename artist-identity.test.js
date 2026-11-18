import test from 'node:test';
import assert from 'node:assert/strict';
import { sameArtist, artistIdentityKeys } from './artist-identity.js';

test('Genius and MusicBrainz identities join through the explicitly linked artist page', () => {
  const genius = { id: 'genius:83959', name: 'Bladee', providerIds: { genius: '83959' }, links: { genius: 'https://genius.com/artists/Bladee' } };
  const mb = { id: 'musicbrainz:cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4', name: 'Bladee', providerIds: { musicbrainz: 'cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4' }, links: { genius: 'http://genius.com/artists/bladee/?utm_source=example' } };
  assert.equal(sameArtist(genius, mb), true);
});

test('different names and regional Apple URL slugs can identify the same provider artist', () => {
  assert.equal(sameArtist({ name: 'Name', providerIds: { apple: '123' } }, { name: 'Alias', links: { apple: 'https://music.apple.com/jp/artist/an-alias/123' } }), true);
});

test('equal names, photographs, song pages, and label sites never identify a person', () => {
  const a = { name: 'Same', image: 'https://example.com/same.jpg', url: 'https://genius.com/shared-song-lyrics', links: { label: 'https://example.com' } };
  assert.equal(sameArtist(a, { ...a }), false);
  assert.equal(artistIdentityKeys(a).size, 0);
});

test('conflicting IDs from the same service prevent a URL-based accidental merge', () => {
  assert.equal(sameArtist({ providerIds: { genius: '1' }, links: { genius: 'https://genius.com/artists/Same' } }, { providerIds: { genius: '2' }, links: { genius: 'https://genius.com/artists/Same' } }), false);
});

test('untrusted hosts and credential-bearing URLs do not generate identity keys', () => {
  assert.equal(artistIdentityKeys({ links: { a: 'https://genius.com.attacker.example/artists/Bladee', b: 'https://user:password@genius.com/artists/Bladee', c: 'javascript:alert(1)' } }).size, 0);
});
