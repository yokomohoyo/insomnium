import type { AuditSeverity } from '../common/response-audit';
import { SECURITY_RULES } from '../common/security-rules';
import * as models from '../models';
import type { Workspace } from '../models/workspace';
import type { SecurityRunItem, SecurityRunSummary } from '../network/security-run';
import { sendingEnvironment } from './run';
import { emptySources, GIT_USAGE, requireSources, type Sources, SOURCES_USAGE, takeSourceOption } from './sources';

// `insomnium-server security`: the app's Security Checks for CI. It tests each
// GET and HEAD in the collection and looks at their answers, and exits 1 when
// it finds something as severe as --fail-on.
//
// The app asks before it sends anything. Here there is nobody to ask, so the
// go-ahead is on the command line, every time: --i-may-test-this-api, and the
// hosts it may send to, by name. Neither has a default, and neither can come
// from a collection.

export const ALLOW_FLAG = '--i-may-test-this-api';

const SEVERITIES: AuditSeverity[] = ['high', 'medium', 'low', 'info'];
export type FailOn = AuditSeverity | 'none';

export interface SecurityConfig extends Sources {
  // the go-ahead: the flag was given
  allowed: boolean;
  environment?: string;
  // a sub environment with another user's credentials, by name
  otherEnvironment?: string;
  // a sub environment whose user has less privilege than the requests need, by name
  lowerEnvironment?: string;
  folder?: string;
  // the least severe finding that fails the run
  failOn: FailOn;
  // rules to leave out, by id
  ignore: string[];
  markdown?: string;
  json?: string;
  sarif?: string;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
  allowedSecrets: string;
}

export const SECURITY_USAGE = `Usage: insomnium-server security (--collection <file> | --repo <url or directory>) ${ALLOW_FLAG} [--folder <name>] [--env <name>] [options]

Checks the collection's HTTP requests as the app's Security Checks does, by the
OWASP API Security Top 10. A GET or HEAD is sent again up to 26 times, changed a
little each time (without its credentials, with a forged token, from another
site, with a quote in a parameter, 15 times in a row), and its answer looked
at. Any other request is never sent. Nothing sent is kept.

Exits 1 when a finding is as severe as --fail-on, or a request that should have
been tested couldn't be; 2 when the run can't start.

Run it only against an API you're allowed to test. Two things say that you are,
and both are required:
  ${ALLOW_FLAG}   on the command line, every time
  INSOMNIUM_ALLOWED_HOSTS  the hosts it may send to, by name (not *)

${SOURCES_USAGE}
  --folder      only the requests in this folder: its name, or a path like "Users/Admin"
  --env         the sub environment to send with, by name
  --as          a sub environment holding another user's credentials, by name: each
                request is also sent once as them, to see whether they get the first
                user's data
  --as-lower    for requests only some users may make (use it with --folder): a sub
                environment whose user may not, by name. Each request is also sent
                once as them, and anything but a refusal is a finding
  --fail-on     the least severe finding that fails the run: high (the default),
                medium, low, info, or none to never fail
  --ignore      rules to leave out, by id, comma-separated (the ids are in a JSON report)
  --markdown    write a Markdown report to this file
  --json        write a JSON report to this file
  --sarif       write a SARIF 2.1.0 report to this file

Environment:
  INSOMNIUM_ALLOWED_HOSTS  comma-separated hosts the checks may send to: required
  INSOMNIUM_VAR_<name>     sets <name> in the environment, for secrets
  INSOMNIUM_VALIDATE_SSL   false to skip certificate validation
  INSOMNIUM_ALLOWED_ENV    environment variables templates may read with {% env 'NAME' %}:
                           comma-separated names, or prefixes ending in *; none by default
  INSOMNIUM_ALLOWED_SECRETS secret-manager secrets templates may read, or prefixes
                           ending in *; none by default
${GIT_USAGE}`;

