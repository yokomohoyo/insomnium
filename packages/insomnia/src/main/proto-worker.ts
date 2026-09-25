import * as protoLoader from '@grpc/proto-loader';
import { AnyDefinition, EnumTypeDefinition, MessageTypeDefinition, PackageDefinition, ServiceDefinition } from '@grpc/proto-loader';
import { loadProtosWithOptionsSync } from '@grpc/proto-loader/build/src/util';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import * as protobuf from 'protobufjs';
import { format } from 'util';
import { isMainThread, parentPort, Worker } from 'worker_threads';

import { generateRequestTemplate } from './ipc/automock';
import type { MethodDefs } from './ipc/grpc';

// Protos are parsed on a worker thread. Parsing, resolving and building the
// package definition are synchronous in protobufjs whether it reads files
// sync or async, and take hundreds of milliseconds for large trees (Google
// Ads, Compute), which froze the app. This file is also the worker's entry
// point: esbuild.main.ts builds it to proto-worker.min.js next to main.min.js.

export const grpcOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};
// Protos are loaded with loadSync on purpose: async load() resolves the types
// inside its file-read callback, so an unresolvable type throws there and the
// returned promise never settles.
export const loadMethodsFromFilePath = async (filePath: string, includeDirs: string[]): Promise<MethodDefs[]> => {
  try {
    const definition = protoLoader.loadSync(filePath, {
      ...grpcOptions,
      includeDirs,
    });
    return getMethodsFromPackageDefinition(definition);
  } catch (error) {
    throw error;
  }
};

// Map of `/<package>.<Service>/<Method>` -> request template.
const getRequestTemplatesFromProtoFile = async (
  filePath: string,
  includeDirs: string[],
): Promise<{ [methodPath: string]: object }> => {
  const result: { [methodPath: string]: object } = {};
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = new protobuf.Root();
    // Mimic protoLoader's includeDirs lookup so cross-tree imports resolve.
    // protobufjs ships descriptor.proto / api.proto / etc. at this path.
    const protobufjsGoogleDir = path.dirname(require.resolve('protobufjs/google/protobuf/descriptor.proto'));
    root.resolvePath = (origin, target) => {
      if (path.isAbsolute(target) && fs.existsSync(target)) {
        return target;
      }
      for (const dir of [path.dirname(origin || filePath), ...includeDirs]) {
        const candidate = path.join(dir, target);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      // Fall back to protobufjs' bundled well-known types (descriptor.proto etc).
      // Needed because user protos often `extend google.protobuf.FileOptions`
      // which can't resolve without the descriptor definitions loaded.
      const wellKnown = target.match(/^google\/protobuf\/(.+)$/);
      if (wellKnown) {
        const bundled = path.join(protobufjsGoogleDir, wellKnown[1]);
        if (fs.existsSync(bundled)) {
          return bundled;
        }
      }
      return target;
    };
    console.log('[grpc-template] loading', filePath, 'with includeDirs', includeDirs);
    root.loadSync(filePath, { keepCase: true });
    console.log('[grpc-template] loaded; resolving...');
    try {
      root.resolveAll();
    } catch (err) {
      // Unresolvable extensions are common in buf-style projects (gnostic,
      // buf.validate). Drop them and keep going - templates only need the
      // message types, not the extensions themselves.
      console.warn('[grpc-template] resolveAll non-fatal:', (err as Error).message);
    }
    let svcCount = 0;
    for (const ns of namespacesOf(root)) {
      for (const svc of servicesIn(ns)) {
        svcCount++;
        for (const methodName of Object.keys(svc.methods)) {
          const methodPath = `/${fullName(svc)}/${methodName}`;
          try {
            result[methodPath] = generateRequestTemplate(svc, methodName);
          } catch (err) {
            console.warn('[grpc-template] generation failed for', methodPath, (err as Error).message);
          }
        }
      }
    }
    console.log('[grpc-template] found', svcCount, 'services,', Object.keys(result).length, 'templates');
  } catch (err) {
    console.warn('[grpc] proto file template parse failed:', err);
  }
  return result;
};

