import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import { SpyInstance } from 'jest-mock';
import os from 'os';
import path from 'path';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import {
  assertSafeNameSegment,
  assertWithinRoot,
  writeProtoFile,
} from '../write-proto-file';

describe('writeProtoFile', () => {
  let existsSyncSpy: SpyInstance<any>;
  let tmpDirSpy: SpyInstance<any>;
  let writeFileSpy: SpyInstance<any>;

  const _setupSpies = () => {
    existsSyncSpy = jest.spyOn(fs, 'existsSync');
    tmpDirSpy = jest.spyOn(os, 'tmpdir');
    writeFileSpy = jest.spyOn(fs.promises, 'writeFile');
  };

  const _configureSpies = (tmpDir: string, exists: boolean) => {
    existsSyncSpy.mockReturnValue(exists);
    tmpDirSpy.mockReturnValue(tmpDir);
    writeFileSpy.mockResolvedValue(undefined);
  };

  const _restoreSpies = () => {
    existsSyncSpy.mockRestore();
    tmpDirSpy.mockRestore();
    writeFileSpy.mockRestore();
  };

  beforeEach(async () => {
    await globalBeforeEach();

    // Spies should be setup AFTER globalBeforeEach()
    _setupSpies();
  });

  afterEach(() => {
    _restoreSpies();

    jest.resetAllMocks();
  });

  describe('individual files', () => {
    it('can write individual file', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pf = await models.protoFile.create({
        parentId: w._id,
        protoText: 'text',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, false); // file doesn't already exist

      // Act
      const result = await writeProtoFile(pf);
      // Assert
      const expectedDir = path.join(tmpDirPath, 'insomnia-grpc');
      const expectedFileName = `${pf._id}.${pf.modified}.proto`;
      const expectedFullPath = path.join(expectedDir, expectedFileName);
      expect(result.filePath).toEqual(expectedFileName);
      expect(result.dirs).toEqual([expectedDir]);
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath);
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath, pf.protoText);
    });

    it('doesnt write individual file if it already exists', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pf = await models.protoFile.create({
        parentId: w._id,
        protoText: 'text',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, true); // file already exists

      // Act
      const result = await writeProtoFile(pf);
      // Assert
      const expectedDir = path.join(tmpDirPath, 'insomnia-grpc');
      const expectedFileName = `${pf._id}.${pf.modified}.proto`;
      const expectedFullPath = path.join(expectedDir, expectedFileName);
      expect(result.filePath).toEqual(expectedFileName);
      expect(result.dirs).toEqual([expectedDir]);
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath);
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('writes individual file when forced, even if it already exists', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pf = await models.protoFile.create({
        parentId: w._id,
        protoText: 'text',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, true); // file already exists

      // Act
      const result = await writeProtoFile(pf, true);
      // Assert
      const expectedDir = path.join(tmpDirPath, 'insomnia-grpc');
      const expectedFileName = `${pf._id}.${pf.modified}.proto`;
      const expectedFullPath = path.join(expectedDir, expectedFileName);
      expect(result.filePath).toEqual(expectedFileName);
      expect(result.dirs).toEqual([expectedDir]);
      expect(existsSyncSpy).not.toHaveBeenCalledWith(expectedFullPath); // Not called because of the force flag
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath, pf.protoText);
    });
  });

  describe('nested files', () => {
    it('can write file contained in a single folder', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pd = await models.protoDirectory.create({
        parentId: w._id,
        name: 'dirName',
      });
      const pf = await models.protoFile.create({
        parentId: pd._id,
        name: 'hello.proto',
        protoText: 'text',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, false); // file doesn't already exist

      // Act
      const result = await writeProtoFile(pf);
      // Assert
      const expectedRootDir = path.join(
        tmpDirPath,
        'insomnia-grpc',
        `${pd._id}.${pd.modified}`,
        pd.name,
      );
      const expectedFilePath = pf.name;
      const expectedFullPath = path.join(expectedRootDir, expectedFilePath);
      expect(result.filePath).toEqual(expectedFilePath);
      expect(result.dirs).toEqual([expectedRootDir]);
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath);
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath, pf.protoText);
    });

    it('can write files contained in nested folders', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pdRoot = await models.protoDirectory.create({
        parentId: w._id,
        name: 'rootDir',
      });
      const pdNested = await models.protoDirectory.create({
        parentId: pdRoot._id,
        name: 'nestedDir',
      });
      const pfRoot = await models.protoFile.create({
        parentId: pdRoot._id,
        name: 'root.proto',
        protoText: 'root',
      });
      const pfNested = await models.protoFile.create({
        parentId: pdNested._id,
        name: 'nested.proto',
        protoText: 'nested',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, false); // files don't already exist

      // Act
      const result = await writeProtoFile(pfNested);
      // Assert
      const expectedRootDir = path.join(
        tmpDirPath,
        'insomnia-grpc',
        `${pdRoot._id}.${pdRoot.modified}`,
        pdRoot.name,
      );
      const expectedNestedDir = path.join(expectedRootDir, pdNested.name);
      const expectedFilePath = {
        root: pfRoot.name,
        nested: path.join(pdNested.name, pfNested.name),
      };
      const expectedFullPath = {
        root: path.join(expectedRootDir, expectedFilePath.root),
        nested: path.join(expectedRootDir, expectedFilePath.nested),
      };
      expect(result.filePath).toEqual(expectedFilePath.nested);
      expect(result.dirs).toEqual([expectedRootDir, expectedNestedDir]);
      // Root folder should be created and written to
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath.root);
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath.root, pfRoot.protoText);
      // Nested folder should be created and written to
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath.nested);
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath.nested, pfNested.protoText);
    });

    it('should not write file if it already exists', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pdRoot = await models.protoDirectory.create({
        parentId: w._id,
        name: 'rootDir',
      });
      const pdNested = await models.protoDirectory.create({
        parentId: pdRoot._id,
        name: 'nestedDir',
      });
      const pfRoot = await models.protoFile.create({
        parentId: pdRoot._id,
        name: 'root.proto',
        protoText: 'root',
      });
      const pfNested = await models.protoFile.create({
        parentId: pdNested._id,
        name: 'nested.proto',
        protoText: 'nested',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, true); // files already exists

      // Act
      const result = await writeProtoFile(pfNested);
      // Assert
      const expectedRootDir = path.join(
        tmpDirPath,
        'insomnia-grpc',
        `${pdRoot._id}.${pdRoot.modified}`,
        pdRoot.name,
      );
      const expectedNestedDir = path.join(expectedRootDir, pdNested.name);
      const expectedFilePath = {
        root: pfRoot.name,
        nested: path.join(pdNested.name, pfNested.name),
      };
      const expectedFullPath = {
        root: path.join(expectedRootDir, expectedFilePath.root),
        nested: path.join(expectedRootDir, expectedFilePath.nested),
      };
      expect(result.filePath).toEqual(expectedFilePath.nested);
      expect(result.dirs).toEqual([expectedRootDir, expectedNestedDir]);
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath.root);
      expect(existsSyncSpy).toHaveBeenCalledWith(expectedFullPath.nested);
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('refuses to write when a directory name contains path traversal', async () => {
      const w = await models.workspace.create();
      const pdRoot = await models.protoDirectory.create({
        parentId: w._id,
        name: '../../escape',
      });
      const pf = await models.protoFile.create({
        parentId: pdRoot._id,
        name: 'evil.proto',
        protoText: 'attacker-controlled',
      });
      _configureSpies(path.join('.', 'foo', 'bar', 'baz'), false);

      await expect(writeProtoFile(pf)).rejects.toThrow(/Invalid proto directory name/);
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('refuses to write when a file name contains a path separator', async () => {
      const w = await models.workspace.create();
      const pdRoot = await models.protoDirectory.create({
        parentId: w._id,
        name: 'rootDir',
      });
      const pf = await models.protoFile.create({
        parentId: pdRoot._id,
        name: '../../etc/passwd',
        protoText: 'attacker-controlled',
      });
      _configureSpies(path.join('.', 'foo', 'bar', 'baz'), false);

      await expect(writeProtoFile(pf)).rejects.toThrow(/Invalid proto file name/);
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('should write file when forced, even if it already exists', async () => {
      // Arrange
      const w = await models.workspace.create();
      const pdRoot = await models.protoDirectory.create({
        parentId: w._id,
        name: 'rootDir',
      });
      const pdNested = await models.protoDirectory.create({
        parentId: pdRoot._id,
        name: 'nestedDir',
      });
      const pfRoot = await models.protoFile.create({
        parentId: pdRoot._id,
        name: 'root.proto',
        protoText: 'root',
      });
      const pfNested = await models.protoFile.create({
        parentId: pdNested._id,
        name: 'nested.proto',
        protoText: 'nested',
      });
      const tmpDirPath = path.join('.', 'foo', 'bar', 'baz');

      _configureSpies(tmpDirPath, true); // files already exists

      // Act
      const result = await writeProtoFile(pfNested, true);
      // Assert
      const expectedRootDir = path.join(
        tmpDirPath,
        'insomnia-grpc',
        `${pdRoot._id}.${pdRoot.modified}`,
        pdRoot.name,
      );
      const expectedNestedDir = path.join(expectedRootDir, pdNested.name);
      const expectedFilePath = {
        root: pfRoot.name,
        nested: path.join(pdNested.name, pfNested.name),
      };
      const expectedFullPath = {
        root: path.join(expectedRootDir, expectedFilePath.root),
        nested: path.join(expectedRootDir, expectedFilePath.nested),
      };
      expect(result.filePath).toEqual(expectedFilePath.nested);
      expect(result.dirs).toEqual([expectedRootDir, expectedNestedDir]);
      expect(existsSyncSpy).not.toHaveBeenCalledWith(expectedFullPath.root); // Not called due to force flag
      expect(existsSyncSpy).not.toHaveBeenCalledWith(expectedFullPath.nested); // Not called due to force flag
      expect(writeFileSpy).toHaveBeenCalledWith(expectedFullPath.nested, pfNested.protoText);
    });
  });
});

describe('assertSafeNameSegment', () => {
  it.each(['service.proto', 'subdir', 'my-service_v2.proto', 'a', 'a.b.c.proto'])(
    'allows valid name %p',
    name => {
      expect(() => assertSafeNameSegment(name, 'proto file')).not.toThrow();
    },
  );

  it.each([
    '..',
    '.',
    '../etc',
    '../../passwd',
    'foo/bar',
    'foo\\bar',
    '/abs/path',
    'foo\0bar',
    '',
  ])('rejects malicious / malformed name %p', name => {
    expect(() => assertSafeNameSegment(name, 'proto file')).toThrow(/Invalid proto file name/);
  });

  it('rejects non-string input', () => {
    expect(() => assertSafeNameSegment(undefined as unknown as string, 'proto directory')).toThrow();
  });

  it('uses the kind label in the error message', () => {
    expect(() => assertSafeNameSegment('../escape', 'proto directory')).toThrow(/Invalid proto directory name/);
  });
});

describe('assertWithinRoot', () => {
  const root = path.join('/tmp', 'insomnia-grpc', 'abc.123');

  it('allows a child inside the root', () => {
    expect(() => assertWithinRoot(root, path.join(root, 'service.proto'))).not.toThrow();
    expect(() => assertWithinRoot(root, path.join(root, 'sub', 'service.proto'))).not.toThrow();
  });

  it('rejects a sibling of the root', () => {
    expect(() => assertWithinRoot(root, path.join('/tmp', 'insomnia-grpc', 'evil'))).toThrow(/escapes parent/);
  });

  it('rejects a parent escape', () => {
    expect(() => assertWithinRoot(root, path.join('/tmp', 'evil'))).toThrow(/escapes parent/);
  });

  it('rejects an absolute path outside root', () => {
    expect(() => assertWithinRoot(root, '/etc/passwd')).toThrow(/escapes parent/);
  });
});
