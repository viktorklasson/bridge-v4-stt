/**
 * Production Server - Headless ElevenLabs Bridge
 * 
 * Manages a pool of pre-warmed browser tabs that can instantly
 * bridge inbound phone calls to ElevenLabs AI agents.
 */

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import puppeteer from 'puppeteer';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TabPoolManager } from './tab-pool-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const POOL_SIZE = parseInt(process.env.POOL_SIZE) || 20;
const TARGET_HOST = 'app.salesys.se';
const TELNECT_HOST = 'bss.telnect.com';

let browser = null;
let tabPool = null;
const activeCalls = new Map(); // callId -> tabId

/**
 * Initialize Express app
 */
const app = express();

// Middleware (temporarily disabled for debugging)
// app.use(cors());
// app.use(express.json());

// API routes will be added in startServer()

/**
 * Initialize Puppeteer browser with autoplay flags
 */
async function initBrowser() {
  console.log('[Production] Launching headless Chrome...');
  
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  console.log('[Production] ✅ Browser launched');
  return browser;
}

/**
 * Initialize tab pool
 */
async function initTabPool(browser) {
  console.log(`[Production] Initializing tab pool (size: ${POOL_SIZE})...`);
  
  tabPool = new TabPoolManager(browser, POOL_SIZE);
  await tabPool.initialize();
  tabPool.startHealthMonitor();
  
  console.log('[Production] ✅ Tab pool ready');
  return tabPool;
}

/**
 * Start Express server with webhook endpoint
 */
function startServer() {
  console.log('[startServer] Starting server...');

  // Middleware (already configured above)
  // app.use(cors()); // Already set
  // app.use(express.json()); // Already set

  // Serve static files (already configured above)
  // app.use(express.static(__dirname)); // Already set
  
  // API Proxies (same as dev server) - commented out for debugging
  // app.use('/proxy/salesys', createProxyMiddleware({
  //   target: 'https://app.salesys.se',
  //   changeOrigin: true,
  //   pathRewrite: { '^/proxy/salesys': '' },
  //   onProxyReq: (proxyReq, req) => {
  //     console.log('[PROXY]', req.method, 'https://app.salesys.se' + req.url.replace('/proxy/salesys', ''));
  //   },
  //   onProxyRes: (proxyRes) => {
  //     console.log('[PROXY] Response:', proxyRes.statusCode);
  //   }
  // }));

  // app.use('/proxy/telnect', createProxyMiddleware({
  //   target: 'https://bss.telnect.com',
  //   changeOrigin: true,
  //   pathRewrite: { '^/proxy/telnect': '' },
  //   onProxyReq: (proxyReq, req) => {
  //     console.log('[PROXY]', req.method, 'https://bss.telnect.com' + req.url.replace('/proxy/telnect', ''));
  //   },
  //   onProxyRes: (proxyRes) => {
  //     console.log('[PROXY] Response:', proxyRes.statusCode);
  //   }
  // }));

  // // Legacy proxy - commented out for debugging
  // app.use('/proxy', createProxyMiddleware({
  //   target: 'https://app.salesys.se',
  //   changeOrigin: true,
  //   pathRewrite: { '^/proxy': '' }
  // }));
  
  // Test route
  app.get('/test', (req, res) => {
    console.log('[Test] Test route hit');
    res.send('Test route works!');
  });

  // Webhook endpoint for inbound calls
  app.post('/webhook/inbound-call', (req, res) => {
    console.log('[Webhook] 📞 Inbound call received');
    res.send('Webhook received');
  });
  
  // Stats endpoint
  app.get('/stats', (req, res) => {
    const stats = tabPool ? tabPool.getStats() : { availableTabs: 0, busyTabs: 0 };
    res.json({
      ...stats,
      activeCalls: Array.from(activeCalls.keys())
    });
  });
  
  // Health check
  app.get('/health', (req, res) => {
    console.log('[Health] Health check requested');
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Static files last (fallback for index.html, etc.)
  app.use(express.static(__dirname));

  // Start server
  app.listen(PORT, () => {
    console.log(`\n🚀 Production Bridge Server running at http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${__dirname}`);
    console.log(`🔄 Tab pool size: ${POOL_SIZE} tabs`);
    console.log(`📞 Webhook endpoint: POST /webhook/inbound-call`);
    console.log(`📊 Stats: GET /stats`);
    console.log(`\nReady to accept calls!`);
  });
  
  return app;
}

/**
 * Cleanup call when it ends
 */
async function cleanupCall(callId) {
  const tabId = activeCalls.get(callId);
  if (tabId !== undefined) {
    console.log(`[Production] Cleaning up call ${callId} on tab ${tabId}`);
    activeCalls.delete(callId);
    await tabPool.releaseTab(tabId);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('\n[Production] Shutting down gracefully...');
  
  if (tabPool) {
    await tabPool.cleanup();
  }
  
  if (browser) {
    await browser.close();
  }
  
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Main startup
 */
async function main() {
  console.log('[main] Starting main function...');

  try {
    // Initialize browser
    browser = await initBrowser();

    // Initialize tab pool
    // tabPool = await initTabPool(browser);

    // Start server
    startServer();

    // Keep the server running (prevent script from exiting)
    return new Promise(() => {}); // Never resolves, keeps server alive

  } catch (error) {
    console.error('[Production] Startup failed:', error);
    await shutdown();
  }
}

// Start!
main().catch(async (error) => {
  console.error('[Production] Fatal error:', error);
  await shutdown();
});