const namespacesOf = (ns: protobuf.NamespaceBase): protobuf.NamespaceBase[] => {
  const out: protobuf.NamespaceBase[] = [ns];
  for (const nested of ns.nestedArray) {
    if (nested instanceof protobuf.Namespace) {
      out.push(...namespacesOf(nested));
    }
  }
  return out;
};

const servicesIn = (ns: protobuf.NamespaceBase): protobuf.Service[] => {
  return ns.nestedArray.filter((n): n is protobuf.Service => n instanceof protobuf.Service);
};

// protobufjs `fullName` is `.pkg.Sub.Service`; gRPC paths drop the leading dot.
const fullName = (svc: protobuf.Service): string => svc.fullName.replace(/^\./, '');

export const getMethodsFromPackageDefinition = (packageDefinition: PackageDefinition): MethodDefs[] => {
  return Object.values(packageDefinition)
    .filter(isServiceDefinition)
    .flatMap(Object.values);
};

const isServiceDefinition = (definition: AnyDefinition): definition is ServiceDefinition => {
  return !!asServiceDefinition(definition);
};
export const asServiceDefinition = (definition: AnyDefinition): ServiceDefinition | null => {
  if (isMessageDefinition(definition) || isEnumDefinition(definition)) {
    return null;
  }
  return definition;
};
const isMessageDefinition = (definition: AnyDefinition): definition is MessageTypeDefinition => {
  return (definition as MessageTypeDefinition).format === 'Protocol Buffer 3 DescriptorProto';
};
const isEnumDefinition = (definition: AnyDefinition): definition is EnumTypeDefinition => {
  return (definition as EnumTypeDefinition).format === 'Protocol Buffer 3 EnumDescriptorProto';
};

export interface ProtoLoadError {
  message: string;
  code?: string;
  path?: string;
}
interface ProtoJob {
  filePath: string;
  includeDirs: string[];
  // Also build request templates, which parses the tree a second time.
  templates?: boolean;
  // Return what this one method needs (methodJSON) instead of the methods.
  method?: string;
}
export interface LoadedProto {
  methods: Pick<MethodDefs, 'path' | 'requestStream' | 'responseStream'>[];
  examples: { [methodPath: string]: object };
}
type ProtoReply = { id: number; error: ProtoLoadError }
  | { id: number; proto: LoadedProto }
  | { id: number; method: protobuf.INamespace | null };
