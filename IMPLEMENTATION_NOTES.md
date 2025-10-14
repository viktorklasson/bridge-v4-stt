# Implementation Notes - Bridge v4 STT

## Overview

Successfully implemented a new architecture that replaces direct audio streaming to ElevenLabs with a **Soniox STT → ElevenLabs Text** flow. This provides better control over speech-to-text with advanced endpoint detection.

---

## What Changed

### 1. **New Module: `soniox-stt.js`**

A complete real-time STT implementation with:
- WebSocket connection to Soniox API
- Audio resampling (48kHz → 16kHz)
- Token accumulation and management
- Endpoint detection (`<end>` token)
- Callbacks for transcripts and status updates

**Key Features:**
```javascript
- onTranscript(text)      // Called when complete transcript ready
- onPartialTranscript(text) // Called for interim results
- onStatusChange(status)   // Connection status updates
- onError(error)          // Error handling
```

### 2. **Modified: `elevenlabs-bridge.js`**

Added text input mode support:
- New config option: `useTextInput: true`
- New method: `sendTextMessage(text)`
- Conditional audio processing (only in audio mode)
- Backwards compatible (defaults to audio mode)

**Usage:**
```javascript
const bridge = new ElevenLabsBridge({
  agentId: 'your-agent-id',
  apiKey: 'your-api-key',
  useTextInput: true, // NEW
  virtualAudioSource: virtualAudio,
  // ... other config
});

await bridge.initialize(); // No phone stream needed in text mode
bridge.sendTextMessage('Hello, AI!'); // Send text messages
```

### 3. **Updated: `index.html`**

Complete flow integration:
- Added Soniox configuration section
- Created dual initialization (Soniox + ElevenLabs)
- Wired transcript → text message flow
- Updated UI labels and descriptions
- Added proper cleanup on call end

---

## Architecture Flow

```
┌─────────────────┐
│  Phone Call     │ 48kHz audio
│  (WebRTC)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Soniox STT     │ Resamples to 16kHz
│  (WebSocket)    │ Detects endpoints
└────────┬────────┘
         │ Text transcript
         ▼
┌─────────────────┐
│  ElevenLabs AI  │ TEXT INPUT mode
│  (WebSocket)    │ Generates response
└────────┬────────┘
         │ TTS audio
         ▼
┌─────────────────┐
│ Virtual Audio   │ Injects into call
│ Source          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Phone Call     │ Remote party hears AI
│  (WebRTC)       │
└─────────────────┘
```

---

## Configuration Required

### 1. Soniox API Key

