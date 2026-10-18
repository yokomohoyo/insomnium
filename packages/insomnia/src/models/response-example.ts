import { database } from '../common/database';
import type { BaseModel } from '.';

// A saved response to a request: what it should answer. Unlike responses,
// examples are part of the collection, so they're exported and git-synced,
// and the local mock server answers with them.

export const name = 'Response Example';

export const type = 'ResponseExample';

export const prefix = 'ex';

export const canDuplicate = true;

export const canSync = true;

export interface ResponseExampleHeader {
  name: string;
  value: string;
}

export interface BaseResponseExample {
  name: string;
  statusCode: number;
  statusMessage: string;
  headers: ResponseExampleHeader[];
  body: string;
  metaSortKey: number;
}

export type ResponseExample = BaseModel & BaseResponseExample & { type: typeof type };

export const isResponseExample = (model: Pick<BaseModel, 'type'>): model is ResponseExample => (
  model.type === type
);

export const init = (): BaseResponseExample => ({
  name: 'Example',
  statusCode: 200,
  statusMessage: 'OK',
  headers: [],
  body: '',
  metaSortKey: Date.now(),
});

export const migrate = (doc: ResponseExample) => doc;

export const create = (patch: Partial<ResponseExample> = {}) => {
  if (!patch.parentId) {
    throw new Error(`New ResponseExample missing \`parentId\`: ${JSON.stringify(patch)}`);
  }
  return database.docCreate<ResponseExample>(type, patch);
};

export const update = (example: ResponseExample, patch: Partial<ResponseExample> = {}) => database.docUpdate<ResponseExample>(example, patch);

export const remove = (example: ResponseExample) => database.remove(example);

export const getById = (_id: string) => database.getWhere<ResponseExample>(type, { _id });

export const findByParentId = (parentId: string) => database.find<ResponseExample>(type, { parentId }, { metaSortKey: 1 });

export const all = () => database.all<ResponseExample>(type);

export const contentTypeOf = ({ headers }: Pick<ResponseExample, 'headers'>) =>
  headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
