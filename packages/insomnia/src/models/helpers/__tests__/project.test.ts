import { describe, expect, it } from '@jest/globals';

import { DEFAULT_PROJECT_ID } from '../../project';
import { sortProjects } from '../project';

const defaultProject = { name: 'b', _id: DEFAULT_PROJECT_ID };

const a = { name: 'a', _id: 'projA' };
const b = { name: 'b', _id: 'projB' };
const zero = { name: '0', _id: 'proj0' };

describe('sortProjects', () => {
  it('sorts the default project first, then the rest by name', () => {
    // @ts-expect-error -- just the fields sorting reads
    expect(sortProjects([b, defaultProject, a, zero])).toEqual([defaultProject, zero, a, b]);
  });
});