interface WorkerLog {
  log: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

type Protobuf = typeof protobuf;
// protobufjs as @grpc/proto-loader requires it. esbuild bundles a copy of
// protobufjs into this file, and that copy's classes fail instanceof checks
// on the roots proto-loader builds.
const loaderProtobuf = (): Protobuf => createRequire(require.resolve('@grpc/proto-loader'))('protobufjs');

const isPackage = (pb: Protobuf, obj: protobuf.ReflectionObject | null): obj is protobuf.Namespace => {
  return obj instanceof pb.Namespace && !(obj instanceof pb.Type) && !(obj instanceof pb.Service);
};

// The method at a gRPC path such as /pkg.Service/Method. Services are looked
// up by exact name through packages only, as proto-loader names them.
const findMethod = (pb: Protobuf, root: protobuf.Root, methodPath: string): protobuf.Method | undefined => {
  const [empty, serviceName, methodName, ...rest] = methodPath.split('/');
  if (empty !== '' || !serviceName || !methodName || rest.length) {
    return undefined;
  }
  let found: protobuf.ReflectionObject | null = root;
  for (const name of serviceName.split('.')) {
    found = isPackage(pb, found) ? found.get(name) : null;
  }
  if (!(found instanceof pb.Service) || !Object.prototype.hasOwnProperty.call(found.methods, methodName)) {
    return undefined;
  }
  return found.methods[methodName];
};

// Just what one method needs from a loaded root, as protobufjs JSON: its
// service with only that method, and every file-level declaration its request
// and response types reach. Declarations are kept whole at file level, which
// is where protobufjs keeps a file's syntax and features, and their type
// references are made absolute so they resolve to the same types. For the
// largest Google APIs this is under 1 MB and builds in tens of milliseconds,
// where parsing the whole tree takes hundreds.
const methodJSON = (pb: Protobuf, root: protobuf.Root, methodPath: string): protobuf.INamespace | null => {
  const method = findMethod(pb, root, methodPath);
  if (!method?.resolvedRequestType || !method.resolvedResponseType) {
    return null;
  }
  const service = method.parent as protobuf.Service;
  const keep = new Set<protobuf.ReflectionObject>([service]);
  const queue: protobuf.ReflectionObject[] = [];
  const add = (obj: protobuf.ReflectionObject | null | undefined) => {
    while (obj?.parent && !isPackage(pb, obj.parent)) {
      obj = obj.parent;
    }
    if (obj && !keep.has(obj)) {
      keep.add(obj);
      queue.push(obj);
    }
  };
  const addField = (field: protobuf.Field) => {
    add(field.resolvedType);
    // An extension's declaration, and the message it extends
    add(field.declaringField);
    add(field.extensionField?.parent);
  };
  add(method.resolvedRequestType);
  add(method.resolvedResponseType);
  for (let obj = queue.pop(); obj; obj = queue.pop()) {
    const nested = [obj];
    for (let item = nested.pop(); item; item = nested.pop()) {
      if (item instanceof pb.Field) {
        addField(item);
      }
      if (item instanceof pb.Type) {
        item.fieldsArray.forEach(addField);
      }
      if (item instanceof pb.Namespace) {
        nested.push(...item.nestedArray);
      }
    }
  }

  const absolute = (obj: protobuf.ReflectionObject, json: any) => {
    if (obj instanceof pb.Enum) {
      // With allow_alias, the parser names an id after its first name and
      // fromJSON after its last. Put the aliases first, keeping the first
      // value's id first, since a field's default is the first value.
      const { values } = json;
      const names = Object.keys(values);
      const aliases = names.filter(name => obj.valuesById[values[name]] !== name);
      const firstAliases = aliases.filter(name => values[name] === values[names[0]]);
      json.values = {};
      for (const name of [...(firstAliases.length ? firstAliases : names.slice(0, 1)), ...aliases, ...names]) {
        json.values[name] = json.values[name] ?? values[name];
      }
    }
    if (obj instanceof pb.Field) {
      json.type = obj.resolvedType?.fullName ?? json.type;
      json.extend = obj.extensionField?.parent?.fullName ?? json.extend;
    }
    if (obj instanceof pb.Type) {
      for (const field of obj.fieldsArray) {
        if (!field.declaringField && field.resolvedType) {
          json.fields[field.name].type = field.resolvedType.fullName;
        }
      }
    }
    if (obj instanceof pb.Namespace) {
      obj.nestedArray.forEach(item => absolute(item, json.nested[item.name]));
    }
    return json;
  };
  const serviceJSON: any = service.toJSON();
  delete serviceJSON.nested;
  serviceJSON.methods = {
    [method.name]: {
      ...serviceJSON.methods[method.name],
      requestType: method.resolvedRequestType.fullName,
      responseType: method.resolvedResponseType.fullName,
    },
  };
  const json: any = {};
  for (const obj of keep) {
    let node = json;
    const packages: protobuf.ReflectionObject[] = [];
    for (let parent = obj.parent; parent?.parent; parent = parent.parent) {
      packages.unshift(parent);
    }
    for (const pkg of packages) {
      node.nested = node.nested || {};
      node = node.nested[pkg.name] = node.nested[pkg.name] || { options: pkg.options };
    }
    node.nested = node.nested || {};
    node.nested[obj.name] = obj === service ? serviceJSON : absolute(obj, obj.toJSON());
  }
  return json;
};

// The method's serializers, made as @grpc/proto-loader makes them.
const methodFromJSON = (json: protobuf.INamespace, methodPath: string): MethodDefs | undefined => {
  const method = findMethod(protobuf, protobuf.Root.fromJSON(json), methodPath);
  const requestType = method?.resolvedRequestType;
  const responseType = method?.resolvedResponseType;
  if (!method || !requestType || !responseType) {
    return undefined;
  }
  return {
    path: methodPath,
    requestStream: !!method.requestStream,
    responseStream: !!method.responseStream,
    requestSerialize: (value: any) => {
      if (Array.isArray(value)) {
        throw new Error(`Failed to serialize message: expected object with ${requestType.name} structure, got array instead`);
      }
      return requestType.encode(requestType.fromObject(value)).finish() as Buffer;
    },
    responseDeserialize: (value: Buffer) => responseType.toObject(responseType.decode(value), grpcOptions),
  };
};

// Reads a file for protobufjs, failing on a FIFO or device instead of
// blocking on it: a read that never returns would hang this thread, and
// with it the app's exit, since exiting waits for worker threads.
export const readRegularFileSync = (file: string) => {
  // A file inside app.asar, such as protobufjs's own google/protobuf protos,
  // is always a regular file, and Electron reads it from the archive by path.
  // Opening it would copy it to the temp dir, which is never cleaned up.
  if (/\.asar[\\/]/.test(file)) {
    return fs.readFileSync(file);
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isFIFO() || stat.isCharacterDevice() || stat.isBlockDevice() || stat.isSocket()) {
      throw Object.assign(new Error(`${file} is not a regular file`), { path: file });
    }
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

if (!isMainThread && parentPort) {
  for (const pb of new Set([protobuf, loaderProtobuf()])) {
    pb.util.fs = { ...pb.util.fs, readFileSync: readRegularFileSync };
  }
  const port = parentPort;
  // This thread's console and warnings would only reach stdout and stderr, so
  // pass them to the main thread's console, which initializeLogging sends to
  // the log file.
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...args: unknown[]) => port.postMessage({ log: level, text: format(...args) });
  }
  process.removeAllListeners('warning');
  process.on('warning', warning => port.postMessage({ log: 'warn', text: `${warning.name}: ${warning.message}` }));
  port.on('message', async ({ id, filePath, includeDirs, templates, method }: ProtoJob & { id: number }) => {
    let reply: ProtoReply;
    try {
      if (method !== undefined) {
        // Loaded as protoLoader.loadSync loads it, which then builds a package
        // definition for every type; only this method's types are needed.
        const root = loadProtosWithOptionsSync(filePath, { ...grpcOptions, includeDirs });
        reply = { id, method: methodJSON(loaderProtobuf(), root, method) };
      } else {
        const methods = await loadMethodsFromFilePath(filePath, includeDirs);
        const examples = templates ? await getRequestTemplatesFromProtoFile(filePath, includeDirs) : {};
        // Just what loadMethods needs; the serializers can't be sent to another thread.
        const methodInfo = methods.map(m => ({ path: m.path, requestStream: m.requestStream, responseStream: m.responseStream }));
        reply = { id, proto: { methods: methodInfo, examples } };
      }
    } catch (err: any) {
      reply = { id, error: {
        message: String(err?.message || err),
        code: typeof err?.code === 'string' ? err.code : undefined,
        path: typeof err?.path === 'string' ? err.path : undefined,
      } };
    }
    try {
      port.postMessage(reply);
    } catch (err: any) {
      // A reply that can't be cloned still has to settle the job
      port.postMessage({ id, error: { message: String(err?.message || err) } });
    }
  });
}

