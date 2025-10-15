/**
 * Soniox Speech-to-Text using Official SDK
 * Handles real-time transcription with endpoint detection
 */

// Import from CDN (since we're in browser)
// Will be loaded via script tag in HTML

class SonioxSTTSDK {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.onTranscript = config.onTranscript || (() => {}); // Called when full transcript ready (after endpoint)
    this.onPartialTranscript = config.onPartialTranscript || (() => {}); // Called for partial updates
    this.onStatusChange = config.onStatusChange || (() => {});
    this.onError = config.onError || (() => {});
    
    this.recordTranscribe = null;
    this.isActive = false;
    this.currentFinalText = '';
    
    console.log('[Soniox SDK] STT initialized');
  }

  /**
   * Initialize and start transcription
   * @param {MediaStream} audioStream - The audio stream to transcribe
   */
  async initialize(audioStream) {
    console.log('[Soniox SDK] ========== INITIALIZING WITH OFFICIAL SDK ==========');
    console.log('[Soniox SDK] Audio stream:', audioStream?.id);
    console.log('[Soniox SDK] Audio tracks:', audioStream?.getAudioTracks().length);
    
    try {
      this.onStatusChange('initializing');
      
      // Check if RecordTranscribe is available
      if (typeof window.SonioxRecordTranscribe === 'undefined') {
        throw new Error('Soniox SDK not loaded. Make sure to include the script tag.');
      }
      
      console.log('[Soniox SDK] Creating RecordTranscribe instance...');
      console.log('[Soniox SDK] Note: SDK may not support external streams, will try...');
      
      // Create RecordTranscribe instance
      // Try with just apiKey first (SDK might handle microphone internally)
      this.recordTranscribe = new window.SonioxRecordTranscribe({
        apiKey: this.apiKey
      });
      
      console.log('[Soniox SDK] RecordTranscribe instance created');
      
      // Store our stream for later use if SDK needs it
      this.externalStream = audioStream;
      
      console.log('[Soniox SDK] Starting transcription...');
      console.log('[Soniox SDK] External stream available:', !!this.externalStream);
      
      // Start transcribing - SDK will request microphone unless we provide stream
      const startConfig = {
        model: 'en_v2',
        enable_endpoint_detection: true,
        onStarted: () => {
          console.log('[Soniox SDK] ✅ Transcription started!');
          this.isActive = true;
          this.onStatusChange('connected');
        },
        onPartialResult: (result) => {
          console.log('[Soniox SDK] 📝 Partial result received');
          
          let finalText = '';
          let nonFinalText = '';
          
          // Process tokens
          if (result.tokens) {
            for (let token of result.tokens) {
              if (token.is_final) {
                finalText += token.text;
              } else {
                nonFinalText += token.text;
              }
            }
            
            console.log('[Soniox SDK] Final tokens:', finalText);
            console.log('[Soniox SDK] Non-final tokens:', nonFinalText);
            
            // Update current final text
            if (finalText) {
              this.currentFinalText = finalText;
            }
            
            // Send partial update
            const fullText = this.currentFinalText + nonFinalText;
            if (fullText) {
              this.onPartialTranscript(fullText);
            }
          }
          
          // Check for endpoint
          if (result.endpoint || (result.tokens && result.tokens.some(t => t.text === '<end>'))) {
            console.log('[Soniox SDK] ========== ENDPOINT DETECTED ==========');
            console.log('[Soniox SDK] ✅ Complete transcript:', this.currentFinalText);
            
            if (this.currentFinalText.trim()) {
              this.onTranscript(this.currentFinalText.trim());
            }
            
            // Reset for next utterance
            this.currentFinalText = '';
          }
        },
        onFinished: () => {
          console.log('[Soniox SDK] Transcription finished');
          this.isActive = false;
          this.onStatusChange('stopped');
        },
        onError: (status, message) => {
          console.error('[Soniox SDK] ❌❌❌ ERROR');
          console.error('[Soniox SDK] Status:', status);
          console.error('[Soniox SDK] Message:', message);
          console.error('[Soniox SDK] Full error object:', {status, message});
          this.onError(new Error(`${status}: ${message}`));
          this.onStatusChange('error');
        }
      });
      
      console.log('[Soniox SDK] ========== SDK FULLY ACTIVE ==========');
      
    } catch (error) {
      console.error('[Soniox SDK] ❌❌❌ Initialization failed');
      console.error('[Soniox SDK] Error name:', error?.name);
      console.error('[Soniox SDK] Error message:', error?.message);
      console.error('[Soniox SDK] Error stack:', error?.stack);
      console.error('[Soniox SDK] Full error:', error);
      this.onStatusChange('error');
      this.onError(error);
      throw error;
    }
  }

  /**
   * Stop transcription and cleanup
   */
  async stop() {
    console.log('[Soniox SDK] Stopping...');
    
    if (this.recordTranscribe) {
      try {
        this.recordTranscribe.stop();
      } catch (e) {
        console.warn('[Soniox SDK] Error stopping:', e);
      }
      this.recordTranscribe = null;
    }
    
    this.isActive = false;
    this.currentFinalText = '';
    this.onStatusChange('stopped');
    
    console.log('[Soniox SDK] Stopped');
  }
}

// Export for use in HTML
window.SonioxSTTSDK = SonioxSTTSDK;

