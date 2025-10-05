#!/usr/bin/env node

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const TARGET_HOST = 'app.salesys.se';
const TELNECT_HOST = 'bss.telnect.com';

// Set DISPLAY for Xvfb (Heroku)
if (process.env.DISPLAY) {
  console.log('[Server] Using DISPLAY:', process.env.DISPLAY);
}

// Puppeteer browser instance
let browser = null;
const activeBridges = new Map(); // callId -> { page, timestamp }
const processedWebhooks = new Set(); // Track processed call IDs to prevent duplicates

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

  // Check if this is a webhook request
  if (req.url === '/webhook/inbound-call' && req.method === 'POST') {
    handleWebhook(req, res);
  }
  // Check if this is a context update request
  else if (req.url.startsWith('/api/context/') && req.method === 'POST') {
    handleContextUpdate(req, res);
  }
  // List active calls
  else if (req.url === '/api/calls' && req.method === 'GET') {
    listActiveCalls(req, res);
  }
  // Check if this is a proxy request
  else if (req.url.startsWith('/proxy/salesys/')) {
    handleProxy(req, res, TARGET_HOST, '/proxy/salesys');
  } else if (req.url.startsWith('/proxy/telnect/')) {
    handleProxy(req, res, TELNECT_HOST, '/proxy/telnect');
  } else if (req.url.startsWith('/proxy/')) {
    // Legacy support - default to Salesys
    handleProxy(req, res, TARGET_HOST, '/proxy');
  } else {
    serveFile(req, res);
  }
});

