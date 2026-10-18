import React, { useEffect, useRef, useState } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (val: number) => void;
  unit?: string;
  step?: number;
}

const ControlKnob: React.FC<KnobProps> = ({ value, min, max, label, onChange, unit = '', step }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startValRef = useRef<number>(0);

  const percentage = ((value - min) / (max - min)) * 100;
  const rotation = (percentage / 100) * 270 - 135; // -135deg to +135deg

  // Mouse Interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
  };

  // Touch Interaction
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startYRef.current = e.touches[0].clientY;
    startValRef.current = value;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const dy = startYRef.current - e.clientY;
      updateValue(dy);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      // Crucial for mobile: Prevent scrolling while adjusting knob
      if (e.cancelable) e.preventDefault();
      
      const dy = startYRef.current - e.touches[0].clientY;
      updateValue(dy);
    };

    const updateValue = (dy: number) => {
        const range = max - min;
        // Sensitivity: 200px drag = full range
        const delta = (dy / 200) * range;
        let newVal = startValRef.current + delta;
        newVal = Math.max(min, Math.min(max, newVal));
        onChange(newVal);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleEnd);
      // Passive: false is crucial for preventing scroll on mobile
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
      window.addEventListener('touchcancel', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isDragging, max, min, onChange]);

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
        setInputValue(step && step < 0.1 ? value.toFixed(2) : value.toFixed(1));
    }
  }, [value, step, isEditing]);

  useEffect(() => {
      if (isEditing && inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
      }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          commitValue();
      } else if (e.key === 'Escape') {
          setIsEditing(false);
          setInputValue(step && step < 0.1 ? value.toFixed(2) : value.toFixed(1));
      }
  };

  const commitValue = () => {
      let num = parseFloat(inputValue);
      if (!isNaN(num)) {
          num = Math.max(min, Math.min(max, num));
          onChange(num);
      }
      setIsEditing(false);
  };

  const handleBlur = () => {
      commitValue();
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none group touch-none">
      <div className="relative w-16 h-16 flex items-center justify-center">
        {/* Background Ring */}
        <svg className="w-full h-full pointer-events-none" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" stroke="#333" strokeWidth="6" fill="none" strokeDasharray="251.2" strokeDashoffset="62.8" transform="rotate(135 50 50)" strokeLinecap="round" />
          {/* Active Ring */}
          <circle 
            cx="50" cy="50" r="40" 
            stroke="#00ff9d" 
            strokeWidth="6" 
            fill="none" 
            strokeDasharray="251.2" 
            strokeDashoffset={251.2 - (percentage / 100) * (251.2 * 0.75)} 
            transform="rotate(135 50 50)" 
            strokeLinecap="round"
            className="opacity-80 group-hover:opacity-100 transition-opacity"
          />
        </svg>
        
        {/* The Knob Cap */}
        <div 
          className="absolute w-12 h-12 bg-studio-700 rounded-full border-2 border-studio-600 shadow-lg flex items-center justify-center cursor-ns-resize group-hover:border-studio-accent transition-colors"
          style={{ transform: `rotate(${rotation}deg)` }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          <div className="w-1 h-4 bg-studio-accent rounded-full absolute -top-1"></div>
        </div>
      </div>
      
      <div className="text-center">
        <div className="text-xs text-gray-400 font-medium tracking-wider">{label}</div>
        {isEditing ? (
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="w-16 text-center text-xs bg-studio-900 text-studio-accent border border-studio-accent rounded mt-1 focus:outline-none"
            />
        ) : (
            <div 
                className="text-xs text-studio-accent font-mono mt-1 cursor-pointer hover:bg-studio-700 rounded px-1"
                onClick={() => setIsEditing(true)}
                title="اضغط للتعديل"
            >
                {step && step < 0.1 ? value.toFixed(2) : value.toFixed(1)}{unit}
            </div>
        )}
      </div>
    </div>
  );
};

export default ControlKnob;