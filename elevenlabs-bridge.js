/**
 * ElevenLabs Audio Bridge
 * Bridges audio between a phone call and an ElevenLabs Conversational AI agent
 */

class ElevenLabsBridge {
  constructor(config) {
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
    this.virtualAudioSource = config.virtualAudioSource; // Virtual mic for injecting AI audio into call
    this.onStatusChange = config.onStatusChange || (() => {});
    this.onAgentMessage = config.onAgentMessage || (() => {});
    this.onAudioLevel = config.onAudioLevel || (() => {}); // Callback for audio level updates
    this.customVariables = config.customVariables || {}; // Custom variables to pass to agent
    this.useTextInput = config.useTextInput !== undefined ? config.useTextInput : false; // NEW: Text input mode
    
    this.ws = null;
    this.audioContext = null;
    this.phoneInputStream = null;
    this.isActive = false;
    this.conversationReady = false; // Wait for ElevenLabs to confirm ready
    this.firstAudioSent = false;
    
    // Audio level tracking
    this.lastPhoneLevel = 0;
    this.lastAgentLevel = 0;
    
    // Audio buffering for chunking (only used in audio mode)
    this.audioBuffer = new Int16Array(0);
    this.SAMPLES_PER_CHUNK = 1600; // 100ms at 16kHz
    this.INPUT_SAMPLE_RATE = 48000;
    this.OUTPUT_SAMPLE_RATE = 16000;
    
    // Audio processing nodes (only used in audio mode)
    this.phoneSource = null;
    this.phoneProcessor = null;
    
    console.log('[ElevenLabs] Bridge initialized - Mode:', this.useTextInput ? 'TEXT' : 'AUDIO', 'Virtual audio:', !!this.virtualAudioSource);
  }

  /**
   * Initialize the audio bridge
   * @param {MediaStream} phoneStream - The audio stream from the phone call (WebRTC) - only needed in audio mode
   */
  async initialize(phoneStream = null) {
    this.onStatusChange('initializing');
    
    try {
      // Only create audio context if we're in audio mode (for audio streaming input)
      if (!this.useTextInput && phoneStream) {
        // Create audio context with 16kHz sample rate (ElevenLabs speech recognition needs 16kHz)
        // Browser will automatically resample phone audio from 48kHz to 16kHz
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000
        });
        
        console.log('[ElevenLabs] Audio context created:', this.audioContext.sampleRate, 'Hz (16kHz for speech recognition)');
        
        // Store phone stream (phone audio → AI)
        this.phoneInputStream = phoneStream;
        console.log('[ElevenLabs] Using phone audio stream - AI will hear phone call audio');
      } else if (this.useTextInput) {
        console.log('[ElevenLabs] TEXT MODE - No audio input needed, will use text messages');
      }
      
