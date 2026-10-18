import crypto from 'node:crypto';

import express from 'express';
import { readFileSync } from 'fs';
import { createHandler } from 'graphql-http/lib/use/http';
import { createServer } from 'https';
import { join } from 'path';

import { basicAuthRouter } from './basic-auth';
import githubApi from './github-api';
import gitlabApi from './gitlab-api';
import { schema } from './graphql';
import { startGRPCServer } from './grpc';
import { mcpRouter } from './mcp';
import { oauthRoutes } from './oauth';
import { startWebSocketServer } from './websocket';

const app = express();
const port = 4010;
const httpsPort = 4011;
const grpcPort = 50051;

app.get('/pets/:id', (req, res) => {
  res.status(200).send({ id: req.params.id });
});

app.get('/sleep', (_req, res) => {
  res.status(200).send({ sleep: true });
});

app.get('/cookies', (_req, res) => {
  res
    .status(200)
    .header('content-type', 'text/plain')
    .cookie('insomnia-test-cookie', 'value123')
    .send(`${_req.headers['cookie']}`);
});

app.use('/file', express.static('fixtures/files'));
app.use('/auth/basic', basicAuthRouter);

githubApi(app);
gitlabApi(app);

app.get('/delay/seconds/:duration', (req, res) => {
  const delaySec = Number.parseInt(req.params.duration || '2');
  setTimeout(function() {
    res.send(`Delayed by ${delaySec} seconds`);
  }, delaySec * 1000);
});

app.use('/oidc', oauthRoutes(port));

app.get('/', (_req, res) => {
  res.status(200).send();
});

app.all('/graphql', createHandler({ schema }));

app.use(express.json()); // Used to parse JSON bodies

app.use('/mcp', mcpRouter);

// An OpenAI-compatible model for the AI assistant: it answers a request
// description with a request, in a code fence as models often do, and
// anything else with "ready". It wants the key the tests set.
const FAKE_MODEL_KEY = 'Bearer e2e-key';
app.get('/v1/models', (request, response) => {
  if (request.headers.authorization !== FAKE_MODEL_KEY) {
    response.status(401).json({ error: { message: 'Incorrect API key provided' } });
    return;
  }
  response.json({ object: 'list', data: [{ id: 'fake-model', object: 'model' }, { id: 'another-model', object: 'model' }] });
});
app.post('/v1/chat/completions', (request, response) => {
  if (request.headers.authorization !== FAKE_MODEL_KEY) {
    response.status(401).json({ error: { message: 'Incorrect API key provided' } });
    return;
  }
  const [first] = request.body.messages || [];
  const content = String(first?.content).includes('description of an HTTP request')
    ? '```json\n' + JSON.stringify({ name: 'Pet two', method: 'GET', url: '{{ base_url }}/pets/2', headers: [{ name: 'Accept', value: 'application/json' }] }) + '\n```'
    : 'ready';
  response.json({ id: 'chatcmpl-1', object: 'chat.completion', model: request.body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
});

// SSE routes
let subscribers: { id: string; response: express.Response }[] = [];
app.get('/events', (request, response) => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  };
  response.writeHead(200, headers);
  const subscriberId = crypto.randomUUID();
  const data = `data: ${JSON.stringify({ id: subscriberId })}\n\n`;
  response.write(data);
  const subscriber = {
    id: subscriberId,
    response,
  };
  subscribers.push(subscriber);
  setInterval(() => {
    // const id = subscriberId;
    const data = JSON.stringify({ message: 'Time: ' + new Date().toISOString().slice(11, 19) });
    // response.write('id: ' + id + '\n');
    response.write('data: ' + data + '\n\n');
  }, 1000);
  request.on('close', () => {
    console.log(`${subscriberId} Connection closed`);
    subscribers = subscribers.filter(sub => sub.id !== subscriberId);
  });
});
app.post('/send-event', (request, response) => {
  // Requires middleware to parse JSON body
  console.log('Received event', request.body);
  subscribers.forEach(subscriber => subscriber.response.write(`data: ${JSON.stringify(request.body)}\n\n`));
  response.json({ success: true });
});

startWebSocketServer(app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
  console.log(`Listening at ws://localhost:${port}`);
}));

startWebSocketServer(createServer({
  cert: readFileSync(join(__dirname, '../fixtures/certificates/localhost.pem')),
  ca: readFileSync(join(__dirname, '../fixtures/certificates/rootCA.pem')),
  key: readFileSync(join(__dirname, '../fixtures/certificates/localhost-key.pem')),
  // Only allow connections using valid client certificates
  requestCert: true,
  rejectUnauthorized: true,
}, app).listen(httpsPort, () => {
  console.log(`Listening at https://localhost:${httpsPort}`);
  console.log(`Listening at wss://localhost:${httpsPort}`);
}));

startGRPCServer(grpcPort);
