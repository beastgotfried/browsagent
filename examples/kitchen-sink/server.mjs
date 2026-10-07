// The backend for the kitchen sink page.
// The page calls GET /api/orders. The context pass must find this call.
import { createServer } from 'node:http';

const ORDERS = [
  { id: 'A-1041', customer: 'Ada', total: 42 },
  { id: 'A-1042', customer: 'Grace', total: 17 },
  { id: 'A-1043', customer: 'Alan', total: 96 },
];

createServer((request, response) => {
  if (request.url === '/api/orders') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ orders: ORDERS }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(4522, '127.0.0.1', () => {
  console.info('[kitchen] the API is on http://127.0.0.1:4522');
});