Get your API key from [Soniox Dashboard](https://soniox.com) and update:

```javascript
// In index.html, line ~182
const sonioxConfig = {
  apiKey: 'YOUR_SONIOX_API_KEY_HERE' // Replace with actual key
};
```

### 2. ElevenLabs Configuration

Already configured, but ensure your agent supports text input:
- Agent ID: `agent_5901k6ecb9epfwhrn82qgkhg0qtw`
- API Key: Already set

---

## Key Technical Details

### Soniox Configuration

```javascript
{
  api_key: 'your-key',
  model: 'en_v2',
  enable_endpoint_detection: true,  // Critical for turn detection
  enable_streaming: true,
  audio_format: 'pcm_s16le',
  sample_rate: 16000,
  num_channels: 1,
  endpoint_config: {
    silence_duration_ms: 800  // Wait 800ms of silence before finalizing
  }
}
```

### Audio Resampling

- **Phone Audio**: 48kHz (WebRTC standard)
- **Soniox Input**: 16kHz (required)
- **Method**: Browser's AudioContext automatically resamples

```javascript
this.audioContext = new AudioContext({
  sampleRate: 16000  // Browser handles resampling
});
```

### Endpoint Detection

Soniox sends tokens with `is_final` flag:
- `is_final: false` → Still processing, may change
- `is_final: true` → Confirmed, won't change
- `<end>` token → Speaker finished, send complete transcript

**Example token stream:**
```javascript
{ text: "Hello", is_final: false }
{ text: "Hello", is_final: true }
{ text: " ", is_final: true }
{ text: "world", is_final: true }
{ text: "<end>", is_final: true } // Trigger sending to AI
```

---

## Message Flow

### 1. Phone Audio → Soniox

```javascript
// In soniox-stt.js
this.audioProcessor.onaudioprocess = (e) => {
  const pcmData = this.float32ToPcm16(e.inputBuffer.getChannelData(0));
  this.ws.send(bytes); // Send binary PCM data
};
```

### 2. Soniox → Transcript

```javascript
// When endpoint detected
if (foundEndToken && this.currentTranscript.trim()) {
  this.onTranscript(this.currentTranscript.trim());
}
```

### 3. Transcript → ElevenLabs

```javascript
// In index.html
sonioxSTT = new SonioxSTT({
  onTranscript: (text) => {
    elevenLabsBridge.sendTextMessage(text); // Send to AI
  }
});
```

### 4. ElevenLabs Text Message Format

```javascript
{
  type: 'user_message',
  user_message: 'Hello, how are you?'
}
```

### 5. ElevenLabs → TTS Audio

```javascript
// ElevenLabs responds with audio
handleAgentAudio(arrayBuffer) {
  virtualAudioSource.addAudioData(pcmData); // Inject into call
}
```

---

## Testing Checklist

### Before Testing
- [ ] Soniox API key configured
- [ ] ElevenLabs agent ID configured
- [ ] Proxy server running (`npm run dev`)
- [ ] Browser console open for logs

### During Test Call
- [ ] Check "Soniox STT connected" status
- [ ] Check "ElevenLabs ready for text messages" status
- [ ] Speak into phone and watch console for:
  - `[Soniox] Final text: ...`
  - `[Soniox] Endpoint detected!`
  - `[STT→AI] Complete transcript ready: ...`
  - `[ElevenLabs] Sending text message: ...`
- [ ] Verify AI audio response plays to remote party
- [ ] Check audio level indicators update

### Expected Console Logs

```
[Soniox] STT initialized
[Soniox] Connecting to WebSocket...
[Soniox] ✅ WebSocket connected
[Soniox] Sending config: {...}
[Soniox] Audio processing started
[Soniox] 📤 Sent 1 audio chunks
[Soniox] Final text: Hello
[Soniox] 🎯 Endpoint detected!
[Soniox] ✅ Complete transcript: Hello there
[STT→AI] Complete transcript ready: Hello there
[ElevenLabs] 📤 Sending text message: Hello there
[ElevenLabs] ✅ Text message sent
[ElevenLabs] Received AI audio (base64): ...
```

---

## Debugging Tips

### No Transcriptions

1. Check Soniox API key is valid
2. Verify WebSocket connection: `[Soniox] ✅ WebSocket connected`
3. Check audio chunks being sent: `[Soniox] 📤 Sent X audio chunks`
4. Verify audio resampling working (should be automatic)

### Transcriptions but No AI Response

1. Check ElevenLabs connection: `[ElevenLabs] conversation_ready`
2. Verify text messages sent: `[ElevenLabs] 📤 Sending text message`
3. Check ElevenLabs console for errors
4. Verify agent supports text input mode

### Audio Output Not Playing

1. Check virtual audio source initialized
2. Verify audio data received: `[ElevenLabs] Received AI audio`
3. Check audio injection: `[ElevenLabs] Sent AI audio to virtual mic`
4. Verify phone call still active

---

## Performance Considerations

### Latency Breakdown

1. **Audio capture**: ~85ms (4096 buffer @ 48kHz)
2. **Soniox transcription**: ~100-200ms
3. **Endpoint detection**: 800ms silence wait
4. **ElevenLabs processing**: Varies (500-2000ms)
5. **TTS audio**: ~200-500ms

**Total estimated latency**: 1.5-3.5 seconds from speech end to response start

### Optimization Options

1. **Reduce endpoint silence**: Lower `silence_duration_ms` (may cause false triggers)
2. **Manual finalization**: Call `sonioxSTT.finalize()` on specific triggers
3. **Streaming TTS**: If ElevenLabs supports streaming text input
4. **Buffer size tuning**: Adjust audio processor buffer for lower latency

---

## Future Enhancements

### Potential Improvements

1. **Partial transcript display**: Show real-time transcription in UI
2. **Confidence scores**: Show STT confidence levels
3. **Multi-language support**: Switch Soniox model based on detected language
4. **Interruption handling**: Stop AI audio when user speaks
5. **Context accumulation**: Build conversation history
6. **Error recovery**: Automatic reconnection on WebSocket failures

### Code Todos

```javascript
// In index.html
const sonioxConfig = {
  apiKey: 'YOUR_SONIOX_API_KEY_HERE' // TODO: Replace with actual key
};
```

---

## Backwards Compatibility

The ElevenLabs bridge still supports audio mode:

```javascript
// Audio mode (old behavior)
const bridge = new ElevenLabsBridge({
  useTextInput: false, // or omit (defaults to false)
  // ... other config
});
await bridge.initialize(phoneStream); // Pass phone stream

// Text mode (new behavior)
const bridge = new ElevenLabsBridge({
  useTextInput: true,
  // ... other config
});
await bridge.initialize(); // No phone stream needed
```

---

## Resources

- [Soniox Real-time Transcription Docs](https://soniox.com/docs/stt/rt/real-time-transcription)
- [Soniox Endpoint Detection](https://soniox.com/docs/stt/rt/endpoint-detection)
- [ElevenLabs Conversational AI Docs](https://elevenlabs.io/docs/agents-platform/libraries/java-script)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

---

## Summary

✅ **Successfully implemented** the new STT architecture with:
- Soniox real-time transcription
- Endpoint detection for natural turn-taking
- Text-based input to ElevenLabs
- Full integration with existing phone system
- Backwards compatible changes

🔑 **Next step**: Configure Soniox API key and test with a real call!

