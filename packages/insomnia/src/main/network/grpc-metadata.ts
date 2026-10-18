import type { Metadata, StatusObject } from '@grpc/grpc-js';

// Metadata as plain data, for the window and MCP: each name's values, with a
// binary (-bin) value as base64
export type GrpcMetadata = Record<string, string[]>;

export const plainMetadata = (metadata?: Metadata | null): GrpcMetadata => Object.fromEntries(
  Object.entries(metadata?.toJSON() || {}).map(([name, values]) => [name, values.map(value => Buffer.isBuffer(value) ? value.toString('base64') : String(value))]),
);

// A call's status, its trailers included
export type GrpcStatus = Omit<StatusObject, 'metadata'> & { metadata?: GrpcMetadata };
