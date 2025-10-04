# Render.com Deployment Guide

## Quick Deploy

### Option 1: Via GitHub (Recommended)

1. **Push to GitHub:**
   ```bash
   git remote add origin https://github.com/your-username/bridge-v3.git
   git push -u origin main
   ```

2. **Deploy on Render:**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub account
   - Select your repository
   - Render will auto-detect the Dockerfile
   - Choose "Frankfurt" region (Europe)
   - Click "Create Web Service"

### Option 2: Direct Git Deploy

1. **Go to Render Dashboard:**
   https://dashboard.render.com

2. **Create New Web Service:**
   - Click "New +" → "Web Service"
   - Choose "Public Git repository"
   - Enter your git URL

3. **Configure:**
   - Name: `elevenlabs-bridge`
   - Region: `Frankfurt` (Europe)
   - Branch: `main`
   - Build Command: (auto-detected from Dockerfile)
   - Start Command: (auto-detected from Dockerfile)

4. **Environment Variables** (already in render.yaml):
   - `DISPLAY` = `:99`
   - `NODE_ENV` = `production`
   - `PUPPETEER_EXECUTABLE_PATH` = `/usr/bin/google-chrome-stable`

5. **Click "Create Web Service"**

## Build Time

- First build: ~8-12 minutes (installs Chrome)
- Subsequent builds: ~3-5 minutes (cached)

## Your Webhook URL

After deployment:
```
https://elevenlabs-bridge.onrender.com/webhook/inbound-call
```

## Testing

Once deployed, test with:
```bash
curl -X POST https://elevenlabs-bridge.onrender.com/webhook/inbound-call \
  -H "Content-Type: application/json" \
  -d '{"id":"test-123","status":"trying","number":{"caller":"0737606800","called":"0775893847"}}'
```

## Monitoring

View logs in real-time:
- Go to your service in Render dashboard
- Click "Logs" tab
- Watch for:
  ```
  [WEBHOOK] Browser initialized
  [Browser:xxx] Call bridged
  [Browser:xxx] AI agent connected
  ```

## Scaling

- **Starter Plan** (Free): 512MB RAM, ~2-3 concurrent calls
- **Standard Plan** ($7/mo): 2GB RAM, ~10 concurrent calls
- **Pro Plan** ($25/mo): 4GB RAM, ~20 concurrent calls

Each browser tab uses ~100-150MB RAM.

## Troubleshooting

### Build fails:
- Check Dockerfile syntax
- Verify all dependencies are listed

### Browser won't launch:
- Check logs for Chrome errors
- Verify DISPLAY=:99 is set
- Ensure Xvfb started successfully

### No audio:
- Verify `headless: false` in proxy_server.js
- Check that PUPPETEER_EXECUTABLE_PATH points to Chrome
- Ensure WebRTC connection is established

## Important Notes

- Render automatically handles HTTPS
- No need for ngrok in production
- Logs persist for 7 days
- Auto-deploys on git push (if connected to GitHub)
