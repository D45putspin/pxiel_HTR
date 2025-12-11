// Tiny CORS-friendly reverse proxy for the wallet service.
// Usage: WALLET_TARGET=http://localhost:8000 CORS_PROXY_PORT=5173 node cors-proxy.js

const http = require('http');
const { URL } = require('url');
const httpProxy = require('http-proxy');

const target = process.env.WALLET_TARGET || 'http://localhost:8000';
const port = Number(process.env.CORS_PROXY_PORT || 5173);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

const proxy = httpProxy.createProxyServer({
  target,
  changeOrigin: true,
  autoRewrite: true,
});

proxy.on('proxyRes', (proxyRes) => {
  Object.entries(corsHeaders).forEach(([k, v]) => {
    proxyRes.headers[k] = v;
  });
});

proxy.on('error', (err, req, res) => {
  res.writeHead(502, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify({ success: false, error: err.message || 'Proxy error' }));
});

const server = http.createServer((req, res) => {
  // Handle preflight directly
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  // Forward everything else to the target wallet service
  const targetUrl = new URL(req.url, target);
  proxy.web(req, res, { target: targetUrl.toString() });
});

server.listen(port, () => {
  console.log(`CORS proxy listening on http://localhost:${port} -> ${target}`);
});
