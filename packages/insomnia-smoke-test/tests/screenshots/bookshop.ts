import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildSchema, graphql } from 'graphql';
import http from 'http';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

// The Bookshop API the README's screenshots show: a small server for them to
// send to, and the collection that goes with it.

export const bookshopPort = 4020;
const baseUrl = `http://127.0.0.1:${bookshopPort}/v1`;

const books = [
  { id: 42, title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', year: 1969, stock: 12 },
  { id: 43, title: 'Kindred', author: 'Octavia E. Butler', year: 1979, stock: 7 },
  { id: 44, title: 'Solaris', author: 'Stanisław Lem', year: 1961, stock: 3 },
  { id: 45, title: 'The Dispossessed', author: 'Ursula K. Le Guin', year: 1974, stock: 0 },
];
const orders = [
  { id: 1001, book_id: 42, quantity: 2, status: 'paid' },
  { id: 1002, book_id: 44, quantity: 1, status: 'shipped' },
];

const schema = buildSchema(`
  """A book the shop sells."""
  type Book {
    id: ID!
    title: String!
    "Who wrote it."
    author: Author!
    year: Int
    "Copies on the shelf."
    stock: Int!
    tags: [String!]!
  }

  type Author {
    id: ID!
    name: String!
    books: [Book!]!
  }

  type Order {
    id: ID!
    book: Book!
    quantity: Int!
    status: OrderStatus!
  }

  enum OrderStatus { PAID SHIPPED CANCELLED }

  type Query {
    "Every book, or those with a tag."
    books(tag: String, inStock: Boolean): [Book!]!
    book(id: ID!): Book
    orders(status: OrderStatus): [Order!]!
  }

  type Mutation {
    placeOrder(bookId: ID!, quantity: Int = 1): Order!
  }
`);

const author = (name: string) => ({ id: name === 'Ursula K. Le Guin' ? '317' : '318', name, books: [] });
const graphqlBook = (book: typeof books[number]) => ({ ...book, author: author(book.author), tags: ['science fiction', 'classic'] });
const rootValue = {
  books: ({ inStock }: { inStock?: boolean }) => books.filter(book => !inStock || book.stock > 0).map(graphqlBook),
  book: ({ id }: { id: string }) => graphqlBook(books.find(book => String(book.id) === id) || books[0]),
  orders: () => orders.map(order => ({ ...order, status: order.status.toUpperCase(), book: graphqlBook(books[0]) })),
  placeOrder: ({ quantity }: { quantity: number }) => ({ id: 1003, quantity, status: 'PAID', book: graphqlBook(books[0]) }),
};

// what an agent can do in the shop, over MCP
const mcpServer = () => {
  const mcp = new McpServer({ name: 'bookshop', version: '1.4.2' }, { instructions: 'Search the catalogue before placing an order. Prices are in euros.' });
  mcp.tool('search_books', 'Finds books by title, author or tag', { query: z.string().describe('Words to look for'), in_stock: z.boolean().optional() }, async ({ query }) => ({
    content: books
      .filter(book => `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()))
      .map(book => ({ type: 'text' as const, text: `#${book.id} ${book.title}, ${book.author} (${book.year}): ${book.stock || 'none'} in stock` })),
  }));
  mcp.tool('get_book', 'One book, by its id', { id: z.number() }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(books.find(book => book.id === id)) }] }));
  mcp.tool('place_order', 'Orders copies of a book', { book_id: z.number(), quantity: z.number().min(1) }, async order => ({ content: [{ type: 'text', text: JSON.stringify({ id: 1003, status: 'paid', ...order }) }] }));
  mcp.tool('order_status', 'Where an order is', { order_id: z.number() }, async () => ({ content: [{ type: 'text', text: 'shipped' }] }));
  mcp.prompt('recommend', 'Recommends a book to a reader', { likes: z.string() }, ({ likes }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Recommend a book from the catalogue to someone who likes ${likes}` } }] }));
  mcp.resource('catalogue', 'bookshop://catalogue', async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify(books) }] }));
  mcp.resource('returns-policy', 'bookshop://policies/returns', async uri => ({ contents: [{ uri: uri.href, text: 'Returns within 30 days.' }] }));
  return mcp;
};

// a model's reply, streamed a word at a time as OpenAI-compatible APIs do
const reply = 'Try "The Dispossessed" by Ursula K. Le Guin. Like "The Left Hand of Darkness", it sets two societies against each other and lets a visitor find out what each one costs. If you would rather stay on Earth, "Kindred" by Octavia E. Butler is the one to read next.';

const readBody = (req: http.IncomingMessage) => new Promise<string>(resolve => {
  let text = '';
  req.on('data', chunk => text += chunk);
  req.on('end', () => resolve(text));
});

export function startBookshop() {
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'X-Request-Id': 'req_8f2a41' });
      res.end(text);
    };
    const path = (req.url || '').split('?')[0];
    const route = `${req.method} ${path}`;
    const body = await readBody(req);
    // a little of the time a real one takes, differing by route
    await new Promise(resolve => setTimeout(resolve, 8 + (path.length * 7) % 40 + Math.random() * 12));

    if (route === 'POST /mcp') {
      const mcp = mcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        mcp.close();
      });
      await mcp.connect(transport);
      return transport.handleRequest(req, res, JSON.parse(body));
    }
    if (path === '/mcp') {
      return res.writeHead(405).end();
    }
    if (route === 'POST /llm/v1/chat/completions') {
      const { model } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const chunk = (payload: object) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-9', object: 'chat.completion.chunk', model, ...payload })}\n\n`);
      const words = reply.split(/(?= )/);
      await new Promise(resolve => setTimeout(resolve, 180));
      for (const word of words) {
        chunk({ choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
        await new Promise(resolve => setTimeout(resolve, 12));
      }
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      chunk({ choices: [], usage: { prompt_tokens: 41, completion_tokens: 63, total_tokens: 104 } });
      return res.end('data: [DONE]\n\n');
    }
    if (route === 'POST /graphql') {
      const { query, variables, operationName } = JSON.parse(body);
      return json(200, await graphql({ schema, source: query, variableValues: variables, operationName, rootValue }));
    }
    if (route === 'GET /v1/health') {
      return json(200, { status: 'ok', version: '1.4.2' });
    }
    if (route === 'POST /v1/auth/token') {
      return json(200, { access_token: 'eyJhbGciOiJIUzI1NiJ9.Ym9va3Nob3A.c2lnbmVk', token_type: 'Bearer', expires_in: 3600 });
    }
    if (route === 'GET /v1/books') {
      return json(200, { total: books.length, books });
    }
    if (route === 'POST /v1/books') {
      return json(201, { id: 42, ...JSON.parse(body || '{}'), created_at: '2026-11-08T14:32:07Z', links: { self: '/v1/books/42', author: '/v1/authors/317' } });
    }
    const book = path.match(/^\/v1\/books\/(\d+)$/);
    if (book && req.method === 'GET') {
      const found = books.find(({ id }) => String(id) === book[1]);
      return found ? json(200, found) : json(404, { error: 'not_found', message: `No book ${book[1]}` });
    }
    if (book && req.method === 'PUT') {
      return json(200, { ...books[0], ...JSON.parse(body || '{}') });
    }
    if (book && req.method === 'DELETE') {
      return json(409, { error: 'has_orders', message: 'This book has open orders' });
    }
    if (route === 'GET /v1/orders') {
      return json(200, { total: orders.length, orders });
    }
    if (route === 'POST /v1/orders') {
      return json(201, { id: 1003, status: 'paid', ...JSON.parse(body || '{}') });
    }
    if (/^\/v1\/orders\/\d+$/.test(path) && req.method === 'PATCH') {
      return json(200, { ...orders[0], status: 'shipped' });
    }
    return json(404, { error: 'not_found' });
  });

  // order events, and an echo of what's sent
  const sockets = new WebSocketServer({ server, path: '/v1/orders/live' });
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ event: 'subscribed', channel: 'orders' }));
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.action === 'watch') {
        socket.send(JSON.stringify({ event: 'order.paid', order: { id: 1003, book_id: message.book_id, quantity: 2 } }));
        socket.send(JSON.stringify({ event: 'stock.changed', book_id: message.book_id, stock: 10 }));
        socket.send(JSON.stringify({ event: 'order.shipped', order: { id: 1002, carrier: 'DHL' } }));
      }
    });
  });

  return new Promise<http.Server>(resolve => server.listen(bookshopPort, '127.0.0.1', () => resolve(server)));
}