export const parseSecurityConfig = (argv: string[], env: Record<string, string | undefined>): SecurityConfig => {
  const config: SecurityConfig = {
    ...emptySources(env),
    allowed: false,
    failOn: 'high',
    ignore: [],
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
      case '--env':
        config.environment = value();
        break;
      case '--as':
        config.otherEnvironment = value();
        break;
      case '--as-lower':
        config.lowerEnvironment = value();
        break;
      case '--folder':
        config.folder = value();
        break;
      case '--fail-on': {
        const level = value().toLowerCase();
        if (level !== 'none' && !SEVERITIES.includes(level as AuditSeverity)) {
          throw new Error(`${option} must be one of high, medium, low, info or none`);
        }
        config.failOn = level as FailOn;
        break;
      }
      case '--ignore': {
        const ids = value().split(',').map(id => id.trim()).filter(Boolean);
        const unknown = ids.filter(id => !(id in SECURITY_RULES));
        if (unknown.length) {
          throw new Error(`${option}: no rule named ${unknown.join(', ')}. The rules are: ${Object.keys(SECURITY_RULES).join(', ')}`);
        }
        config.ignore.push(...ids);
        break;
      }
      case '--markdown':
        config.markdown = value();
        break;
      case '--json':
        config.json = value();
        break;
      case '--sarif':
        config.sarif = value();
        break;
      default:
        throw new Error(`Unknown option ${option}`);
    }
  }

  requireSources(config);
  // the go-ahead, and what it covers: asked for by name, since there's nobody to ask
  if (!config.allowed) {
    throw new Error(`The security checks send requests made to find what an API lets through. Pass ${ALLOW_FLAG} to say you're allowed to test it.`);
  }
  if (!env.INSOMNIUM_ALLOWED_HOSTS?.trim() || config.allowedHosts.some(host => host.includes('*'))) {
    throw new Error('Name the hosts the security checks may send to in INSOMNIUM_ALLOWED_HOSTS (comma-separated, without *).');
  }
  return config;
};

// the other user's environment, by name: one of the collections' sub environments
export async function findOtherEnvironment(workspaces: Workspace[], name: string, option = '--as') {
  const names = new Set<string>();
  for (const workspace of workspaces) {
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    for (const environment of await models.environment.findByParentId(base._id)) {
      if (environment.name === name) {
        return environment._id;
      }
      names.add(environment.name);
    }
  }
  throw new Error(`No environment named '${name}' for ${option}. The collections have: ${[...names].join(', ') || 'no sub environments'}`);
}

// the requests that should have been tested and couldn't be: a host that isn't
// allowed, a script that failed. A run with any of these hasn't checked what
// it was asked to, whatever it found in the rest
export const untested = (summary: SecurityRunSummary) => summary.items.filter(({ failed }) => failed).length;

// whether a run fails: a finding as severe as --fail-on, or a request it couldn't test
export const failsRun = (summary: SecurityRunSummary, failOn: FailOn) =>
  untested(summary) > 0
  || (failOn !== 'none' && SEVERITIES.slice(0, SEVERITIES.indexOf(failOn) + 1).some(severity => summary.findings[severity] > 0));

// The run's console output: a request as it finishes, with what was found, and a summary
export const formatItem = (item: SecurityRunItem) => {
  const name = [...item.folders, item.name].join(' / ');
  const mark = item.failed ? '!' : item.outcome === 'skipped' ? '-' : item.findings.length ? '✗' : '✓';
  const lines = [`  ${mark} ${name}  ${item.method} ${item.url}`];
  if (item.note) {
    lines.push(`      ${item.note}`);
  }
  for (const finding of item.findings) {
    lines.push(`      ${finding.severity.toUpperCase().padEnd(6)} ${finding.title}${finding.evidence ? ` (${finding.evidence})` : ''}  [${finding.id}]`);
  }
  return lines.join('\n');
};

export const formatSecuritySummary = (summary: SecurityRunSummary, failOn: FailOn) => {
  const found = SEVERITIES.filter(severity => summary.findings[severity]).map(severity => `${summary.findings[severity]} ${severity}`).join(', ') || 'nothing found';
  const tested = summary.items.filter(({ outcome }) => outcome === 'tested').length;
  const missed = untested(summary);
  const severe = failOn !== 'none' && SEVERITIES.slice(0, SEVERITIES.indexOf(failOn) + 1).some(severity => summary.findings[severity] > 0);
  return [
    `${summary.items.length} ${summary.items.length === 1 ? 'request' : 'requests'}, ${tested} tested${missed ? `, ${missed} could not be tested` : ''} · ${found} · ${summary.requests} sent`,
    ...(missed ? [`Failed: ${missed} ${missed === 1 ? 'request' : 'requests'} could not be tested`] : []),
    severe ? `Failed: a finding is ${failOn} or worse (--fail-on ${failOn})` : failOn === 'none' ? 'Not failing on findings (--fail-on none)' : `Nothing ${failOn} or worse`,
    'A request with nothing found had none of these problems this once; that does not show the API is secure.',
  ].join('\n');
};
