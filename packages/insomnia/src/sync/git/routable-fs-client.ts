import * as git from 'isomorphic-git';
import path from 'path';

type Methods = 'readFile' | 'writeFile' | 'unlink' | 'readdir' | 'mkdir' | 'rmdir' | 'stat' | 'lstat' | 'readlink' | 'symlink';

/**
 * An isometric-git FS client that can route to various client depending on what the filePath is.
 *
 * @param defaultFS - default client
 * @param otherFS - map of path prefixes to clients
 * @returns {{promises: *}}
 */
export function routableFSClient(
  defaultFS: git.PromiseFsClient,
  otherFS: Record<string, git.PromiseFsClient>,
) {
  const route = (filePath: string): [git.PromiseFsClient, string] => {
    filePath = path.normalize(filePath);
    // isomorphic-git accepts a tree entry named '..', which would put a file
    // outside the repository
    if (filePath === '..' || filePath.startsWith(`..${path.sep}`)) {
      throw new Error(`Refusing ${filePath}: outside the repository`);
    }
    for (const prefix of Object.keys(otherFS)) {
      // whole path segments only: '.insomnium-x' or 'gitfoo' are not under '.insomnium' or 'git'
      const dir = path.normalize(prefix);
      if (filePath === dir || filePath.startsWith(dir + path.sep)) {
        return [otherFS[prefix], filePath];
      }
    }
    // Fallback to default if no prefix matched
    return [defaultFS, filePath];
  };

  const execMethod = async (method: Methods, filePath: string, ...args: any[]) => {
    const [client, routedPath] = route(filePath);
    // Uncomment this to debug operations
    // console.log('[routablefs] Executing', method, routedPath, { args });
    // TODO: remove non-null assertion
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return client.promises[method]!(routedPath, ...args);
  };

  // @ts-expect-error -- TSCONVERSION declare and initialize together to avoid an error
  const methods: git.CallbackFsClient = {};
  methods.readFile = execMethod.bind(methods, 'readFile');
  methods.writeFile = execMethod.bind(methods, 'writeFile');
  methods.unlink = execMethod.bind(methods, 'unlink');
  methods.readdir = execMethod.bind(methods, 'readdir');
  methods.mkdir = execMethod.bind(methods, 'mkdir');
  methods.rmdir = execMethod.bind(methods, 'rmdir');
  methods.stat = execMethod.bind(methods, 'stat');
  methods.lstat = execMethod.bind(methods, 'lstat');
  // A symlink is stored as a file holding its target, as git does with
  // core.symlinks=false: a real link could point anywhere on disk
  methods.symlink = (target: string, linkPath: string) => execMethod('writeFile', linkPath, target);
  methods.readlink = (linkPath: string) => execMethod('readFile', linkPath);
  return {
    promises: methods,
  };
}
