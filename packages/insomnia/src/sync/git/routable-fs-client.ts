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
    // isomorphic-git never builds a '..' segment itself, but accepts one from a
    // tree entry or a server's ref name. Checked before normalizing, which would
    // turn git/refs/../../config into git/config
    if (filePath.split(/[\\/]/).includes('..')) {
      throw new Error(`Refusing ${filePath}: it goes through '..'`);
    }
    filePath = path.normalize(filePath);
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
  // A symlink is stored as a plain file holding its target, since a real link
  // could point anywhere on disk (isomorphic-git then indexes it as 100644)
  methods.symlink = (target: string, linkPath: string) => execMethod('writeFile', linkPath, target);
  methods.readlink = (linkPath: string) => execMethod('readFile', linkPath);
  return {
    promises: methods,
  };
}