async function handleWebhook(req, res) {
  console.log('[WEBHOOK] Received inbound call webhook');
  
  // Collect request body
  let body = [];
  req.on('data', chunk => {
    body.push(chunk);
  });
  
  req.on('end', async () => {
    try {
      body = Buffer.concat(body).toString();
      const webhook = JSON.parse(body);
      
      console.log('[WEBHOOK] Call ID:', webhook.id);
      console.log('[WEBHOOK] From:', webhook.number?.caller, '→', webhook.number?.called);
      console.log('[WEBHOOK] Status:', webhook.status);
      
      // Check if we've already processed this call OR if there's already an active call
      const callerNumber = webhook.number?.caller;
      const activeCallKey = `${callerNumber}_active`;
      
      if (processedWebhooks.has(webhook.id) || processedWebhooks.has(activeCallKey)) {
        console.log('[WEBHOOK] ⚠️  Call already being processed, ignoring duplicate webhook');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Webhook acknowledged (already processing)',
          callId: webhook.id 
        }));
        return;
      }
      
      // Mark as processed (both by call ID and by caller number)
      processedWebhooks.add(webhook.id);
      processedWebhooks.add(activeCallKey);
      
      // Clean up old entries after 2 minutes (shorter timeout)
      setTimeout(() => {
        processedWebhooks.delete(webhook.id);
        processedWebhooks.delete(activeCallKey);
      }, 120000);
      
      // Respond immediately to webhook (don't make Telnect wait)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Webhook received - launching bridge',
        callId: webhook.id 
      }));
      
      // Store call ID and caller number for the waiting browser tab to pick up
      const callerNumber = webhook.number?.caller || 'unknown';
      const calledNumber = webhook.number?.called || 'unknown';
      const bridgeUrl = `http://localhost:${PORT}/index.html?callId=${webhook.id}&inbound=true&caller=${callerNumber}&called=${calledNumber}`;
      console.log('[WEBHOOK] 📞 Call ready for bridging:', webhook.id);
      console.log('[WEBHOOK] 🌉 Bridge URL:', bridgeUrl);
      
      // Launch browser with proper audio support for Heroku/Xvfb
      try {
        // Ensure browser is initialized
        if (!browser) {
          console.log('[WEBHOOK] Initializing Puppeteer browser...');
          browser = await puppeteer.launch({
            headless: false, // MUST be false for WebRTC audio!
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || '/usr/bin/chromium',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--autoplay-policy=no-user-gesture-required',
              '--use-fake-device-for-media-stream',
              '--use-fake-ui-for-media-stream',
              '--disable-web-security'
            ]
          });
          console.log('[WEBHOOK] ✅ Browser initialized');
        }
        
        // Open new page for this call
        const page = await browser.newPage();
        console.log('[WEBHOOK] ✅ New tab opened for call:', webhook.id);
        
        // Navigate to bridge URL
        await page.goto(bridgeUrl, { waitUntil: 'networkidle0', timeout: 15000 });
        console.log('[WEBHOOK] ✅ Bridge page loaded');
        
        // Store the page reference
        activeBridges.set(webhook.id, { 
          page, 
          timestamp: Date.now(),
          callerNumber: webhook.number?.caller
        });
        
        // Monitor page console for debugging
        page.on('console', msg => {
          const text = msg.text();
          if (text.includes('[Bridge]') || text.includes('[Call]') || text.includes('[ElevenLabs]')) {
            console.log(`[Browser:${webhook.id}]`, text);
          }
        });
        
        // Monitor page title for cleanup signal
        const cleanupInterval = setInterval(async () => {
          try {
            const title = await page.title();
            if (title === 'CALL_ENDED') {
              console.log('[WEBHOOK] Call ended, closing tab:', webhook.id);
              clearInterval(cleanupInterval);
              await page.close();
              activeBridges.delete(webhook.id);
              
              // Clear deduplication immediately so new calls can come through
              processedWebhooks.delete(webhook.id);
              processedWebhooks.delete(activeCallKey);
              console.log('[WEBHOOK] Cleared deduplication for:', callerNumber);
            }
          } catch (e) {
            clearInterval(cleanupInterval);
          }
        }, 1000);
        
        // Fallback cleanup after 10 minutes
        setTimeout(async () => {
          if (activeBridges.has(webhook.id)) {
            console.log('[WEBHOOK] Timeout cleanup for call:', webhook.id);
            await page.close();
            activeBridges.delete(webhook.id);
          }
        }, 600000);
        
      } catch (error) {
        console.error('[WEBHOOK] Failed to launch browser:', error);
      }
      
    } catch (error) {
      console.error('[WEBHOOK] Error:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

async function handleContextUpdate(req, res) {
  const callId = req.url.split('/api/context/')[1].split('?')[0];
  
  let body = [];
  req.on('data', chunk => body.push(chunk));
  
  req.on('end', async () => {
    try {
      body = Buffer.concat(body).toString();
      const update = JSON.parse(body);
      
      console.log('[CONTEXT] Update for call:', callId, 'Type:', update.type, 'Text:', update.text || '(none)');
      
      const bridge = activeBridges.get(callId);
      
      if (!bridge) {
        console.log('[CONTEXT] Call not found:', callId);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Call not found or already ended', callId }));
        return;
      }
      
      // Send update to ElevenLabs via page evaluation
      await bridge.page.evaluate((updateData) => {
        if (window.elevenLabsBridge && window.elevenLabsBridge.ws && window.elevenLabsBridge.ws.readyState === WebSocket.OPEN) {
          window.elevenLabsBridge.ws.send(JSON.stringify(updateData));
          console.log('[Context] Sent to AI:', updateData);
          return true;
        } else {
          console.error('[Context] Bridge WebSocket not available');
          return false;
        }
      }, update);
      
      console.log('[CONTEXT] ✅ Update sent successfully');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, callId, updateType: update.type }));
      
    } catch (error) {
      console.error('[CONTEXT] Error:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

function listActiveCalls(req, res) {
  const calls = Array.from(activeBridges.entries()).map(([id, bridge]) => ({
    callId: id,
    callerNumber: bridge.callerNumber,
    durationSeconds: Math.floor((Date.now() - bridge.timestamp) / 1000)
  }));
  
  console.log('[API] Listing active calls:', calls.length);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ calls, count: calls.length }));
}

function handleProxy(req, res, targetHost, proxyPrefix) {
  // Remove proxy prefix (keeping the leading slash for the API path)
  const targetPath = req.url.substring(proxyPrefix.length); // Remove the proxy prefix
  const targetUrl = `https://${targetHost}${targetPath}`;
  
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
      hostname: targetHost,
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
  // Strip query params from URL for file serving
  let urlPath = req.url.split('?')[0];
  
  // Default to index.html
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
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

server.listen(PORT, async () => {
  console.log(`🚀 CORS Proxy Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🔄 Proxying API requests:`);
  console.log(`   - /proxy/salesys/* → https://${TARGET_HOST}`);
  console.log(`   - /proxy/telnect/* → https://${TELNECT_HOST}`);
  console.log(`   - /proxy/* → https://${TARGET_HOST} (legacy)`);
  console.log(`📞 Webhook endpoint: POST /webhook/inbound-call`);
  console.log(`🤖 Auto-launches headless browser for each inbound call`);
  console.log(`\nOpen http://localhost:${PORT}/index.html in your browser for manual testing`);
  console.log('\nPress Ctrl+C to stop the server\n');
  
  // Clean up any orphaned browser instances on startup
  if (browser) {
    console.log('[Server] Closing any existing browser instances...');
    try {
      await browser.close();
      browser = null;
      activeBridges.clear();
      processedWebhooks.clear();
      console.log('[Server] ✅ Cleanup complete');
    } catch (e) {
      console.log('[Server] No cleanup needed');
    }
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

