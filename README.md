# Bridge v3 - Autonomous Phone Call AI Bridge

Fully autonomous system that bridges inbound phone calls with ElevenLabs Conversational AI agents. Receives webhooks from Telnect, automatically answers calls, and connects them to AI agents with zero manual intervention.

## Architecture

```
Phone Call (Verto/WebRTC) 
    ↓ 48kHz audio
Audio Bridge (Web Audio API)
    ↓ 
ElevenLabs AI Agent (WebSocket)
    ↓ AI responses
Audio Bridge
    ↓
Phone Call
```

## Features

- ✅ WebRTC phone calls via Salesys/Verto
- ✅ Real-time audio bridging (48kHz)
- ✅ ElevenLabs Conversational AI integration
- ✅ CORS proxy server
- ✅ Real-time status monitoring
- ✅ Audio quality monitoring

## Quick Start

### Local Development

```bash
npm install
npm run dev
```

Server runs on http://localhost:3000

### Production Deployment (Heroku)

See [HEROKU_DEPLOYMENT.md](./HEROKU_DEPLOYMENT.md) for complete deployment guide.

Quick deploy:
```bash
heroku create your-app
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-xvfb-google-chrome
heroku buildpacks:add heroku/nodejs
git push heroku main
```

Configure webhook: `https://your-app.herokuapp.com/webhook/inbound-call`

## How It Works

### Call Flow

1. **Login to Salesys** - Authenticates with Salesys API using the token
2. **Connect to Verto** - Establishes WebRTC connection to phone system
3. **Initiate Call** - Dials the configured number
4. **Call Active** - When answered, triggers AI agent initialization
5. **Bridge Audio** - Sets up bidirectional audio streaming:
   - Phone audio → ElevenLabs AI (for understanding)
   - AI responses → Phone audio (for speaking)

### Audio Processing

- **Sample Rate**: 48kHz (matches WebRTC standard)
- **Format**: PCM 16-bit (converted from Float32)
- **Channels**: Mono
- **Latency**: ~85ms (4096 buffer size)

### ElevenLabs Integration

The `elevenlabs-bridge.js` module handles:
- WebSocket connection to ElevenLabs
- Audio format conversion (Float32 ↔ PCM16)
- Real-time audio streaming
- Message handling (transcriptions, AI responses)

## File Structure

```
bridge-v3/
├── index.html              # Main application
├── elevenlabs-bridge.js    # ElevenLabs audio bridge
├── proxy_server.js         # CORS proxy server
├── package.json            # Dependencies
└── README.md               # This file
```

## API Endpoints

### Salesys API (via proxy)

- `POST /proxy/api/dial/easytelecom-v1/login` - Get Verto credentials
- `POST /proxy/api/dial/easytelecom-v1/call` - Initiate outbound call

### ElevenLabs API (direct)

- `GET /v1/convai/conversation/get_signed_url` - Get WebSocket URL
- `WebSocket` - Real-time conversation stream

## Troubleshooting

### "ElevenLabs agent ID not configured"

Update the `elevenLabsConfig` in `index.html` with your agent ID from ElevenLabs dashboard.

### "Failed to get signed URL: 401"

Check that your ElevenLabs API key is correct and has the necessary permissions.

### Audio not bridging

1. Check browser console for errors
2. Verify microphone permissions are granted
3. Check that both streams are active (phone + AI)
4. Verify sample rates match (48kHz)

### CORS errors

The proxy server should handle CORS. If you still see errors:
1. Restart the proxy server
2. Clear browser cache
3. Check that you're accessing via http://localhost:3000 (not file://)

## Development

### Testing Without Phone Call

You can test the ElevenLabs integration separately:

```javascript
// In browser console
const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
const bridge = new ElevenLabsBridge({
  agentId: 'your-agent-id',
  apiKey: 'your-api-key',
  onStatusChange: console.log,
  onAgentMessage: console.log
});
await bridge.initialize(testStream);
```

### Monitoring Audio Quality

Open Developer Tools and check:
- Console logs for audio buffer sizes
- Network tab for WebSocket messages
- Audio settings tables

## References

- [ElevenLabs Agents Platform Documentation](https://elevenlabs.io/docs/agents-platform/libraries/java-script)
- [Web Audio API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebRTC Audio Specifications](https://www.w3.org/TR/webrtc/)

## License

MIT

