# Bridge v4 STT - Autonomous Phone Call AI Bridge with Custom STT

Fully autonomous system that bridges inbound phone calls with ElevenLabs Conversational AI agents using Soniox real-time STT. Receives webhooks from Telnect, automatically answers calls, and connects them to AI agents with zero manual intervention.

## Architecture (NEW!)

```
Phone Call (Verto/WebRTC) 
    ↓ 48kHz audio → 16kHz resampling
Soniox Real-time STT (WebSocket)
    ↓ Text transcription (with endpoint detection)
ElevenLabs AI Agent (WebSocket - TEXT MODE)
    ↓ AI text response → TTS audio
Virtual Audio Source
    ↓ Audio injection
Phone Call
```

**Key Changes:**
- 🎤 **Soniox STT**: Handles speech-to-text with advanced endpoint detection
- 📝 **Text-based AI**: ElevenLabs receives text messages instead of audio stream
- 🎯 **Endpoint Detection**: Natural turn-taking using Soniox's `<end>` token detection
- ⚡ **Lower Latency**: Text processing is faster than audio streaming

## Features

- ✅ WebRTC phone calls via Salesys/Verto
- ✅ Soniox real-time STT with endpoint detection
- ✅ ElevenLabs Conversational AI (text-based input)
- ✅ Real-time audio bridging for TTS output
- ✅ CORS proxy server
- ✅ Real-time status monitoring
- ✅ Transcription quality monitoring

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

### Call Flow (NEW Architecture)

1. **Login to Salesys** - Authenticates with Salesys API using the token
2. **Connect to Verto** - Establishes WebRTC connection to phone system
3. **Initiate Call** - Dials the configured number
4. **Call Active** - When answered, triggers AI agent initialization
5. **Initialize Soniox STT** - Connects to Soniox WebSocket for real-time transcription
6. **Initialize ElevenLabs** - Connects in TEXT INPUT mode (no audio streaming)
7. **Audio → Text Flow**:
   - Phone audio (48kHz) → Soniox STT (16kHz)
   - Soniox transcribes and detects endpoints (`<end>` token)
   - Complete transcript sent to ElevenLabs as text message
8. **Text → Audio Flow**:
   - ElevenLabs generates TTS audio response
   - Audio injected into phone call via Virtual Audio Source

### Audio Processing

**Soniox STT:**
- **Input Sample Rate**: 16kHz (auto-resampled from 48kHz)
- **Format**: PCM 16-bit signed little-endian
- **Channels**: Mono
- **Endpoint Detection**: Enabled (800ms silence threshold)
- **Latency**: ~100ms for transcription

**ElevenLabs TTS:**
- **Input**: Text messages (JSON)
- **Output**: PCM 16-bit audio
- **Sample Rate**: 16kHz
- **Latency**: Depends on text length and TTS generation

### Module Integration

**`soniox-stt.js`**:
- WebSocket connection to Soniox
- Audio capture and resampling (48kHz → 16kHz)
- Token accumulation (final + partial)
- Endpoint detection and transcript finalization
- Callbacks for transcripts and status

**`elevenlabs-bridge.js`** (Modified):
- WebSocket connection to ElevenLabs
- TEXT INPUT mode support
- `sendTextMessage(text)` method for text-based input
- Audio output reception (TTS responses)
- Virtual audio source integration for TTS playback

## File Structure

```
bridge-v4-stt/
├── index.html              # Main application
├── soniox-stt.js           # Soniox real-time STT module (NEW)
├── elevenlabs-bridge.js    # ElevenLabs bridge (modified for text input)
├── virtual-audio-source.js # Virtual audio source for TTS injection
├── proxy_server.js         # CORS proxy server
├── package.json            # Dependencies
└── README.md               # This file
```

## API Endpoints

### Salesys API (via proxy)

- `POST /proxy/api/dial/easytelecom-v1/login` - Get Verto credentials
- `POST /proxy/api/dial/easytelecom-v1/call` - Initiate outbound call

### Soniox API (NEW)

- `WebSocket wss://api.soniox.com/transcribe-websocket` - Real-time transcription
  - Send: Configuration + PCM audio chunks
  - Receive: Token stream with `is_final` flags and `<end>` markers

### ElevenLabs API (modified)

- `GET /v1/convai/conversation/get_signed_url` - Get WebSocket URL
- `WebSocket` - Real-time conversation stream
  - **NEW**: Send text messages via `user_message` type
  - Receive: TTS audio responses

## Configuration

### Required API Keys

1. **Soniox API Key**: Get from [Soniox Dashboard](https://soniox.com)
   - Update `sonioxConfig.apiKey` in `index.html`

2. **ElevenLabs Agent ID & API Key**: Get from [ElevenLabs Dashboard](https://elevenlabs.io)
   - Update `elevenLabsConfig` in `index.html`

3. **Salesys Token**: Provided by Salesys
4. **Telnect Token**: Provided by Telnect

## Troubleshooting

### "YOUR_SONIOX_API_KEY_HERE"

Update the `sonioxConfig.apiKey` in `index.html` with your Soniox API key.

### "ElevenLabs agent ID not configured"

Update the `elevenLabsConfig` in `index.html` with your agent ID from ElevenLabs dashboard.

### "Failed to get signed URL: 401"

Check that your ElevenLabs API key is correct and has the necessary permissions.

### No transcriptions appearing

1. Check browser console for Soniox connection status
2. Verify Soniox API key is correct
3. Check that phone audio stream is active
4. Verify audio is being sent to Soniox (check console logs)

### Transcriptions but no AI response

1. Check ElevenLabs connection status
2. Verify text messages are being sent (check console logs)
3. Check ElevenLabs agent configuration supports text input

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