const json = (body: unknown) => ({ mimeType: 'application/json', text: JSON.stringify(body, null, 2) });
const bearer = { type: 'bearer', token: '{{ _.token }}' };
const jsonHeader = [{ name: 'Content-Type', value: 'application/json' }];
const newBook = {
  title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin',
  year: 1969,
  isbn: '978-0441478125',
  tags: ['science fiction', 'classic'],
  stock: 12,
};

const example = (id: string, parentId: string, name: string, statusCode: number, statusMessage: string, body: unknown) => ({
  _id: id,
  _type: 'response_example',
  parentId,
  name,
  statusCode,
  statusMessage,
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: JSON.stringify(body, null, 2),
});

export const bookshopSpec = `openapi: 3.0.3
info:
  title: Bookshop API
  description: Books, and the orders placed for them.
  version: 1.4.2
  contact:
    name: Bookshop
    url: https://bookshop.example
servers:
  - url: ${baseUrl}
    description: This computer
tags:
  - name: Books
    description: What the shop sells
  - name: Orders
    description: What was bought
paths:
  /books:
    get:
      operationId: listBooks
      summary: List books
      description: Every book, newest first.
      tags: [Books]
      parameters:
        - name: tag
          in: query
          description: Only books with this tag
          schema:
            type: string
      responses:
        '200':
          description: The books
          content:
            application/json:
              schema:
                type: object
                properties:
                  total:
                    type: integer
                  books:
                    type: array
                    items:
                      $ref: '#/components/schemas/Book'
    post:
      operationId: createBook
      summary: Create book
      description: Adds a book to the shop.
      tags: [Books]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Book'
      responses:
        '201':
          description: The book, with its id
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Book'
  /books/{id}:
    get:
      operationId: getBook
      summary: Get book
      description: One book, by its id.
      tags: [Books]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: The book
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Book'
        '404':
          description: No such book
  /orders:
    post:
      summary: Place order
      tags: [Orders]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Order'
      responses:
        '201':
          description: The order
components:
  schemas:
    Book:
      type: object
      required: [title, author]
      properties:
        id:
          type: integer
        title:
          type: string
        author:
          type: string
        year:
          type: integer
        stock:
          type: integer
    Order:
      type: object
      required: [book_id, quantity]
      properties:
        book_id:
          type: integer
        quantity:
          type: integer
          minimum: 1
`;

