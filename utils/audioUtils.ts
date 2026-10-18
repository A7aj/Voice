
// Generates a synthetic impulse response for reverb
export const createReverbImpulse = (ctx: AudioContext, duration: number = 2, decay: number = 2): AudioBuffer => {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  const impulseL = impulse.getChannelData(0);
  const impulseR = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i;
    // Simple noise with exponential decay
    impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
  }

  return impulse;
};

// Formats seconds to MM:SS
export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

// Slices an AudioBuffer (Cut functionality)
export const sliceAudioBuffer = (
  ctx: AudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number
): AudioBuffer => {
  // Check bounds
  if (start < 0) start = 0;
  if (end > buffer.duration) end = buffer.duration;
  if (start >= end) return buffer;

  const rate = buffer.sampleRate;
  const startSample = Math.floor(start * rate);
  const endSample = Math.floor(end * rate);
  const totalSamples = buffer.length;
  const removedSamples = endSample - startSample;
  const newLength = totalSamples - removedSamples;

  if (newLength <= 0) return ctx.createBuffer(buffer.numberOfChannels, 1, rate);

  const newBuffer = ctx.createBuffer(buffer.numberOfChannels, newLength, rate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const oldData = buffer.getChannelData(channel);
    const newData = newBuffer.getChannelData(channel);

    // Copy part 1 (Before cut)
    newData.set(oldData.subarray(0, startSample), 0);
    // Copy part 2 (After cut)
    newData.set(oldData.subarray(endSample), startSample);
  }

  return newBuffer;
};

// Apply Gain to a specific region of the buffer (Destructive)
export const applyGainToRegion = (
  ctx: AudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number,
  dbChange: number
): AudioBuffer => {
  const rate = buffer.sampleRate;
  const startSample = Math.floor(start * rate);
  const endSample = Math.floor(end * rate);
  
  // Calculate linear gain factor: 10^(dB/20)
  const gainFactor = Math.pow(10, dbChange / 20);

  const newBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const inputData = buffer.getChannelData(channel);
    const outputData = newBuffer.getChannelData(channel);
    
    // Copy all data first
    outputData.set(inputData);

    // Apply gain to region
    for (let i = startSample; i < endSample && i < outputData.length; i++) {
      outputData[i] = outputData[i] * gainFactor;
    }
  }

  return newBuffer;
};

// --- Spectral Noise Reduction Utilities ---

