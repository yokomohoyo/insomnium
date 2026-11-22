import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { chooseFuzz, FUZZ_LISTS, FUZZ_MODES, type FuzzMode, fuzzPlanSize } from '../../../common/fuzz';
import { isSafeToRepeat } from '../../../common/security-tests';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import { FUZZ_MAX_ATTEMPTS, type FuzzAttemptResult, listFuzzPoints, runFuzz } from '../../../network/fuzz-run';
import { assertSafeRequestUrl, fail, findWorkspaceForRequest, foreignEnvironment, json, notFound } from './util';

// What the user is asked before a fuzz: it sends the request once for each
// attempt, each with a value swapped for a payload made to break things, and
// a request that changes data changes it every time
export interface FuzzRequest {
  request: string;
  method: string;
  url: string;
  workspace: string;
  // how many requests it sends, the first (as it is) included
  requests: number;
  // the positions and lists chosen, as the dialog would name them
  positions: string[];
  lists: string[];
  // how the payloads are spread over the positions
  mode: FuzzMode;
  // not a GET or HEAD: every attempt the server accepts changes something
  changesData: boolean;
}
export type ConfirmFuzz = (run: FuzzRequest, signal?: AbortSignal) => Promise<boolean>;

// as much of an answer as a client is given, and as many of the attempts that
// didn't stand out: a run can be 2000 attempts long
const SNIPPET_CHARS = 600;
const QUIET_ATTEMPTS = 100;

// A position's current value, for a client to see what it's replacing. The
// request is rendered, so a value may be a credential from the environment:
// one whose name or shape says so is not handed over
const CREDENTIAL_NAME = /auth|token|key|secret|passw|cookie|session|credential|signature/i;
const CREDENTIAL_VALUE = /^(bearer|basic)\s|^eyJ[\w-]+\.[\w-]+\./i;
const shownValue = ({ label, original }: { label: string; original: string }) =>
  CREDENTIAL_NAME.test(label) || CREDENTIAL_VALUE.test(original) ? '(hidden: it looks like a credential)' : original.length > 200 ? `${original.slice(0, 200)}…` : original;

const brief = ({ index, position, payload, statusCode, bytes, elapsed, error, flags }: FuzzAttemptResult) =>
  ({ attempt: index, position, payload: payload.length > 200 ? `${payload.slice(0, 200)}… (${payload.length} characters)` : payload, statusCode, bytes, ms: Math.round(elapsed), ...(error ? { error } : {}), flags: flags.map(({ label }) => label) });

