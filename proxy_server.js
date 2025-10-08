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
const dtmfBuffer = new Map(); // callId -> array of digits

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
  // Handle notify events (DTMF, hangup, etc.)
  else if (req.url.startsWith('/api/notify') && req.method === 'POST') {
    handleNotifyEvent(req, res);
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
      
      // Check if we've already processed this exact call ID
      if (processedWebhooks.has(webhook.id)) {
        console.log('[WEBHOOK] ⚠️  Duplicate webhook for same call ID, ignoring');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Webhook acknowledged (duplicate)',
          callId: webhook.id 
        }));
        return;
      }
      
      // Check if there's already an active call from this number
      const callerNumber = webhook.number?.caller;
      const activeCallKey = `${callerNumber}_active`;
      
      if (processedWebhooks.has(activeCallKey)) {
        console.log('[WEBHOOK] 🔄 New call from same number - cleaning up old call');
        
        // Find and close the old call's tab
        for (const [oldCallId, bridge] of activeBridges.entries()) {
          if (bridge.callerNumber === callerNumber) {
            console.log('[WEBHOOK] Closing old tab for call:', oldCallId);
            try {
              await bridge.page.close();
              activeBridges.delete(oldCallId);
              processedWebhooks.delete(oldCallId);
            } catch (e) {
              console.log('[WEBHOOK] Old tab already closed');
            }
          }
        }
        
        // Clear the old active key
        processedWebhooks.delete(activeCallKey);
      }
      
      // Mark as processed (both by call ID and by caller number)
      processedWebhooks.add(webhook.id);
      processedWebhooks.add(activeCallKey);
      
      // Clean up old entries after 2 minutes (fallback)
      setTimeout(() => {
        processedWebhooks.delete(webhook.id);
        processedWebhooks.delete(activeCallKey);
      }, 120000);
      
      // Respond immediately to webhook with actions array
      // Note: In production, use your Render URL instead of localhost
      const notifyUrl = process.env.RENDER_EXTERNAL_URL 
        ? `${process.env.RENDER_EXTERNAL_URL}/api/notify`
        : 'https://bridge-gxqe.onrender.com/api/notify';
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { action: 'recording_start', param: { mono: 'false' } },
        { action: 'notify', param: { url: notifyUrl } }
      ]));
      
      // Store call ID and caller number for the waiting browser tab to pick up
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

