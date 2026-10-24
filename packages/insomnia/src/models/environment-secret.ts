import { database as db } from '../common/database';
import type { BaseModel } from './index';

// The values of an environment's secret variables (Environment.secretKeys):
// kept on this computer only, encrypted at rest (common/credential-guard.ts),
// and never synced or exported. The environment keeps each one's name, with
// an empty value (common/environment-secrets.ts).
export const name = 'Environment Secret';

export const type = 'EnvironmentSecret';

export const prefix = 'envs';

export const canDuplicate = true;

export const canSync = false;

export interface BaseEnvironmentSecret {
  values: Record<string, string>;
}

export type EnvironmentSecret = BaseModel & BaseEnvironmentSecret;

export const isEnvironmentSecret = (model: Pick<BaseModel, 'type'>): model is EnvironmentSecret => (
  model.type === type
);

export function init(): BaseEnvironmentSecret {
  return {
    values: {},
  };
}

export function migrate(doc: EnvironmentSecret) {
  return doc;
}

export const getByParentId = (parentId: string) => db.getWhere<EnvironmentSecret>(type, { parentId });

// the values for an environment: all of them, replacing what was there
export async function setValues(parentId: string, values: Record<string, string>) {
  const existing = await getByParentId(parentId);
  if (existing) {
    return db.docUpdate<EnvironmentSecret>(existing, { values });
  }
  return db.docCreate<EnvironmentSecret>(type, { parentId, values });
}

export const all = () => db.all<EnvironmentSecret>(type);
