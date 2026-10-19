// Stands in for the app behind the smoke stack's staging site. It answers every request with the headers it
// received, so run.sh can see exactly what Caddy forwards.
import http from 'node:http';

http
  .createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers }));
  })
  .listen(3000, '0.0.0.0');
