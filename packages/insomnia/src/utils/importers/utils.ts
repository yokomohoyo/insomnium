import { ImportRequest } from './entities';

export const setDefaults = (obj: ImportRequest | null) => {
  if (!obj || !obj._type) {
    return obj;
  }

  switch (obj._type) {
    case 'request': {
      const merged: any = {
        parentId: '__WORKSPACE_ID__',
        name: 'Imported',
        url: '',
        body: '',
        parameters: [],
        headers: [],
        authentication: [],
        ...obj,
        method: (obj.method || 'GET').toUpperCase(),
      };
      // Multi-auth: importers may still emit legacy single-object auth.
      // Wrap as a 1-element array; treat empty/all-undefined as [].
      const auth = merged.authentication;
      if (auth && !Array.isArray(auth)) {
        const hasMeaningfulFields = Object.values(auth).some(v => v !== undefined && v !== null);
        merged.authentication = hasMeaningfulFields ? [auth] : [];
      }
      return merged;
    }

    case 'request_group':
      return {
        parentId: '__WORKSPACE_ID__',
        name: 'Imported',
        environment: {},
        ...obj,
      };

    case 'environment':
      return {
        parentId: '__BASE_ENVIRONMENT_ID__',
        name: 'Imported Environment',
        data: {},
        ...obj,
      };

    default:
      return obj;
  }
};

export const unthrowableParseJson = (rawData: string) => {
  try {
    return JSON.parse(rawData);
  } catch (err) {
    return null;
  }
};
