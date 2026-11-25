import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const add = (left, right) => left + right;

export function createApplication() {
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.method === 'POST' && request.url === '/sum') {
      try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const { left, right } = JSON.parse(body);
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('invalid numbers');
        response.end(JSON.stringify({ result: add(left, right) }));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'invalid input' }));
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApplication();
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
