/**
 * Soniox Speech-to-Text Real-time Transcription
 * Handles real-time transcription with endpoint detection
 */

class SonioxSTT {
  constructor(config) {
    this.apiKey = config.apiKey;
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
      const wsUrl = `wss://api.soniox.com/transcribe-websocket`;
      
      console.log('[Soniox] Connecting to WebSocket...');
      
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[Soniox] ✅✅✅ WebSocket CONNECTED successfully!');
        
        // Send configuration message
        // Based on Soniox WebSocket API documentation
        const config = {
          api_key: this.apiKey,
          model: 'en_v2',
          enable_endpoint_detection: true,
          audio_format: 'pcm_s16le',
          sample_rate_hertz: this.TARGET_SAMPLE_RATE,
          num_audio_channels: 1  // Required for PCM - using num_audio_channels instead of num_channels
        };
        
        console.log('[Soniox] 📤 Sending config:', JSON.stringify(config));
        this.ws.send(JSON.stringify(config));
        console.log('[Soniox] ✅ Config sent, waiting for acknowledgment...');
        
        resolve();
      };

      this.ws.onmessage = (event) => {
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
      
      // Handle Soniox v10 format: fw (final words), nfw (non-final words)
      if (message.fw !== undefined || message.nfw !== undefined) {
        const finalWords = message.fw || [];
        const nonFinalWords = message.nfw || [];
        
        console.log('[Soniox] Words - Final:', finalWords.length, 'Non-final:', nonFinalWords.length);
        
        // Build transcript from final words
        if (finalWords.length > 0) {
          const finalText = finalWords.map(w => w.t || w.text || '').join('');
          this.currentTranscript += finalText;
          console.log('[Soniox] ✅ Final text added:', finalText, '| Total:', this.currentTranscript);
        }
        
        // Build partial from non-final words
        if (nonFinalWords.length > 0) {
          this.partialTranscript = nonFinalWords.map(w => w.t || w.text || '').join('');
          console.log('[Soniox] 📝 Non-final text:', this.partialTranscript);
        }
        
        // Send partial updates
        const fullPartial = this.currentTranscript + this.partialTranscript;
        if (fullPartial) {
          console.log('[Soniox] 📝 Partial update:', fullPartial);
          this.onPartialTranscript(fullPartial);
        }
        
        // Check for endpoint (when we have final text and non-final is empty)
        if (this.currentTranscript.trim() && nonFinalWords.length === 0 && finalWords.length > 0) {
          console.log('[Soniox] ========== ENDPOINT DETECTED (implicit) ==========');
          console.log('[Soniox] ✅✅✅ Complete transcript:', this.currentTranscript);
          this.onTranscript(this.currentTranscript.trim());
          
          // Reset for next utterance
          this.currentTranscript = '';
          this.partialTranscript = '';
          console.log('[Soniox] Reset for next utterance');
        }
        
        // Log audio progress
        if (message.fpt !== undefined) {
          console.log('[Soniox] Audio processed:', message.fpt, 'ms (final),', message.tpt, 'ms (total)');
        }
        
        return;
      }
      
      // Handle old-style result format (if API changes)
      if (message.result) {
        const result = message.result;
        
        // Extract tokens
        if (result.tokens && result.tokens.length > 0) {
          let finalText = '';
          let partialText = '';
          let foundEndToken = false;
          
          for (const token of result.tokens) {
            const text = token.text || '';
            
            // Check for endpoint marker
            if (text === '<end>' || token.type === 'endpoint') {
              foundEndToken = true;
              console.log('[Soniox] 🎯 Endpoint detected!');
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
          if (foundEndToken && this.currentTranscript.trim()) {
            console.log('[Soniox] ========== ENDPOINT DETECTED ==========');
            console.log('[Soniox] ✅✅✅ Complete transcript:', this.currentTranscript);
            this.onTranscript(this.currentTranscript.trim());
            
            // Reset for next utterance
            this.currentTranscript = '';
            this.partialTranscript = '';
            console.log('[Soniox] Reset for next utterance');
          }
        }
        
        // Log audio progress
        if (result.audio_final_proc_ms !== undefined) {
          console.log('[Soniox] Audio processed:', result.audio_final_proc_ms, 'ms (final),', result.audio_total_proc_ms, 'ms (total)');
        }
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
      
      if (debugCounter % 50 === 0) {
        console.log('[Soniox] Audio chunk #' + debugCounter, '- Avg:', avgAmplitude.toFixed(4), 'Max:', maxSample.toFixed(4));
        if (maxSample < 0.001) {
          console.warn('[Soniox] ⚠️ AUDIO IS SILENT! Max sample:', maxSample);
        }
      }
      
      // Convert Float32 to PCM 16-bit
      const pcmData = this.float32ToPcm16(inputData);
      
      // Add to buffer
      const newBuffer = new Int16Array(this.audioBuffer.length + pcmData.length);
      newBuffer.set(this.audioBuffer);
      newBuffer.set(pcmData, this.audioBuffer.length);
      this.audioBuffer = newBuffer;

      // Send complete chunks
      while (this.audioBuffer.length >= this.SAMPLES_PER_CHUNK) {
        const chunk = this.audioBuffer.slice(0, this.SAMPLES_PER_CHUNK);
        this.audioBuffer = this.audioBuffer.slice(this.SAMPLES_PER_CHUNK);
        
        // Send as binary data
        const bytes = new Uint8Array(chunk.buffer);
        this.ws.send(bytes);
        
        chunkCount++;
        if (chunkCount === 1 || chunkCount % 50 === 0) {
          console.log('[Soniox] 📤 Sent', chunkCount, 'audio chunks');
        }
      }
    };

    // Connect audio pipeline
    this.audioSource.connect(this.audioProcessor);
    this.audioProcessor.connect(this.audioContext.destination);
    
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