// Simple FFT implementation (Radix-2 Cooly-Tukey)
// Note: This is a pure JS implementation. For production with large files, 
// WebAssembly or AudioWorklets are recommended.
const fft = (data: Float32Array): { real: Float32Array; imag: Float32Array } => {
    const N = data.length;
    const real = new Float32Array(data);
    const imag = new Float32Array(N);

    if (N === 1) return { real, imag };

    const half = N / 2;
    for (let i = 0; i < half; i++) {
        // Bit-reversal permutation (simplified for iterative logic later, but strictly doing recursive here for brevity)
    }
    
    // Basic recursive implementation for clarity
    // (In a real app, use a pre-calculated bit-reverse table iterative loop)
    const _fft = (r: Float32Array, i: Float32Array, n: number, step: number, offset: number) => {
        if (step >= n) return;
        const halfN = n / 2; // Size of sub-problem
        
        // This simplified recursive FFT is slow for JS. 
        // We will use a basic iterative O(N^2) DFT for small windows if window is small, 
        // OR a pre-optimized O(N log N).
        // Let's implement a standard iterative FFT for robustness.
    };

    // Standard Iterative FFT
    let i = 0, j = 0;
    for (i = 0; i < N; i++) {
        if (j > i) {
            [real[j], real[i]] = [real[i], real[j]];
            [imag[j], imag[i]] = [imag[i], imag[j]];
        }
        let m = N >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    let mmax = 1;
    while (N > mmax) {
        const step = mmax << 1;
        const theta = -(Math.PI) / mmax;
        let wtemp = Math.sin(0.5 * theta);
        const wpr = -2.0 * wtemp * wtemp;
        const wpi = Math.sin(theta);
        let wr = 1.0;
        let wi = 0.0;
        for (let m = 0; m < mmax; m++) {
            for (let i = m; i < N; i += step) {
                const j = i + mmax;
                const tempr = wr * real[j] - wi * imag[j];
                const tempi = wr * imag[j] + wi * real[j];
                real[j] = real[i] - tempr;
                imag[j] = imag[i] - tempi;
                real[i] += tempr;
                imag[i] += tempi;
            }
            wtemp = wr;
            wr = wtemp * wpr - wi * wpi + wr;
            wi = wi * wpr + wtemp * wpi + wi;
        }
        mmax = step;
    }

    return { real, imag };
};

const ifft = (real: Float32Array, imag: Float32Array): Float32Array => {
    const N = real.length;
    // Conjugate
    for (let i = 0; i < N; i++) {
        imag[i] = -imag[i];
    }
    const res = fft(new Float32Array(real)); // Hack: Use FFT for IFFT
    // Correct IFFT input needs complex input handling which our simple FFT above doesn't fully expose in args,
    // but standard FFT property: IFFT(x) = 1/N * conj(FFT(conj(x)))
    
    // Let's implement the inverse logic directly to be safe or reuse the structure:
    // Reuse FFT structure but swap imaginary sign and scale.
    // Actually, calling FFT on swapped imaginary parts works.
    
    // We need to pass the conjugated input into the FFT function defined above.
    // The FFT function above takes `data` (real input). We need a version that takes real/imag.
    // For brevity, we will use a "Spectral Gate" approximation that modifies magnitudes 
    // and preserves original phase, which simplifies reconstruction significantly.
    
    return new Float32Array(N); // Placeholder if we don't fully implement IFFT
};


// ----------------------------------------------------------------------
// Robust Real-Valued FFT / IFFT Wrapper for Spectral Subtraction
// ----------------------------------------------------------------------
class FFT {
    size: number;
    cosTable: Float32Array;
    sinTable: Float32Array;
    reverseTable: Uint32Array;

    constructor(size: number) {
        this.size = size;
        this.cosTable = new Float32Array(size);
        this.sinTable = new Float32Array(size);
        this.reverseTable = new Uint32Array(size);

        for (let i = 0; i < size; i++) {
            this.cosTable[i] = Math.cos(2 * Math.PI * i / size);
            this.sinTable[i] = Math.sin(2 * Math.PI * i / size);
            
            let limit = 1;
            let bit = size >> 1;
            let iRev = 0;
            let k = i;
            while (limit < size) {
                if (k & 1) iRev += bit;
                limit <<= 1;
                bit >>= 1;
                k >>= 1;
            }
            this.reverseTable[i] = iRev;
        }
    }

    transform(real: Float32Array, imag: Float32Array) {
        const size = this.size;
        const cosTable = this.cosTable;
        const sinTable = this.sinTable;
        const reverseTable = this.reverseTable;

        // Bit-reverse
        for (let i = 0; i < size; i++) {
            const rev = reverseTable[i];
            if (rev > i) {
                [real[i], real[rev]] = [real[rev], real[i]];
                [imag[i], imag[rev]] = [imag[rev], imag[i]];
            }
        }

        // Cooley-Tukey
        let halfSize = 1;
        while (halfSize < size) {
            const phaseStep = size / (halfSize * 2); // 2 * PI is built into tables
            for (let i = 0; i < halfSize; i++) {
                // Table lookups
                // theta = -2*PI * i / (2*halfSize) = -PI * i / halfSize
                // Our tables cover 2*PI. Index = (i * phaseStep)
                // Wait, standard FFT has negative exponent.
                
                // Simplified trig calculation for readability/reliability over custom table indexing issues
                const theta = -Math.PI * i / halfSize;
                const cos = Math.cos(theta);
                const sin = Math.sin(theta);

                for (let j = i; j < size; j += halfSize * 2) {
                    const k = j + halfSize;
                    const tReal = cos * real[k] - sin * imag[k];
                    const tImag = cos * imag[k] + sin * real[k];
                    real[k] = real[j] - tReal;
                    imag[k] = imag[j] - tImag;
                    real[j] += tReal;
                    imag[j] += tImag;
                }
            }
            halfSize <<= 1;
        }
    }

    inverseTransform(real: Float32Array, imag: Float32Array) {
        // Conjugate
        for (let i = 0; i < this.size; i++) imag[i] = -imag[i];
        this.transform(real, imag);
        // Conjugate + Scale
        for (let i = 0; i < this.size; i++) {
            imag[i] = -imag[i] / this.size;
            real[i] = real[i] / this.size;
        }
    }
}

// Capture Noise Profile
// Returns array of spectral magnitudes
export const captureNoiseProfile = (
    buffer: AudioBuffer,
    start: number,
    end: number
): Float32Array => {
    const channelData = buffer.getChannelData(0); // Analyze first channel
    const rate = buffer.sampleRate;
    const startSample = Math.floor(start * rate);
    const endSample = Math.floor(end * rate);
    const len = endSample - startSample;
    
    const fftSize = 2048;
    const fftObj = new FFT(fftSize);
    const window = new Float32Array(fftSize);
    for(let i=0; i<fftSize; i++) window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1))); // Hanning

    const magnitudes = new Float32Array(fftSize).fill(0);
    let frames = 0;

    // Slide over the selection
    const step = fftSize / 2; // 50% overlap
    for(let i = startSample; i < endSample - fftSize; i += step) {
        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);
        
        for(let j=0; j<fftSize; j++) {
            real[j] = channelData[i + j] * window[j];
            imag[j] = 0;
        }

        fftObj.transform(real, imag);

        for(let j=0; j<fftSize; j++) {
            magnitudes[j] += Math.sqrt(real[j]*real[j] + imag[j]*imag[j]);
        }
        frames++;
    }

    // Average
    if (frames > 0) {
        for(let j=0; j<fftSize; j++) magnitudes[j] /= frames;
    }

    return magnitudes;
};

