import { describe, expect, it } from '@jest/globals';
import { parse } from 'protobufjs';

import { generateRequestTemplate, mockRequestMethods } from '../automock';

it('mocks simple requests', () => {
  const parsed = parse(`
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

  const service = parsed.root.lookupService('FooService');
  const mocked = mockRequestMethods(service);

  const plain = mocked['Foo']().plain;
  expect(plain).toStrictEqual({
    foo: 'Hello',
  });
});

it('mocks requests with nested objects', () => {
  const parsed = parse(`
    syntax = "proto3";

    message BarBarObject {
        int32 one = 1;
    }

    message BarObject {
        BarBarObject fuzz = 1;
    }

    message FooRequest {
        BarObject bar = 2;
    }

    message FooResponse {
        string foo = 1;
    }

    service FooService {
        rpc Foo (FooRequest) returns (FooResponse);
    }`);

  const service = parsed.root.lookupService('FooService');
  const mocked = mockRequestMethods(service);

  const plain = mocked['Foo']().plain;
  expect(plain).toStrictEqual({
    bar: {
      fuzz: {
        one: 10,
      },
    },
  });
});

it('mocks requests with enums', () => {
  const parsed = parse(`
    syntax = "proto3";

    enum MyEnum {
        MYENUM_UNSPECIFIED = 0;
        MYENUM_A = 1;
        MYENUM_B = 2;
    }

    message FooRequest {
        MyEnum enum = 1;
    }

    message FooResponse {
        string foo = 1;
    }

    service FooService {
        rpc Foo (FooRequest) returns (FooResponse);
    }`);

  const service = parsed.root.lookupService('FooService');
  const mocked = mockRequestMethods(service);

  const plain = mocked['Foo']().plain;
  expect(plain).toStrictEqual({
    enum: 0,
  });
});

it('mocks requests with repeated values', () => {
  const parsed = parse(`
    syntax = "proto3";

    message FooRequest {
        repeated string foo = 1;
    }

    message FooResponse {
        string foo = 1;
    }

    service FooService {
        rpc Foo (FooRequest) returns (FooResponse);
    }`);

  const service = parsed.root.lookupService('FooService');
  const mocked = mockRequestMethods(service);

  const plain = mocked['Foo']().plain;
  expect(plain).toStrictEqual({
    foo: ['Hello'],
  });
});

describe('generateRequestTemplate', () => {
  const svc = (proto: string) => parse(proto).root.lookupService('S');

  it('emits empty/zero defaults for scalars', () => {
    const s = svc(`
      syntax = "proto3";
      message Req { string s = 1; int32 i = 2; double d = 3; bool b = 4; bytes by = 5; }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(generateRequestTemplate(s, 'M')).toStrictEqual({ s: '', i: 0, d: 0, b: false, by: '' });
  });

  it('emits empty arrays for repeated fields', () => {
    const s = svc(`
      syntax = "proto3";
      message Req { repeated string xs = 1; repeated int32 ys = 2; }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(generateRequestTemplate(s, 'M')).toStrictEqual({ xs: [], ys: [] });
  });

  it('emits empty map for map fields', () => {
    const s = svc(`
      syntax = "proto3";
      message Req { map<string, int32> m = 1; }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(generateRequestTemplate(s, 'M')).toStrictEqual({ m: {} });
  });

  it('recurses into nested messages', () => {
    const s = svc(`
      syntax = "proto3";
      message Inner { string name = 1; int32 age = 2; }
      message Req { Inner who = 1; }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(generateRequestTemplate(s, 'M')).toStrictEqual({ who: { name: '', age: 0 } });
  });

  it('uses first option for oneof groups', () => {
    const s = svc(`
      syntax = "proto3";
      message Req { oneof which { string first = 1; int32 second = 2; } }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    const t = generateRequestTemplate(s, 'M') as Record<string, unknown>;
    expect(Object.keys(t)).toContain('first');
    expect(t.first).toBe('');
  });

  it('uses first enum value', () => {
    const s = svc(`
      syntax = "proto3";
      enum E { E_UNSPECIFIED = 0; E_ONE = 1; }
      message Req { E e = 1; }
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(generateRequestTemplate(s, 'M')).toStrictEqual({ e: 0 });
  });

  it('does not infinite-loop on recursive types', () => {
    const s = svc(`
      syntax = "proto3";
      message Node { string name = 1; Node next = 2; }
      message Res {}
      service S { rpc M (Node) returns (Res); }
    `);
    const t = generateRequestTemplate(s, 'M');
    expect(t).toHaveProperty('name');
    expect(t).toHaveProperty('next');
  });

  it('throws on unknown method names', () => {
    const s = svc(`
      syntax = "proto3";
      message Req {}
      message Res {}
      service S { rpc M (Req) returns (Res); }
    `);
    expect(() => generateRequestTemplate(s, 'DoesNotExist')).toThrow(/not found/);
  });
});
