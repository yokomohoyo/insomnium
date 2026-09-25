import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import * as grpcReflection from 'grpc-reflection-js';
import os from 'os';
import path from 'path';
import protobuf from 'protobufjs';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { loadMethods, loadMethodsFromReflection } from '../grpc';

jest.mock('grpc-reflection-js');

describe('loadMethods', () => {
  let tmpDir: string;
  let tmpDirSpy: { mockRestore: () => void };

  // Settle-or-fail guard so a hang shows up as a test failure instead of a jest timeout.
  const settle = (promise: Promise<unknown>, ms = 2000) => Promise.race([
    promise.then(value => ({ value }), error => ({ error: String(error?.message || error) })),
    new Promise(resolve => setTimeout(() => resolve('timed out'), ms)),
  ]);

  beforeEach(async () => {
    await globalBeforeEach();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-grpc-'));
    tmpDirSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    tmpDirSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects instead of hanging when a type cannot be resolved', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({
      parentId: workspace._id,
      protoText: 'syntax = "proto3";\nmessage A { Undefined u = 1; }\nservice S { rpc Call(A) returns (A); }\n',
    });

    const result = await settle(loadMethods(protoFile._id));

    expect(result).toEqual({ error: expect.stringContaining("no such Type or Enum 'Undefined'") });
  });

  it('loads methods from a proto directory written for the first time', async () => {
    const workspace = await models.workspace.create();
    const dir = await models.protoDirectory.create({ name: 'root', parentId: workspace._id });
    await models.protoFile.create({
      name: 'dep.proto',
      parentId: dir._id,
      protoText: 'syntax = "proto3";\npackage pkg;\nmessage Dep { string x = 1; }\n',
    });
    const main = await models.protoFile.create({
      name: 'main.proto',
      parentId: dir._id,
      protoText: 'syntax = "proto3";\npackage pkg;\nimport "dep.proto";\nservice S { rpc Call(Dep) returns (Dep); }\n',
    });

    const result = await settle(loadMethods(main._id));

    expect(result).toEqual({ value: [{ type: 'unary', fullPath: '/pkg.S/Call', example: { x: '' } }] });
  });

  it('returns the same methods to concurrent calls on a proto written for the first time', async () => {
    const expected = { value: [{ type: 'unary', fullPath: '/pkg.S/Call', example: { x: '' } }] };
    for (let i = 0; i < 10; i++) {
      const workspace = await models.workspace.create();
      const single = await models.protoFile.create({
        parentId: workspace._id,
        protoText: 'syntax = "proto3";\npackage pkg;\nmessage Dep { string x = 1; }\nservice S { rpc Call(Dep) returns (Dep); }\n',
      });
      const dir = await models.protoDirectory.create({ name: 'root', parentId: workspace._id });
      await models.protoFile.create({
        name: 'dep.proto',
        parentId: dir._id,
        protoText: 'syntax = "proto3";\npackage pkg;\nmessage Dep { string x = 1; }\n',
      });
      const main = await models.protoFile.create({
        name: 'main.proto',
        parentId: dir._id,
        protoText: 'syntax = "proto3";\npackage pkg;\nimport "dep.proto";\nservice S { rpc Call(Dep) returns (Dep); }\n',
      });

      for (const id of [single._id, main._id]) {
        const results = await Promise.all([1, 2, 3].map(() => settle(loadMethods(id))));

        expect(results).toEqual([expected, expected, expected]);
      }
    }
  });
});

describe('loadMethodsFromReflection', () => {
  beforeEach(globalBeforeEach);

  describe('one service reflection', () => {
    beforeEach(() => {
      globalBeforeEach();
      // we want to test that the values that are passed to axios are returned in the config key
      (grpcReflection.Client as unknown as jest.Mock).mockImplementation(() => ({
        listServices: () => Promise.resolve(['FooService']),
        fileContainingSymbol: async () => {
          const parsed = protobuf.parse(`
            syntax = "proto3";

            message FooRequest {
                string foo = 1;
            }

            message FooResponse {
                string foo = 1;
            }

            service FooService {
                rpc Foo (FooRequest) returns (FooResponse);
            }`);
          return parsed.root;
        },
      }));
    });

    it('parses methods', async () => {
      const methods = await loadMethodsFromReflection({ url: 'foo.com', metadata: [] });
      expect(methods).toStrictEqual([{
        type: 'unary',
        fullPath: '/FooService/Foo',
        example: {
          foo: '',
        },
      }]);
    });
  });

  describe('format service reflection', () => {
    beforeEach(() => {
      globalBeforeEach();
      // we want to test that the values that are passed to axios are returned in the config key
      (grpcReflection.Client as unknown as jest.Mock).mockImplementation(() => ({
        listServices: () => Promise.resolve(['FooService']),
        fileContainingSymbol: async () => {
          const parsed = protobuf.parse(`
            syntax = "proto3";

            message FooRequest {
                string foo = 1;
            }

            message FooResponse {
                string foo = 1;
            }

            service FooService {
                rpc format (FooRequest) returns (FooResponse);
            }`);
          return parsed.root;
        },
      }));
    });

    it('parses methods', async () => {
      const methods = await loadMethodsFromReflection({ url: 'foo.com', metadata: [] });
      expect(methods).toStrictEqual([{
        type: 'unary',
        fullPath: '/FooService/format',
        example: {
          foo: '',
        },
      }]);
    });
  });

  describe('multiple service reflection', () => {
    beforeEach(() => {
      globalBeforeEach();
      // we want to test that the values that are passed to axios are returned in the config key
      (grpcReflection.Client as unknown as jest.Mock).mockImplementation(() => ({
        listServices: () => Promise.resolve(['FooService', 'BarService']),
        fileContainingSymbol: async () => {
          const parsed = protobuf.parse(`
            syntax = "proto3";

            message FooRequest {
                string foo = 1;
            }

            message FooResponse {
                string foo = 1;
            }

            message BarRequest {
                string bar = 1;
            }

            message BarResponse {
                string bar = 1;
            }

            service FooService {
                rpc Foo (FooRequest) returns (FooResponse);
            }

            service BarService {
                rpc Bar (BarRequest) returns (BarResponse);
            }`);
          return parsed.root;
        },
      }));
    });

    it('parses methods', async () => {
      const methods = await loadMethodsFromReflection({ url: 'foo-bar.com', metadata: [] });
      expect(methods).toStrictEqual([{
        type: 'unary',
        fullPath: '/FooService/Foo',
        example: {
          foo: '',
        },
      }, {
        type: 'unary',
        fullPath: '/BarService/Bar',
        example: {
          bar: '',
        },
      }]);
    });
  });

});
