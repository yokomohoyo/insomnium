import { useEffect, useState } from 'react';

import { saveSecretValues, secretValuesOf } from '../../common/environment-secrets';
import type { Environment } from '../../models/environment';
import type { EnvironmentInfo } from '../components/editors/environment-variables';

// An environment's secret values, for its editor, which starts from them:
// null until they're read
export function useSecretValues(environmentId: string | undefined) {
  const [values, setValues] = useState<{ id: string; secrets: Record<string, string> } | null>(null);
  useEffect(() => {
    let mounted = true;
    if (environmentId) {
      secretValuesOf(environmentId).then(secrets => mounted && setValues({ id: environmentId, secrets }));
    }
    return () => {
      mounted = false;
    };
  }, [environmentId]);
  return values && values.id === environmentId ? values.secrets : null;
}

// What the editor gave, as the environment's patch, with its secret values
// saved apart. secretKeys is only written once there are, or were, some, so an
// environment without any isn't changed for Git Sync.
export async function environmentPatchFrom(environment: Environment, info: EnvironmentInfo): Promise<Partial<Environment>> {
  const secretKeys = info.secretKeys || [];
  const hadSecrets = Array.isArray(environment.secretKeys);
  if (secretKeys.length || hadSecrets) {
    await saveSecretValues(environment._id, info.secrets || {});
  }
  return {
    data: info.object,
    dataPropertyOrder: info.propertyOrder,
    ...(secretKeys.length || hadSecrets ? { secretKeys } : {}),
  };
}
