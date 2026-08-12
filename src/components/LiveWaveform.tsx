import React, { useEffect, useRef } from 'react';

interface LiveWaveformProps {
  analyser: AnalyserNode | null;
  isListening: boolean;
  isSpeaking: boolean;
}

export default function LiveWaveform({ analyser, isListening, isSpeaking }: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (analyser && isListening) {
        analyser.getByteFrequencyData(dataArray);
      } else if (isSpeaking) {
        const time = Date.now() / 150;
        for (let i = 0; i < bufferLength; i++) {
          const val = Math.sin(time + i * 0.4) * 80 + Math.cos(time * 1.5 + i * 0.2) * 60 + 100;
          dataArray[i] = Math.min(255, Math.max(30, val));
        }
      } else if (isListening) {
        const time = Date.now() / 300;
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.max(10, (Math.sin(time + i * 0.5) + 1) * 20);
        }
      } else {
        dataArray.fill(0);
      }

      const barCount = 60;
      const barWidth = (width / barCount) - 2;
      const step = Math.floor(dataArray.length / barCount) || 1;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const percent = value / 255;
        // Height between 4px and height - 4px
        const barHeight = Math.max(4, percent * (height - 8));

        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        if (isSpeaking && percent > 0.15) {
          ctx.fillStyle = i % 5 === 0 ? '#E53935' : '#F04440';
        } else if (isListening) {
          ctx.fillStyle = 'rgba(241, 243, 245, 0.22)';
        } else {
          ctx.fillStyle = '#343A42';
        }

        ctx.fillRect(x, y, barWidth, barHeight);
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyser, isListening, isSpeaking]);

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="w-full h-12 bg-[#0B0D0F] border border-[#292F35] rounded px-2 py-1 flex items-center justify-center">
        <canvas 
          ref={canvasRef} 
          width={480} 
          height={40} 
          className="w-full h-full block"
        />
      </div>
      <div className="flex items-center justify-between w-full text-[11px] font-medium text-[#A7AFB9]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-[#E53935] animate-ping' : isListening ? 'bg-[#35C98A]' : 'bg-[#525963]'}`}></div>
          <span className={isSpeaking ? 'text-[#E53935] font-semibold' : ''}>
            {isSpeaking ? '● DRIVER SPEAKING' : isListening ? '○ NO SPEECH (WAITING FOR TRANSMISSION)' : 'OFFLINE'}
          </span>
        </div>
        <span className="text-[#707984]">AUDIO INPUT: MIC LOGICAL ANALYSER</span>
      </div>
    </div>
  );
}
