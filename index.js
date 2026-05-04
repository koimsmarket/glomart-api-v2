const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Glomart API running');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API running on ${PORT}`);
});
