/* audioEngine.js — Web Audio API Near-Ultrasonic (~18.5kHz) FSK Modem Engine */

class UltrasonicFSKTransmitter {
  constructor() {
    this.audioCtx = null;
    this.oscillator = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.intervalId = null;
  }

  init() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Frequency Shift Keying (FSK) frequencies in near-ultrasound range (inaudible to adults)
  // Sync Preamble = 17,800 Hz, Bit 0 = 18,500 Hz, Bit 1 = 19,200 Hz
  startTransmitting(hexToken) {
    this.init();
    this.stopTransmitting();
    this.isPlaying = true;

    // Convert hex token to binary array
    const binaryBits = [];
    for (let i = 0; i < hexToken.length; i++) {
      const val = parseInt(hexToken[i], 16);
      const bin = val.toString(2).padStart(4, '0');
      for (let char of bin) {
        binaryBits.push(parseInt(char));
      }
    }

    let bitIndex = 0;
    const bitDurationMs = 80; // 80ms per bit

    this.oscillator = this.audioCtx.createOscillator();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(0.08, this.audioCtx.currentTime); // Low volume high-freq

    this.oscillator.type = 'sine';
    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.oscillator.start();

    this.intervalId = setInterval(() => {
      if (!this.isPlaying) return;

      let freq = 17800; // Preamble frequency
      if (bitIndex < binaryBits.length) {
        freq = binaryBits[bitIndex] === 1 ? 19200 : 18500;
        bitIndex++;
      } else {
        bitIndex = 0; // Loop token payload
      }

      if (this.oscillator && this.audioCtx) {
        this.oscillator.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      }
    }, bitDurationMs);
  }

  stopTransmitting() {
    this.isPlaying = false;
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.oscillator) {
      try { this.oscillator.stop(); this.oscillator.disconnect(); } catch (e) {}
      this.oscillator = null;
    }
  }
}

class UltrasonicFSKReceiver {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.mediaStream = null;
    this.isListening = false;
  }

  async startListening(onTokenDecoded, onError) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 4096;
      source.connect(this.analyser);

      this.isListening = true;
      this.listenLoop(onTokenDecoded);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  listenLoop(onTokenDecoded) {
    if (!this.isListening || !this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const sampleRate = this.audioCtx.sampleRate;
    const binSize = sampleRate / this.analyser.fftSize;

    // Detect energy in 18.5kHz (Bit 0) and 19.2kHz (Bit 1)
    const bin18k5 = Math.round(18500 / binSize);
    const bin19k2 = Math.round(19200 / binSize);

    const energy18k5 = dataArray[bin18k5] || 0;
    const energy19k2 = dataArray[bin19k2] || 0;

    // High frequency energy presence trigger
    if (energy18k5 > 50 || energy19k2 > 50) {
      console.log('🎙️ Ultrasonic acoustic signal detected! Signal strength:', Math.max(energy18k5, energy19k2));
    }

    if (this.isListening) {
      requestAnimationFrame(() => this.listenLoop(onTokenDecoded));
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null;
    }
  }
}

window.ultrasonicTransmitter = new UltrasonicFSKTransmitter();
window.ultrasonicReceiver = new UltrasonicFSKReceiver();
