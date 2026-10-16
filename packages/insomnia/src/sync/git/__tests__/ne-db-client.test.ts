import { createBuilder } from '@develohpanda/fluent-builder';
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'path';
import YAML from 'yaml';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { database as db } from '../../../common/database';
import * as models from '../../../models';
import { workspaceModelSchema } from '../../../models/__schemas__/model-schemas';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INSOMNIA_DIR_NAME } from '../git-vcs';
import { MemClient } from '../mem-client';
import { importClonedDocs, NeDBClient, readClonedDocs } from '../ne-db-client';
import { assertAsyncError, setupDateMocks } from './util';

const workspaceBuilder = createBuilder(workspaceModelSchema);

describe('NeDBClient', () => {
  afterAll(() => jest.restoreAllMocks());
  beforeEach(async () => {
    await globalBeforeEach();
    workspaceBuilder.reset();
    setupDateMocks();
    // Create some sample models
    await models.project.all();
    await models.workspace.create({
      _id: 'wrk_1',
    });
    await models.request.create({
      _id: 'req_1',
      parentId: 'wrk_1',
    });
    await models.request.create({
      _id: 'req_2',
      parentId: 'wrk_1',
    });
    // Shouldn't list private docs
    await models.request.create({
      _id: 'req_x',
      isPrivate: true,
      parentId: 'wrk_1',
    });
  });

  describe('readdir()', () => {
    it('reads model IDs from model type folders', async () => {
      const neDbClient = new NeDBClient('wrk_1', DEFAULT_PROJECT_ID);
      const reqDir = path.join(GIT_INSOMNIA_DIR, models.request.type);
      const wrkDir = path.join(GIT_INSOMNIA_DIR, models.workspace.type);
      expect(await neDbClient.readdir(GIT_CLONE_DIR)).toEqual([GIT_INSOMNIA_DIR_NAME]);
      expect(await neDbClient.readdir(GIT_INSOMNIA_DIR)).toEqual([
        models.apiSpec.type,
        models.environment.type,
        models.grpcRequest.type,
        models.protoDirectory.type,
        models.protoFile.type,
        models.request.type,
        models.requestGroup.type,
        models.unitTest.type,
        models.unitTestSuite.type,
        models.webSocketPayload.type,
        models.webSocketRequest.type,
        models.workspace.type,
      ]);
      expect(await neDbClient.readdir(reqDir)).toEqual(['req_1.yml', 'req_2.yml']);
      expect(await neDbClient.readdir(wrkDir)).toEqual(['wrk_1.yml']);
    });
  });

  describe('readFile()', () => {
    it('reads file from model/id folders', async () => {
      const wrk1Yml = path.join(GIT_INSOMNIA_DIR, models.workspace.type, 'wrk_1.yml');
      const req1Yml = path.join(GIT_INSOMNIA_DIR, models.request.type, 'req_1.yml');
      const reqXYml = path.join(GIT_INSOMNIA_DIR, models.request.type, 'req_x.yml');
      const pNeDB = new NeDBClient('wrk_1', DEFAULT_PROJECT_ID);
      expect(YAML.parse((await pNeDB.readFile(wrk1Yml, 'utf8')).toString())).toEqual(
        expect.objectContaining({
          _id: 'wrk_1',
          parentId: null, // should be reset to default value instead of the active project id
        }),
      );
      expect(YAML.parse((await pNeDB.readFile(req1Yml, 'utf8')).toString())).toEqual(
        expect.objectContaining({
          _id: 'req_1',
          parentId: 'wrk_1',
        }),
      );
      await assertAsyncError(pNeDB.readFile(reqXYml));
    });
  });

  describe('stat()', () => {
    it('stats a dir', async () => {
      // Arrange
      const reqDir = path.join(GIT_INSOMNIA_DIR, models.request.type);
      const wrkDir = path.join(GIT_INSOMNIA_DIR, models.workspace.type);
      const dirType = expect.objectContaining({
        type: 'dir',
      });
      const fileType = expect.objectContaining({
        type: 'file',
      });
      // Act
      const neDbClient = new NeDBClient('wrk_1', DEFAULT_PROJECT_ID);
      // Assert
      expect(await neDbClient.stat(GIT_CLONE_DIR)).toEqual(dirType);
      expect(await neDbClient.stat(GIT_INSOMNIA_DIR)).toEqual(dirType);
      expect(await neDbClient.stat(reqDir)).toEqual(dirType);
      expect(await neDbClient.stat(path.join(wrkDir, 'wrk_1.yml'))).toEqual(fileType);
      expect(await neDbClient.stat(path.join(reqDir, 'req_2.yml'))).toEqual(fileType);
    });
  });

  describe('writeFile()', () => {
    it('should ignore files not in GIT_INSOMNIA_DIR directory', async () => {
      // Arrange
      const upsertSpy = jest.spyOn(db, 'upsert');
      const workspaceId = 'wrk_1';
      const neDbClient = new NeDBClient(workspaceId, DEFAULT_PROJECT_ID);
      const env = {
        _id: 'env_1',
        type: models.environment.type,
        parentId: workspaceId,
      };
      const filePath = path.join('anotherDir', env.type, `${env._id}.yml`);
      // Act
      await neDbClient.writeFile(filePath, YAML.stringify(env));
      // Assert
      expect(upsertSpy).not.toBeCalled();
      // Cleanup
      upsertSpy.mockRestore();
    });

    it('should write files in GIT_INSOMNIA_DIR directory to db', async () => {
      // Arrange
      const workspaceId = 'wrk_1';
      const neDbClient = new NeDBClient(workspaceId, DEFAULT_PROJECT_ID);
      const upsertSpy = jest.spyOn(db, 'upsert');
      const env = {
        _id: 'env_1',
        type: models.environment.type,
        parentId: workspaceId,
      };
      const filePath = path.join(GIT_INSOMNIA_DIR, env.type, `${env._id}.yml`);
      // Act
      await neDbClient.writeFile(filePath, YAML.stringify(env));
      // Assert
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      expect(upsertSpy).toHaveBeenCalledWith(env, true);
      // Cleanup
      upsertSpy.mockRestore();
    });

    it('should set workspace parentId to the project', async () => {
      // Arrange
      const workspaceId = 'wrk_1';
      const projectId = `${models.project.prefix}_1`;
      const neDbClient = new NeDBClient(workspaceId, projectId);
      const upsertSpy = jest.spyOn(db, 'upsert');

      // @ts-expect-error not sure why scope is being typed as never
      workspaceBuilder._id(workspaceId).scope('design').certificates(null);

      // @ts-expect-error parentId can be string or null for a workspace
      const workspaceInFile = workspaceBuilder.parentId(null).build();
      const workspaceInDb = workspaceBuilder.parentId(projectId).build();

      const filePath = path.join(GIT_INSOMNIA_DIR, models.workspace.type, `${workspaceId}.yml`);

      // Act
      await neDbClient.writeFile(filePath, YAML.stringify(workspaceInFile));

      // Assert
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      expect(upsertSpy).toHaveBeenCalledWith(workspaceInDb, true);

      // Cleanup
      upsertSpy.mockRestore();
    });

    it('should throw error if id does not match', async () => {
      // Arrange
      const workspaceId = 'wrk_1';
      const neDbClient = new NeDBClient(workspaceId, DEFAULT_PROJECT_ID);
      const env = {
        _id: 'env_1',
        type: models.environment.type,
        parentId: workspaceId,
      };
      const filePath = path.join(GIT_INSOMNIA_DIR, env.type, 'env_2.yml');
      // Act
      const promiseResult = neDbClient.writeFile(filePath, YAML.stringify(env));
      // Assert
      await expect(promiseResult).rejects.toThrowError(
        'Doc _id does not match file path [env_1 != env_2]',
      );
    });

    it.each([
      models.settings.type,
      models.gitRepository.type,
      models.oAuth2Token.type,
      models.clientCertificate.type,
      models.caCertificate.type,
      models.pluginData.type,
      models.workspaceMeta.type,
      models.project.type,
    ])('should ignore a %s, which Git Sync never writes', async type => {
      const upsertSpy = jest.spyOn(db, 'upsert');
      const neDbClient = new NeDBClient('wrk_1', DEFAULT_PROJECT_ID);
      const doc = { _id: 'x_1', type, parentId: null, created: 0, validateSSL: false, proxyEnabled: true };
      await neDbClient.writeFile(path.join(GIT_INSOMNIA_DIR, type, 'x_1.yml'), YAML.stringify(doc));
      expect(upsertSpy).not.toBeCalled();
      expect(await db.get(type, 'x_1')).toBeFalsy();
      upsertSpy.mockRestore();
    });

    describe('does not touch other workspaces', () => {
      const write = (doc: { _id: string; type: string; parentId: string | null; name?: string }) =>
        new NeDBClient('wrk_1', DEFAULT_PROJECT_ID).writeFile(path.join(GIT_INSOMNIA_DIR, doc.type, `${doc._id}.yml`), YAML.stringify(doc));
      beforeEach(async () => {
        await models.workspace.create({ _id: 'wrk_2', name: 'other' });
        await models.requestGroup.create({ _id: 'fld_2', parentId: 'wrk_2' });
        await models.request.create({ _id: 'req_2b', parentId: 'fld_2', name: 'theirs' });
      });

      it('ignores a doc whose _id is not its type\'s', async () => {
        const settings = await models.settings.getOrCreate();
        await write({ _id: settings._id, type: models.request.type, parentId: 'wrk_1' });
        expect(await db.get(models.settings.type, settings._id)).toEqual(expect.objectContaining({ type: models.settings.type }));
      });

      it('ignores another workspace\'s Workspace', async () => {
        await write({ _id: 'wrk_2', type: models.workspace.type, parentId: null, name: 'replaced' });
        expect((await models.workspace.getById('wrk_2'))?.name).toBe('other');
      });

      it('does not overwrite a doc that lives in another workspace', async () => {
        await write({ _id: 'req_2b', type: models.request.type, parentId: 'wrk_1', name: 'replaced' });
        expect(await models.request.getById('req_2b')).toEqual(expect.objectContaining({ parentId: 'fld_2', name: 'theirs' }));
      });

      it('does not put a new doc under another workspace', async () => {
        await write({ _id: 'req_new', type: models.request.type, parentId: 'fld_2' });
        expect(await models.request.getById('req_new')).toBeFalsy();
      });

      it('still writes this workspace\'s docs', async () => {
        await write({ _id: 'req_1', type: models.request.type, parentId: 'wrk_1', name: 'updated' });
        await write({ _id: 'req_new', type: models.request.type, parentId: 'wrk_1' });
        expect((await models.request.getById('req_1'))?.name).toBe('updated');
        expect(await models.request.getById('req_new')).toBeTruthy();
      });
    });

    it('should throw error if type does not match', async () => {
      // Arrange
      const workspaceId = 'wrk_1';
      const neDbClient = new NeDBClient(workspaceId, DEFAULT_PROJECT_ID);
      const env = {
        _id: 'env_1',
        type: models.environment.type,
        parentId: workspaceId,
      };
      const filePath = path.join(GIT_INSOMNIA_DIR, models.request.type, `${env._id}.yml`);
      // Act
      const promiseResult = neDbClient.writeFile(filePath, YAML.stringify(env));
      // Assert
      await expect(promiseResult).rejects.toThrowError(
        'Doc type does not match file path [Environment != Request]',
      );
    });
  });

  describe('readClonedDocs()', () => {
    it('keeps only synced documents that are in their type folder and named by their _id', async () => {
      const fsClient = MemClient.createClient();
      const write = async (type: string, fileName: string, doc: object) => {
        await fsClient.promises.mkdir(path.join(GIT_INSOMNIA_DIR, type), { recursive: true });
        await fsClient.promises.writeFile(path.join(GIT_INSOMNIA_DIR, type, fileName), YAML.stringify(doc));
      };
      const workspace = { _id: 'wrk_9', type: models.workspace.type, name: 'cloned' };
      const request = { _id: 'req_9', type: models.request.type, parentId: 'wrk_9' };
      await write(models.workspace.type, 'wrk_9.yml', workspace);
      await write(models.request.type, 'req_9.yml', request);
      // not synced types
      await write(models.settings.type, 'set_9.yml', { _id: 'set_9', type: models.settings.type, created: 0, validateSSL: false });
      await write(models.caCertificate.type, 'crt_9.yml', { _id: 'crt_9', type: models.caCertificate.type, parentId: 'wrk_9' });
      // a synced folder smuggling another type, and a file not named by its _id
      await write(models.request.type, 'set_8.yml', { _id: 'set_8', type: models.settings.type });
      await write(models.request.type, 'other.yml', { _id: 'req_8', type: models.request.type, parentId: 'wrk_9' });

      expect(await readClonedDocs(fsClient)).toEqual([request, workspace]);
    });
  });

  describe('importClonedDocs()', () => {
    const cloned = async (files: [string, string, object][]) => {
      const fsClient = MemClient.createClient();
      for (const [type, fileName, doc] of files) {
        await fsClient.promises.mkdir(path.join(GIT_INSOMNIA_DIR, type), { recursive: true });
        await fsClient.promises.writeFile(path.join(GIT_INSOMNIA_DIR, type, fileName), YAML.stringify(doc));
      }
      return fsClient;
    };
    const workspaceFile: [string, string, object] = [models.workspace.type, 'wrk_9.yml', { _id: 'wrk_9', type: models.workspace.type, scope: 'collection', parentId: 'proj_evil' }];
    const requestFile: [string, string, object] = [models.request.type, 'req_9.yml', { _id: 'req_9', type: models.request.type, parentId: 'wrk_9' }];

    it('cannot plant settings, which would become the active ones', async () => {
      const settings = await models.settings.getOrCreate();
      const fsClient = await cloned([
        workspaceFile,
        [models.settings.type, 'set_evil.yml', { _id: 'set_evil', type: models.settings.type, created: 0, validateSSL: false, proxyEnabled: true, httpsProxy: 'evil.example:8080' }],
      ]);
      expect(await importClonedDocs(fsClient, DEFAULT_PROJECT_ID)).toHaveProperty('workspace');
      expect((await models.settings.getOrCreate())._id).toBe(settings._id);
      expect(await db.get(models.settings.type, 'set_evil')).toBeFalsy();
    });

    it('moves the workspace into the project and writes its synced documents', async () => {
      const result = await importClonedDocs(await cloned([workspaceFile, requestFile]), DEFAULT_PROJECT_ID);
      expect(result).toEqual({ workspace: expect.objectContaining({ _id: 'wrk_9', parentId: DEFAULT_PROJECT_ID, scope: 'collection' }) });
      expect(await models.request.getById('req_9')).toBeTruthy();
    });

    it.each([
      ['no workspace', [requestFile], 'No workspaces found in repository'],
      ['a workspace file not named by its _id', [[models.workspace.type, 'other.yml', { _id: 'wrk_9', type: models.workspace.type }], requestFile], 'No workspaces found in repository'],
      ['two workspaces', [workspaceFile, [models.workspace.type, 'wrk_8.yml', { _id: 'wrk_8', type: models.workspace.type }], requestFile], 'Multiple workspaces found in repository. Expected one.'],
    ] as [string, [string, string, object][], string][])('writes nothing for %s', async (_, files, error) => {
      expect(await importClonedDocs(await cloned(files), DEFAULT_PROJECT_ID)).toEqual({ error });
      expect(await models.request.getById('req_9')).toBeFalsy();
    });

    it('skips docs that are already in the app or whose parents lead outside the repository', async () => {
      const fsClient = await cloned([
        workspaceFile,
        requestFile,
        [models.request.type, 'req_1.yml', { _id: 'req_1', type: models.request.type, parentId: 'wrk_9', name: 'replaced' }],
        [models.request.type, 'req_7.yml', { _id: 'req_7', type: models.request.type, parentId: 'fld_elsewhere' }],
        [models.request.type, 'set_7.yml', { _id: 'set_7', type: models.request.type, parentId: 'wrk_9' }],
      ]);
      expect(await importClonedDocs(fsClient, DEFAULT_PROJECT_ID)).toHaveProperty('workspace');
      expect(await models.request.getById('req_9')).toBeTruthy();
      expect(await models.request.getById('req_1')).toEqual(expect.objectContaining({ parentId: 'wrk_1' }));
      expect(await models.request.getById('req_7')).toBeFalsy();
      expect(await db.get(models.request.type, 'set_7')).toBeFalsy();
    });

    it('leaves a workspace that is already in the app alone', async () => {
      const fsClient = await cloned([[models.workspace.type, 'wrk_1.yml', { _id: 'wrk_1', type: models.workspace.type, name: 'replaced' }], requestFile]);
      expect(await importClonedDocs(fsClient, DEFAULT_PROJECT_ID)).toEqual({ existingWorkspace: expect.objectContaining({ _id: 'wrk_1' }) });
      expect((await models.workspace.getById('wrk_1'))?.name).not.toBe('replaced');
      expect(await models.request.getById('req_9')).toBeFalsy();
    });
  });

  describe('mkdir()', () => {
    it('should throw error', async () => {
      const workspaceId = 'wrk_1';
      const neDbClient = new NeDBClient(workspaceId, DEFAULT_PROJECT_ID);
      const promiseResult = neDbClient.mkdir();
      await expect(promiseResult).rejects.toThrowError('NeDBClient is not writable');
    });
  });
});
