export interface AudioEffectState {
  reverb: number; // 0 to 1 (Wet mix)
  delay: number; // 0 to 1 (Wet mix)
  bass: number; // -10 to 10 dB
  treble: number; // -10 to 10 dB
  speed: number; // 0.5 to 2.0
  gain: number; // -20 to 20 dB (Master Volume)
  compressor: number; // 0 to 1 (Threshold/Ratio intensity)
  mix: number; // 0 to 1 (Global Effect Intensity)
}

export interface AudioPreset {
  id: string;
  name: string;
  description: string;
  effects: Partial<AudioEffectState>;
}

export interface AudioSelection {
  start: number; // seconds
  end: number; // seconds
}

export interface LibraryItem {
  id: string;
  name: string;
  buffer: AudioBuffer;
  date: number;
  duration: number;
}

export enum PlaybackState {
  STOPPED,
  PLAYING,
  PAUSED
}

// Web Audio API Extension types if needed
export interface AudioContextExtended extends AudioContext {
  createGain(): GainNode;
}