// Pending jobs fail when the worker goes this long without finishing one, for
// example while it reads an import from a network drive that stopped answering.
const PROTO_WORKER_TIMEOUT_MS = 60_000;

interface ProtoWorker {
  thread: Worker;
  pending: Map<number, { resolve: (reply: ProtoReply) => void; reject: (err: Error) => void }>;
  watchdog?: ReturnType<typeof setTimeout>;
}
// One long-lived worker, since starting a thread and warming up the parser
// takes longer than loading a typical proto. Unref'd so it never keeps the
// process alive.
let worker: ProtoWorker | undefined;
let nextJobId = 0;

// Every job settles: a crash, an exit or a stall rejects whatever is still pending.
const failWorker = (w: ProtoWorker, err: Error) => {
  clearTimeout(w.watchdog);
  if (worker === w) {
    worker = undefined;
  }
  w.pending.forEach(({ reject }) => reject(err));
  w.pending.clear();
};

const watchWorker = (w: ProtoWorker) => {
  clearTimeout(w.watchdog);
  if (w.pending.size) {
    w.watchdog = setTimeout(() => {
      failWorker(w, new Error(`Loading the proto file timed out after ${PROTO_WORKER_TIMEOUT_MS / 1000} seconds`));
      w.thread.terminate();
    }, PROTO_WORKER_TIMEOUT_MS);
    w.watchdog.unref?.();
  }
};

