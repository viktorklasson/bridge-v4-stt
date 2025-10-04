# Heroku Deployment Guide

## Prerequisites

1. Heroku account
2. Heroku CLI installed: `brew install heroku/brew/heroku`
3. Git repository initialized

## Quick Deploy

### 1. Login to Heroku
```bash
heroku login
```

### 2. Create Heroku App
```bash
heroku create your-bridge-app-name
```

### 3. Add Buildpacks (IN THIS ORDER!)
```bash
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-xvfb-google-chrome
heroku buildpacks:add heroku/nodejs
```

Verify buildpacks:
```bash
heroku buildpacks
```

Should show:
```
1. https://github.com/heroku/heroku-buildpack-xvfb-google-chrome
2. heroku/nodejs
```

### 4. Set Environment Variables
```bash
heroku config:set DISPLAY=:99
heroku config:set TELNECT_TOKEN="NnoXdRRU8hAvoFVfxxo2JwyF80ukM5rF0rcAksJl"
```

### 5. Initialize Git (if not already done)
```bash
git init
git add .
git commit -m "Initial commit - ElevenLabs bridge"
```

### 6. Deploy
```bash
git push heroku main
```

Or if your branch is named `master`:
```bash
git push heroku master
```

### 7. Check Logs
```bash
heroku logs --tail
```

You should see:
```
[Server] Using DISPLAY: :99
[WEBHOOK] Browser initialized
Webhook endpoint ready
```

### 8. Get Your Public URL
```bash
heroku info
```

Your webhook URL will be:
```
https://your-bridge-app-name.herokuapp.com/webhook/inbound-call
```

### 9. Configure Telnect
Set your Telnect webhook to the Heroku URL above.

## Testing

### Test the webhook:
```bash
curl -X POST https://your-bridge-app-name.herokuapp.com/webhook/inbound-call \
  -H "Content-Type: application/json" \
  -d '{"id":"test-123","status":"trying","number":{"caller":"0737606800","called":"0775893847"}}'
```

### Make a real call:
Call your Telnect number and watch the logs:
```bash
heroku logs --tail
```

## Troubleshooting

### Browser fails to launch:
```bash
# Check if buildpacks are in correct order
heroku buildpacks

# Check environment
heroku run bash
echo $DISPLAY
echo $CHROME_BIN
```

### Audio not working:
- Verify `headless: false` in proxy_server.js
- Check that DISPLAY=:99 is set
- Ensure Xvfb buildpack is FIRST

### Memory issues:
```bash
# Upgrade dyno type
heroku ps:scale web=1:standard-1x
```

## Scaling

For multiple concurrent calls:
- Standard-1X dyno: ~5 concurrent calls
- Standard-2X dyno: ~10 concurrent calls
- Performance-M dyno: ~20 concurrent calls

Each browser tab uses ~100MB RAM.

## Monitoring

```bash
# View logs
heroku logs --tail

# Check dyno status
heroku ps

# View metrics
heroku logs --tail | grep WEBHOOK
```

## Local Testing with Docker (Optional)

Test the Xvfb setup locally:

```bash
docker run -it --rm \
  -p 3000:3000 \
  -e DISPLAY=:99 \
  node:18 bash

# Inside container:
apt-get update
apt-get install -y xvfb chromium
Xvfb :99 -screen 0 1024x768x24 &
export DISPLAY=:99

npm install
npm start
```

## Important Notes

- Keep tokens in `index.html` (they're client-side anyway)
- Browser stays open, creates new tabs per call
- Tabs auto-close when calls end
- System is fully autonomous after deployment
