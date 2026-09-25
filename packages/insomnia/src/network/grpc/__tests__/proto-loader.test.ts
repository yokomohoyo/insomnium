import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { addFileFromPath, ProtoLoadResult } from '../proto-loader';

// Settle-or-fail guard so a hang shows up as a test failure instead of a jest timeout.
const within = (promise: Promise<ProtoLoadResult>, ms = 2000) => Promise.race([
  promise,
  new Promise<'timed out'>(resolve => setTimeout(() => resolve('timed out'), ms)),
]);

describe('addFileFromPath', () => {
  let tmpDir: string;

  const writeProto = (relPath: string, body: string) => {
    const filePath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `syntax = "proto3";\n${body}\n`);
    return filePath;
  };

  beforeEach(async () => {
    await globalBeforeEach();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-proto-loader-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a file whose import is missing', async () => {
    const workspace = await models.workspace.create();
    const filePath = writeProto('main.proto', 'import "missing.proto";\nmessage A { string x = 1; }');

    const result = await within(addFileFromPath(filePath, workspace));

    expect(result).toEqual({ success: false, errors: [expect.stringContaining('missing or unreadable proto import')] });
    expect((result as ProtoLoadResult).errors[0]).toContain(path.join(tmpDir, 'missing.proto'));
    expect(await models.protoFile.all()).toHaveLength(0);
  });

  it('does not hang when a type from the missing import is used', async () => {
    const workspace = await models.workspace.create();
    const filePath = writeProto('main.proto', 'import "missing.proto";\nmessage A { Missing m = 1; }');

    const result = await within(addFileFromPath(filePath, workspace));

    expect(result).toEqual({ success: false, errors: [expect.stringContaining('missing or unreadable proto import')] });
  });

  // chmod 000 doesn't stop root from reading, and on Windows only sets read-only
  const cannotLockFiles = process.getuid?.() === 0 || process.platform === 'win32';

  it('rejects a file whose import is unreadable', async () => {
    if (cannotLockFiles) {
      return;
    }
    const workspace = await models.workspace.create();
    const importPath = writeProto('locked.proto', 'message L { string x = 1; }');
    fs.chmodSync(importPath, 0o000);
    const filePath = writeProto('main.proto', 'import "locked.proto";\nmessage A { L l = 1; }');

    const result = await within(addFileFromPath(filePath, workspace));

    expect(result).toEqual({ success: false, errors: [expect.stringContaining('cannot read proto import (EACCES')] });
  });

  it('rejects a file whose import is unreadable in an include dir', async () => {
    if (cannotLockFiles) {
      return;
    }
    const workspace = await models.workspace.create();
    const outer = await models.protoDirectory.create({ name: 'root', parentId: workspace._id });
    const inner = await models.protoDirectory.create({ name: 'pkg', parentId: outer._id });
    fs.chmodSync(writeProto('pkg/dep.proto', 'package pkg;\nmessage Dep { string x = 1; }'), 0o000);
    const filePath = writeProto('pkg/main.proto', 'package pkg;\nimport "pkg/dep.proto";\nmessage A { Dep d = 1; }');

    const result = await within(addFileFromPath(filePath, inner));

    expect(result).toEqual({ success: false, errors: [expect.stringContaining('missing or unreadable proto import')] });
  });

  it('resolves imports through ancestor directories and bundled google types', async () => {
    const workspace = await models.workspace.create();
    const outer = await models.protoDirectory.create({ name: 'root', parentId: workspace._id });
    const inner = await models.protoDirectory.create({ name: 'pkg', parentId: outer._id });
    writeProto('pkg/dep.proto', 'package pkg;\nmessage Dep { string x = 1; }');
    const filePath = writeProto(
      'pkg/main.proto',
      'package pkg;\nimport "pkg/dep.proto";\nimport "google/protobuf/timestamp.proto";\n' +
      'message A { Dep d = 1; google.protobuf.Timestamp t = 2; }',
    );

    const result = await within(addFileFromPath(filePath, inner));

    expect(result).toMatchObject({ success: true, errors: [] });
    expect((result as ProtoLoadResult & { success: true }).loaded[0]).toMatchObject({ name: 'main.proto', parentId: inner._id });
  });
});
