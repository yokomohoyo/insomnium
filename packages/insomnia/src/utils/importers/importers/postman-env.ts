import { translateDynamicVariables } from '../../../templating/faker-functions';
import { Converter, GLOBAL_ENVIRONMENT_IMPORT_ID } from '../entities';

export const id = 'postman-environment';
export const name = 'Postman Environment';
export const description = 'Importer for Postman environments and globals';

interface EnvVar {
  enabled: boolean;
  key: string;
  value: string;
}

interface Environment {
  name: string;
  values: EnvVar[];
  _postman_variable_scope: 'environment' | 'globals' | string;
}

type Data = {
  [key in EnvVar['key']]: EnvVar['value'];
};

export const convert: Converter<Data> = rawData => {
  try {
    const { _postman_variable_scope, name, values } = JSON.parse(
      rawData,
    ) as Environment;

    if (_postman_variable_scope !== 'environment' && _postman_variable_scope !== 'globals') {
      return null;
    }
    // globals join the project's global environment (common/global-environments.ts)
    const globals = _postman_variable_scope === 'globals';

    return translateDynamicVariables([
      {
        _id: '__ENV_1__',
        _type: 'environment',
        ...(globals ? { parentId: GLOBAL_ENVIRONMENT_IMPORT_ID } : {}),
        name: name || (globals ? 'Postman Globals' : 'Postman Environment'),
        data: values.reduce((accumulator, { enabled, key, value }) => {
          if (!enabled) {
            return accumulator;
          }
          return {
            ...accumulator,
            [key]: value,
          };
        }, {}),
      },
    ]);
  } catch (error) {
    // Nothing
  }

  return null;
};
