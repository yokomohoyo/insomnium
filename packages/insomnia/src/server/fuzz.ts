import { FUZZ_LISTS } from '../common/fuzz';
import { isSafeToRepeat } from '../common/security-tests';
import { FUZZ_MAX_ATTEMPTS, type FuzzAttemptResult, type FuzzRunSummary } from '../network/fuzz-run';
import type { RunnableRequest } from '../network/runner';
import { sendingEnvironment } from './run';
import { ALLOW_FLAG } from './security';
import { emptySources, GIT_USAGE, requireSources, type Sources, SOURCES_USAGE, takeSourceOption } from './sources';

// `insomnium-server fuzz`: the app's Fuzz for a pipeline. It sends one request
// many times, each time with a value swapped for a payload, and exits 1 when
// an answer stands out.
//
// The app asks before it sends anything, and asks again for a request that
// changes data. Here both go-aheads are on the command line, every time:
// --i-may-test-this-api, and --i-may-change-data for anything but a GET or
// HEAD. Neither has a default, or can come from the environment or a
// collection.

export const CHANGE_FLAG = '--i-may-change-data';

export interface FuzzConfig extends Sources {
  allowed: boolean;
  mayChangeData: boolean;
  // the request, by name or path
  request?: string;
  environment?: string;
  // position ids or labels; the suggested ones when there are none, every one for "all"
  positions: string[];
  lists: string[];
  // a file of payloads, one a line
  payloadFile?: string;
  delay: number;
  // exit 0 even when attempts stood out
  noFail: boolean;
  csv?: string;
  json?: string;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
  allowedSecrets: string;
}

export const FUZZ_USAGE = `Usage: insomnium-server fuzz (--collection <file> | --repo <url or directory>) --request <name> ${ALLOW_FLAG} (--lists <ids> | --payloads <file>) [options]

Fuzzes one HTTP request as the app's Fuzz does: sends it once as it is, then
once for each attempt with one value swapped for a payload, and compares every
answer with the first. The request's scripts and assertions run for every
attempt (fuzzPayload, fuzzPosition and fuzzAttempt are iteration data), and one
that fails marks the attempt. Nothing sent is kept. At most ${FUZZ_MAX_ATTEMPTS} attempts.

Exits 1 when an attempt stood out (a server error, a stack trace or database
error, a template worked out, a slipped-in field that came back, a much slower
answer, a failed check) or couldn't be sent; 2 when the run can't start.

Run it only against an API you're allowed to test. ${ALLOW_FLAG} says
that you are: it is required on the command line, every time. A request that
isn't a GET or HEAD changes data once for every attempt the server accepts, and
needs ${CHANGE_FLAG} as well.

${SOURCES_USAGE}
  --request     the request to fuzz: its name, or a path like "Users/Create user"
  --env         the sub environment to send with, by name
  --positions   where the payloads go, comma-separated: labels as the output names
                them ("Query: status"), or all. The likely ones when left out: the
                query, the body, and the parts of the path that look like ids
  --lists       payload lists, comma-separated: ${FUZZ_LISTS.map(({ id }) => id).join(', ')}
  --payloads    a file of your own payloads, one a line. A line that is JSON goes
                into a JSON body as that value; role=owner is a field to slip in
  --delay       milliseconds to wait between attempts
  --no-fail     exit 0 even when attempts stood out
  --csv         write the attempts to this file as CSV
  --json        write the run to this file as JSON

Environment:
  INSOMNIUM_ALLOWED_HOSTS  comma-separated hosts it may send to; any by default,
                           except cloud metadata hosts, which must be listed
  INSOMNIUM_VAR_<name>     sets <name> in the environment, for secrets
  INSOMNIUM_VALIDATE_SSL   false to skip certificate validation
  INSOMNIUM_ALLOWED_ENV    environment variables templates may read with {% env 'NAME' %}:
                           comma-separated names, or prefixes ending in *; none by default
  INSOMNIUM_ALLOWED_SECRETS secret-manager secrets templates may read, or prefixes
                           ending in *; none by default
${GIT_USAGE}`;

const listed = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean);

