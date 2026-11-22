/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { compareWithSpec, notInSpecFinding, requestAgainstSpec, requestPath, specOperations } from '../spec-inventory';

const SPEC = `
openapi: 3.0.0
info: { title: Shop, version: 1.0.0 }
servers:
  - url: https://shop.example.com/api/v2
  - url: /api/v2/
paths:
  /orders:
    get: { responses: { '200': { description: ok } } }
    post: { responses: { '201': { description: made } } }
    parameters: []
  /orders/{id}:
    get: { responses: { '200': { description: ok } } }
    delete: { responses: { '204': { description: gone } } }
  /health:
    get: { responses: { '200': { description: ok } } }
`;

const request = (requestId: string, method: string, url: string) => ({ requestId, method, url });

describe('specOperations()', () => {
  it("lists a spec's operations, and the paths its servers put them under", () => {
    expect(specOperations(SPEC)).toEqual({
      operations: [
        { method: 'GET', path: '/orders' },
        { method: 'POST', path: '/orders' },
        { method: 'GET', path: '/orders/{id}' },
        { method: 'DELETE', path: '/orders/{id}' },
        { method: 'GET', path: '/health' },
      ],
      basePaths: ['/api/v2'],
    });
  });

  it("reads Swagger 2's basePath, and JSON", () => {
    expect(specOperations(JSON.stringify({ swagger: '2.0', basePath: '/v1', paths: { '/pets': { get: {}, 'x-note': 'no' } } })))
      .toEqual({ operations: [{ method: 'GET', path: '/pets' }], basePaths: ['/v1'] });
  });

  it("is nothing for what isn't a spec with paths", () => {
    expect(specOperations('')).toBeNull();
    expect(specOperations('just: yaml')).toBeNull();
    expect(specOperations('openapi: 3.0.0\ninfo: {}')).toBeNull();
    expect(specOperations('{ not yaml: [')).toBeNull();
    expect(specOperations('asyncapi: 2.6.0\nchannels: {}')).toBeNull();
  });
});

describe('requestPath()', () => {
  it("is the URL's path, without its host, query or hash", () => {
    expect(requestPath('https://shop.example.com/api/v2/orders?page=2#top')).toBe('/api/v2/orders');
    expect(requestPath('http://localhost:4010')).toBe('/');
    expect(requestPath('shop.example.com/orders/7')).toBe('/orders/7');
  });

  it('takes a variable in front for the host it stands for', () => {
    expect(requestPath('{{ _.base_url }}/orders/{{ _.id }}?expand=items')).toBe('/orders/{{ _.id }}');
    expect(requestPath("{% response 'body', 'req_1', '$.url' %}/orders")).toBe('/orders');
    expect(requestPath('{{ scheme }}://{{ host }}:8080/orders')).toBe('/orders');
  });
});

describe('compareWithSpec()', () => {
  it('finds each request its operation: as written, under a base path, with variables, or behind a prefix', () => {
    const inventory = compareWithSpec(SPEC, [
      request('a', 'GET', 'https://shop.example.com/api/v2/orders?page=2'),
      request('b', 'post', '{{ _.base }}/orders'),
      request('c', 'GET', '{{ _.base }}/orders/{{ _.orderId }}'),
      request('d', 'DELETE', 'https://gateway.example.com/shop/orders/:id'),
      request('e', 'GET', 'https://shop.example.com/api/v2/health'),
    ]);

    expect(inventory).toEqual({ operations: 5, uncovered: [], undocumented: [] });
  });

  it("names the requests the spec doesn't describe: another path, or another method", () => {
    const inventory = compareWithSpec(SPEC, [
      request('a', 'GET', 'https://shop.example.com/api/v2/orders'),
      request('b', 'GET', 'https://shop.example.com/api/v1/internal/users'),
      request('c', 'PUT', '{{ _.base }}/orders/7'),
      request('d', 'GET', '{{ _.base }}/orders/7/items'),
    ]);

    expect(inventory?.undocumented).toEqual([
      { requestId: 'b', operation: 'GET /api/v1/internal/users' },
      { requestId: 'c', operation: 'PUT /orders/7' },
      { requestId: 'd', operation: 'GET /orders/7/items' },
    ]);
  });

  it('names the operations no request covers', () => {
    const inventory = compareWithSpec(SPEC, [request('a', 'GET', '{{ _.base }}/orders')]);

    expect(inventory).toMatchObject({ operations: 5, uncovered: ['POST /orders', 'GET /orders/{id}', 'DELETE /orders/{id}', 'GET /health'] });
  });

  it("takes a variable at a path's end for the longest operation it ends like, not for every short one", () => {
    // behind a prefix the spec doesn't name: it ends like /orders/{id}, and a
    // variable alone would end like /orders and /health as well
    const { uncovered, undocumented } = compareWithSpec(SPEC, [request('a', 'GET', 'https://gateway.example.com/shop/orders/{{ _.id }}')])!;

    expect(undocumented).toEqual([]);
    expect(uncovered).toEqual(['GET /orders', 'POST /orders', 'DELETE /orders/{id}', 'GET /health']);
  });

  it("doesn't take a longer path's end for a short operation's, when the parts differ", () => {
    // /health is the spec's; /orders/health would be an order named health, which GET /orders/{id} covers
    const inventory = compareWithSpec(SPEC, [request('a', 'GET', '{{ _.base }}/orders/health')]);

    expect(inventory?.undocumented).toEqual([]);
    expect(inventory?.uncovered).not.toContain('GET /orders/{id}');
  });

  it('has nothing to say without a spec', () => {
    expect(compareWithSpec('', [request('a', 'GET', 'https://shop.example.com/orders')])).toBeNull();
  });
});

describe('requestAgainstSpec()', () => {
  it('names the operation that describes a request', () => {
    expect(requestAgainstSpec(SPEC, { method: 'get', url: '{{ base_url }}/api/v2/orders/{{ _.id }}?expand=items' })).toEqual({ described: ['GET /orders/{id}'], operation: 'GET /api/v2/orders/{{ _.id }}' });
    expect(requestAgainstSpec(SPEC, { method: 'POST', url: 'https://shop.example.com/orders' })?.described).toEqual(['POST /orders']);
  });

  it("says what a request asks for when the spec doesn't describe it", () => {
    expect(requestAgainstSpec(SPEC, { method: 'GET', url: 'https://shop.example.com/internal/users' })).toEqual({ described: [], operation: 'GET /internal/users' });
    // the path is there, the method isn't
    expect(requestAgainstSpec(SPEC, { method: 'PUT', url: 'https://shop.example.com/orders/7' })).toEqual({ described: [], operation: 'PUT /orders/7' });
  });

  it('has nothing to say without a spec', () => {
    expect(requestAgainstSpec('', { method: 'GET', url: 'https://shop.example.com/orders' })).toBeNull();
    expect(requestAgainstSpec('title: notes', { method: 'GET', url: 'https://shop.example.com/orders' })).toBeNull();
  });
});

describe('notInSpecFinding()', () => {
  it('is a low finding under improper inventory, naming what was asked for', () => {
    expect(notInSpecFinding('GET /internal/users')).toMatchObject({
      id: 'not-in-spec',
      severity: 'low',
      owasp: 'API9:2023 Improper Inventory Management',
      evidence: 'GET /internal/users',
    });
  });
});
