import React, { useEffect, useRef, useState } from 'react';
import { AudioSelection } from '../types';

interface WaveformProps {
  buffer: AudioBuffer | null;
  currentTime: number;
  selection: AudioSelection | null;
  onSelectionChange: (sel: AudioSelection | null) => void;
  onSeek: (time: number) => void;
  isRecording?: boolean;
  recordingPeaks?: React.MutableRefObject<number[]>;
}

type DragMode = 'none' | 'create' | 'resize-start' | 'resize-end';

const Waveform: React.FC<WaveformProps> = ({ 
    buffer, 
    currentTime, 
    selection, 
    onSelectionChange, 
    onSeek,
    isRecording = false,
    recordingPeaks
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drag State
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState<number | null>(null);
  
  // Zoom State
  const [zoom, setZoom] = useState(1);
  const [scrollOffset, setScrollOffset] = useState(0); // in seconds
  const [cursorStyle, setCursorStyle] = useState('crosshair');

  // Peak Normalization State
  const [bufferPeak, setBufferPeak] = useState(1.0);

  // Pinch Zoom & Pan Refs
  const lastTouchDistance = useRef<number | null>(null);
  const lastTouchX = useRef<number | null>(null);
  const touchStartPos = useRef<{x: number, y: number} | null>(null);
  const isPotentialSeek = useRef(false);

  // Refs for event listener access
  const bufferRef = useRef(buffer);
  const zoomRef = useRef(zoom);
  const scrollOffsetRef = useRef(scrollOffset);
  const selectionRef = useRef(selection);

  useEffect(() => { bufferRef.current = buffer; }, [buffer]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { scrollOffsetRef.current = scrollOffset; }, [scrollOffset]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  // Reset zoom when buffer changes, BUT NOT if recording
  useEffect(() => {
    if (!isRecording) {
        setZoom(1);
        setScrollOffset(0);
        zoomRef.current = 1;
        scrollOffsetRef.current = 0;
        
        // Calculate Peak for Normalization
        if (buffer) {
            const data = buffer.getChannelData(0);
            let max = 0;
            const step = Math.floor(data.length / 2000) || 1; // Scan sub-sample for speed
            for(let i=0; i<data.length; i+=step) {
                const val = Math.abs(data[i]);
                if (val > max) max = val;
            }
            // Ensure we don't divide by zero or boost silence too much
            // Clamp minimum peak to 0.1 to prevent noise explosion
            setBufferPeak(Math.max(max, 0.1));
        } else {
            setBufferPeak(1.0);
        }
    }
  }, [buffer, isRecording]);

  // Helper: Get Time from ClientX
  const getTimeFromEvent = (clientX: number) => {
    if (!canvasRef.current || !buffer) return 0;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const width = rect.width;
    
    const curZoom = zoomRef.current;
    const curOffset = scrollOffsetRef.current;
    
    const visibleDuration = buffer.duration / curZoom;
    const maxOffset = Math.max(0, buffer.duration - visibleDuration);
    const actualOffset = Math.min(curOffset, maxOffset);

    const timeInView = (x / width) * visibleDuration;
    return Math.max(0, Math.min(buffer.duration, actualOffset + timeInView));
  };

  // Helper: Get X pixel from Time
  const getXFromTime = (time: number, width: number) => {
    if (!buffer) return 0;
    const curZoom = zoomRef.current;
    const curOffset = scrollOffsetRef.current;
    const visibleDuration = buffer.duration / curZoom;
    const maxOffset = Math.max(0, buffer.duration - visibleDuration);
    const actualOffset = Math.min(curOffset, maxOffset);
    
    return ((time - actualOffset) / visibleDuration) * width;
  };

  // Handle Wheel / Pinch Zoom (Desktop)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (isRecording) {
        e.preventDefault();
        const zoomDelta = -e.deltaY;
        const sensitivity = 0.001;
        let newZoom = zoomRef.current * (1 + zoomDelta * sensitivity);
        newZoom = Math.max(1, Math.min(50, newZoom)); 
        setZoom(newZoom);
        zoomRef.current = newZoom;
        return;
      }

      e.preventDefault();
      
      const curZoom = zoomRef.current;
      const curOffset = scrollOffsetRef.current;
      const curBuffer = bufferRef.current;

      if (!curBuffer) return;

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;

      if (e.deltaMode === 1) { deltaX *= 40; deltaY *= 40; }
      else if (e.deltaMode === 2) { deltaX *= 800; deltaY *= 800; }

      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const visibleDuration = curBuffer.duration / curZoom;
      
      let isHorizontalPan = Math.abs(deltaX) > Math.abs(deltaY);
      if (e.shiftKey) {
        isHorizontalPan = true;
        if (Math.abs(deltaY) > Math.abs(deltaX)) deltaX = deltaY;
      }

      if (isHorizontalPan) {
        const secondsPerPixel = visibleDuration / width;
        const timeDelta = deltaX * secondsPerPixel;
        let newOffset = curOffset + timeDelta;
        const maxOffset = Math.max(0, curBuffer.duration - visibleDuration);
        newOffset = Math.max(0, Math.min(maxOffset, newOffset));
        scrollOffsetRef.current = newOffset;
        setScrollOffset(newOffset);
      } else {
        const mouseX = e.clientX - rect.left;
        const mouseRatio = Math.max(0, Math.min(1, mouseX / width));
        const mouseTime = curOffset + (mouseRatio * visibleDuration);

        const sensitivity = 0.001;
        const zoomDelta = -deltaY;
        let newZoom = curZoom * (1 + zoomDelta * sensitivity);
        newZoom = Math.max(1, Math.min(200, newZoom));

        const newVisibleDuration = curBuffer.duration / newZoom;
        let newOffset = mouseTime - (mouseRatio * newVisibleDuration);
        const maxOffset = Math.max(0, curBuffer.duration - newVisibleDuration);
        newOffset = Math.max(0, Math.min(maxOffset, newOffset));

        zoomRef.current = newZoom;
        scrollOffsetRef.current = newOffset;
        setZoom(newZoom);
        setScrollOffset(newOffset);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isRecording]);

  // Live Recording Render Loop
  useEffect(() => {
    if (!isRecording || !recordingPeaks || !canvasRef.current) return;
    
    let animationFrameId: number;

    const renderLive = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const amp = height / 2;
        const curZoom = zoomRef.current;

        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        ctx.strokeStyle = '#444';
        ctx.moveTo(0, amp);
        ctx.lineTo(width, amp);
        ctx.stroke();

        const peaks = recordingPeaks.current;
        if (peaks.length === 0) {
            animationFrameId = requestAnimationFrame(renderLive);
            return;
        }

        ctx.beginPath();
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 2;

        const totalPoints = peaks.length;
        const visiblePoints = totalPoints / curZoom;
        const startIndex = Math.max(0, totalPoints - visiblePoints);
        const step = visiblePoints / width;

        for (let i = 0; i < width; i++) {
            const index = Math.floor(startIndex + (i * step));
            if (index >= totalPoints) break;
            if (index < 0) continue;
            const value = peaks[index];
            ctx.moveTo(i, amp - (value * amp));
            ctx.lineTo(i, amp + (value * amp));
        }
        ctx.stroke();

        ctx.fillStyle = '#ff4d4d';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('• جاري التسجيل', 20, 30);

        if (curZoom > 1) {
            const zoomText = `x${curZoom.toFixed(1)}`;
            ctx.fillStyle = 'rgba(255, 77, 77, 0.2)';
            const textWidth = ctx.measureText(zoomText).width;
            ctx.fillRect(120, 16, textWidth + 8, 20);
            ctx.fillStyle = '#ff9999';
            ctx.fillText(zoomText, 124, 30);
        }

        animationFrameId = requestAnimationFrame(renderLive);
    };

    renderLive();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isRecording, recordingPeaks]);

  // Static Draw Loop (Playback / Editing)
  useEffect(() => {
    if (isRecording) return;

    const canvas = canvasRef.current;
    if (!canvas || !buffer) {
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0,0, canvas.width, canvas.height);
        }
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const amp = height / 2;

    // Normalization Factor: 
    // We want the peak of the buffer to touch the edges (1.0 or -1.0)
    // So we scale by 1 / bufferPeak. 
    // We multiply by a small extra factor (e.g. 1.05) to ensure it looks really full, but clamp to 1.
    const normFactor = (1 / bufferPeak);

    ctx.clearRect(0, 0, width, height);

    const visibleDuration = buffer.duration / zoom;
    const maxOffset = Math.max(0, buffer.duration - visibleDuration);
    const actualOffset = Math.min(scrollOffset, maxOffset);
    
    const startSample = Math.floor(actualOffset * buffer.sampleRate);
    const endSample = Math.floor((actualOffset + visibleDuration) * buffer.sampleRate);
    const visibleSamples = endSample - startSample;
    
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(visibleSamples / width));

    // Grid
    ctx.beginPath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const gridStep = visibleDuration / 10; 
    for(let t = actualOffset - (actualOffset % gridStep); t < actualOffset + visibleDuration; t += gridStep) {
        const x = ((t - actualOffset) / visibleDuration) * width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    ctx.stroke();

    // Midline
    ctx.beginPath();
    ctx.strokeStyle = '#444';
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();

    // Waveform
    ctx.beginPath();
    ctx.strokeStyle = '#00ff9d';
    ctx.lineWidth = 2; // Thicker line for "fuller" look

    const stride = step < 1 ? 1 : Math.floor(step);
    for (let i = 0; i < width; i++) {
      const sampleIndex = startSample + Math.floor((i / width) * visibleSamples);
      if (sampleIndex >= data.length) break;
      
      let min = 1.0;
      let max = -1.0;
      
      if (stride === 1) {
          const datum = data[sampleIndex];
          min = datum;
          max = datum;
      } else {
          let loopStride = 1;
          if (stride > 200) loopStride = Math.floor(stride / 100);

          const sliceEnd = Math.min(data.length, sampleIndex + stride);
          for (let j = sampleIndex; j < sliceEnd; j += loopStride) {
            const datum = data[j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }
      }
      
      if (min > max) { min = 0; max = 0; }

      // Apply Normalization
      min *= normFactor;
      max *= normFactor;

      // Clamp visual range
      if (min < -1) min = -1;
      if (max > 1) max = 1;

      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

    const timeToX = (t: number) => ((t - actualOffset) / visibleDuration) * width;

    // Playhead
    if (currentTime >= actualOffset && currentTime <= actualOffset + visibleDuration) {
        const x = timeToX(currentTime);
        ctx.fillStyle = 'white';
        ctx.fillRect(x, 0, 2, height);
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 8);
        ctx.fill();
    }

    // Selection & Handles
    if (selection) {
      const selStart = selection.start;
      const selEnd = selection.end;
      
      const x1 = timeToX(selStart);
      const x2 = timeToX(selEnd);

      // Draw shaded region (clamped to view)
      const drawStart = Math.max(0, x1);
      const drawEnd = Math.min(width, x2);
      
      if (drawEnd > drawStart) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.fillRect(drawStart, 0, drawEnd - drawStart, height);
          
          ctx.fillStyle = 'rgba(0, 255, 157, 0.8)';
          // Lines
          if (x1 >= 0 && x1 <= width) ctx.fillRect(x1, 0, 1, height);
          if (x2 >= 0 && x2 <= width) ctx.fillRect(x2, 0, 1, height);
      }

      // Draw Interactive Handles (Heads) at the top
      const handleSize = 10;
      ctx.fillStyle = '#00ff9d';

      // Start Handle
      if (x1 >= -handleSize && x1 <= width + handleSize) {
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.lineTo(x1 + handleSize, 0);
          ctx.lineTo(x1, handleSize);
          ctx.fill();
      }

      // End Handle
      if (x2 >= -handleSize && x2 <= width + handleSize) {
          ctx.beginPath();
          ctx.moveTo(x2, 0);
          ctx.lineTo(x2 - handleSize, 0);
          ctx.lineTo(x2, handleSize);
          ctx.fill();
      }
    }

    // Zoom Info
    if (zoom > 1) {
        const zoomText = `x${zoom.toFixed(1)}`;
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        const textWidth = ctx.measureText(zoomText).width;
        ctx.fillRect(4, 4, textWidth + 8, 20);
        ctx.fillStyle = '#00ff9d';
        ctx.fillText(zoomText, 8, 18);
    }

  }, [buffer, currentTime, selection, zoom, scrollOffset, isRecording, bufferPeak]);

  // Handle Resize
  useEffect(() => {
    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.offsetWidth;
        canvasRef.current.height = containerRef.current.offsetHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);


  // --- Mouse Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!buffer || isRecording || !canvasRef.current) return;
    
    const time = getTimeFromEvent(e.clientX);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Check for Hit on Existing Selection Handles
    let mode: DragMode = 'create';
    const threshold = 15; // pixels

    if (selection) {
        const startX = getXFromTime(selection.start, rect.width);
        const endX = getXFromTime(selection.end, rect.width);
        
        if (Math.abs(x - startX) <= threshold) {
            mode = 'resize-start';
        } else if (Math.abs(x - endX) <= threshold) {
            mode = 'resize-end';
        }
    }

    setDragMode(mode);

    if (mode === 'create') {
        setDragStart(time);
        onSelectionChange(null);
        onSeek(time);
    } else {
        // For resizing, we don't reset selection, we just track the value
        setDragStart(time); 
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!buffer || isRecording || !canvasRef.current) return;

    // Cursor Update Logic
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let hoverMode = 'crosshair';
    if (selection && dragMode === 'none') {
        const threshold = 10;
        const startX = getXFromTime(selection.start, rect.width);
        const endX = getXFromTime(selection.end, rect.width);
        if (Math.abs(x - startX) <= threshold || Math.abs(x - endX) <= threshold) {
            hoverMode = 'ew-resize';
        }
    } else if (dragMode === 'resize-start' || dragMode === 'resize-end') {
        hoverMode = 'ew-resize';
    }
    setCursorStyle(hoverMode);


    // Drag Logic
    if (dragMode === 'none' || dragStart === null) return;

    const currentTime = getTimeFromEvent(e.clientX);

    if (dragMode === 'create') {
        const start = Math.min(dragStart, currentTime);
        const end = Math.max(dragStart, currentTime);
        if (end - start > 0.01) {
             onSelectionChange({ start, end });
        }
    } else if (dragMode === 'resize-start' && selection) {
        const newStart = Math.min(currentTime, selection.end - 0.01);
        onSelectionChange({ start: newStart, end: selection.end });
    } else if (dragMode === 'resize-end' && selection) {
        const newEnd = Math.max(currentTime, selection.start + 0.01);
        onSelectionChange({ start: selection.start, end: newEnd });
    }
  };

  const handleMouseUp = () => {
    setDragMode('none');
    setDragStart(null);
  };

  // --- Touch Handlers (Mobile) ---
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isRecording) {
         if (e.touches.length === 2) {
             const t1 = e.touches[0];
             const t2 = e.touches[1];
             const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
             const midX = (t1.clientX + t2.clientX) / 2;
             lastTouchDistance.current = dist;
             lastTouchX.current = midX;
         }
         return;
    }
    
    if (!buffer || !canvasRef.current) return;
    
    // Pinch & Pan Check
    if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        lastTouchDistance.current = dist;
        lastTouchX.current = midX;
        setDragMode('none');
        return;
    }

    const touch = e.touches[0];
    const time = getTimeFromEvent(touch.clientX);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;

    // Hit Test Handles
    let mode: DragMode = 'create';
    const threshold = 20; // Larger for touch

    if (selection) {
        const startX = getXFromTime(selection.start, rect.width);
        const endX = getXFromTime(selection.end, rect.width);
        
        if (Math.abs(x - startX) <= threshold) {
            mode = 'resize-start';
        } else if (Math.abs(x - endX) <= threshold) {
            mode = 'resize-end';
        }
    }

    setDragMode(mode);
    setDragStart(time);
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    
    if (mode === 'create') {
        onSelectionChange(null);
        isPotentialSeek.current = true;
    } else {
        isPotentialSeek.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Pinch Zoom & Pan
    if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault(); 
        isPotentialSeek.current = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        
        const curBuffer = bufferRef.current;
        const rect = canvasRef.current?.getBoundingClientRect();

        if (lastTouchDistance.current !== null && rect) {
            // 1. Handle Zoom
            const distDelta = dist - lastTouchDistance.current;
            const zoomSensitivity = 0.01;
            const curZoom = zoomRef.current;
            let newZoom = curZoom * (1 + distDelta * zoomSensitivity);
            const maxZoom = isRecording ? 50 : 200;
            newZoom = Math.max(1, Math.min(maxZoom, newZoom));
            
            // 2. Handle Pan (only if not recording or if we want to allow panning during recording)
            let newOffset = scrollOffsetRef.current;
            if (lastTouchX.current !== null && curBuffer && !isRecording) {
                const xDelta = midX - lastTouchX.current;
                const visibleDuration = curBuffer.duration / newZoom;
                const secondsPerPixel = visibleDuration / rect.width;
                // Dragging right (positive xDelta) should decrease offset to show earlier parts
                newOffset -= xDelta * secondsPerPixel;
                const maxOffset = Math.max(0, curBuffer.duration - visibleDuration);
                newOffset = Math.max(0, Math.min(maxOffset, newOffset));
            }

            setZoom(newZoom);
            zoomRef.current = newZoom;
            setScrollOffset(newOffset);
            scrollOffsetRef.current = newOffset;
        }
        lastTouchDistance.current = dist;
        lastTouchX.current = midX;
        return;
    }
    
    if (!buffer || isRecording || dragMode === 'none') return;
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    
    // Check if we've moved enough to cancel a potential seek
    if (isPotentialSeek.current && touchStartPos.current) {
        const dist = Math.hypot(touch.clientX - touchStartPos.current.x, touch.clientY - touchStartPos.current.y);
        if (dist > 10) isPotentialSeek.current = false;
    }

    const currentTime = getTimeFromEvent(touch.clientX);

    if (dragMode === 'create' && dragStart !== null) {
        const start = Math.min(dragStart, currentTime);
        const end = Math.max(dragStart, currentTime);
        if (end - start > 0.01) onSelectionChange({ start, end });
    } else if (dragMode === 'resize-start' && selection) {
        const newStart = Math.min(currentTime, selection.end - 0.01);
        onSelectionChange({ start: newStart, end: selection.end });
    } else if (dragMode === 'resize-end' && selection) {
        const newEnd = Math.max(currentTime, selection.start + 0.01);
        onSelectionChange({ start: selection.start, end: newEnd });
    }
  };

  const handleTouchEnd = () => {
    if (isPotentialSeek.current && dragStart !== null) {
        onSeek(dragStart);
    }
    isPotentialSeek.current = false;
    touchStartPos.current = null;
    setDragMode('none');
    setDragStart(null);
    lastTouchDistance.current = null;
    lastTouchX.current = null;
  };

  return (
    <div 
        ref={containerRef} 
        className="relative w-full h-full bg-studio-900 rounded-lg overflow-hidden border border-studio-700 shadow-inner touch-none"
        style={{ cursor: cursorStyle }}
    >
      <canvas 
        ref={canvasRef} 
        className="w-full h-full block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      />
      {!buffer && !isRecording && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 pointer-events-none">
          <span className="text-sm">اسحب ملف صوتي هنا أو قم بالتحميل للبدء</span>
        </div>
      )}
    </div>
  );
};

export default Waveform;