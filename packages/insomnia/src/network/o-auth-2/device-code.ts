// The device authorization grant (RFC 8628): ask the provider for a code, show
// it to the user with the page to enter it on, and ask the token endpoint for
// the token every few seconds until they have. The polling is here, apart from
// the requests (get-token.ts) and the dialog (registered by the UI), so it can
// be tested on its own.

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  // the page with the code in it already, if the provider gives one
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

// the device authorization endpoint's answer (RFC 8628 3.2). Google says
// verification_url, as the drafts did.
export function readDeviceAuthorization(body: Record<string, any> | null, now = Date.now()): DeviceAuthorization {
  if (!body || typeof body !== 'object') {
    throw new Error('The device authorization endpoint sent nothing readable');
  }
  if (body.error) {
    throw new Error(`OAuth 2.0 Error ${body.error}${body.error_description ? `: ${body.error_description}` : ''}`);
  }
  const verificationUri = body.verification_uri || body.verification_url;
  if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string' || typeof verificationUri !== 'string') {
    throw new Error('The device authorization endpoint left out the device code, the user code or the page to enter it on');
  }
  const expiresIn = Number(body.expires_in);
  const interval = Number(body.interval);
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri,
    ...(typeof body.verification_uri_complete === 'string' ? { verificationUriComplete: body.verification_uri_complete } : {}),
    // 15 minutes when it doesn't say, as is usual
    expiresAt: now + (expiresIn > 0 ? expiresIn : 900) * 1000,
    // 5 s when it doesn't say (RFC 8628 3.2)
    intervalMs: (interval > 0 ? interval : 5) * 1000,
  };
}

// what the dialog is told, and how it says the user gave up
export interface DeviceCodePrompt {
  authorization: DeviceAuthorization;
  cancel: () => void;
}
// shows the code; returns a function that closes the dialog
type DeviceCodeUi = (prompt: DeviceCodePrompt) => () => void;
let showPrompt: DeviceCodeUi = ({ authorization }) => {
  console.log(`[oauth2] Enter ${authorization.userCode} at ${authorization.verificationUri}`);
  return () => {};
};
export const setDeviceCodeUi = (ui: DeviceCodeUi) => {
  showPrompt = ui;
};

export interface TokenPoll {
  // the token endpoint's answer to one poll
  status: number;
  body: Record<string, any> | null;
}

// Polls until the token comes, the user cancels, or the code expires. Returns
// the poll that answered with a token; an OAuth error other than "not yet" or
// "slower" ends it.
export async function pollForToken(
  authorization: DeviceAuthorization,
  poll: () => Promise<TokenPoll>,
  { sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), now = Date.now } = {},
): Promise<TokenPoll> {
  let cancelled = false;
  const close = showPrompt({ authorization, cancel: () => {
    cancelled = true;
  } });
  try {
    let interval = authorization.intervalMs;
    while (true) {
      await sleep(interval);
      if (cancelled) {
        throw new Error('Signing in on another device was cancelled');
      }
      if (now() >= authorization.expiresAt) {
        throw new Error('The code expired before it was entered: fetch the tokens again for a new one');
      }
      const answer = await poll();
      const error = answer.body?.error;
      if (answer.status >= 200 && answer.status < 300 && !error) {
        return answer;
      }
      if (error === 'authorization_pending') {
        continue;
      }
      // asked to slow down: 5 s more between polls from now on (RFC 8628 3.5)
      if (error === 'slow_down') {
        interval += 5000;
        continue;
      }
      if (error === 'access_denied') {
        throw new Error('The sign-in was declined');
      }
      if (error === 'expired_token') {
        throw new Error('The code expired before it was entered: fetch the tokens again for a new one');
      }
      // something else: the caller reports the response as it would any token request's
      return answer;
    }
  } finally {
    close();
  }
}