// Apply Denoise
export const removeNoise = (
    ctx: AudioContext,
    buffer: AudioBuffer,
    noiseProfile: Float32Array,
    amount: number = 1.0 // 0 to 1 scaling of reduction
): AudioBuffer => {
    const fftSize = 2048;
    const fftObj = new FFT(fftSize);
    
    // Hanning Window
    const window = new Float32Array(fftSize);
    for(let i=0; i<fftSize; i++) window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1))); 

    const outputBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const step = fftSize / 2; // 50% overlap

    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const inputData = buffer.getChannelData(c);
        const outputData = outputBuffer.getChannelData(c);
        
        // We need a helper buffer to accumulate overlap-add
        // But for simplicity in this array processing, we write directly to outputData knowing it's initialized to 0
        // We must apply windowing during reconstruction too for perfect reconstruction if we modify spectral content?
        // Standard OLA: Window analysis, process, IFFT. The synthesis window depends on the overlap. 
        // For 50% overlap Hanning, simple OLA works reasonably well.

        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);

        for (let i = 0; i < inputData.length - fftSize; i += step) {
            // 1. Window & Copy
            for(let j=0; j<fftSize; j++) {
                real[j] = inputData[i+j] * window[j];
                imag[j] = 0;
            }

            // 2. FFT
            fftObj.transform(real, imag);

            // 3. Spectral Subtraction
            for(let j=0; j<fftSize; j++) {
                const mag = Math.sqrt(real[j]*real[j] + imag[j]*imag[j]);
                const phase = Math.atan2(imag[j], real[j]);
                
                // Subtract noise profile
                // noiseProfile is average magnitude. 
                // We reduce current magnitude by (noiseProfile * amount)
                let newMag = mag - (noiseProfile[j] * amount * 1.5); // 1.5 multiplier for aggression
                if (newMag < 0) newMag = 0;

                // Reconstruct complex
                real[j] = newMag * Math.cos(phase);
                imag[j] = newMag * Math.sin(phase);
            }

            // 4. IFFT
            fftObj.inverseTransform(real, imag);

            // 5. Overlap-Add to Output
            // We apply the window again (or simply add if Hanning COLA criteria met approx)
            // Ideally: x[n] * w[n] -> FFT -> IFFT -> y[n] * w[n] -> OLA. 
            // Square of Hanning at 50% sums to constant? No, sums to curve.
            // Simplified: Just add. The input Hanning does most smoothing.
            for(let j=0; j<fftSize; j++) {
                // Scaling factor for Hanning 50% OLA roughly 2/3 or similar, 
                // or just let the window handle it. 
                // Empirically for simple removal:
                outputData[i+j] += real[j]; 
            }
        }
    }
    
    return outputBuffer;
};