      // Try public agent connection first (no auth needed)
      const publicUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.agentId}`;
      
      console.log('[ElevenLabs] Attempting public agent connection...');
      
      try {
        await this.connectToAgent(publicUrl);
      } catch (publicError) {
        console.log('[ElevenLabs] Public connection failed, trying authenticated connection...');
        // If public connection fails, try getting signed URL (requires API key with permissions)
        const signedUrl = await this.getSignedUrl();
        await this.connectToAgent(signedUrl);
      }
      
      // Start audio processing only in audio mode
      if (!this.useTextInput && phoneStream) {
        this.startAudioProcessing();
      }
      
      this.isActive = true;
      this.onStatusChange('connected');
      
    } catch (error) {
      console.error('[ElevenLabs] Initialization failed:', error);
      this.onStatusChange('error', error);
      throw error;
    }
  }

  /**
   * Get signed URL from ElevenLabs API
   */
  async getSignedUrl() {
    console.log('[ElevenLabs] Requesting signed URL for agent:', this.agentId);
    
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${this.agentId}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': this.apiKey
        }
      }
    );

    console.log('[ElevenLabs] Signed URL response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ElevenLabs] Signed URL error:', errorText);
      throw new Error(`Failed to get signed URL: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[ElevenLabs] Got signed URL successfully');
    return data.signed_url;
  }

  /**
   * Connect to ElevenLabs agent via WebSocket
   */
  async connectToAgent(signedUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(signedUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[ElevenLabs] ✅ WebSocket connected successfully!');
        this.onStatusChange('websocket_connected');
        
        // DON'T send anything - let server initiate and send conversation_initiation_metadata
        // The public agent API handles this automatically
        console.log('[ElevenLabs] Waiting for server to send conversation_initiation_metadata...');
        
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleAgentMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[ElevenLabs] WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('[ElevenLabs] WebSocket closed - Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);
        this.onStatusChange('disconnected');
        
        // If WebSocket closes unexpectedly, trigger call hangup
        if (!event.wasClean || event.code !== 1000) {
          console.error('[ElevenLabs] Unexpected disconnect - will trigger call hangup');
          this.onStatusChange('error_disconnect');
        }
      };

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  /**
   * Start processing audio from the phone call
   */
  startAudioProcessing() {
    if (!this.phoneInputStream || !this.audioContext) {
      throw new Error('Audio context or phone stream not initialized');
    }

    // Create audio source from phone stream
    this.phoneSource = this.audioContext.createMediaStreamSource(this.phoneInputStream);
    
    // Create script processor for capturing audio
    // Using 4096 buffer size for good balance between latency and performance
    this.phoneProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    let audioChunkCount = 0;
    let debugCounter = 0;
    
    this.phoneProcessor.onaudioprocess = (e) => {
      debugCounter++;
      
      // Debug every 50 calls
      if (debugCounter % 50 === 0) {
        console.log('[ElevenLabs] 🔄 Audio processor running. Active:', this.isActive, 'WS:', this.ws?.readyState, 'Ready:', this.conversationReady);
      }
      
      // Only send audio when conversation is ready
      if (!this.isActive) {
        if (debugCounter % 50 === 0) console.log('[ElevenLabs] ⚠️ Not active');
        return;
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (debugCounter % 50 === 0) console.log('[ElevenLabs] ⚠️ WebSocket not open');
        return;
      }
      if (!this.conversationReady) {
        if (debugCounter % 50 === 0) console.log('[ElevenLabs] ⚠️ Conversation not ready yet');
        return;
      }

      // Get audio data from phone call (WebRTC stream)
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate audio level (RMS)
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      const level = Math.min(100, Math.round(rms * 300)); // Scale to 0-100%
      
      // Update audio level periodically
      if (debugCounter % 10 === 0) {
        this.lastPhoneLevel = level;
        this.onAudioLevel('phone-to-agent', level);
      }
      
      // Check if there's actual audio (not just silence)
      const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
      
      if (hasAudio) {
        audioChunkCount++;
        if (audioChunkCount === 1) {
          console.log('[ElevenLabs] 🎤 First audio with actual sound detected!');
        }
        if (audioChunkCount % 10 === 0) {
          console.log('[ElevenLabs] ✅ Sent', audioChunkCount, 'audio chunks with sound to AI (level:', level + '%)');
        }
      }
      
      // Always send audio (even silence) to keep stream alive
      // Convert Float32Array to Int16Array (PCM 16-bit)
      // AudioContext already resampled from 48kHz to 16kHz automatically
      const pcmData = this.float32ToPcm16(inputData);
      
      // Send to ElevenLabs (now at 16kHz)
      this.sendAudioToAgent(pcmData);
    };

    // Connect the audio pipeline
    this.phoneSource.connect(this.phoneProcessor);
    this.phoneProcessor.connect(this.audioContext.destination);
    
    console.log('[ElevenLabs] Audio processing started');
  }

  /**
   * Convert Float32Array to PCM 16-bit Int16Array
   */
  float32ToPcm16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * Convert PCM 16-bit to Float32Array
   */
  pcm16ToFloat32(int16Array) {
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
    }
    return float32Array;
  }

  /**
   * Send audio data to ElevenLabs agent (with buffering and chunking)
   * Only used in audio mode
   */
  sendAudioToAgent(pcmData) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.conversationReady) {
      return;
    }

    // Append to buffer
    const newBuffer = new Int16Array(this.audioBuffer.length + pcmData.length);
    newBuffer.set(this.audioBuffer);
    newBuffer.set(pcmData, this.audioBuffer.length);
    this.audioBuffer = newBuffer;

    // Send complete chunks of 4800 samples (100ms at 48kHz)
    while (this.audioBuffer.length >= this.SAMPLES_PER_CHUNK) {
      const chunk = this.audioBuffer.slice(0, this.SAMPLES_PER_CHUNK);
      this.audioBuffer = this.audioBuffer.slice(this.SAMPLES_PER_CHUNK);
      
      // Convert to Uint8Array for base64 encoding
      const bytes = new Uint8Array(chunk.buffer);
      
      // Safe base64 encoding (chunked to avoid stack overflow)
      const chunkSize = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const subChunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, subChunk);
      }
      const base64 = btoa(binary);
      
      // Send as user_audio_chunk (NOT wrapped in audio_event)
      this.ws.send(JSON.stringify({
        user_audio_chunk: base64
      }));
      
      // Log first send
      if (!this.firstAudioSent) {
        console.log('[ElevenLabs] 📤 FIRST AUDIO CHUNK SENT! Samples:', this.SAMPLES_PER_CHUNK, 'Base64 length:', base64.length);
        this.firstAudioSent = true;
      }
    }
  }

  /**
   * Send text message to ElevenLabs agent
   * Used in text input mode
   * @param {string} text - The user's message text
   */
  sendTextMessage(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[ElevenLabs] ❌ Cannot send text - WebSocket not open. State:', this.ws?.readyState);
      return;
    }
    
    if (!this.conversationReady) {
      console.error('[ElevenLabs] ❌ Cannot send text - Conversation not ready yet');
      return;
    }

    if (!text || !text.trim()) {
      console.warn('[ElevenLabs] Empty text message, skipping');
      return;
    }

    console.log('[ElevenLabs] 📤📤📤 Sending USER TEXT MESSAGE to AI:', text);

    // Try simple "text" field first
    const simpleMessage = {
      text: text.trim()
    };
    
    console.log('[ElevenLabs] Trying simple format (just text field):', JSON.stringify(simpleMessage));
    this.ws.send(JSON.stringify(simpleMessage));
    
    // Also try user_input format
    setTimeout(() => {
      const message2 = {
        type: 'user_input',
        text: text.trim()
      };
      console.log('[ElevenLabs] Also trying user_input format:', JSON.stringify(message2));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message2));
      }
    }, 100);
    
    // And user_message format
    setTimeout(() => {
      const message3 = {
        type: 'user_message',
        user_message: text.trim()
      };
      console.log('[ElevenLabs] Also trying user_message format:', JSON.stringify(message3));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message3));
      }
    }, 200);
    
    console.log('[ElevenLabs] ✅ Text messages sent, trying multiple formats');
    console.log('[ElevenLabs] Waiting for AI response...');
  }

  /**
   * Handle messages from ElevenLabs agent
   */
  handleAgentMessage(data) {
    if (typeof data === 'string') {
      // JSON message
      try {
        const message = JSON.parse(data);
        console.log('[ElevenLabs] 📨 Message:', message.type);
        
        if (message.type === 'conversation_initiation_metadata') {
          console.log('[ElevenLabs] ✅ Conversation initialized! Server metadata received.');
          console.log('[ElevenLabs] Metadata:', message);
          
          // CRITICAL: Send client data response with dynamic variables
          // Dynamic variables are at top level, not nested
          const clientResponse = {
            type: 'conversation_initiation_client_data',
            conversation_config_override: {},
            custom_llm_extra_body: {},
            dynamic_variables: this.customVariables
          };
          
          console.log('[ElevenLabs] Sending client response:', JSON.stringify(clientResponse));
          this.ws.send(JSON.stringify(clientResponse));
          
          console.log('[ElevenLabs] ⏳ Waiting for server to acknowledge before sending audio...');
          // Don't set conversationReady yet - wait for next message
        } else if (message.type === 'conversation_initiation_client_data_received') {
          // Server acknowledged our client data - now ready for audio!
          if (!this.conversationReady) {
            console.log('[ElevenLabs] ✅ Server ready! Now we can send audio');
            this.conversationReady = true;
            this.onStatusChange('conversation_ready');
          }
        } else if (message.type === 'ping') {
          // Handle ping immediately and send pong
          const pongResponse = {
            type: 'pong',
            event_id: message.ping_event?.event_id
          };
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(pongResponse));
            // Don't log every pong to reduce noise
          }
          
          // Also mark as ready if not already
          if (!this.conversationReady) {
            this.conversationReady = true;
            this.onStatusChange('conversation_ready');
          }
        } else if (message.type === 'audio') {
          // Server is sending audio as JSON with base64
          if (message.audio_event && message.audio_event.audio_base_64) {
            // Decode base64 to binary
            const binaryString = atob(message.audio_event.audio_base_64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Convert to Int16Array (PCM 16-bit)
            const pcmData = new Int16Array(bytes.buffer);
            
            console.log('[ElevenLabs] Received AI audio (base64):', pcmData.length, 'samples');
            
            // Send to virtual audio source
            if (this.virtualAudioSource) {
              this.virtualAudioSource.addAudioData(pcmData);
              console.log('[ElevenLabs] Sent AI audio to virtual mic → phone call');
            }
          }
        } else if (message.type === 'agent_response') {
          const agentText = message.agent_response_event?.agent_response || message.agent_response;
          console.log('[ElevenLabs] 🤖🤖🤖 Agent TEXT response:', agentText);
          this.onAgentMessage(agentText);
        } else if (message.type === 'agent_response_correction') {
          console.log('[ElevenLabs] Agent correction:', message);
        } else if (message.type === 'user_transcript') {
          const userText = message.user_transcription_event?.user_transcript || message.user_transcript;
          console.log('[ElevenLabs] 🎤 User transcript (from ElevenLabs):', userText);
        } else if (message.type === 'interruption') {
          console.log('[ElevenLabs] User interrupted agent');
        } else {
          console.log('[ElevenLabs] ⚠️ Unknown/unhandled message type:', message.type);
          console.log('[ElevenLabs] Full message:', JSON.stringify(message).substring(0, 500));
        }
      } catch (error) {
        console.error('[ElevenLabs] Failed to parse message:', error, data);
      }
    } else if (data instanceof ArrayBuffer) {
      // Binary audio data from agent
      this.handleAgentAudio(data);
    }
  }

  /**
   * Handle audio data from ElevenLabs agent
   */
  handleAgentAudio(arrayBuffer) {
    console.log('[ElevenLabs] Received AI audio:', arrayBuffer.byteLength, 'bytes');
    
    // Convert ArrayBuffer to Int16Array (PCM 16-bit)
    const pcmData = new Int16Array(arrayBuffer);
    
    // Calculate audio level (RMS)
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
      const normalized = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7FFF);
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / pcmData.length);
    const level = Math.min(100, Math.round(rms * 300)); // Scale to 0-100%
    
    // Update audio level
    this.lastAgentLevel = level;
    this.onAudioLevel('agent-to-phone', level);
    
    console.log('[ElevenLabs] AI audio level:', level + '%');
    
    // Send to virtual audio source (which feeds into the phone call)
    if (this.virtualAudioSource) {
      this.virtualAudioSource.addAudioData(pcmData);
      console.log('[ElevenLabs] Sent AI audio to virtual mic → phone call');
    } else {
      console.warn('[ElevenLabs] No virtual audio source available, audio discarded');
    }
  }

  /**
   * End the bridge session
   */
  async endSession() {
    this.isActive = false;
    
    if (this.phoneProcessor) {
      this.phoneProcessor.disconnect();
      this.phoneProcessor = null;
    }
    
    if (this.phoneSource) {
      this.phoneSource.disconnect();
      this.phoneSource = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    
    this.onStatusChange('ended');
    console.log('[ElevenLabs] Bridge session ended');
  }
}

// Export for use in HTML
window.ElevenLabsBridge = ElevenLabsBridge;

