// Secret environment variables: an environment names them (secretKeys, which
// syncs), keeps an empty value for each in its data (which syncs and exports),
// and their values live in an EnvironmentSecret on this computer only,
// encrypted at rest. Rendering lays the values over the data.
import * as models from '../models';
import type { Environment } from '../models/environment';

export const secretKeysOf = (environment: Pick<Environment, 'secretKeys'>) =>
  Array.isArray(environment.secretKeys) ? environment.secretKeys.filter(key => typeof key === 'string') : [];

// the environment as requests see it: its secret variables' values in its data
export async function withSecretValues<T extends Environment | null | undefined>(environment: T): Promise<T> {
  if (!environment) {
    return environment;
  }
  const keys = secretKeysOf(environment);
  if (!keys.length) {
    return environment;
  }
  const values = (await models.environmentSecret.getByParentId(environment._id))?.values || {};
  const data = { ...environment.data };
  for (const key of keys) {
    if (typeof values[key] === 'string') {
      data[key] = values[key];
    }
  }
  return { ...environment, data };
}

// What an environment's variables become: its data with each secret's value
// emptied, and the secrets kept to the variables still in the data. A value in
// the data is a new one, typed in the JSON view, so it goes to the secrets; an
// empty one leaves the secret as it was.
export function splitSecrets(data: Record<string, any>, secretKeys: string[], secrets: Record<string, string>) {
  const keys = secretKeys.filter((key, index) => secretKeys.indexOf(key) === index && Object.prototype.hasOwnProperty.call(data, key));
  const nextData = { ...data };
  const nextSecrets: Record<string, string> = {};
  for (const key of keys) {
    const inData = data[key];
    const typed = inData == null || inData === '' ? null : typeof inData === 'string' ? inData : JSON.stringify(inData);
    nextSecrets[key] = typed ?? (typeof secrets[key] === 'string' ? secrets[key] : '');
    nextData[key] = '';
  }
  return { data: nextData, secretKeys: keys, secrets: nextSecrets };
}

// Writes an environment's data, as a script, the MCP server or insomnium-server
// sets it: a secret variable's value goes to its secrets, not the data
export async function setEnvironmentData(environment: Environment, data: Record<string, any>, patch: Partial<Environment> = {}) {
  const keys = secretKeysOf(environment);
  if (!keys.length) {
    return models.environment.update(environment, { ...patch, data });
  }
  const split = splitSecrets(data, keys, await secretValuesOf(environment._id));
  await saveSecretValues(environment._id, split.secrets);
  return models.environment.update(environment, { ...patch, data: split.data, secretKeys: split.secretKeys });
}

// Keeps an environment's secret values, as the editor gives them
export const saveSecretValues = (environmentId: string, secrets: Record<string, string>) =>
  models.environmentSecret.setValues(environmentId, secrets);

export const secretValuesOf = async (environmentId: string) =>
  (await models.environmentSecret.getByParentId(environmentId))?.values || {};
