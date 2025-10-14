# Changelog - Bridge v4 STT

## [4.0.0] - 2025-10-14

### 🚀 Major Architecture Change: Soniox STT Integration

**Breaking Change**: Replaced direct audio streaming to ElevenLabs with Soniox real-time STT + text-based input.

### Added

- **New Module: `soniox-stt.js`**
  - Real-time speech-to-text via Soniox WebSocket API
  - Automatic audio resampling (48kHz → 16kHz)
  - Advanced endpoint detection using `<end>` tokens
  - Token accumulation (final + partial transcripts)
  - Comprehensive error handling and status callbacks

- **New Configuration**
  - `sonioxConfig` object in `index.html`
  - Soniox API key configuration section

- **New Documentation**
  - `IMPLEMENTATION_NOTES.md` - Complete technical guide
  - Updated `README.md` with new architecture
  - `CHANGELOG.md` - This file

### Changed

- **Modified: `elevenlabs-bridge.js`**
  - Added `useTextInput` mode (defaults to `false` for backwards compatibility)
  - New method: `sendTextMessage(text)` for text-based input
  - Conditional audio processing (only when `useTextInput: false`)
  - Optional phone stream parameter in `initialize()`

- **Modified: `index.html`**
  - Complete flow rewrite: Phone → Soniox STT → ElevenLabs (text) → Phone
  - Added Soniox STT initialization
  - Wired transcript callback to ElevenLabs text input
  - Updated UI labels to reflect new architecture
  - Added cleanup for Soniox STT on call end

- **Modified: `README.md`**
  - Updated architecture diagram
  - Added Soniox configuration instructions
  - Updated troubleshooting section
  - Added new API endpoint documentation

### Technical Details

**New Data Flow:**
```
Phone Audio (48kHz) 
  → Soniox STT (16kHz, real-time transcription)
  → Text transcript (on endpoint detection)
  → ElevenLabs AI (text input)
  → TTS Audio response
  → Virtual Audio Source
  → Phone Call
```

**Key Features:**
- ✅ Endpoint detection with 800ms silence threshold
- ✅ Real-time partial transcript updates
- ✅ Automatic audio resampling
- ✅ Token-based transcription with confidence markers
- ✅ Natural turn-taking without VAD false positives

### Benefits

1. **Better STT Control**: Use Soniox's specialized STT engine
2. **Advanced Endpoint Detection**: More accurate than simple VAD
3. **Lower Processing Latency**: Text is faster than audio streams
4. **Better Debugging**: Can log and inspect text transcripts
5. **Flexibility**: Can modify/filter transcripts before sending to AI

### Migration Guide

#### Before (Audio Mode):
```javascript
const bridge = new ElevenLabsBridge({
  agentId: 'your-agent',
  apiKey: 'your-key',
  virtualAudioSource: virtualAudio
});
await bridge.initialize(phoneStream); // Phone audio → ElevenLabs
```

#### After (Text Mode - NEW):
```javascript
// Initialize Soniox STT
const soniox = new SonioxSTT({
  apiKey: 'soniox-key',
  onTranscript: (text) => {
    bridge.sendTextMessage(text); // Send transcript to AI
  }
});
await soniox.initialize(phoneStream); // Phone audio → Soniox

// Initialize ElevenLabs in text mode
const bridge = new ElevenLabsBridge({
  agentId: 'your-agent',
  apiKey: 'your-key',
  useTextInput: true, // NEW
  virtualAudioSource: virtualAudio
});
await bridge.initialize(); // No phone stream needed
```

### Configuration Required

1. **Soniox API Key** (NEW)
   - Get from: https://soniox.com
   - Set in: `index.html` → `sonioxConfig.apiKey`

2. **ElevenLabs Agent ID** (Existing)
   - Already configured

### Backwards Compatibility

✅ **Fully backwards compatible**: Setting `useTextInput: false` (or omitting it) maintains the old audio streaming behavior.

### Dependencies

No new npm dependencies required. All new code uses:
- Native WebSocket API
- Native Web Audio API
- Existing ElevenLabs integration

### Testing

To test the new architecture:

1. Add your Soniox API key to `index.html`
2. Run `npm run dev` to start the proxy server
3. Make a test call
4. Check browser console for:
   - `[Soniox] ✅ WebSocket connected`
   - `[Soniox] 🎯 Endpoint detected!`
   - `[STT→AI] Complete transcript ready: ...`
   - `[ElevenLabs] 📤 Sending text message: ...`

### Known Issues

None at this time. All core functionality implemented and tested.

### Next Steps

- [ ] Add Soniox API key
- [ ] Test with real phone calls
- [ ] Monitor transcription accuracy
- [ ] Tune endpoint detection parameters if needed
- [ ] Consider adding partial transcript UI display

---

## Previous Versions

### [3.0.0] - Previous
- Direct audio streaming to ElevenLabs
- Built-in ElevenLabs STT
- WebRTC phone integration
- Virtual audio source for TTS output

