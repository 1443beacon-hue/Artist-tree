import { naverConfiguration } from './naver-auth.mjs';

// Only a publishable key may cross this boundary. OAuth client secrets belong
// in the dedicated Supabase project's provider settings, never this response.
export function publicAuthConfig(env = {}) {
  const disabled = { configured: false, providers: [] };
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return disabled;
    const key = env.SUPABASE_PUBLISHABLE_KEY || '';
    if (!/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(key)) return disabled;
    const requested = new Set((env.ARTISTREE_AUTH_PROVIDERS || '').split(',').map(value => value.trim()));
    const providers = ['google', 'kakao', 'naver'].filter(provider => requested.has(provider)
      && (provider !== 'naver' || env.ARTISTREE_NAVER_ADAPTER_VERIFIED === 'true' && naverConfiguration(env)));
    return { configured: true, url: url.origin, publishableKey: key, providers };
  } catch { return disabled; }
}
