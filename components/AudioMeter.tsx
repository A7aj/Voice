import React, { useEffect, useRef } from 'react';

interface AudioMeterProps {
  analyser: AnalyserNode | null;
  height?: number;
}

const AudioMeter: React.FC<AudioMeterProps> = ({ analyser, height = 200 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Configuration
    const width = canvas.width;
    const h = canvas.height;
    const meterWidth = width - 16; // Space for text labels
    const segmentHeight = 3;
    const segmentGap = 1;
    
    // dB Range mapping
    const minDb = -60;
    const maxDb = 3;
    const totalDb = maxDb - minDb;

    const draw = () => {
      // Clear
      ctx.clearRect(0, 0, width, h);
      
      // We don't draw background here anymore, letting parent control it
      // ctx.fillStyle = '#1e1e1e';
      // ctx.fillRect(0, 0, meterWidth, h);

      let currentDb = -100; // Silence default

      if (analyser) {
        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        analyser.getFloatTimeDomainData(dataArray);

        // Calculate Peak Level (Instantaneous)
        let maxAmp = 0;
        for (let i = 0; i < bufferLength; i++) {
            const val = Math.abs(dataArray[i]);
            if (val > maxAmp) maxAmp = val;
        }
        
        // Convert to dB
        if (maxAmp > 0) {
            currentDb = 20 * Math.log10(maxAmp);
        }
      }

      // Draw Segments
      const numSegments = Math.floor(h / (segmentHeight + segmentGap));
      
      for (let i = 0; i < numSegments; i++) {
        const y = h - (i * (segmentHeight + segmentGap)) - segmentHeight;
        const segmentRatio = i / numSegments;
        const segmentDb = minDb + (segmentRatio * totalDb);

        // Determine Color based on segment position
        let color = '#2a2a2a'; // Inactive darker color
        let activeColor = '#00ff9d'; // Default Green

        if (segmentDb >= 0) {
            activeColor = '#ff4d4d'; // Red (Clipping)
        } else if (segmentDb >= -12) {
            activeColor = '#fbbf24'; // Yellow (Strong)
        }

        // Light up if signal exceeds this segment
        if (currentDb >= segmentDb) {
            color = activeColor;
        }

        ctx.fillStyle = color;
        ctx.fillRect(0, y, meterWidth, segmentHeight);
      }

      // Draw Labels
      ctx.fillStyle = '#666';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      
      const labels = [0, -6, -12, -24, -40];
      labels.forEach(db => {
         const ratio = (db - minDb) / totalDb;
         const y = h - (ratio * h);
         if (y > 10 && y < h - 10) {
             ctx.fillText(db.toString(), meterWidth + 4, y + 3);
             // Marker line
             ctx.fillStyle = '#444';
             ctx.fillRect(meterWidth, y, 3, 1);
             ctx.fillStyle = '#666';
         }
      });
      
      // Peak Hold Indicator at 0dB
      const zeroRatio = (0 - minDb) / totalDb;
      const zeroY = h - (zeroRatio * h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, zeroY, meterWidth, 1);


      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, height]);

  return (
    <div className="flex flex-col items-center justify-center">
      <canvas 
        ref={canvasRef} 
        width={36} 
        height={height}
        className="block"
      />
      <span className="text-[9px] text-gray-500 mt-2 font-mono">dB</span>
    </div>
  );
};

export default AudioMeter;