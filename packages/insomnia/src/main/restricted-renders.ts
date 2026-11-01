import { AsyncLocalStorage } from 'node:async_hooks';

import { setMetadataGuard } from '../network/metadata-hosts';
import { setTagAllowed } from '../templating/base-extension';
import { setFileTagAllowed } from '../ui/components/templating/local-template-tags';

// Renders done for someone other than the person at the app: an MCP client's
// tool calls, and the mock server's answers to whatever reaches it. The file
// tag would read any file on this computer for them, so it can't run inside.
type Restricted = 'client' | 'mock';
const restricted = new AsyncLocalStorage<Restricted>();

setFileTagAllowed(() => !restricted.getStore());
// and nothing they send connects to a cloud metadata address (network/metadata-hosts.ts)
setMetadataGuard(() => Boolean(restricted.getStore()));

// A mock answer goes to whatever reaches the server, so its examples make up
// values only: none of the computer's (os, env), a secret manager's, a
// response's or request's, a cookie's, or a token minted.
const MOCK_TAGS = new Set(['base64', 'now', 'uuid', 'hash', 'hmac', 'jwt', 'random', 'faker']);
setTagAllowed(name => restricted.getStore() !== 'mock' || MOCK_TAGS.has(name));

export const restrictRenders = <T>(run: () => T, kind: Restricted = 'client'): T => restricted.run(kind, run);

export const rendersAreRestricted = () => Boolean(restricted.getStore());
