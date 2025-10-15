/**
 * Soniox Speech-to-Text Real-time Transcription
 * Handles real-time transcription with endpoint detection
 */

class SonioxSTT {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.context = config.context || ''; // Context/prompt for better transcription accuracy
    this.onTranscript = config.onTranscript || (() => {}); // Called when full transcript ready (after endpoint)
    this.onPartialTranscript = config.onPartialTranscript || (() => {}); // Called for partial updates
    this.onStatusChange = config.onStatusChange || (() => {});
    this.onError = config.onError || (() => {});
    
    this.ws = null;
    this.isActive = false;
    this.audioContext = null;
    this.audioProcessor = null;
    this.audioSource = null;
    
    // Transcript buffering
    this.currentTranscript = ''; // Accumulated final tokens
    this.partialTranscript = ''; // Current non-final tokens
    
    // Audio buffering
    this.audioBuffer = new Int16Array(0);
    this.SAMPLES_PER_CHUNK = 1600; // 100ms at 16kHz
    this.TARGET_SAMPLE_RATE = 16000; // Soniox expects 16kHz
    
    // Keepalive to maintain session during silence
    this.keepaliveInterval = null;
    this.lastAudioTime = Date.now();
    
    console.log('[Soniox] STT initialized');
  }

  /**
   * Initialize and connect to Soniox
   * @param {MediaStream} audioStream - The audio stream to transcribe
   */
  async initialize(audioStream, preConnectedContext = null, preConnectedSource = null) {
    console.log('[Soniox] ========== INITIALIZING STT ==========');
    console.log('[Soniox] Audio stream provided:', !!audioStream);
    console.log('[Soniox] Audio stream ID:', audioStream?.id);
    console.log('[Soniox] Audio stream active:', audioStream?.active);
    console.log('[Soniox] Audio tracks:', audioStream?.getAudioTracks().length);
    console.log('[Soniox] Pre-connected context provided:', !!preConnectedContext);
    
    try {
      this.onStatusChange('initializing');
      
      // Use pre-connected context if provided (connected while stream was fresh)
      if (preConnectedContext && preConnectedSource) {
        console.log('[Soniox] ✅ Using PRE-CONNECTED audio context (connected before bridge)');
        this.audioContext = preConnectedContext;
        this.audioSource = preConnectedSource;
      } else {
        // Create audio context at 16kHz (Soniox requirement)
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.TARGET_SAMPLE_RATE
        });
        console.log('[Soniox] ✅ Audio context created at', this.audioContext.sampleRate, 'Hz');
      }
      
      // Connect to Soniox WebSocket
      console.log('[Soniox] Connecting to WebSocket...');
      await this.connectWebSocket();
      console.log('[Soniox] ✅ WebSocket connected');
      
      // Start processing audio
      console.log('[Soniox] Starting audio processing...');
      // Only pass stream if we don't have pre-connected source
      this.startAudioProcessing(audioStream, !!preConnectedSource);
      console.log('[Soniox] ✅ Audio processing started');
      
      this.isActive = true;
      this.onStatusChange('connected');
      
      // Start keepalive timer to maintain session during silence
      this.startKeepalive();
      
      console.log('[Soniox] ========== STT FULLY ACTIVE ==========');
      
    } catch (error) {
      console.error('[Soniox] ❌❌❌ Initialization failed:', error);
      console.error('[Soniox] Error stack:', error.stack);
      this.onStatusChange('error');
      this.onError(error);
      throw error;
    }
  }

  /**
   * Connect to Soniox WebSocket API
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      // CORRECT endpoint from official docs
      const wsUrl = `wss://stt-rt.soniox.com/transcribe-websocket`;
      
      console.log('[Soniox] Connecting to CORRECT endpoint:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[Soniox] ✅✅✅ WebSocket CONNECTED successfully!');
        
        // Send configuration message
        // Using CORRECT field names from official WebSocket API docs
        const config = {
          api_key: this.apiKey,
          model: 'stt-rt-preview',  // Real-time model
          enable_endpoint_detection: true,
          audio_format: 'pcm_s16le',
          sample_rate: this.TARGET_SAMPLE_RATE,
          num_channels: 1,
          language_hints: ['sv'],  // Swedish language
          // Context for better accuracy (domain-specific terms, names, products)
          context: this.context || ''
        };
        
        console.log('[Soniox] 📤 Sending config:', JSON.stringify(config));
        this.ws.send(JSON.stringify(config));
        console.log('[Soniox] ✅ Config sent, waiting for acknowledgment...');
        
        resolve();
      };

      this.ws.onmessage = (event) => {
        console.log('[Soniox] 📨 WebSocket message received, type:', typeof event.data, 'length:', event.data?.length || 'N/A');
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[Soniox] WebSocket error:', error);
        this.onError(error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('[Soniox] WebSocket closed:', event.code, event.reason);
        this.onStatusChange('disconnected');
      };

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  /**
   * Handle messages from Soniox
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      // Log ALL messages from Soniox for debugging
      console.log('[Soniox] 📩 Received message:', JSON.stringify(message).substring(0, 200));
      
      // Handle CORRECT format from official WebSocket API docs
      if (message.tokens !== undefined) {
        const tokens = message.tokens || [];
        
        console.log('[Soniox] 📩 Received', tokens.length, 'tokens');
        
        let finalText = '';
        let partialText = '';
        let hasEndpoint = false;
        
        // Process tokens
        for (const token of tokens) {
          const text = token.text || '';
          
          // Check for endpoint marker
          if (text === '<end>') {
            hasEndpoint = true;
            console.log('[Soniox] 🎯 Endpoint marker found!');
            continue;
          }
          
          if (token.is_final) {
            finalText += text;
          } else {
            partialText += text;
          }
        }
        
        // Update accumulated transcripts
        if (finalText) {
          this.currentTranscript += finalText;
          console.log('[Soniox] ✅ Final text added:', finalText, '| Total:', this.currentTranscript);
        }
        
        // Update partial transcript
        this.partialTranscript = partialText;
        
        // Send partial updates (final + partial)
        const fullPartial = this.currentTranscript + partialText;
        if (fullPartial) {
          console.log('[Soniox] 📝 Partial update:', fullPartial);
          this.onPartialTranscript(fullPartial);
        }
        
        // If endpoint detected, send complete transcript and reset
        if (hasEndpoint && this.currentTranscript.trim()) {
          console.log('[Soniox] ========== ENDPOINT DETECTED ==========');
          console.log('[Soniox] ✅✅✅ Complete transcript:', this.currentTranscript);
          this.onTranscript(this.currentTranscript.trim());
          
          // Reset for next utterance
          this.currentTranscript = '';
          this.partialTranscript = '';
          console.log('[Soniox] Reset for next utterance');
        }
        
        // Log audio progress
        if (message.final_audio_proc_ms !== undefined) {
          console.log('[Soniox] Audio processed:', message.final_audio_proc_ms, 'ms (final),', message.total_audio_proc_ms, 'ms (total)');
        }
        
        return;
      } else if (message.error) {
        console.error('[Soniox] ❌❌❌ Error from server:', message.error);
        this.onError(new Error(message.error));
      } else if (message.status) {
        console.log('[Soniox] Status update:', message.status);
      } else {
        console.log('[Soniox] ⚠️ Unknown message type:', Object.keys(message));
      }
      
    } catch (error) {
      console.error('[Soniox] Failed to parse message:', error, data);
    }
  }

  /**
   * Start processing audio from the stream
   */
  startAudioProcessing(audioStream, usePreConnected = false) {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    // Create audio source from stream (unless using pre-connected)
    if (!usePreConnected) {
      console.log('[Soniox] Creating MediaStreamSource from audio stream...');
      this.audioSource = this.audioContext.createMediaStreamSource(audioStream);
    } else {
      console.log('[Soniox] Using pre-connected audio source');
    }
    
    // Create processor for capturing audio
    this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    let chunkCount = 0;
    let debugCounter = 0;
    
    this.audioProcessor.onaudioprocess = (e) => {
      debugCounter++;
      
      // ALWAYS log first 20 callbacks to debug
      if (debugCounter <= 20) {
        console.log('[Soniox] 🔥 onaudioprocess callback #' + debugCounter + ' FIRED - Active:', this.isActive, 'WS:', this.ws?.readyState);
      }
      
      if (!this.isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (debugCounter % 50 === 0) {
          console.log('[Soniox] Not ready - Active:', this.isActive, 'WS:', this.ws?.readyState);
        }
        return;
      }

      // Get audio data (already at 16kHz thanks to AudioContext)
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Check if audio contains actual sound
      let sum = 0;
      let maxSample = 0;
      for (let i = 0; i < inputData.length; i++) {
        const abs = Math.abs(inputData[i]);
        sum += abs;
        if (abs > maxSample) maxSample = abs;
      }
      const avgAmplitude = sum / inputData.length;
      
      // Log EVERY callback to see what's happening
      if (debugCounter <= 10 || debugCounter % 10 === 0) {
        console.log('[Soniox] 🎤 Audio callback #' + debugCounter, '- Avg:', avgAmplitude.toFixed(6), 'Max:', maxSample.toFixed(6), 'Samples:', inputData.length);
        if (maxSample < 0.001) {
          console.warn('[Soniox] ⚠️⚠️⚠️ AUDIO IS SILENT! Max sample:', maxSample);
        } else {
          console.log('[Soniox] ✅ AUDIO HAS SIGNAL! Max:', maxSample);
        }
      }
      
      // Convert Float32 to PCM 16-bit
      const pcmData = this.float32ToPcm16(inputData);
      
      // Add to buffer
      const newBuffer = new Int16Array(this.audioBuffer.length + pcmData.length);
      newBuffer.set(this.audioBuffer);
      newBuffer.set(pcmData, this.audioBuffer.length);
      this.audioBuffer = newBuffer;
      
      if (debugCounter <= 5) {
        console.log('[Soniox] Buffer size after adding:', this.audioBuffer.length, 'samples');
      }

      // Send complete chunks
      while (this.audioBuffer.length >= this.SAMPLES_PER_CHUNK) {
        const chunk = this.audioBuffer.slice(0, this.SAMPLES_PER_CHUNK);
        this.audioBuffer = this.audioBuffer.slice(this.SAMPLES_PER_CHUNK);
        
        chunkCount++;
        
        // DETAILED logging for first chunk
        if (chunkCount === 1) {
          console.log('[Soniox] ==================== FIRST CHUNK DETAILS ====================');
          console.log('[Soniox] Chunk length:', chunk.length, 'Int16 samples');
          console.log('[Soniox] Expected bytes:', chunk.length * 2, '(Int16 = 2 bytes per sample)');
          console.log('[Soniox] First 20 PCM Int16 values:', Array.from(chunk.slice(0, 20)));
          
          // Check byte order (little-endian)
          const testValue = chunk[0];
          const lowByte = testValue & 0xFF;
          const highByte = (testValue >> 8) & 0xFF;
          console.log('[Soniox] First sample:', testValue, '= bytes:', lowByte, highByte, '(little-endian: low byte first)');
        }
        
        // Send as binary data - direct buffer access for proper byte order
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        
        if (chunkCount === 1) {
          console.log('[Soniox] Uint8Array length:', bytes.length, 'bytes');
          console.log('[Soniox] First 40 bytes (Uint8):', Array.from(bytes.slice(0, 40)));
          console.log('[Soniox] WebSocket readyState:', this.ws.readyState, '(1=OPEN)');
          console.log('[Soniox] WebSocket bufferedAmount BEFORE send:', this.ws.bufferedAmount);
        }
        
        this.ws.send(bytes);
        
        if (chunkCount === 1) {
          console.log('[Soniox] WebSocket bufferedAmount AFTER send:', this.ws.bufferedAmount);
          console.log('[Soniox] ==================== END FIRST CHUNK ====================');
        }
        
        console.log('[Soniox] ✅ ws.send() called for chunk #' + chunkCount);
        
        if (chunkCount <= 5 || chunkCount % 10 === 0) {
          console.log('[Soniox] 📤 Sent chunk #' + chunkCount, '- Size:', bytes.length, 'bytes,', chunk.length, 'samples');
        }
      }
    };

    // Connect audio pipeline
    console.log('[Soniox] 🔌 Connecting audio pipeline...');
    console.log('[Soniox] audioSource:', this.audioSource);
    console.log('[Soniox] audioProcessor:', this.audioProcessor);
    console.log('[Soniox] audioContext.destination:', this.audioContext.destination);
    console.log('[Soniox] audioContext.state:', this.audioContext.state);
    
    this.audioSource.connect(this.audioProcessor);
    console.log('[Soniox] ✅ Source connected to processor');
    
    this.audioProcessor.connect(this.audioContext.destination);
    console.log('[Soniox] ✅ Processor connected to destination');
    
    console.log('[Soniox] 🎤 Audio pipeline fully connected - callbacks should start firing NOW');
    console.log('[Soniox] Audio processing started');
  }

  /**
   * Convert Float32Array to PCM 16-bit Int16Array
   */
  float32ToPcm16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * Start keepalive timer to maintain session during silence
   */
  startKeepalive() {
    // Send keepalive every 10 seconds if no audio sent recently
    this.keepaliveInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const silenceDuration = Date.now() - this.lastAudioTime;
      
      // If more than 5 seconds of silence, send keepalive
      if (silenceDuration > 5000) {
        console.log('[Soniox] Sending keepalive (silence:', Math.round(silenceDuration/1000), 's)');
        this.ws.send(JSON.stringify({ type: 'keepalive' }));
      }
    }, 10000); // Check every 10 seconds

    console.log('[Soniox] Keepalive timer started');
  }

  /**
   * Stop keepalive timer
   */
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      console.log('[Soniox] Keepalive timer stopped');
    }
  }

  /**
   * Manually finalize current transcript (force endpoint)
   */
  finalize() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[Soniox] Sending manual finalize');
      this.ws.send(JSON.stringify({ type: 'finalize' }));
    }
  }

  /**
   * Stop transcription and cleanup
   */
  async stop() {
    console.log('[Soniox] Stopping STT...');
    
    this.isActive = false;
    
    // Stop keepalive
    this.stopKeepalive();
    
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    
    this.currentTranscript = '';
    this.partialTranscript = '';
    
    this.onStatusChange('stopped');
    console.log('[Soniox] STT stopped');
  }
}

// Export for use in HTML
window.SonioxSTT = SonioxSTT;

