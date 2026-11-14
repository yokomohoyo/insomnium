import { createBuilder } from '@develohpanda/fluent-builder';
import { describe, expect, it } from '@jest/globals';

import { baseModelSchema, workspaceModelSchema } from '../../models/__schemas__/model-schemas';
import { resetKeys } from '../ignore-keys';

const baseModelBuilder = createBuilder(baseModelSchema);
const workspaceModelBuilder = createBuilder(workspaceModelSchema);

describe('resetKeys', () => {
  it('should clear parentId from the workspace', () => {
    const base = baseModelBuilder._id('123').parentId('abc').build();
    const workspace = workspaceModelBuilder._id('123').parentId('abc').build();

    resetKeys(base);
    resetKeys(workspace);

    // Don't reset _id
    expect(base._id).toBe('123');
    expect(workspace._id).toBe('123');

    // Do reset parentId for a workspace
    expect(base.parentId).toBe('abc');
    expect(workspace.parentId).toBeNull();
  });
});