async function handleNotifyEvent(req, res) {
  let body = [];
  req.on('data', chunk => body.push(chunk));
  
  req.on('end', async () => {
    try {
      body = Buffer.concat(body).toString();
      const event = JSON.parse(body);
      
      const callId = event.call?.id;
      const eventName = event.name;
      
      console.log('[NOTIFY] Event:', eventName, 'Call:', callId);
      
      // Handle DTMF events
      if (eventName === 'dtmf') {
        const digit = event.arg?.dtmf_digit;
        console.log('[DTMF] Digit pressed:', digit, 'Call:', callId);
        
        // Initialize buffer for this call if needed
        if (!dtmfBuffer.has(callId)) {
          dtmfBuffer.set(callId, []);
        }
        
        const buffer = dtmfBuffer.get(callId);
        
        // If * is pressed, check for Swedish SSN in previous digits
        if (digit === '*') {
          console.log('[DTMF] * pressed - checking for Swedish SSN');
          const recentDigits = buffer.slice(-12).join(''); // Last 12 digits
          
          const ssn = validateSwedishSSN(recentDigits);
          if (ssn) {
            console.log('[SSN] Valid Swedish SSN found:', ssn);
            
            // Send to Fello API
            try {
              const payload = {
                ssn: ssn,
                callId: callId
              };
              
              console.log('[SSN] Sending to Fello API:', 'https://fello.link/api/identify-async.php');
              console.log('[SSN] Payload:', JSON.stringify(payload));
              
              const response = await fetch('https://fello.link/api/identify-async.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              
              const responseText = await response.text();
              console.log('[SSN] Fello API response:', response.status, responseText);
              
              // Send context update to AI
              const bridge = activeBridges.get(callId);
              if (bridge) {
                await bridge.page.evaluate((ssnData) => {
                  if (window.elevenLabsBridge && window.elevenLabsBridge.ws) {
                    window.elevenLabsBridge.ws.send(JSON.stringify({
                      type: 'contextual_update',
                      text: `User entered Swedish SSN: ${ssnData} and pressed * to confirm`
                    }));
                  }
                }, ssn);
              }
            } catch (error) {
              console.error('[SSN] Failed to send to Fello:', error);
            }
          } else {
            console.log('[SSN] No valid SSN found in:', recentDigits);
          }
          
          // Clear buffer after * press
          buffer.length = 0;
        } else if (digit === '#') {
          // Hash key pressed - call route.php
          console.log('[DTMF] # pressed - calling route.php');
          
          try {
            // PHP expects call_id as form data, not JSON
            const formData = new URLSearchParams();
            formData.append('call_id', callId);
            
            console.log('[ROUTE] Sending to Fello route API:', 'https://fello.link/api/route.php');
            console.log('[ROUTE] call_id:', callId);
            
            const response = await fetch('https://fello.link/api/route.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString()
            });
            
            const responseText = await response.text();
            console.log('[ROUTE] Fello route API response:', response.status, responseText);
            
            // Send context update to AI
            const bridge = activeBridges.get(callId);
            if (bridge) {
              await bridge.page.evaluate(() => {
                if (window.elevenLabsBridge && window.elevenLabsBridge.ws) {
                  window.elevenLabsBridge.ws.send(JSON.stringify({
                    type: 'contextual_update',
                    text: 'User pressed # to request routing'
                  }));
                }
              });
            }
          } catch (error) {
            console.error('[ROUTE] Failed to send to Fello route API:', error);
          }
          
          // Clear buffer after # press
          buffer.length = 0;
        } else {
          // Add digit to buffer
          buffer.push(digit);
          console.log('[DTMF] Buffer:', buffer.join(''));
        }
        
        // Send user_activity to AI for every DTMF press
        const bridge = activeBridges.get(callId);
        if (bridge) {
          try {
            await bridge.page.evaluate(() => {
              if (window.elevenLabsBridge && window.elevenLabsBridge.ws && window.elevenLabsBridge.ws.readyState === WebSocket.OPEN) {
                window.elevenLabsBridge.ws.send(JSON.stringify({
                  type: 'user_activity'
                }));
              }
            });
          } catch (e) {
            console.log('[DTMF] Failed to send user_activity');
          }
        }
      }
      
      // Handle hangup events
      if (eventName === 'hangup') {
        console.log('[NOTIFY] Call ended:', callId);
        
        // Clean up DTMF buffer
        dtmfBuffer.delete(callId);
        
        // Immediately terminate AI and close tab
        const bridge = activeBridges.get(callId);
        if (bridge) {
          try {
            console.log('[NOTIFY] Terminating AI agent for call:', callId);
            
            // Force close AI WebSocket
            await bridge.page.evaluate(() => {
              if (window.elevenLabsBridge && window.elevenLabsBridge.ws) {
                window.elevenLabsBridge.ws.close();
                window.elevenLabsBridge.ws = null;
                console.log('[Hangup] AI WebSocket closed');
              }
              
              // Stop audio processor
              if (window.elevenLabsBridge && window.elevenLabsBridge.phoneProcessor) {
                window.elevenLabsBridge.phoneProcessor.disconnect();
                window.elevenLabsBridge.phoneProcessor = null;
                console.log('[Hangup] Audio processor stopped');
              }
              
              // Set title for cleanup
              document.title = 'CALL_ENDED';
            });
            
            console.log('[NOTIFY] ✅ AI terminated, tab will close shortly');
          } catch (e) {
            console.log('[NOTIFY] Page already closed');
          }
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
      
    } catch (error) {
      console.error('[NOTIFY] Error:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

function validateSwedishSSN(digits) {
  // Try 10-digit format (YYMMDDXXXX)
  if (digits.length >= 10) {
    const ssn10 = digits.slice(-10);
    if (isValidSwedishSSN(ssn10)) {
      // Convert to 12-digit format (assume 19XX for YY < 30, else 20XX)
      const yy = parseInt(ssn10.substring(0, 2));
      const century = yy < 30 ? '20' : '19';
      return century + ssn10;
    }
  }
  
  // Try 12-digit format (YYYYMMDDXXXX)
  if (digits.length >= 12) {
    const ssn12 = digits.slice(-12);
    if (isValidSwedishSSN(ssn12.substring(2))) { // Validate last 10 digits
      return ssn12;
    }
  }
  
  return null;
}

function isValidSwedishSSN(ssn10) {
  // Must be 10 digits
  if (!/^\d{10}$/.test(ssn10)) return false;
  
  // Validate date (YYMMDD)
  const yy = parseInt(ssn10.substring(0, 2));
  const mm = parseInt(ssn10.substring(2, 4));
  const dd = parseInt(ssn10.substring(4, 6));
  
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  
  // Validate Luhn checksum
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(ssn10[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  
  const checksum = (10 - (sum % 10)) % 10;
  const lastDigit = parseInt(ssn10[9]);
  
  return checksum === lastDigit;
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