// The app's only, with the app's dialog: the headless server has nobody to ask
export function registerFuzzTools(server: McpServer, confirm: ConfirmFuzz, { list = listFuzzPoints, run = runFuzz }: { list?: typeof listFuzzPoints; run?: typeof runFuzz } = {}) {
  server.tool(
    'list_fuzz_points',
    "List where fuzz_request can put payloads in an HTTP request, as the app's Fuzz dialog does: each query parameter, part of the path, header, value in a JSON body or form field, and a new field of a JSON body. The request is rendered with its environment and nothing is sent. Returns each position's id, label, current value (hidden when it looks like a credential) and whether it's a likely place for input (suggested), and the payload lists there are, with how many payloads each has.",
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
    },
    async ({ requestId, environmentId }) => {
      const request = await models.request.getById(requestId);
      if (!request || !isRequest(request)) {
        return notFound('HTTP request');
      }
      const foreign = await foreignEnvironment((await findWorkspaceForRequest(request.parentId))?._id, environmentId);
      if (foreign) {
        return fail(foreign);
      }
      try {
        const { points, method, url } = await list(requestId, environmentId);
        return json({
          requestId,
          method,
          url,
          positions: points.map(({ id, label, original, suggested }) => ({ id, label, value: shownValue({ label, original }), suggested })),
          lists: FUZZ_LISTS.map(({ id, name, about, payloads }) => ({ id, name, about, payloads: payloads.length })),
        });
      } catch (err) {
        return fail(`the request could not be read: ${(err as Error).message}`);
      }
    },
  );

  server.tool(
    'fuzz_request',
    `Fuzz an HTTP request, as the app's Fuzz dialog does: send it once as it is, then once for each attempt with one value swapped for a payload, and compare every answer with the first. Choose positions (from list_fuzz_points; the suggested ones when left out) and payload lists by id (${FUZZ_LISTS.map(({ id }) => id).join(', ')}) and/or your own payloads. Each position gets each payload, one at a time (or all at once, or in every combination: mode), up to ${FUZZ_MAX_ATTEMPTS} attempts. The request's pre-request and after-response scripts and assertions run for every attempt, with fuzzPayload, fuzzPosition and fuzzAttempt as iteration data; a failed test or assertion marks the attempt. Nothing sent is stored. It works on any method: a request that changes data changes it once per attempt the server accepts. The app asks the user to allow each run, saying how many requests it sends; a declined run returns an error and sends nothing. Returns the attempts that stood out (a server error, a stack trace or database error, a template worked out, a slipped-in field that came back, a much slower answer, a failed check) with the start of each answer, and the rest in brief. An attempt that stood out is a place to look, not a proven fault.`,
    {
      requestId: z.string(),
      environmentId: z.string().nullable().optional().describe('Override the active environment for this call. Null = no environment overrides; omit = use workspace active environment.'),
      positions: z.array(z.string()).optional().describe('Position ids or labels from list_fuzz_points, or ["all"]. The suggested positions when left out.'),
      lists: z.array(z.string()).optional().describe(`Payload lists by id: ${FUZZ_LISTS.map(({ id, about }) => `${id} (${about.toLowerCase()})`).join('; ')}.`),
      payloads: z.array(z.string()).optional().describe('Your own payloads. One that is JSON (null, {"$gt":""}) goes into a JSON body as that value; one like role=owner is a field to slip into a JSON body.'),
      mode: z.enum(FUZZ_MODES as [string, ...string[]]).optional().describe('How the payloads are spread over the positions. one (the default): each position with each payload, one at a time, which shows which input is at fault. together: each payload in every position at once. combinations: every combination of payloads over the positions, for what only breaks when two inputs are odd at once; it grows fast.'),
      delayMs: z.number().int().min(0).max(60000).optional().describe('A pause between attempts, in milliseconds.'),
    },
    async ({ requestId, environmentId, positions, lists, payloads, mode, delayMs }, { signal }) => {
      const request = await models.request.getById(requestId);
      if (!request || !isRequest(request)) {
        return notFound('HTTP request');
      }
      const workspace = await findWorkspaceForRequest(request.parentId);
      const foreign = await foreignEnvironment(workspace?._id, environmentId);
      if (foreign) {
        return fail(foreign);
      }
      let chosen;
      let url;
      try {
        const listed = await list(requestId, environmentId);
        url = listed.url;
        chosen = chooseFuzz(listed.points, { positions, lists, payloads: payloads?.join('\n') });
      } catch (err) {
        return fail((err as Error).message);
      }
      const attempts = Math.min(FUZZ_MAX_ATTEMPTS, fuzzPlanSize(chosen.points, chosen.payloads, mode as FuzzMode | undefined));
      if (!attempts) {
        return fail('nothing to try: none of the payloads chosen fit the positions chosen (fields to slip in go only in "Body: a new field", and nothing else goes there)');
      }
      const allowed = await confirm({
        request: request.name,
        method: request.method,
        url,
        workspace: workspace?.name || '',
        requests: attempts + 1,
        positions: chosen.points.map(({ label }) => label),
        lists: chosen.lists,
        mode: (mode as FuzzMode | undefined) || 'one',
        changesData: !isSafeToRepeat(request.method),
      }, signal);
      console.log(`[mcp] fuzz_request ${requestId}: the user ${allowed === true ? 'allowed' : 'declined'} the run`);
      // only a plain yes sends anything
      if (allowed !== true) {
        return fail('the user declined to fuzz the request');
      }
      try {
        const summary = await run(requestId, {
          ...(environmentId === undefined ? {} : { environmentId }),
          pointIds: chosen.points.map(({ id }) => id),
          payloads: chosen.payloads,
          mode: mode as FuzzMode | undefined,
          delay: delayMs,
          signal,
          checkUrl: assertSafeRequestUrl,
        });
        const quiet = summary.attempts.filter(({ notable }) => !notable);
        return json({
          requestId,
          baseline: summary.baseline,
          requests: summary.requests,
          attempts: summary.attempts.length,
          stopped: summary.stopped,
          worthALook: summary.attempts.filter(({ notable }) => notable).map(attempt => ({ ...brief(attempt), answer: attempt.snippet.slice(0, SNIPPET_CHARS) })),
          others: quiet.slice(0, QUIET_ATTEMPTS).map(brief),
          ...(quiet.length > QUIET_ATTEMPTS ? { othersLeftOut: quiet.length - QUIET_ATTEMPTS } : {}),
        });
      } catch (err) {
        return fail(`the request could not be fuzzed: ${(err as Error).message}`);
      }
    },
  );
}
