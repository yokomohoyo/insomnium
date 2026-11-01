import { AsyncLocalStorage } from 'node:async_hooks';

import { setFileTagAllowed } from '../ui/components/templating/local-template-tags';

// Renders done for someone other than the person at the app: an MCP client's
// tool calls, and the mock server's answers to whatever reaches it. The file
// tag would read any file on this computer for them, so it can't run inside.
const restricted = new AsyncLocalStorage<true>();

setFileTagAllowed(() => !restricted.getStore());

export const restrictRenders = <T>(run: () => T): T => restricted.run(true, run);