// An Insomnium export of the collection. Its requests are in the order the
// sidebar shows them.
export const bookshopCollection = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_bookshop', _type: 'workspace', parentId: null, name: 'Bookshop API', scope: 'collection' },
    { _id: 'env_base', _type: 'environment', parentId: 'wrk_bookshop', name: 'Base Environment', data: { base_url: baseUrl, token: '' } },
    { _id: 'env_local', _type: 'environment', parentId: 'env_base', name: 'Local', color: '#7d69cb', data: { base_url: baseUrl } },
    { _id: 'env_staging', _type: 'environment', parentId: 'env_base', name: 'Staging', color: '#e8a33d', data: { base_url: 'https://staging.bookshop.example/v1' } },

    { _id: 'fld_auth', _type: 'request_group', parentId: 'wrk_bookshop', name: 'Auth', metaSortKey: 100 },
    {
      _id: 'req_token',
      _type: 'request',
      parentId: 'fld_auth',
      name: 'Get access token',
      method: 'POST',
      url: '{{ _.base_url }}/auth/token',
      headers: jsonHeader,
      body: json({ client_id: 'bookshop-web', grant_type: 'client_credentials' }),
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '200' }, { id: 'a2', source: 'jsonpath', property: '$.access_token', operator: 'exists' }],
      metaSortKey: 110,
    },

    { _id: 'fld_books', _type: 'request_group', parentId: 'wrk_bookshop', name: 'Books', metaSortKey: 200 },
    {
      _id: 'req_list_books',
      _type: 'request',
      parentId: 'fld_books',
      name: 'List books',
      method: 'GET',
      url: '{{ _.base_url }}/books',
      authentication: bearer,
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '200' }, { id: 'a2', source: 'jsonpath', property: '$.total', operator: 'greaterThan', value: '0' }, { id: 'a3', source: 'responseTime', operator: 'lessThan', value: '500' }],
      metaSortKey: 210,
    },
    {
      _id: 'req_get_book',
      _type: 'request',
      parentId: 'fld_books',
      name: 'Get book',
      method: 'GET',
      url: '{{ _.base_url }}/books/42',
      authentication: bearer,
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '200' }, { id: 'a2', source: 'jsonpath', property: '$.author', operator: 'contains', value: 'Le Guin' }],
      metaSortKey: 220,
    },
    {
      _id: 'req_create_book',
      _type: 'request',
      parentId: 'fld_books',
      name: 'Create book',
      method: 'POST',
      url: '{{ _.base_url }}/books',
      headers: jsonHeader,
      authentication: bearer,
      body: json(newBook),
      preRequestScript: [
        '// a new ISBN for each send',
        'const isbn = `978-${Date.now() % 10000000000}`;',
        "insomnia.variables.set('isbn', isbn);",
        "console.log('creating a book with ISBN', isbn);",
      ].join('\n'),
      afterResponseScript: [
        'const book = insomnia.response.json();',
        '',
        "insomnia.test('is created', () => {",
        '  insomnia.response.to.have.status(201);',
        '});',
        '',
        "insomnia.test('has an id and a link to itself', () => {",
        "  insomnia.expect(book.id).to.be.a('number');",
        '  insomnia.expect(book.links.self).to.contain(book.id);',
        '});',
        '',
        "insomnia.test('keeps the stock it was given', () => {",
        '  insomnia.expect(book.stock).to.equal(12);',
        '});',
        '',
        '// the requests after this one can use it',
        "insomnia.environment.set('book_id', book.id);",
      ].join('\n'),
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '201' }, { id: 'a2', source: 'header', property: 'Content-Type', operator: 'contains', value: 'json' }],
      metaSortKey: 230,
    },
    {
      _id: 'req_update_book',
      _type: 'request',
      parentId: 'fld_books',
      name: 'Update book',
      method: 'PUT',
      url: '{{ _.base_url }}/books/42',
      headers: jsonHeader,
      authentication: bearer,
      body: json({ stock: 11 }),
      assertions: [{ id: 'a1', source: 'jsonpath', property: '$.stock', operator: 'equals', value: '11' }],
      metaSortKey: 240,
    },
    {
      _id: 'req_remove_book',
      _type: 'request',
      parentId: 'fld_books',
      name: 'Remove book',
      method: 'DELETE',
      url: '{{ _.base_url }}/books/45',
      authentication: bearer,
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '204' }],
      metaSortKey: 250,
    },

    { _id: 'fld_orders', _type: 'request_group', parentId: 'wrk_bookshop', name: 'Orders', metaSortKey: 300 },
    {
      _id: 'req_list_orders',
      _type: 'request',
      parentId: 'fld_orders',
      name: 'List orders',
      method: 'GET',
      url: '{{ _.base_url }}/orders',
      authentication: bearer,
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '200' }],
      metaSortKey: 310,
    },
    {
      _id: 'req_place_order',
      _type: 'request',
      parentId: 'fld_orders',
      name: 'Place order',
      method: 'POST',
      url: '{{ _.base_url }}/orders',
      headers: jsonHeader,
      authentication: bearer,
      body: json({ book_id: 42, quantity: 2 }),
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '201' }, { id: 'a2', source: 'jsonpath', property: '$.status', operator: 'equals', value: 'paid' }],
      metaSortKey: 320,
    },
    {
      _id: 'req_mark_shipped',
      _type: 'request',
      parentId: 'fld_orders',
      name: 'Mark shipped',
      method: 'PATCH',
      url: '{{ _.base_url }}/orders/1001',
      headers: jsonHeader,
      authentication: bearer,
      body: json({ status: 'shipped' }),
      metaSortKey: 330,
    },
    { _id: 'req_health', _type: 'request', parentId: 'wrk_bookshop', name: 'Health check', method: 'GET', url: '{{ _.base_url }}/health', metaSortKey: 400 },

    { _id: 'fld_more', _type: 'request_group', parentId: 'wrk_bookshop', name: 'Storefront', metaSortKey: 500 },
    {
      _id: 'req_graphql',
      _type: 'request',
      parentId: 'fld_more',
      name: 'Books in stock',
      method: 'POST',
      url: `http://127.0.0.1:${bookshopPort}/graphql`,
      headers: jsonHeader,
      body: {
        mimeType: 'application/graphql',
        text: JSON.stringify({
          query: 'query BooksInStock($tag: String) {\n  books(tag: $tag, inStock: true) {\n    id\n    title\n    author {\n      name\n    }\n    stock\n  }\n}',
          variables: { tag: 'classic' },
          operationName: 'BooksInStock',
        }),
      },
      metaSortKey: 510,
    },
    { _id: 'ws-req_orders', _type: 'websocket_request', parentId: 'fld_more', name: 'Order events', url: `ws://127.0.0.1:${bookshopPort}/v1/orders/live`, metaSortKey: 520 },
    { _id: 'mcp-req_bookshop', _type: 'mcp_request', parentId: 'fld_more', name: 'Bookshop MCP server', transport: 'http', url: `http://127.0.0.1:${bookshopPort}/mcp`, headers: [], command: '', args: '', metaSortKey: 530 },
    {
      _id: 'req_llm',
      _type: 'request',
      parentId: 'fld_more',
      name: 'Recommend a book',
      method: 'POST',
      url: `http://127.0.0.1:${bookshopPort}/llm/v1/chat/completions`,
      headers: [{ name: 'Accept', value: 'text/event-stream' }, ...jsonHeader],
      body: json({
        model: 'llama3.2',
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: 'You recommend books from the Bookshop catalogue.' },
          { role: 'user', content: 'I liked The Left Hand of Darkness. What next?' },
        ],
      }),
      metaSortKey: 540,
    },

    example('ex_books', 'req_list_books', 'Two books', 200, 'OK', { total: 2, books: books.slice(0, 2) }),
    example('ex_book', 'req_get_book', 'Found', 200, 'OK', books[0]),
    example('ex_book_missing', 'req_get_book', 'Not found', 404, 'Not Found', { error: 'not_found', message: 'No book 42' }),
    example('ex_created', 'req_create_book', 'Created', 201, 'Created', { id: 42, ...newBook }),
    example('ex_orders', 'req_list_orders', 'Two orders', 200, 'OK', { total: 2, orders }),
    example('ex_order', 'req_place_order', 'Paid', 201, 'Created', { id: 1003, status: 'paid', book_id: 42, quantity: 2 }),
  ],
});
