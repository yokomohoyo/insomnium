import * as protoLoader from '@grpc/proto-loader';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import * as grpcReflection from 'grpc-reflection-js';
import os from 'os';
import path from 'path';
import protobuf from 'protobufjs';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { largeProtoText, longestStallDuring } from '../../../__jest__/proto-worker';
import * as models from '../../../models';
import type { GrpcRequest } from '../../../models/grpc-request';
import { writeProtoFile } from '../../../network/grpc/write-proto-file';
import { grpcOptions } from '../../proto-worker';
import { getSelectedMethod, loadMethods, loadMethodsFromReflection } from '../grpc';

jest.mock('grpc-reflection-js');
jest.mock('worker_threads', () => (jest.requireActual('../../../__jest__/proto-worker') as { workerThreads: unknown }).workerThreads);

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

  it('keeps the event loop running while a large proto is parsed', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({ parentId: workspace._id, protoText: largeProtoText() });

    const { result, elapsed, longestStall } = await longestStallDuring(() => loadMethods(protoFile._id));

    expect(result).toMatchObject([{ type: 'unary', fullPath: '/big.S/Call' }]);
    expect(longestStall).toBeLessThan(elapsed / 4);
  }, 30000);

  it('sends the worker\'s logs and warnings to the main thread\'s console, which goes to the log file', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const workspace = await models.workspace.create();
      const broken = await models.protoFile.create({
        parentId: workspace._id,
        protoText: 'syntax = "proto3";\nimport "nowhere.proto";\nmessage A { string x = 1; }\n',
      });
      const valid = await models.protoFile.create({
        parentId: workspace._id,
        protoText: 'syntax = "proto3";\nmessage A { string x = 1; }\nservice S { rpc Call(A) returns (A); }\n',
      });

      await expect(loadMethods(broken._id)).rejects.toThrow('nowhere.proto');
      await loadMethods(valid._id);

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Warning: nowhere\.proto not found in any of the include paths/));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[grpc-template\] loading .* with includeDirs/));
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('getSelectedMethod', () => {
  let tmpDir: string;
  let tmpDirSpy: { mockRestore: () => void };

  const request = (protoFileId: string, protoMethodName: string) => (
    { _id: 'greq_1', protoFileId, protoMethodName, url: '', metadata: [] } as unknown as GrpcRequest
  );

  beforeEach(async () => {
    await globalBeforeEach();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-grpc-'));
    tmpDirSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    tmpDirSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds the same serializers as proto-loader does from the whole file', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({
      parentId: workspace._id,
      protoText: `syntax = "proto2";
        package mixed;
        import "google/protobuf/timestamp.proto";
        message Outer {
          message Inner {
            optional int32 a = 1 [default = 7];
            repeated int32 unpacked = 2;
            repeated int32 packed = 3 [packed = true];
            optional Color color = 4 [default = BLUE];
            extensions 100 to 199;
          }
          enum Color {
            option allow_alias = true;
            RED = 0;
            CRIMSON = 0;
            BLUE = 1;
            NAVY = 1;
          }
          required string name = 1;
          optional Inner inner = 2;
          repeated group Item = 3 {
            optional string label = 4;
            optional sint64 weight = 5;
          }
          map<string, Inner> by_name = 6;
          oneof choice {
            string text = 7;
            Color hue = 8;
          }
          optional google.protobuf.Timestamp at = 9;
          extend Inner {
            optional string scoped_ext = 100;
          }
        }
        extend Outer.Inner {
          optional int64 file_ext = 101;
        }
        message Reply {
          optional Outer outer = 1;
          optional Outer.Color first = 2;
        }
        message Unrelated { optional string x = 1; }
        service P2 {
          rpc Call(Outer) returns (Reply);
          rpc Other(Unrelated) returns (Unrelated);
        }
      `,
    });
    const outer = {
      name: 'n',
      inner: { a: 3, unpacked: [1, 2], packed: [3, 4], color: 'NAVY', '.mixed.Outer.scoped_ext': 's', '.mixed.file_ext': '9007199254740993' },
      item: [{ label: 'l', weight: '-9007199254740993' }],
      by_name: { k: { a: 1 } },
      hue: 'CRIMSON',
      at: { seconds: '1', nanos: 2 },
    };

    const method = await getSelectedMethod(request(protoFile._id, '/mixed.P2/Call'));

    const { filePath, dirs } = await writeProtoFile(protoFile);
    const expected = (protoLoader.loadSync(filePath, { ...grpcOptions, includeDirs: dirs })['mixed.P2'] as protoLoader.ServiceDefinition).Call;
    const reply = expected.responseSerialize({ outer, first: 'BLUE' });
    expect(method).toMatchObject({ path: '/mixed.P2/Call', requestStream: false, responseStream: false });
    expect(method?.requestSerialize(outer)).toEqual(expected.requestSerialize(outer));
    expect(method?.responseDeserialize(reply)).toEqual(expected.responseDeserialize(reply));
    expect(method?.responseDeserialize(Buffer.alloc(0))).toEqual(expected.responseDeserialize(Buffer.alloc(0)));
    expect(method?.responseDeserialize(Buffer.alloc(0))).toMatchObject({ first: 'RED' });
  });

  it('returns undefined for a method the proto file does not have', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({
      parentId: workspace._id,
      protoText: 'syntax = "proto3";\npackage pkg;\nmessage A { string x = 1; }\nservice S { rpc Call(A) returns (A); }\n',
    });

    expect(await getSelectedMethod(request(protoFile._id, '/pkg.S/Missing'))).toBeUndefined();
    expect(await getSelectedMethod(request(protoFile._id, '/pkg.A/Call'))).toBeUndefined();
    expect(await getSelectedMethod(request(protoFile._id, '/pkg.S/Call'))).toMatchObject({ path: '/pkg.S/Call' });
  });

  it('rejects when a type cannot be resolved', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({
      parentId: workspace._id,
      protoText: 'syntax = "proto3";\nmessage A { Undefined u = 1; }\nservice S { rpc Call(A) returns (A); }\n',
    });

    await expect(getSelectedMethod(request(protoFile._id, '/S/Call'))).rejects.toThrow("no such Type or Enum 'Undefined'");
  });

  it('keeps the event loop running while a large proto is parsed', async () => {
    const workspace = await models.workspace.create();
    const protoFile = await models.protoFile.create({ parentId: workspace._id, protoText: largeProtoText() });

    const { result, elapsed, longestStall } = await longestStallDuring(() => getSelectedMethod(request(protoFile._id, '/big.S/Call')));

    expect(result).toMatchObject({ path: '/big.S/Call', requestStream: false, responseStream: false });
    expect(longestStall).toBeLessThan(elapsed / 4);
  }, 30000);
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
