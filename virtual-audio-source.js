/**
 * Virtual Audio Source
 * Creates a MediaStreamTrack from programmatically generated audio
 * This allows injecting AI audio into WebRTC as if it were a microphone
 */

class VirtualAudioSource {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: this.sampleRate
    });
    
    // Create a destination that we can capture as a MediaStream
    this.destination = this.audioContext.createMediaStreamDestination();
    this.stream = this.destination.stream;
    
    // Audio buffer queue for playback
    this.audioQueue = [];
    this.isPlaying = false;
    this.currentSource = null;
    
    console.log('[VirtualAudioSource] Created with sample rate:', this.sampleRate);
  }

  /**
   * Get the MediaStream that can be used in WebRTC
   */
  getMediaStream() {
    return this.stream;
  }

  /**
   * Get the audio track
   */
  getAudioTrack() {
    return this.stream.getAudioTracks()[0];
  }

  /**
   * Add PCM audio data to be played
   * @param {Int16Array} pcmData - PCM 16-bit audio data
   */
  addAudioData(pcmData) {
    // Convert PCM 16-bit to Float32
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7FFF);
    }

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(
      1, // mono
      float32Data.length,
      this.sampleRate
    );
    
    audioBuffer.getChannelData(0).set(float32Data);
    
    // Add to queue
    this.audioQueue.push(audioBuffer);
    
    // Start playback if not already playing
    if (!this.isPlaying) {
      this.playNextBuffer();
    }
  }

  /**
   * Play queued audio buffers sequentially
   */
  playNextBuffer() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift();
    
    // Create buffer source
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Connect to the destination (which is captured as MediaStream)
    source.connect(this.destination);
    
    // Play next buffer when this one ends
    source.onended = () => {
      this.currentSource = null;
      this.playNextBuffer();
    };
    
    this.currentSource = source;
    source.start();
  }

  /**
   * Add silence (useful for keeping stream active)
   * @param {number} durationMs - Duration in milliseconds
   */
  addSilence(durationMs) {
    const samples = Math.floor(this.sampleRate * durationMs / 1000);
    const silenceBuffer = this.audioContext.createBuffer(
      1,
      samples,
      this.sampleRate
    );
    
    // Buffer is already silent (zeros)
    this.audioQueue.push(silenceBuffer);
    
    if (!this.isPlaying) {
      this.playNextBuffer();
    }
  }

  /**
   * Check if currently playing audio
   */
  get playing() {
    return this.isPlaying;
  }

  /**
   * Get queue length
   */
  get queueLength() {
    return this.audioQueue.length;
  }

  /**
   * Clear audio buffer/queue (for interruptions)
   */
  clearBuffer() {
    console.log('[VirtualAudioSource] 🛑 Clearing buffer - had', this.audioQueue.length, 'chunks queued');
    
    // Stop currently playing audio
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (e) {
        // Already stopped
      }
      this.currentSource = null;
    }
    
    // Clear the queue
    this.audioQueue = [];
    this.isPlaying = false;
    
    console.log('[VirtualAudioSource] ✅ Buffer cleared');
  }

  /**
   * Stop and cleanup
   */
  async stop() {
    this.audioQueue = [];
    this.isPlaying = false;
    
    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }
    
    // Stop all tracks
    this.stream.getTracks().forEach(track => track.stop());
    
    await this.audioContext.close();
  }
}

// Export for use in other scripts
window.VirtualAudioSource = VirtualAudioSource;