// Export processed audio to WAV
export const exportAudio = async (
  originalBuffer: AudioBuffer,
  effects: { bass: number; treble: number; reverb: number; delay: number; gain: number; compressor: number },
  impulseBuffer: AudioBuffer | null,
  includeEffects: boolean = true
): Promise<Blob> => {
  // If raw export requested, just return the original buffer as WAV
  if (!includeEffects) {
    return bufferToWave(originalBuffer, originalBuffer.length);
  }

  // Add 5 seconds padding to the end of the buffer to capture reverb/delay tails
  const paddingSeconds = 5;
  const paddingSamples = Math.floor(originalBuffer.sampleRate * paddingSeconds);
  const totalLength = originalBuffer.length + paddingSamples;

  const offlineCtx = new OfflineAudioContext(
    originalBuffer.numberOfChannels,
    totalLength,
    originalBuffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = originalBuffer;

  // --- Create Nodes ---

  // 1. EQ
  const bassNode = offlineCtx.createBiquadFilter();
  bassNode.type = 'lowshelf';
  bassNode.frequency.value = 200;
  bassNode.gain.value = effects.bass;

  const trebleNode = offlineCtx.createBiquadFilter();
  trebleNode.type = 'highshelf';
  trebleNode.frequency.value = 2000;
  trebleNode.gain.value = effects.treble;

  // 2. Dynamics (Compressor)
  const compressorNode = offlineCtx.createDynamicsCompressor();
  // Map 0-1 knob to Threshold (-60 to 0) and Ratio
  if (effects.compressor > 0) {
    compressorNode.threshold.value = -60 * effects.compressor; // Down to -60dB
    compressorNode.knee.value = 30;
    compressorNode.ratio.value = 1 + (effects.compressor * 19); // 1 to 20
    compressorNode.attack.value = 0.01;
    compressorNode.release.value = 0.25;
  } else {
     // Minimal impact
    compressorNode.threshold.value = 0;
    compressorNode.ratio.value = 1;
  }

  // Makeup Gain for Compressor (Auto-compensate roughly)
  const makeupGainNode = offlineCtx.createGain();
  makeupGainNode.gain.value = 1 + (effects.compressor * 0.5); // Slight boost when compressing

  // 3. Reverb & Delay Split
  const dryGain = offlineCtx.createGain();
  const wetGainReverb = offlineCtx.createGain();
  const reverbNode = offlineCtx.createConvolver();
  if (impulseBuffer) reverbNode.buffer = impulseBuffer;

  const delayNode = offlineCtx.createDelay();
  delayNode.delayTime.value = 0.3;
  const delayFeedback = offlineCtx.createGain();
  delayFeedback.gain.value = 0.4;
  const wetGainDelay = offlineCtx.createGain();
  
  // Mix config
  dryGain.gain.value = 1 - Math.max(effects.reverb, effects.delay) * 0.5;
  wetGainReverb.gain.value = effects.reverb;
  wetGainDelay.gain.value = effects.delay;

  // 4. Master Gain
  const masterGainNode = offlineCtx.createGain();
  // Convert dB to linear
  masterGainNode.gain.value = Math.pow(10, effects.gain / 20);

  // --- Connections ---
  
  // Source -> Bass -> Treble -> Compressor -> Makeup
  source.connect(bassNode);
  bassNode.connect(trebleNode);
  trebleNode.connect(compressorNode);
  compressorNode.connect(makeupGainNode);

  const effectSource = makeupGainNode; // Signal after dynamics

  // Path 1: Dry
  effectSource.connect(dryGain);
  dryGain.connect(masterGainNode);

  // Path 2: Reverb
  if (effects.reverb > 0) {
    effectSource.connect(reverbNode);
    reverbNode.connect(wetGainReverb);
    wetGainReverb.connect(masterGainNode);
  }

  // Path 3: Delay
  if (effects.delay > 0) {
    effectSource.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode); // feedback loop
    delayNode.connect(wetGainDelay);
    wetGainDelay.connect(masterGainNode);
  }

  masterGainNode.connect(offlineCtx.destination);

  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  
  return bufferToWave(renderedBuffer, renderedBuffer.length);
};

// Helper to convert AudioBuffer to WAV Blob
function bufferToWave(abuffer: AudioBuffer, len: number) {
  let numOfChan = abuffer.numberOfChannels,
      length = len * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [], i, sample,
      offset = 0,
      pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded in this simple export)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

  while(pos < len) {
      for(i = 0; i < numOfChan; i++) {             // interleave channels
          sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
          sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
          view.setInt16(44 + offset, sample, true); // write 16-bit sample
          offset += 2;
      }
      pos++;
  }

  return new Blob([buffer], {type: "audio/wav"});

  function setUint16(data: any) {
      view.setUint16(pos, data, true);
      pos += 2;
  }

  function setUint32(data: any) {
      view.setUint32(pos, data, true);
      pos += 4;
  }
}
