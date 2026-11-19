// Official, source-identified embeds only. No extracted audio, guessed search
// matches, autoplay, audio cache, or saved playback state.
export function validateTrackPlayer(data, scope = 'main') {
  if (!['main', 'spotify'].includes(scope)) return null;
  if (data?.status === 'unavailable') return { status: 'unavailable' };
  if (data?.status !== 'ready' || !['main', 'spotify'].includes(scope)
    || (scope === 'spotify' ? data.provider !== 'spotify' : !['apple', 'youtube'].includes(data.provider))) return null;
  try {
    const embed = new URL(data.embedUrl), open = new URL(data.openUrl);
    if ([embed, open].some(url => url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)) return null;
    if (data.provider === 'apple') {
      const match = embed.pathname.match(/^\/([a-z]{2})\/song\/(\d{1,20})$/);
      if (embed.hostname !== 'embed.music.apple.com' || !match || embed.search !== '?theme=light'
        || open.href !== `https://music.apple.com/${match[1]}/song/${match[2]}`) return null;
    } else if (data.provider === 'spotify') {
      const match = embed.pathname.match(/^\/embed\/track\/([a-zA-Z0-9]{22})$/);
      if (embed.hostname !== 'open.spotify.com' || !match || embed.search
        || open.href !== `https://open.spotify.com/track/${match[1]}`) return null;
    } else {
      const match = embed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/);
      if (embed.hostname !== 'www.youtube-nocookie.com' || !match || embed.search !== '?start=0&end=30&rel=0'
        || open.href !== `https://www.youtube.com/watch?v=${match[1]}`) return null;
    }
    return { status: 'ready', provider: data.provider, source: data.provider === 'apple' ? 'Apple Music' : data.provider === 'youtube' ? 'YouTube' : 'Spotify',
      embedUrl: embed.href, openUrl: open.href };
  } catch { return null; }
}

export function createTrackPlayer({ host, resolve, scope = 'main', onClose = () => {}, onExplore = () => {} }) {
  const doc = host.ownerDocument;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const root = make('section', 'track-panel');
  root.setAttribute('aria-label', 'Selected shared track');
  const bar = make('div', 'track-panel-bar'), overline = make('span', 'track-panel-overline', 'SHARED TRACK'),
    close = make('button', 'track-panel-close', '×');
  close.type = 'button'; close.setAttribute('aria-label', 'Close track player and return to artist');
  bar.append(overline, close);
  const title = make('h2', 'track-panel-title'); title.tabIndex = -1;
  const caption = make('p', 'track-panel-caption');
  const player = make('div', 'track-player');
  const status = make('p', 'track-player-status'); status.setAttribute('role', 'status');
  const retry = make('button', 'track-player-retry', 'Try again'); retry.type = 'button'; retry.hidden = true;
  const open = make('a', 'track-player-open'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.hidden = true;
  const note = make('p', 'track-player-note', 'Press play in the official player. Preview length and availability depend on the service, region, and sign-in status.');
  const label = make('p', 'track-panel-label', 'CREDITED ON THIS MAP');
  const people = make('ul', 'track-panel-artists');
  const coverage = make('p', 'track-panel-coverage', 'Verified participants visible on this map, not a complete credit list.');
  const source = make('a', 'track-panel-source'); source.target = '_blank'; source.rel = 'noopener noreferrer';
  root.append(bar, title, caption, player, status, retry, open, note, label, people, coverage, source);
  let credit = null, controller = null, version = 0, peopleSignature = '';
  const mount = () => { if (!host.contains(root)) host.replaceChildren(root); };
  const clear = () => {
    version++; controller?.abort(); controller = null;
    // Removing the browsing context stops even logged-in/full-track playback.
    player.replaceChildren(); credit = null; peopleSignature = ''; root.remove();
  };
  async function load() {
    if (!credit) return;
    const current = ++version; controller?.abort(); controller = new AbortController();
    const signal = controller.signal, selected = credit;
    player.replaceChildren(); player.setAttribute('aria-busy', 'true');
    status.textContent = 'Finding an official player…'; retry.hidden = true; open.hidden = true;
    note.textContent = 'Press play in the official player. Preview length and availability depend on the service, region, and sign-in status.';
    try {
      const data = await resolve(selected, signal, scope);
      if (signal.aborted || current !== version || !credit) return;
      const result = validateTrackPlayer(data, scope);
      if (!result) throw new Error('Invalid player response');
      if (result.status === 'unavailable') {
        status.textContent = 'No verified preview player is available for this recording in this region. You can still open its credit source below.';
        return;
      }
      open.href = result.openUrl; open.textContent = `Open in ${result.source} ↗`; open.hidden = false;
      const frame = make('iframe', 'track-player-frame');
      frame.title = `${result.source} player for ${selected.title}`;
      frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
      frame.setAttribute('referrerpolicy', result.provider === 'youtube' ? 'strict-origin-when-cross-origin' : 'no-referrer');
      frame.setAttribute('data-provider', result.provider);
      frame.height = result.provider === 'spotify' ? '152' : '175';
      frame.src = result.embedUrl;
      note.textContent = result.provider === 'youtube'
        ? 'Press play for a 30-second video excerpt linked by the credit source. Playback availability is controlled by YouTube and the rights holder.'
        : 'Press play in the official player. Preview length and availability depend on the service, region, and sign-in status.';
      frame.addEventListener('error', () => {
        if (current !== version) return;
        player.replaceChildren(); status.textContent = 'The embedded player could not load. Use the service link or try again.';
        retry.hidden = false;
      });
      player.append(frame);
      status.textContent = `Official ${result.source} player · use its play and pause controls.`;
    } catch {
      if (!signal.aborted && current === version) {
        status.textContent = 'Could not check the official player. No audio has started. Try again or open the credit source below.';
        retry.hidden = false;
      }
    } finally {
      if (current === version) { player.setAttribute('aria-busy', 'false'); controller = null; }
    }
  }
  close.addEventListener('click', () => { clear(); onClose(); });
  retry.addEventListener('click', () => { void load(); });
  return {
    show(value, { focus = false } = {}) {
      const changed = credit?.trackKey !== value.trackKey;
      if (changed) { clear(); credit = value; }
      else credit = value;
      title.textContent = value.title;
      caption.textContent = `${value.participants.length} credited artists on this map`;
      source.href = value.url; source.textContent = `Credit source · ${value.source} ↗`;
      const nextPeople = JSON.stringify(value.participants);
      if (peopleSignature !== nextPeople) {
        peopleSignature = nextPeople; people.replaceChildren();
        value.participants.forEach(person => {
          const row = make('li', 'track-panel-artist'), button = make('button', '', person.name);
          button.type = 'button'; button.setAttribute('aria-label', `Explore ${person.name}`);
          button.addEventListener('click', () => onExplore(person.id));
          row.append(button); people.append(row);
        });
      }
      mount();
      if (changed) void load();
      if (focus) { host.scrollTop = 0; title.focus?.({ preventScroll: true }); }
    },
    clear,
    get element() { return root; }
  };
}