export const parseFuzzConfig = (argv: string[], env: Record<string, string | undefined>): FuzzConfig => {
  const config: FuzzConfig = {
    ...emptySources(env),
    allowed: false,
    mayChangeData: false,
    positions: [],
    lists: [],
    delay: 0,
    noFail: false,
    ...sendingEnvironment(env),
  };

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${option} needs a value`);
      }
      return next;
    };
    if (takeSourceOption(config, option, value)) {
      continue;
    }
    switch (option) {
      case ALLOW_FLAG:
        config.allowed = true;
        break;
      case CHANGE_FLAG:
        config.mayChangeData = true;
        break;
      case '--request':
        config.request = value();
        break;
      case '--env':
        config.environment = value();
        break;
      case '--positions':
        config.positions.push(...listed(value()));
        break;
      case '--lists': {
        const ids = listed(value());
        const unknown = ids.filter(id => !FUZZ_LISTS.some(list => list.id === id));
        if (unknown.length) {
          throw new Error(`${option}: no list named ${unknown.join(', ')}. The lists are: ${FUZZ_LISTS.map(({ id }) => id).join(', ')}`);
        }
        config.lists.push(...ids);
        break;
      }
      case '--payloads':
        config.payloadFile = value();
        break;
      case '--delay': {
        const delay = Number(value());
        if (!Number.isInteger(delay) || delay < 0) {
          throw new Error(`${option} must be a whole number of milliseconds`);
        }
        config.delay = delay;
        break;
      }
      case '--no-fail':
        config.noFail = true;
        break;
      case '--csv':
        config.csv = value();
        break;
      case '--json':
        config.json = value();
        break;
      default:
        throw new Error(`Unknown option ${option}`);
    }
  }

  requireSources(config);
  if (!config.request) {
    throw new Error('Name the request to fuzz with --request');
  }
  if (!config.lists.length && !config.payloadFile) {
    throw new Error(`Say what to try: --lists (${FUZZ_LISTS.map(({ id }) => id).join(', ')}) or --payloads <file>`);
  }
  // the go-ahead: asked for by name, since there's nobody to ask
  if (!config.allowed) {
    throw new Error(`A fuzz sends requests made to break things. Pass ${ALLOW_FLAG} to say you're allowed to test this API.`);
  }
  return config;
};

const pathOf = ({ folders, request }: RunnableRequest) => [...folders, request.name].join('/');

// the request to fuzz, by its name or its path through the folders
export const findFuzzRequest = (requests: RunnableRequest[], wanted: string) => {
  const path = wanted.split('/').map(part => part.trim()).filter(Boolean).join('/');
  const exact = requests.filter(request => pathOf(request) === path);
  const matches = exact.length ? exact : requests.filter(({ request }) => request.name === wanted.trim());
  if (!matches.length) {
    throw new Error(`No request '${wanted}'. The collections have: ${requests.map(pathOf).join(', ') || 'no HTTP requests'}`);
  }
  if (matches.length > 1) {
    throw new Error(`'${wanted}' names ${matches.length} requests: ${matches.map(pathOf).join(', ')}. Give its path.`);
  }
  return matches[0];
};

// a request that changes data needs its own go-ahead
export const assertMayFuzz = (method: string, mayChangeData: boolean) => {
  if (!isSafeToRepeat(method) && !mayChangeData) {
    throw new Error(`A ${method} changes data once for every attempt the server accepts. Pass ${CHANGE_FLAG} to say that's allowed and can be put right.`);
  }
};

const shown = (payload: string) => payload.length > 60 ? `${payload.slice(0, 57)}… (${payload.length} characters)` : payload;

// an attempt's line: only the ones that stood out or couldn't be sent are printed
export const formatAttempt = ({ index, position, payload, statusCode, bytes, elapsed, error, flags, notable }: FuzzAttemptResult) =>
  `  ${error ? '!' : notable ? '✗' : '·'} ${String(index).padStart(4)}  ${position}  ←  ${shown(payload)}\n        ${error ? error : `${statusCode}, ${bytes} B, ${Math.round(elapsed)} ms`}${flags.length ? `: ${flags.map(({ label }) => label).join('; ')}` : ''}`;

export const failedAttempts = (summary: FuzzRunSummary) => summary.attempts.filter(({ error }) => error).length;

export const failsFuzz = (summary: FuzzRunSummary, noFail: boolean) => failedAttempts(summary) > 0 || (!noFail && summary.notable > 0);

export const formatFuzzSummary = (summary: FuzzRunSummary, noFail: boolean) => {
  const failed = failedAttempts(summary);
  return [
    `${summary.attempts.length} ${summary.attempts.length === 1 ? 'attempt' : 'attempts'} · ${summary.notable} worth a look${failed ? ` · ${failed} could not be sent` : ''} · ${summary.requests} sent`,
    ...(failed ? [`Failed: ${failed} ${failed === 1 ? 'attempt' : 'attempts'} could not be sent`] : []),
    summary.notable ? (noFail ? 'Not failing on attempts that stood out (--no-fail)' : `Failed: ${summary.notable} ${summary.notable === 1 ? 'attempt' : 'attempts'} stood out`) : 'Nothing stood out',
    'An attempt that stood out is a place to look, not a proven fault; one that did not found nothing this once.',
  ].join('\n');
};