const startWorker = () => {
  const thread = new Worker(path.join(__dirname, 'proto-worker.min.js'));
  const w: ProtoWorker = { thread, pending: new Map() };
  thread.on('message', (reply: ProtoReply | WorkerLog) => {
    if ('log' in reply) {
      console[reply.log](reply.text);
      return;
    }
    w.pending.get(reply.id)?.resolve(reply);
    w.pending.delete(reply.id);
    watchWorker(w);
  });
  thread.on('messageerror', err => {
    failWorker(w, err);
    thread.terminate();
  });
  thread.on('error', err => failWorker(w, err));
  thread.on('exit', code => failWorker(w, new Error(`Proto worker exited with code ${code}`)));
  thread.unref();
  return w;
};

const runProtoJob = (job: ProtoJob) => new Promise<ProtoReply>((resolve, reject) => {
  const w = worker = worker || startWorker();
  const id = nextJobId++;
  w.pending.set(id, { resolve, reject });
  if (w.pending.size === 1) {
    watchWorker(w);
  }
  w.thread.postMessage({ ...job, id });
});

const runLoadJob = async (job: ProtoJob) => {
  const reply = await runProtoJob(job);
  if ('error' in reply) {
    throw Object.assign(new Error(reply.error.message), reply.error);
  }
  return reply;
};

// Methods and request templates of a proto file; rejects with the load error.
export const loadProto = async (filePath: string, includeDirs: string[]): Promise<LoadedProto> => {
  const reply = await runLoadJob({ filePath, includeDirs, templates: true });
  return 'proto' in reply ? reply.proto : { methods: [], examples: {} };
};

// The method at a gRPC path such as /pkg.Service/Method, with serializers to
// call it, or undefined when the proto file has no such method. The worker
// parses the file; this thread only builds the types the method uses.
export const loadMethod = async (filePath: string, includeDirs: string[], methodPath: string): Promise<MethodDefs | undefined> => {
  const reply = await runLoadJob({ filePath, includeDirs, method: methodPath });
  return 'method' in reply && reply.method ? methodFromJSON(reply.method, methodPath) : undefined;
};

// Loads a proto file as loadProto does and returns the error, if any. Keeps
// the error's code and path, which an IPC rejection would drop.
export const validateProto = async (filePath: string, includeDirs: string[]): Promise<ProtoLoadError | undefined> => {
  const reply = await runProtoJob({ filePath, includeDirs });
  return 'error' in reply ? reply.error : undefined;
};
