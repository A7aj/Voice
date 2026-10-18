import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Icons, AUDIO_PRESETS } from './constants';
import { AudioEffectState, AudioSelection, PlaybackState, AudioPreset, LibraryItem } from './types';
import ControlKnob from './components/ControlKnob';
import Waveform from './components/Waveform';
import AudioMeter from './components/AudioMeter';
import { createReverbImpulse, exportAudio, formatTime, sliceAudioBuffer, applyGainToRegion, captureNoiseProfile, removeNoise } from './utils/audioUtils';
import { GoogleGenAI, Type } from "@google/genai";

export default function App() {
  // State
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(PlaybackState.STOPPED);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const [effects, setEffects] = useState<AudioEffectState>({
    reverb: 0,
    delay: 0,
    bass: 0,
    treble: 0,
    speed: 1.0,
    gain: 0,
    compressor: 0,
    mix: 1.0,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [exportWithEffects, setExportWithEffects] = useState(true);
  const [isBypassed, setIsBypassed] = useState(false);
  const [shouldResume, setShouldResume] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);

  const runAiAudioDoctor = () => {
    if (!buffer) {
        alert("يرجى تحميل أو تسجيل ملف صوتي أولاً لاستخدام المعالج الذكي.");
        return;
    }
    setIsAnalyzing(true);
    setTimeout(() => {
        const data = buffer.getChannelData(0);
        let peak = 0;
        let sumSq = 0;
        const step = Math.max(1, Math.floor(data.length / 1000));
        for (let i = 0; i < data.length; i += step) {
            const val = Math.abs(data[i]);
            if (val > peak) peak = val;
            sumSq += val * val;
        }
        const rms = Math.sqrt(sumSq / (data.length / step));
        const dbPeak = (20 * Math.log10(peak || 0.0001)).toFixed(1);
        
        setAiAnalysisResult({
            duration: buffer.duration.toFixed(2),
            sampleRate: buffer.sampleRate,
            peakDb: dbPeak,
            rmsLevel: (rms * 100).toFixed(1),
            clarityScore: Math.min(98, Math.max(70, Math.floor(rms * 150 + 75))),
            noiseLevel: peak < 0.1 ? 'منخفض جداً (نقي)' : 'متوسط (يحتاج تنقية)',
            recommendation: peak < 0.2 ? 'الصوت هادئ نسبياً، يوصى برفع الكسب (Gain) وتطبيق معالجة بودكاست دافئة مع كومبريسور.' : 'مستوى الصوت ممتاز، يوصى بضغط ديناميكي خفيف (Compression) مع توازن الترددات الحادة للوصول لجودة الاستوديو.'
        });
        setIsAnalyzing(false);
        setIsAiModalOpen(true);
    }, 500);
  };

  const applyAiMastering = () => {
    setEffects({
        reverb: 0.15,
        delay: 0,
        bass: 2.5,
        treble: 2.0,
        speed: 1.0,
        gain: 1.5,
        compressor: 0.75,
        mix: 1.0
    });
    setIsAiModalOpen(false);
    alert("⚡ تم تطبيق إعدادات الماسترينج الذكي بنجاح وتحديث كافة المؤثرات لتلائم معايير الإذاعة!");
  };
  
  // Library State
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [isLibraryOpen, setIsLibraryOpen] = useState(true);
  const [isDraggingOverLibrary, setIsDraggingOverLibrary] = useState(false);

  // Meter State
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
  
  // Microphone Selection State
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  // Visualization Data for Recording
  const recordingPeaksRef = useRef<number[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Selection Edit State
  const [selectionGain, setSelectionGain] = useState<number>(0);

  // Noise Reduction State
  const [noiseProfile, setNoiseProfile] = useState<Float32Array | null>(null);
  const [denoiseAmount, setDenoiseAmount] = useState<number>(50); // %

  // History State for Undo/Redo
  const [history, setHistory] = useState<AudioBuffer[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Refs for Audio Engine
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Effect Nodes Refs
  const bassNodeRef = useRef<BiquadFilterNode | null>(null);
  const trebleNodeRef = useRef<BiquadFilterNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupGainNodeRef = useRef<GainNode | null>(null);
  const delayGainRef = useRef<GainNode | null>(null);
  const reverbGainRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const bypassGainNodeRef = useRef<GainNode | null>(null);
  const effectsChainGainNodeRef = useRef<GainNode | null>(null);
  
  // Animation Frame for UI update
  const rafRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);

  // Initialize Audio Context & Devices
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioContextClass();
    
    // Create impulse response for reverb once
    const impulse = createReverbImpulse(audioContextRef.current, 3, 2);
    if (audioContextRef.current) {
       (window as any).reverbImpulse = impulse;
    }

    // Enumerate Devices
    const getDevices = async () => {
        try {
            // Try to get permission first to ensure labels are available
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter(d => d.kind === 'audioinput');
            setAudioInputDevices(inputs);
            // Set default if none selected and devices exist
            if (inputs.length > 0 && !selectedDeviceId) {
                setSelectedDeviceId(inputs[0].deviceId);
            }
        } catch (e) {
            console.error("Error fetching devices:", e);
        }
    };
    
    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    
    return () => {
      audioContextRef.current?.close();
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []);

  // Recording Timer Loop
  useEffect(() => {
    let timerId: number;
    if (isRecording) {
        // Use a slightly faster interval to ensure UI feels responsive
        timerId = window.setInterval(() => {
            const now = Date.now();
            // Calculate duration precisely
            const duration = (now - recordingStartTime) / 1000;
            setCurrentTime(duration);
        }, 30);
    }
    return () => {
        if (timerId) clearInterval(timerId);
    }
  }, [isRecording, recordingStartTime]);

  // History Management
  const pushToHistory = (newBuffer: AudioBuffer) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newBuffer);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setBuffer(newBuffer);
  };

  const undo = () => {
    if (historyIndex > 0) {
      stop();
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setBuffer(history[newIndex]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      stop();
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setBuffer(history[newIndex]);
    }
  };

  const handleNewProject = () => {
    if (buffer && !window.confirm("هل أنت متأكد من رغبتك في بدء مشروع جديد؟ سيتم مسح العمل الحالي.")) {
      return;
    }
    stop();
    setBuffer(null);
    setFileName('');
    setHistory([]);
    setHistoryIndex(-1);
    setCurrentTime(0);
    setSelection(null);
    setSelectedPresetId('');
    setNoiseProfile(null);
  };

  // Preset Management
  const applyPreset = (preset: AudioPreset) => {
    if (preset.id === 'auto') {
      analyzeAudioWithAI();
      return;
    }
    
    setSelectedPresetId(preset.id);
    setEffects(prev => ({
      ...prev,
      ...preset.effects
    }));
  };

  const analyzeAudioWithAI = async () => {
    if (!buffer) return;
    setIsAnalyzing(true);
    setIsProcessing(true);

    try {
      // 1. Extract a representative chunk (5 seconds from the middle)
      const duration = buffer.duration;
      const start = Math.max(0, duration / 2 - 2.5);
      const end = Math.min(duration, start + 5);
      
      // We'll send some metadata and a description of the audio peaks to save bandwidth
      // or we can send a small base64 chunk. Let's try sending metadata first.
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const startIdx = Math.floor(start * sampleRate);
      const endIdx = Math.floor(end * sampleRate);
      
      let sum = 0;
      let peak = 0;
      const step = Math.floor((endIdx - startIdx) / 1000);
      for (let i = startIdx; i < endIdx; i += step) {
        const val = Math.abs(channelData[i]);
        sum += val;
        if (val > peak) peak = val;
      }
      const avg = sum / 1000;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze these audio characteristics and suggest the best audio effect settings (reverb, delay, bass, treble, compressor) to make it sound professional and clear.
        
        Audio Metadata:
        - Duration: ${duration.toFixed(2)}s
        - Peak Amplitude: ${peak.toFixed(4)}
        - Average Amplitude (RMS approx): ${avg.toFixed(4)}
        - Sample Rate: ${sampleRate}Hz
        
        The user wants a "Professional Studio" feel.
        Return the settings in JSON format.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reverb: { type: Type.NUMBER, description: "0 to 1" },
              delay: { type: Type.NUMBER, description: "0 to 1" },
              bass: { type: Type.NUMBER, description: "-10 to 10" },
              treble: { type: Type.NUMBER, description: "-10 to 10" },
              compressor: { type: Type.NUMBER, description: "0 to 1" },
              reasoning: { type: Type.STRING, description: "Brief explanation of why these settings were chosen" }
            },
            required: ["reverb", "delay", "bass", "treble", "compressor"]
          }
        }
      });

      const result = JSON.parse(response.text);
      setEffects(prev => ({
        ...prev,
        reverb: result.reverb,
        delay: result.delay,
        bass: result.bass,
        treble: result.treble,
        compressor: result.compressor
      }));
      setSelectedPresetId('auto');
      console.log("AI Reasoning:", result.reasoning);
    } catch (err) {
      console.error("AI Analysis failed:", err);
      alert("فشل تحليل الذكاء الاصطناعي. يرجى المحاولة مرة أخرى.");
    } finally {
      setIsAnalyzing(false);
      setIsProcessing(false);
    }
  };

  // Library Management
  const addToLibrary = (newBuffer: AudioBuffer, name: string) => {
    const newItem: LibraryItem = {
      id: crypto.randomUUID(),
      name: name,
      buffer: newBuffer,
      date: Date.now(),
      duration: newBuffer.duration
    };
    setLibrary(prev => [newItem, ...prev]);
    return newItem;
  };

  const loadFromLibrary = (item: LibraryItem) => {
    if (isPlaying !== PlaybackState.STOPPED) stop();
    setBuffer(item.buffer);
    setFileName(item.name);
    setHistory([item.buffer]);
    setHistoryIndex(0);
    setCurrentTime(0);
    setSelection(null);
  };

  const deleteFromLibrary = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('هل أنت متأكد من حذف هذا الملف من المكتبة؟')) {
        setLibrary(prev => prev.filter(item => item.id !== id));
    }
  };

  // Handling File Upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !audioContextRef.current) return;
    
    setIsProcessing(true);
    let lastBuffer: AudioBuffer | null = null;
    let lastName = '';

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const arrayBuffer = await file.arrayBuffer();
            const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            
            const name = file.name.replace(/\.[^/.]+$/, "");
            addToLibrary(decodedBuffer, name);
            
            lastBuffer = decodedBuffer;
            lastName = name;
        }

        // Load the last file into the editor
        if (lastBuffer) {
            stop();
            setBuffer(lastBuffer);
            setFileName(lastName);
            setHistory([lastBuffer]);
            setHistoryIndex(0);
            setCurrentTime(0);
            setSelection(null);
            startOffsetRef.current = 0;
            setNoiseProfile(null);
        }
        
        setIsLibraryOpen(true); // Open library to show imported files
    } catch (err) {
      console.error(err);
      alert("فشل في قراءة الملف الصوتي");
    } finally {
        setIsProcessing(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Audio Graph Setup
  const setupAudioGraph = () => {
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = effects.speed;
    
    // Loop configuration
    source.loop = isLooping;
    if (isLooping && selection) {
      source.loopStart = selection.start;
      source.loopEnd = selection.end;
    } else {
        // Reset just in case
        source.loopStart = 0;
        source.loopEnd = buffer?.duration || 0;
    }

    // 1. EQ Nodes
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 200;
    bass.gain.value = effects.bass;

    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 2000;
    treble.gain.value = effects.treble;

    // 2. Compressor (Power/Dynamics)
    const compressor = ctx.createDynamicsCompressor();
    // Initial setup based on state
    if (effects.compressor > 0) {
        compressor.threshold.value = -60 * effects.compressor;
        compressor.knee.value = 30;
        compressor.ratio.value = 1 + (effects.compressor * 19);
        compressor.attack.value = 0.01;
        compressor.release.value = 0.25;
    } else {
        compressor.threshold.value = 0; // Off effectively
        compressor.ratio.value = 1;
    }

    const makeupGain = ctx.createGain();
    makeupGain.gain.value = 1 + (effects.compressor * 0.5);

    // 3. Effects Split
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.3;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.4;
    const delayOut = ctx.createGain();
    delayOut.gain.value = effects.delay;

    const reverb = ctx.createConvolver();
    if ((window as any).reverbImpulse) {
        reverb.buffer = (window as any).reverbImpulse;
    }
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = effects.reverb;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - Math.max(effects.reverb, effects.delay) * 0.5;

    // 4. Master Gain
    const masterGain = ctx.createGain();
    // Convert dB to linear: 10 ^ (dB / 20)
    masterGain.gain.value = Math.pow(10, effects.gain / 20);

    // 5. Analyser (Meter)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // High resolution for time domain
    analyser.smoothingTimeConstant = 0.3;

    const finalDestination = ctx.destination;

    // --- Connections ---
    
    // Create Bypass and Effects Chain Gains
    const bypassGain = ctx.createGain();
    const effectsChainGain = ctx.createGain();
    
    // Set initial values
    bypassGain.gain.value = isBypassed ? 1 : 0;
    effectsChainGain.gain.value = isBypassed ? 0 : 1;

    // Connect Source to both paths
    source.connect(bypassGain);
    source.connect(effectsChainGain);

    // Path 1: Bypass -> Master
    bypassGain.connect(masterGain);

    // Path 2: Effects Chain -> Master
    // Source -> EffectsChainGain -> Bass -> Treble -> Compressor -> MakeupGain
    effectsChainGain.connect(bass);
    bass.connect(treble);
    treble.connect(compressor);
    compressor.connect(makeupGain);

    const signalPoint = makeupGain;

    // Path 2a: Dry (within effects)
    signalPoint.connect(dryGain);
    dryGain.connect(masterGain);

    // Path 2b: Reverb
    signalPoint.connect(reverb);
    reverb.connect(reverbOut);
    reverbOut.connect(masterGain);

    // Path 2c: Delay
    signalPoint.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay); 
    delay.connect(delayOut);
    delayOut.connect(masterGain);

    // Final
    masterGain.connect(analyser); // Connect to meter
    analyser.connect(finalDestination); // Connect to speakers

    // Update State
    setAnalyserNode(analyser);

    // Store refs
    bassNodeRef.current = bass;
    trebleNodeRef.current = treble;
    compressorNodeRef.current = compressor;
    makeupGainNodeRef.current = makeupGain;
    delayGainRef.current = delayOut;
    reverbGainRef.current = reverbOut;
    masterGainNodeRef.current = masterGain;
    sourceNodeRef.current = source;
    bypassGainNodeRef.current = bypassGain;
    effectsChainGainNodeRef.current = effectsChainGain;

    return source;
  };

  // Playback Logic
  const togglePlay = useCallback(() => {
    if (!buffer || !audioContextRef.current) return;

    if (isPlaying === PlaybackState.PLAYING) {
      // Pause
      sourceNodeRef.current?.stop();
      sourceNodeRef.current = null;
      setIsPlaying(PlaybackState.PAUSED);
      setAnalyserNode(null); // Stop Meter
      // Save current time
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      startOffsetRef.current = (startOffsetRef.current + (elapsed * effects.speed)) % buffer.duration;
      cancelAnimationFrame(rafRef.current!);
    } else {
      // Play
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      const source = setupAudioGraph();
      if (!source) return;

      // Handle offset for playback start
      // If looping and selection is active, we want to make sure we start within range if we are outside
      let startPos = startOffsetRef.current;
      if (isLooping && selection) {
        if (startPos < selection.start || startPos > selection.end) {
            startPos = selection.start;
            startOffsetRef.current = startPos;
        }
      }
      
      // Handle loop if at end but loop is off
      if (startPos >= buffer.duration) {
        startPos = 0;
        startOffsetRef.current = 0;
      }

      startTimeRef.current = audioContextRef.current.currentTime;
      source.start(0, startPos);
      
      setIsPlaying(PlaybackState.PLAYING);

      // UI Loop
      const updateUI = () => {
        if (!audioContextRef.current) return;
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        
        // Calculate current time carefully considering loops
        let actualCurrentTime = 0;
        
        if (isLooping && selection) {
             // Complex loop time math for UI
             const loopDuration = selection.end - selection.start;
             const relativeTime = (startOffsetRef.current - selection.start) + (elapsed * effects.speed);
             actualCurrentTime = selection.start + (relativeTime % loopDuration);
        } else if (isLooping && !selection) {
             actualCurrentTime = (startOffsetRef.current + (elapsed * effects.speed)) % buffer.duration;
        } else {
             actualCurrentTime = startOffsetRef.current + (elapsed * effects.speed);
        }
        
        if (!isLooping && actualCurrentTime >= buffer.duration) {
          setIsPlaying(PlaybackState.STOPPED);
          setAnalyserNode(null); // Stop meter
          startOffsetRef.current = 0;
          setCurrentTime(0);
          return;
        }

        setCurrentTime(actualCurrentTime);
        rafRef.current = requestAnimationFrame(updateUI);
      };
      updateUI();
    }
  }, [buffer, isPlaying, effects.speed, isLooping, selection, isBypassed]); 

  const stop = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(PlaybackState.STOPPED);
    setAnalyserNode(null); // Stop meter
    startOffsetRef.current = 0;
    setCurrentTime(0);
    cancelAnimationFrame(rafRef.current!);
  };

  // Update Effects Live
  useEffect(() => {
    const mix = effects.mix !== undefined ? effects.mix : 1;

    // Handle Bypass Live
    if (bypassGainNodeRef.current && effectsChainGainNodeRef.current) {
        const now = audioContextRef.current?.currentTime || 0;
        // Smooth crossfade to avoid clicks
        bypassGainNodeRef.current.gain.setTargetAtTime(isBypassed ? 1 : 0, now, 0.05);
        effectsChainGainNodeRef.current.gain.setTargetAtTime(isBypassed ? 0 : 1, now, 0.05);
    }

    if (bassNodeRef.current) bassNodeRef.current.gain.setTargetAtTime(effects.bass * mix, 0, 0.1);
    if (trebleNodeRef.current) trebleNodeRef.current.gain.setTargetAtTime(effects.treble * mix, 0, 0.1);
    if (reverbGainRef.current) reverbGainRef.current.gain.setTargetAtTime(effects.reverb * mix, 0, 0.1);
    if (delayGainRef.current) delayGainRef.current.gain.setTargetAtTime(effects.delay * mix, 0, 0.1);
    if (masterGainNodeRef.current) {
        const linearGain = Math.pow(10, effects.gain / 20);
        masterGainNodeRef.current.gain.setTargetAtTime(linearGain, 0, 0.1);
    }
    if (compressorNodeRef.current && makeupGainNodeRef.current) {
        // Scale compressor intensity by mix
        const effectiveCompressor = effects.compressor * mix;
        const thresh = effectiveCompressor > 0 ? -60 * effectiveCompressor : 0;
        const ratio = effectiveCompressor > 0 ? 1 + (effectiveCompressor * 19) : 1;
        
        compressorNodeRef.current.threshold.setTargetAtTime(thresh, 0, 0.1);
        compressorNodeRef.current.ratio.setTargetAtTime(ratio, 0, 0.1);
        makeupGainNodeRef.current.gain.setTargetAtTime(1 + (effectiveCompressor * 0.5), 0, 0.1);
    }
    if (sourceNodeRef.current) {
        sourceNodeRef.current.playbackRate.setTargetAtTime(effects.speed, 0, 0.1);
        // Update loop state live
        sourceNodeRef.current.loop = isLooping;
        if (isLooping && selection) {
            sourceNodeRef.current.loopStart = selection.start;
            sourceNodeRef.current.loopEnd = selection.end;
        } else {
             sourceNodeRef.current.loopStart = 0;
             sourceNodeRef.current.loopEnd = buffer?.duration || 0;
        }
    }
  }, [effects, isLooping, selection, buffer, isBypassed]);

  // Edit Operations
  const handleCut = async () => {
    if (!buffer || !selection || !audioContextRef.current) return;
    
    const wasPlaying = isPlaying === PlaybackState.PLAYING;
    const cutTime = currentTime;
    const selectionDuration = selection.end - selection.start;
    const currentSelection = { ...selection };

    stop(); 
    setIsProcessing(true);
    
    setTimeout(() => {
        if(!buffer || !audioContextRef.current) return;
        const newBuffer = sliceAudioBuffer(audioContextRef.current, buffer, currentSelection.start, currentSelection.end);
        
        let newTime = cutTime;
        if (cutTime > currentSelection.end) {
            newTime -= selectionDuration;
        } else if (cutTime > currentSelection.start) {
            newTime = currentSelection.start;
        }
        newTime = Math.max(0, Math.min(newBuffer.duration - 0.001, newTime));

        pushToHistory(newBuffer);
        setSelection(null);
        startOffsetRef.current = newTime;
        setCurrentTime(newTime);
        setIsProcessing(false);
        
        if (wasPlaying) {
            setShouldResume(true);
        }
    }, 100);
  };

  const applyGain = () => {
    if (!buffer || !selection || !audioContextRef.current) return;

    const wasPlaying = isPlaying === PlaybackState.PLAYING;
    const currentTimeAtEdit = currentTime;

    stop();
    setIsProcessing(true);

    setTimeout(() => {
        if(!buffer || !selection || !audioContextRef.current) return;
        const newBuffer = applyGainToRegion(audioContextRef.current, buffer, selection.start, selection.end, selectionGain);
        pushToHistory(newBuffer);
        
        startOffsetRef.current = currentTimeAtEdit;
        setCurrentTime(currentTimeAtEdit);
        setIsProcessing(false);

        if (wasPlaying) {
            setShouldResume(true);
        }
    }, 100);
  };

  // --- Noise Reduction Handlers ---
  const handleCaptureNoise = () => {
      if (!buffer || !selection) return;
      const profile = captureNoiseProfile(buffer, selection.start, selection.end);
      setNoiseProfile(profile);
      setSelection(null); // Clear selection to indicate capture done
      alert("تم تعيين عينة الضوضاء بنجاح!");
  };

  const handleApplyDenoise = () => {
      if (!buffer || !noiseProfile || !audioContextRef.current) return;
      
      const wasPlaying = isPlaying === PlaybackState.PLAYING;
      const currentTimeAtEdit = currentTime;

      stop();
      setIsProcessing(true);
      
      // Use setTimeout to allow UI render to show loading state
      setTimeout(() => {
        if(!buffer || !noiseProfile || !audioContextRef.current) return;
        
        // Apply to whole buffer
        const newBuffer = removeNoise(audioContextRef.current, buffer, noiseProfile, denoiseAmount / 100);
        pushToHistory(newBuffer);
        
        startOffsetRef.current = currentTimeAtEdit;
        setCurrentTime(currentTimeAtEdit);
        setIsProcessing(false);

        if (wasPlaying) {
            setShouldResume(true);
        }
      }, 100);
  };


  // Auto-resume playback after edit operations
  useEffect(() => {
    if (shouldResume && isPlaying === PlaybackState.STOPPED && buffer) {
        setShouldResume(false);
        togglePlay();
    }
  }, [shouldResume, isPlaying, togglePlay, buffer]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ignore if typing in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        // Spacebar: Toggle Play/Pause
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent scrolling
            togglePlay();
        }

        // Delete/Backspace: Cut Selection
        if ((e.code === 'Delete' || e.code === 'Backspace') && selection && !isRecording) {
             e.preventDefault();
             handleCut();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, selection, isRecording, buffer]); // Include buffer/handleCut dependencies implicitly

  // Recording Logic
  const handleRecording = async () => {
    if (isRecording) {
      // Stop Recording
      mediaRecorderRef.current?.stop();
      if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
      }
      if (inputSourceRef.current) {
          inputSourceRef.current.disconnect();
          inputSourceRef.current = null;
      }
      setAnalyserNode(null); // Stop meter
      setIsRecording(false);
    } else {
      // Start Recording
      try {
        if (isPlaying !== PlaybackState.STOPPED) stop();
        
        // Setup Audio Context for Visualization
        if (!audioContextRef.current) {
             const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
             audioContextRef.current = new AudioContextClass();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        // Constraints with specific device ID if selected
        const constraints = { 
            audio: selectedDeviceId 
                ? { deviceId: { exact: selectedDeviceId } } 
                : true 
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Media Recorder Setup (Saving the file)
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];
        recordingPeaksRef.current = []; // Reset peaks

        // Visualization Chain Setup (Live Waveform)
        const source = ctx.createMediaStreamSource(stream);
        
        // 1. For Meter
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        setAnalyserNode(analyser);

        // 2. For Waveform (Peaks)
        // Buffer size 2048 ~46ms @ 44.1kHz -> ~21 updates/sec
        const processor = ctx.createScriptProcessor(2048, 1, 1); 
        source.connect(processor);
        
        const mute = ctx.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(ctx.destination);

        processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            let max = 0;
            // Simple peak detection
            for (let i = 0; i < input.length; i++) {
                const val = Math.abs(input[i]);
                if (val > max) max = val;
            }
            recordingPeaksRef.current.push(max);
        };

        inputSourceRef.current = source;
        processorRef.current = processor;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            const arrayBuffer = await blob.arrayBuffer();
            if (audioContextRef.current) {
                try {
                    const decoded = await audioContextRef.current.decodeAudioData(arrayBuffer);
                    
                    // Add to library
                    const name = `تسجيل صوتي ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
                    addToLibrary(decoded, name);

                    pushToHistory(decoded);
                    setFileName(name);
                    setSelection(null);
                    setCurrentTime(0);
                    startOffsetRef.current = 0;
                } catch (e) {
                    console.error(e);
                    alert("فشل في معالجة التسجيل - الصيغة غير مدعومة");
                }
            }
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
        setRecordingStartTime(Date.now());
        setCurrentTime(0);

      } catch (err) {
        console.error(err);
        alert("يرجى السماح بالوصول للميكروفون للبدء في التسجيل");
      }
    }
  };

  const handleDownload = async () => {
    if (!buffer) return;
    setIsProcessing(true);
    const blob = await exportAudio(buffer, effects, (window as any).reverbImpulse, exportWithEffects);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportWithEffects ? 'edited' : 'raw'}_${fileName || 'audio'}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    setIsProcessing(false);
  };

  return (
    <div 
      className="min-h-screen flex flex-col text-gray-100 font-sans selection:bg-studio-accent selection:text-studio-900"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="p-4 md:p-6 border-b border-studio-700 bg-studio-800/50 backdrop-blur-sm flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3 md:gap-4">
            {/* Logo Integration */}
            <div className="relative group cursor-pointer transition-transform hover:scale-105">
                <div className="absolute -inset-1 bg-studio-accent/30 rounded-full blur-lg opacity-75 group-hover:opacity-100 transition duration-500"></div>
                <img 
                    src="https://ui-avatars.com/api/?name=Audio+Forge&background=00ff9d&color=121212&size=128&rounded=true&bold=true&font-size=0.4" 
                    alt="AudioForge Pro Logo" 
                    className="relative w-10 h-10 md:w-14 md:h-14 rounded-full border-2 border-studio-accent shadow-[0_0_20px_rgba(0,255,157,0.3)] object-cover bg-studio-900" 
                />
            </div>
            <div>
                <h1 className="text-lg md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                    AudioForge <span className="hidden sm:inline text-studio-accent bg-studio-accent/10 px-2 py-0.5 rounded text-sm border border-studio-accent/20">Pro</span>
                </h1>
                <p className="text-[10px] md:text-xs text-gray-400 font-medium tracking-wide">محرر صوتي احترافي</p>
            </div>
        </div>
        <div className="flex gap-2 md:gap-4 items-center">
            {/* Mic Selector - Desktop Only */}
            <div className="hidden lg:block">
                <select 
                    className="bg-studio-700 text-gray-300 text-sm rounded-full px-4 py-2 border border-studio-600 focus:border-studio-accent focus:outline-none max-w-[200px] truncate"
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    disabled={isRecording}
                >
                    {audioInputDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `ميكروفون ${device.deviceId.slice(0,5)}...`}
                        </option>
                    ))}
                    {audioInputDevices.length === 0 && <option value="">المايك الافتراضي</option>}
                </select>
            </div>

            <button 
                onClick={runAiAudioDoctor}
                disabled={isAnalyzing}
                className="flex items-center gap-2 p-2 md:px-4 md:py-2 bg-gradient-to-r from-studio-accent/20 to-cyan-500/20 hover:from-studio-accent/30 hover:to-cyan-500/30 text-studio-accent rounded-full transition-all text-sm font-bold border border-studio-accent/40 shadow-[0_0_15px_rgba(0,255,157,0.2)]"
                title="المعالج الذكي (AI Doctor)"
            >
                <Icons.Sparkles />
                <span className="hidden md:inline">{isAnalyzing ? 'جاري التحليل...' : 'المعالج الذكي AI'}</span>
            </button>

            <button 
                onClick={() => setIsLibraryOpen(!isLibraryOpen)}
                className={`flex items-center gap-2 p-2 md:px-4 md:py-2 rounded-full transition-colors text-sm font-medium border ${isLibraryOpen ? 'bg-studio-accent text-studio-900 border-studio-accent' : 'bg-studio-700 hover:bg-studio-600 border-studio-600 hover:border-studio-500'}`}
                title="المكتبة"
            >
                <Icons.Loop /> {/* Using Loop icon as a placeholder for Library/List if no specific icon */}
                <span className="hidden md:inline">المكتبة</span>
                {library.length > 0 && <span className="flex items-center justify-center w-4 h-4 text-[8px] bg-red-500 text-white rounded-full ml-1">{library.length}</span>}
            </button>

            <label className="flex items-center gap-2 p-2 md:px-4 md:py-2 bg-studio-700 hover:bg-studio-600 rounded-full cursor-pointer transition-colors text-sm font-medium border border-studio-600 hover:border-studio-500" title="استيراد ملف">
                <Icons.Download />
                <span className="hidden md:inline">استيراد</span>
                <input type="file" accept="audio/*, .wav, .mp3, .m4a, .aac, .ogg, .flac" multiple className="hidden" onChange={(e) => e.target.files && handleFileUpload(e.target.files)} />
            </label>

            <div className="flex items-center gap-2 bg-studio-800 border border-studio-700 rounded-full px-2 py-1 md:px-3 md:py-1.5">
                <span className="hidden sm:inline text-[10px] font-bold text-gray-400 uppercase tracking-wider">تصدير بالمؤثرات</span>
                <button 
                    onClick={() => setExportWithEffects(!exportWithEffects)}
                    className={`relative w-8 h-4 md:w-10 md:h-5 rounded-full transition-colors duration-200 focus:outline-none ${exportWithEffects ? 'bg-studio-accent' : 'bg-studio-600'}`}
                >
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 md:w-4 md:h-4 bg-studio-900 rounded-full transition-transform duration-200 ${exportWithEffects ? 'translate-x-4 md:translate-x-5' : 'translate-x-0'}`}></div>
                </button>
            </div>

            <button 
                onClick={handleDownload}
                disabled={!buffer || isProcessing}
                className={`flex items-center gap-2 p-2 md:px-4 md:py-2 rounded-full text-sm font-bold text-studio-900 transition-all
                    ${!buffer ? 'bg-gray-600 cursor-not-allowed' : 'bg-studio-accent hover:bg-white shadow-[0_0_20px_rgba(0,255,157,0.4)] hover:shadow-[0_0_30px_rgba(0,255,157,0.6)]'}
                `}
                title="تصدير المشروع"
            >
                <Icons.Upload />
                <span className="hidden md:inline">تصدير</span>
            </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 p-4 lg:p-8 flex flex-col gap-6 max-w-7xl mx-auto w-full relative">
        
        {/* Waveform Visualizer & Meter Container Split Layout */}
        <div className="flex flex-col lg:flex-row gap-6 items-stretch">
            
            {/* Left: Main Editor (Waveform + Controls) */}
            <div className="flex-1 bg-studio-800 rounded-xl border border-studio-700 shadow-xl overflow-hidden flex flex-col">
                {/* Top Bar Info */}
                <div className="bg-studio-800 p-4 border-b border-studio-700 flex justify-between items-center z-10 relative">
                    <div className="text-sm text-gray-400 font-mono flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : buffer ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                    {isRecording ? 'جاري التسجيل...' : (fileName ? fileName : 'لا يوجد ملف')}
                    {isProcessing && <span className="text-studio-accent animate-pulse ml-2 font-bold">[جاري المعالجة...]</span>}
                    </div>
                    <div className="text-2xl font-mono text-studio-accent font-bold tracking-wider shadow-black drop-shadow-md">
                        {formatTime(currentTime)}
                    </div>
                </div>
                
                {/* Waveform Area */}
                <div className="flex-1 h-64 md:h-80 bg-studio-900 relative">
                    <Waveform 
                        buffer={buffer} 
                        currentTime={currentTime} 
                        selection={selection}
                        onSelectionChange={setSelection}
                        isRecording={isRecording}
                        recordingPeaks={recordingPeaksRef}
                        onSeek={(time) => {
                            if (!buffer || isRecording) return;
                            startOffsetRef.current = time;
                            setCurrentTime(time);
                            if (isPlaying === PlaybackState.PLAYING) {
                                togglePlay(); // Restart
                                togglePlay();
                            }
                        }}
                    />
                    {/* Tip Overlay */}
                    <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
                        <div className="inline-block bg-studio-900/80 px-2 py-1 rounded text-[10px] text-gray-500">
                            استخدم عجلة الماوس أو اللمس للتكبير • المسطرة للتشغيل • Delete للحذف
                        </div>
                    </div>
                </div>

                {/* Transport Controls Bar */}
                <div className="bg-studio-800 p-3 md:p-4 border-t border-studio-700">
                    <div className="flex justify-center gap-3 md:gap-6 flex-wrap items-center select-none">
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setIsBypassed(!isBypassed)} 
                                className={`p-2.5 md:p-3 rounded-full transition-colors active:translate-y-0.5 font-bold text-xs flex items-center justify-center w-10 h-10 md:w-12 md:h-12 border-2 ${isBypassed ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-studio-700 text-gray-400 border-transparent hover:text-studio-accent'}`} 
                                title="تجاوز المؤثرات (FX Bypass)"
                            >
                                FX
                            </button>

                            <button 
                                onClick={stop} 
                                className="p-2.5 md:p-3 rounded-full bg-studio-700 hover:bg-studio-600 text-gray-300 transition-colors active:translate-y-0.5" 
                                title="إيقاف"
                            >
                                <Icons.Square />
                            </button>
                            
                            <button 
                                onClick={() => setIsLooping(!isLooping)} 
                                className={`p-2.5 md:p-3 rounded-full transition-colors active:translate-y-0.5 ${isLooping ? 'bg-studio-accent text-studio-900 shadow-[0_0_10px_rgba(0,255,157,0.4)]' : 'bg-studio-700 hover:bg-studio-600 text-gray-300'}`} 
                                title="تكرار"
                            >
                                <Icons.Loop />
                            </button>
                        </div>

                        <button 
                            onClick={togglePlay} 
                            disabled={isRecording}
                            className={`p-3.5 md:p-4 rounded-full transition-transform shadow-[0_0_20px_rgba(0,255,157,0.3)] hover:shadow-[0_0_30px_rgba(0,255,157,0.5)] ${isRecording ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-studio-accent text-studio-900 hover:scale-105 active:scale-95'}`}
                            title={isPlaying === PlaybackState.PLAYING ? "إيقاف مؤقت" : "تشغيل"}
                        >
                            {isPlaying === PlaybackState.PLAYING ? <Icons.Pause /> : <Icons.Play />}
                        </button>

                        {/* Record Button */}
                        <button 
                            onClick={handleRecording} 
                            className={`p-3.5 md:p-4 rounded-full transition-all shadow-lg ${
                                isRecording 
                                ? 'bg-red-600 text-white animate-pulse shadow-red-500/50' 
                                : 'bg-studio-700 text-red-500 hover:bg-studio-600 hover:text-red-400 hover:shadow-red-500/20'
                            }`}
                            title={isRecording ? "إيقاف التسجيل" : "بدء التسجيل"}
                        >
                            <Icons.Mic />
                        </button>

                        <button 
                            onClick={handleNewProject}
                            className="p-3.5 md:p-4 rounded-full bg-studio-700 hover:bg-studio-600 text-gray-300 hover:text-white transition-colors active:translate-y-0.5"
                            title="مشروع جديد"
                        >
                            <Icons.FilePlus />
                        </button>
                        
                        <div className="h-8 md:h-12 w-px bg-studio-700 mx-1 hidden sm:block"></div>

                        {/* History Controls */}
                        <div className="flex gap-2">
                            <button 
                                onClick={undo}
                                disabled={historyIndex <= 0 || isRecording}
                                className={`p-2.5 md:p-3 rounded-full transition-colors ${historyIndex > 0 && !isRecording ? 'bg-studio-700 hover:bg-studio-600 text-white hover:text-studio-accent' : 'bg-studio-800 text-studio-600 cursor-not-allowed'}`}
                                title="تراجع"
                            >
                                <Icons.Undo />
                            </button>
                            <button 
                                onClick={redo}
                                disabled={historyIndex >= history.length - 1 || isRecording}
                                className={`p-2.5 md:p-3 rounded-full transition-colors ${historyIndex < history.length - 1 && !isRecording ? 'bg-studio-700 hover:bg-studio-600 text-white hover:text-studio-accent' : 'bg-studio-800 text-studio-600 cursor-not-allowed'}`}
                                title="إعادة"
                            >
                                <Icons.Redo />
                            </button>
                        </div>

                        <div className="h-12 w-px bg-studio-700 mx-2 hidden sm:block"></div>

                        {/* Contextual Edit Tools */}
                        <div className={`flex items-center gap-2 md:gap-3 bg-studio-900/50 p-1.5 md:p-2 rounded-full border border-studio-700/50 transition-all duration-300 ${!isRecording && buffer ? 'opacity-100' : 'opacity-40 pointer-events-none grayscale'}`}>
                            
                            {/* Standard Tools (Requires Selection) */}
                            <div className={`flex items-center gap-1.5 md:gap-2 ${!selection ? 'opacity-30 pointer-events-none' : ''}`}>
                                <button 
                                    onClick={handleCut}
                                    className="p-2 md:p-2.5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-[0_0_10px_rgba(239,68,68,0.15)]"
                                    title="قص التحديد"
                                >
                                    <Icons.Scissors />
                                </button>
                                
                                <div className="w-px h-5 md:h-6 bg-studio-700/50"></div>
                                
                                <button 
                                    onClick={handleCaptureNoise}
                                    className="p-2 md:p-2.5 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white transition-all shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                                    title="تعيين كعينة ضوضاء"
                                >
                                    <Icons.Wave />
                                </button>
                            </div>

                            {/* Denoise Controls (Visible if Profile exists) */}
                            {noiseProfile && (
                                <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 bg-studio-800/80 rounded-full border border-blue-500/30 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <span className="hidden xs:inline text-[10px] text-blue-300 font-bold whitespace-nowrap">إزالة الضوضاء</span>
                                    <input 
                                        type="range" 
                                        min="0" max="100" 
                                        value={denoiseAmount}
                                        onChange={(e) => setDenoiseAmount(Number(e.target.value))}
                                        className="w-12 md:w-16 h-1.5 bg-studio-600 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <button 
                                        onClick={handleApplyDenoise}
                                        className="p-1 md:p-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.4)]"
                                        title="تطبيق الفلتر"
                                    >
                                        <Icons.Sparkles />
                                    </button>
                                </div>
                            )}

                             {/* Gain Controls (Requires Selection) */}
                             {selection && !noiseProfile && (
                                <div className="flex items-center gap-2 md:gap-3 px-1.5 md:px-2 border-l border-studio-700 pl-2 md:pl-3">
                                    <div className="flex flex-col w-16 md:w-24 gap-1">
                                        <input 
                                            type="range" 
                                            min="-20" max="20" 
                                            step="1"
                                            value={selectionGain}
                                            onChange={(e) => setSelectionGain(Number(e.target.value))}
                                            className="h-1.5 bg-studio-700 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <div className="flex justify-between text-[7px] md:text-[8px] text-gray-500 font-mono">
                                            <span className="hidden xs:inline">-20</span>
                                            <span className={selectionGain !== 0 ? 'text-studio-accent' : ''}>{selectionGain > 0 ? '+' : ''}{selectionGain}</span>
                                            <span className="hidden xs:inline">+20</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={applyGain}
                                        className="px-1.5 py-0.5 md:px-2 md:py-1 rounded text-studio-900 bg-gray-400 hover:bg-studio-accent text-[9px] md:text-[10px] font-bold transition-colors"
                                    >
                                        Gain
                                    </button>
                                </div>
                             )}

                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column: Meter + Library */}
            <div className="flex flex-row gap-4 w-full lg:w-auto shrink-0 h-[400px] items-stretch">
                {/* Meter Strip (Desktop) */}
                <div className="hidden lg:flex flex-col w-24 bg-studio-800 rounded-xl border border-studio-700 shadow-xl overflow-hidden py-4 items-center gap-3">
                     <div className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-1">Level</div>
                     <div className="flex-1 w-full flex items-center justify-center relative">
                        {/* Meter background track */}
                        <div className="bg-studio-900/50 w-16 h-full rounded-lg border border-studio-700/50 flex justify-center py-2 shadow-inner">
                            <AudioMeter analyser={analyserNode} height={260} />
                        </div>
                     </div>
                     <div className="w-2 h-2 rounded-full bg-studio-accent shadow-[0_0_8px_rgba(0,255,157,0.6)] animate-pulse"></div>
                     <div className="text-[10px] text-studio-accent font-mono tracking-wider">OUT 1-2</div>
                </div>

                {/* Library Panel (Visible if Open) */}
                {isLibraryOpen && (
                    <div 
                        className={`w-full lg:w-64 bg-studio-800 rounded-xl border shadow-xl overflow-hidden flex flex-col h-full transition-colors ${isDraggingOverLibrary ? 'border-studio-accent bg-studio-700/50' : 'border-studio-700'}`}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDraggingOverLibrary(true);
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDraggingOverLibrary(false);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDraggingOverLibrary(false);
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                handleFileUpload(e.dataTransfer.files);
                            }
                        }}
                    >
                        <div className="p-3 border-b border-studio-700 flex justify-between items-center bg-studio-900/50">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Icons.Loop /> المكتبة
                            </h3>
                            <div className="flex gap-1">
                                <label className="p-1.5 rounded bg-studio-700 hover:bg-studio-600 text-studio-accent cursor-pointer transition-colors" title="استيراد">
                                    <div className="scale-75"><Icons.Download /></div>
                                    <input type="file" accept="audio/*, .wav, .mp3, .m4a, .aac, .ogg, .flac" multiple className="hidden" onChange={(e) => e.target.files && handleFileUpload(e.target.files)} />
                                </label>
                                <button onClick={() => setIsLibraryOpen(false)} className="text-gray-400 hover:text-white p-1.5 rounded hover:bg-studio-700 transition-colors">
                                    <div className="scale-75"><Icons.Minus /></div>
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                            {library.length === 0 ? (
                                <div className="text-center text-gray-500 py-8 flex flex-col items-center gap-2">
                                    <div className="scale-75 opacity-50"><Icons.Download /></div>
                                    <span className="text-xs">لا توجد ملفات</span>
                                </div>
                            ) : (
                                library.map(item => (
                                    <div 
                                        key={item.id}
                                        onClick={() => loadFromLibrary(item)}
                                        className={`p-2 rounded-lg cursor-pointer transition-all group relative border ${fileName === item.name ? 'bg-studio-700 border-studio-accent/50 shadow-md' : 'bg-studio-900/40 hover:bg-studio-700/60 border-transparent hover:border-studio-600'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <div className={`text-xs font-medium truncate w-32 ${fileName === item.name ? 'text-studio-accent' : 'text-gray-200'}`}>{item.name}</div>
                                            <button 
                                                type="button"
                                                onClick={(e) => deleteFromLibrary(item.id, e)}
                                                className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-studio-800 rounded"
                                                title="حذف"
                                            >
                                                <div className="scale-75"><Icons.Trash /></div>
                                            </button>
                                        </div>
                                        <div className="flex justify-between items-center text-[9px] text-gray-500 font-mono">
                                            <span className="bg-studio-800 px-1 py-0.5 rounded">{formatTime(item.duration)}</span>
                                            <span>{new Date(item.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Presets Selection */}
        <div className={`bg-studio-800 rounded-xl p-6 border border-studio-700 shadow-lg ${isRecording ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
            <div className="flex items-center justify-between mb-6 border-b border-studio-700 pb-4">
                <h3 className="text-white font-bold tracking-wider text-sm uppercase flex items-center gap-2">
                    <Icons.Sparkles /> أنماط الصوت الجاهزة (Presets)
                </h3>
                {isAnalyzing && (
                    <div className="flex items-center gap-2 text-studio-accent text-xs animate-pulse font-bold">
                        <div className="w-2 h-2 bg-studio-accent rounded-full"></div>
                        جاري تحليل الصوت بالذكاء الاصطناعي...
                    </div>
                )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                {AUDIO_PRESETS.map((preset) => (
                    <button
                        key={preset.id}
                        onClick={() => applyPreset(preset)}
                        className={`group relative flex flex-col items-center p-4 rounded-xl border transition-all duration-300 ${
                            selectedPresetId === preset.id 
                            ? 'bg-studio-accent border-studio-accent shadow-[0_0_15px_rgba(0,255,157,0.3)]' 
                            : 'bg-studio-900/50 border-studio-700 hover:border-studio-accent/50 hover:bg-studio-800'
                        }`}
                    >
                        <div className={`mb-2 p-2 rounded-full transition-colors ${
                            selectedPresetId === preset.id ? 'bg-studio-900 text-studio-accent' : 'bg-studio-800 text-gray-400 group-hover:text-studio-accent'
                        }`}>
                            {preset.id === 'auto' ? <Icons.Sparkles /> : preset.id === 'haram' ? <Icons.Mic /> : <Icons.Activity />}
                        </div>
                        <span className={`text-xs font-bold text-center ${
                            selectedPresetId === preset.id ? 'text-studio-900' : 'text-gray-300'
                        }`}>
                            {preset.name}
                        </span>
                        
                        {/* Tooltip on hover */}
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-2 bg-studio-700 text-[10px] text-gray-200 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-studio-600 text-center">
                            {preset.description}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-studio-700"></div>
                        </div>
                    </button>
                ))}
            </div>
        </div>

        {/* Effects Rack */}
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 ${isRecording ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
            
            {/* Dynamics & Power */}
            <div className="bg-studio-800 rounded-xl p-6 border border-studio-700 shadow-lg flex flex-col items-center hover:border-red-500/30 transition-colors">
                <h3 className="text-red-400 font-bold mb-6 tracking-wider text-sm uppercase border-b border-studio-700 w-full text-center pb-2 flex items-center justify-center gap-2">
                    <Icons.Zap /> الديناميكية والقوة
                </h3>
                <div className="flex gap-8">
                    <ControlKnob 
                        label="Master Gain" 
                        value={effects.gain} 
                        min={-20} max={20} 
                        onChange={(val) => setEffects(prev => ({...prev, gain: val}))}
                        unit="dB"
                    />
                    <ControlKnob 
                        label="Compressor" 
                        value={effects.compressor} 
                        min={0} max={1} 
                        onChange={(val) => setEffects(prev => ({...prev, compressor: val}))}
                        unit="%"
                    />
                </div>
            </div>

            {/* EQ Section */}
            <div className="bg-studio-800 rounded-xl p-6 border border-studio-700 shadow-lg flex flex-col items-center hover:border-studio-accent/30 transition-colors">
                <h3 className="text-studio-accent font-bold mb-6 tracking-wider text-sm uppercase border-b border-studio-700 w-full text-center pb-2">المعادل الصوتي (EQ)</h3>
                <div className="flex gap-8">
                    <ControlKnob 
                        label="Bass" 
                        value={effects.bass} 
                        min={-10} max={10} 
                        onChange={(val) => setEffects(prev => ({...prev, bass: val}))}
                        unit="dB"
                    />
                    <ControlKnob 
                        label="Treble" 
                        value={effects.treble} 
                        min={-10} max={10} 
                        onChange={(val) => setEffects(prev => ({...prev, treble: val}))}
                        unit="dB"
                    />
                </div>
            </div>

            {/* Time Effects */}
            <div className="bg-studio-800 rounded-xl p-6 border border-studio-700 shadow-lg flex flex-col items-center hover:border-purple-500/30 transition-colors">
                <h3 className="text-purple-400 font-bold mb-6 tracking-wider text-sm uppercase border-b border-studio-700 w-full text-center pb-2">صدى وتكرار</h3>
                <div className="flex gap-8">
                    <ControlKnob 
                        label="Reverb" 
                        value={effects.reverb} 
                        min={0} max={1} 
                        onChange={(val) => setEffects(prev => ({...prev, reverb: val}))}
                    />
                    <ControlKnob 
                        label="Delay" 
                        value={effects.delay} 
                        min={0} max={1} 
                        onChange={(val) => setEffects(prev => ({...prev, delay: val}))}
                    />
                </div>
            </div>

            {/* Speed & Mix Control */}
            <div className="bg-studio-800 rounded-xl p-6 border border-studio-700 shadow-lg flex flex-col items-center hover:border-blue-500/30 transition-colors">
                 <h3 className="text-blue-400 font-bold mb-6 tracking-wider text-sm uppercase border-b border-studio-700 w-full text-center pb-2">التحكم العام</h3>
                 <div className="flex gap-8">
                    <ControlKnob 
                        label="Speed" 
                        value={effects.speed} 
                        min={0.5} max={2.0} 
                        step={0.01}
                        onChange={(val) => setEffects(prev => ({...prev, speed: val}))}
                        unit="x"
                    />
                    <ControlKnob 
                        label="FX Amount" 
                        value={effects.mix} 
                        min={0} max={1} 
                        onChange={(val) => setEffects(prev => ({...prev, mix: val}))}
                        unit="%"
                    />
                 </div>
            </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-gray-600 text-xs">
         تم التطوير باستخدام تقنيات الويب الحديثة (م. عبدالله الحاج)
      </footer>

      {/* AI Doctor & Master Modal */}
      {isAiModalOpen && aiAnalysisResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
            <div className="bg-studio-800 border border-studio-accent/40 rounded-2xl p-6 md:p-8 max-w-lg w-full shadow-[0_0_50px_rgba(0,255,157,0.2)] flex flex-col gap-6 relative">
                <div className="flex justify-between items-center border-b border-studio-700 pb-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <span className="text-studio-accent"><Icons.Sparkles /></span> المعالج الذكي والماسترينج (AI Neural Doctor)
                    </h2>
                    <button 
                        onClick={() => setIsAiModalOpen(false)}
                        className="text-gray-400 hover:text-white p-1.5 rounded-lg bg-studio-700 hover:bg-studio-600 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-studio-900/60 p-4 rounded-xl border border-studio-700 flex flex-col gap-1">
                        <span className="text-xs text-gray-400">مدة الملف</span>
                        <span className="text-lg font-bold text-studio-accent">{aiAnalysisResult.duration} ثانية</span>
                    </div>
                    <div className="bg-studio-900/60 p-4 rounded-xl border border-studio-700 flex flex-col gap-1">
                        <span className="text-xs text-gray-400">معدل العينة</span>
                        <span className="text-lg font-bold text-white">{aiAnalysisResult.sampleRate} Hz</span>
                    </div>
                    <div className="bg-studio-900/60 p-4 rounded-xl border border-studio-700 flex flex-col gap-1">
                        <span className="text-xs text-gray-400">الذروة (Peak dB)</span>
                        <span className="text-lg font-bold text-yellow-400">{aiAnalysisResult.peakDb} dB</span>
                    </div>
                    <div className="bg-studio-900/60 p-4 rounded-xl border border-studio-700 flex flex-col gap-1">
                        <span className="text-xs text-gray-400">درجة النقاء (Clarity)</span>
                        <span className="text-lg font-bold text-green-400">{aiAnalysisResult.clarityScore}%</span>
                    </div>
                </div>

                <div className="bg-studio-900/80 p-4 rounded-xl border border-studio-accent/20 flex flex-col gap-2">
                    <h4 className="text-sm font-bold text-studio-accent flex items-center gap-1.5">
                        <Icons.Zap /> توصيات الذكاء الاصطناعي:
                    </h4>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        {aiAnalysisResult.recommendation}
                    </p>
                </div>

                <div className="flex gap-3 pt-2">
                    <button 
                        onClick={applyAiMastering}
                        className="flex-1 py-3 px-4 bg-studio-accent hover:bg-white text-studio-900 font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(0,255,157,0.3)] flex items-center justify-center gap-2"
                    >
                        <Icons.Sparkles /> تطبيق الماسترينج الذكي تلقائياً
                    </button>
                    <button 
                        onClick={() => setIsAiModalOpen(false)}
                        className="py-3 px-6 bg-studio-700 hover:bg-studio-600 text-white font-medium rounded-xl transition-colors"
                    >
                        إغلاق
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}