#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const TARGET_HOST = 'app.salesys.se';

// MIME types for serving files
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Add CORS headers to all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Check if this is a proxy request
  if (req.url.startsWith('/proxy/')) {
    handleProxy(req, res);
  } else {
    serveFile(req, res);
  }
});

function handleProxy(req, res) {
  // Remove /proxy prefix (keeping the leading slash for the API path)
  const targetPath = req.url.substring(6); // Remove just '/proxy'
  const targetUrl = `https://${TARGET_HOST}${targetPath}`;
  
  console.log(`[PROXY] ${req.method} ${targetUrl}`);

  // Collect request body
  let body = [];
  req.on('data', chunk => {
    body.push(chunk);
  });

  req.on('end', () => {
    body = Buffer.concat(body);

    // Prepare headers for proxied request
    const headers = {};
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }
    if (body.length > 0) {
      headers['Content-Length'] = body.length;
    }

    // Make the proxied request
    const options = {
      hostname: TARGET_HOST,
      path: targetPath,
      method: req.method,
      headers: headers
    };

    const proxyReq = https.request(options, proxyRes => {
      console.log(`[PROXY] Response: ${proxyRes.statusCode}`);

      // Forward response headers
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      // Forward response body
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('[PROXY] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    // Send the request body
    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
}

function serveFile(req, res) {
  // Default to index.html
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  // Get file extension
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found\n');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

server.listen(PORT, () => {
  console.log(`🚀 CORS Proxy Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🔄 Proxying API requests to: https://${TARGET_HOST}`);
  console.log(`\nOpen http://localhost:${PORT}/index.html in your browser`);
  console.log('\nPress Ctrl+C to stop the server\n');
});

