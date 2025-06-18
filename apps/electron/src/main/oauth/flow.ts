import { ipcMain, shell, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { randomBase64url, sha256base64url } from './pkce';

interface PendingRequest {
  verifier: string;
  created: number;
}

/**
 * Initialises the OAuth PKCE flow IPC handler and returns a function that
 * processes deep-link callbacks (e.g. amical://oauth/callback?...).
 *
 * @param store          electron-store instance used for token persistence
 * @param getMainWindow  lazy getter to obtain the current BrowserWindow (can be null)
 * @returns handleDeepLink(url)
 */
export function initOAuth(
  store: Store,
  getMainWindow: () => BrowserWindow | null
): (url: string) => void {
  const pending = new Map<string, PendingRequest>();

  // House-keeping timer: prune entries older than 5 minutes.
  setInterval(() => {
    const now = Date.now();
    for (const [state, { created }] of pending) {
      if (now - created > 5 * 60_000) pending.delete(state);
    }
  }, 60_000);

  ipcMain.handle('oauth-login', async () => {
    const clientId = process.env.OAUTH_CLIENT_ID;
    if (!clientId) throw new Error('OAUTH_CLIENT_ID env var not defined');

    const verifier = randomBase64url();
    const challenge = sha256base64url(verifier);
    const state = randomBase64url(16);
    pending.set(state, { verifier, created: Date.now() });

    // TODO: replace with real authorize endpoint.
    const authUrl = new URL(process.env.OAUTH_AUTHORIZE_URL!);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', 'amical://oauth/callback');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'openid profile');
    authUrl.searchParams.set('prompt', 'login');

    console.log('[OAuth] opening browser to:', authUrl.toString());
    await shell.openExternal(authUrl.toString());
  });

  async function exchangeCodeForToken(code: string, verifier: string) {
    const tokenUrl = process.env.OAUTH_TOKEN_URL;
    const clientId = process.env.OAUTH_CLIENT_ID;
    if (!tokenUrl || !clientId) throw new Error('OAUTH_TOKEN_URL or CLIENT_ID missing');

    const body = JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: "amical-client-secret",
      redirect_uri: 'amical://oauth/callback',
      code_verifier: verifier,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    }
    return await res.json();
  }

  async function handleDeepLink(url: string) {
    try {
      const u = new URL(url);
      if (!(u.hostname === 'oauth' && u.pathname === '/callback')) return; // ignore others

      console.log('[OAuth] deep-link callback:', u.toString());
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      if (!code || !state) throw new Error('Missing code or state');

      const entry = pending.get(state);
      if (!entry) throw new Error('State mismatch / expired');
      pending.delete(state);

      const token = await exchangeCodeForToken(code, entry.verifier);
      store.set('oauth-token', token);

      getMainWindow()?.webContents.send('oauth-success', token);
      console.log('[OAuth] login success');
    } catch (err) {
      console.error('[OAuth] deep-link error:', err);
      getMainWindow()?.webContents.send('oauth-error', (err as Error).message);
    }
  }

  return handleDeepLink;
} 