# Production Deployment Guide

## Overview

The headless ElevenLabs bridge uses a pool of pre-warmed browser tabs managed by Puppeteer to instantly accept and bridge inbound phone calls to AI agents.

## Architecture

```
Telnect Webhook
    ↓
POST /webhook/inbound-call
    ↓
Get available tab from pool (20 pre-warmed tabs)
    ↓
Inject call ID into tab
    ↓
Tab bridges: Phone ← → ElevenLabs AI
    ↓
Call ends → Release tab back to pool
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create `.env` file:
```bash
POOL_SIZE=20                    # Number of pre-warmed tabs
PORT=3000                       # Server port
ELEVENLABS_AGENT_ID=your_id     # Your ElevenLabs agent ID
SALESYS_TOKEN=your_token        # Your Salesys API token
```

### 3. Run Production Server

```bash
npm run production
```

This will:
- Launch headless Chrome with autoplay enabled
- Pre-warm 20 browser tabs (ready in ~30 seconds)
- Start webhook server on port 3000
- Accept inbound calls instantly (<100ms)

## Development vs Production

### Development Mode (Manual Testing)
```bash
npm run dev
```
- Opens browser UI with START BRIDGE button
- Manual call initiation
- Good for testing

### Production Mode (Webhook-Driven)
```bash
npm run production
```
- Headless Puppeteer with pre-warmed tabs
- Webhook-triggered calls
- Auto-scaling
- Production ready

## Webhook Integration

Configure Telnect to send webhooks to:
```
POST http://your-server.com:3000/webhook/inbound-call
```

Expected webhook payload:
```json
{
  "id": "c2225ahk...",
  "source": { "caller": { "user": "0737606800" } },
  "destination": { "to": { "user": "0775893847" } },
  "number": {
    "caller": "0737606800",
    "called": "0775893847"
  }
}
```

## Monitoring

### Stats Endpoint
```bash
curl http://localhost:3000/stats
```

Response:
```json
{
  "total": 20,
  "available": 18,
  "busy": 2,
  "calls": ["c2225ahk...", "c2225ahk..."],
  "activeCalls": ["c2225ahk...", "c2225ahk..."]
}
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Scaling

### Vertical Scaling (Single Server)
Increase `POOL_SIZE`:
```bash
POOL_SIZE=50 npm run production
```

### Horizontal Scaling (Multiple Servers)
1. Deploy multiple instances behind load balancer
2. Each server handles 20-50 concurrent calls
3. Load balancer routes webhooks round-robin

Example:
- 5 servers × 20 tabs = 100 concurrent calls
- 10 servers × 50 tabs = 500 concurrent calls

## Testing

### Test Webhook Locally
```bash
chmod +x test-webhook.sh
./test-webhook.sh
```

### Monitor Logs
```bash
# Production logs
npm run production | tee production.log

# Watch for errors
tail -f production.log | grep ERROR
```

## Troubleshooting

### Browser crashes
- Check Chrome dependencies: `apt-get install chromium-browser`
- Increase memory: `NODE_OPTIONS="--max-old-space-size=4096"`

### Tabs not responding
- Check stats endpoint: `curl localhost:3000/stats`
- Health monitor auto-restarts crashed tabs every 30s

### Audio issues
- Verify AudioContext resumed: Check browser console
- Ensure autoplay flags in Puppeteer launch args

## Production Checklist

- [ ] Configure environment variables
- [ ] Set up webhook in Telnect
- [ ] Test with test-webhook.sh
- [ ] Monitor stats endpoint
- [ ] Set up process manager (PM2/systemd)
- [ ] Configure logging
- [ ] Set up alerts for errors

## Resource Requirements

Per server (20 concurrent calls):
- CPU: 4 cores
- RAM: 4GB
- Network: 10 Mbps upload/download

## Support

For issues, check logs:
- Browser console (via Puppeteer)
- Server logs (stdout)
- Network requests (PROXY logs)

