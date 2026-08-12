import { SynchronizedSegment } from '../types';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface TranscriptProps {
  segments: SynchronizedSegment[];
  currentTime: number;
  onSegmentClick: (time: number) => void;
}

export default function Transcript({ segments, currentTime, onSegmentClick }: TranscriptProps) {
  
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 10).toString();
    return `${m}:${s}.${ms}`;
  };

  const getStateColor = (state: string) => {
    if (state === 'STRESSED') return 'text-[#E53935]';
    if (state === 'TIRED-LIKE') return 'text-[#E3A43B]';
    return 'text-[#35C98A]';
  };

  return (
    <div className="flex flex-col h-full bg-[#15191D] overflow-hidden font-sans">
      <div className="px-6 py-4 border-b border-[#292F35] flex justify-between items-center shrink-0">
        <h3 className="text-base sm:text-lg font-semibold text-[#F2F4F7] tracking-wide">SESSION LIVE TRANSCRIPT</h3>
        <span className="text-xs sm:text-sm font-medium text-[#A7AFB9]">Auto-Sync: ENABLED</span>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <table className="w-full text-left text-sm border-collapse relative">
          <thead className="bg-[#181D22] text-[#A7AFB9] sticky top-0 z-10 font-medium">
            <tr>
              <th className="px-4 py-3 font-semibold border-b border-[#292F35] w-28 text-sm">Time</th>
              <th className="px-4 py-3 font-semibold border-b border-[#292F35] w-32 text-sm">State</th>
              <th className="px-4 py-3 font-semibold border-b border-[#292F35] w-20 text-sm">Conf.</th>
              <th className="px-4 py-3 font-semibold border-b border-[#292F35] text-sm">Transcript Message</th>
            </tr>
          </thead>
          <tbody className="font-sans">
            {segments.map((segment, i) => {
              const startT = typeof segment.start === 'number' ? segment.start : segment.timestamp;
              const endT = typeof segment.end === 'number' ? segment.end : (segments[i + 1]?.timestamp || startT + 5);
              const isActive = currentTime >= startT && currentTime <= endT;

              return (
                <tr 
                  key={i}
                  onClick={() => onSegmentClick(startT)}
                  className={twMerge(
                    "cursor-pointer transition-colors border-b border-[#292F35] hover:bg-[#191E23]",
                    isActive ? "bg-[rgba(229,57,53,0.08)] border-l-[3px] border-l-[#E53935]" : "border-l-[3px] border-l-transparent"
                  )}
                >
                  <td className={twMerge("px-4 py-3 font-mono text-sm", isActive ? "text-[#F2F4F7] font-bold" : "text-[#A7AFB9]")}>
                    {formatTime(startT)}
                  </td>
                  <td className={twMerge("px-4 py-3 uppercase font-semibold text-sm", getStateColor(segment.state))}>
                    {segment.state}
                  </td>
                  <td className={twMerge("px-4 py-3 font-mono text-sm", isActive ? "text-[#F2F4F7] font-bold" : "text-[#A7AFB9]")}>
                    {Math.round(segment.confidence * 100)}%
                  </td>
                  <td className={twMerge("px-4 py-3 pr-4 text-base leading-relaxed text-[#F2F4F7]", isActive ? "font-semibold" : "font-normal")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#F2F4F7]" style={{ color: '#F2F4F7' }}>"{segment.text}"</span>
                      {segment.lap ? (
                        <span className="text-xs font-mono font-bold bg-[#111417] text-[#A7AFB9] px-2 py-0.5 rounded border border-[#292F35] shrink-0" style={{ color: '#A7AFB9' }}>
                          LAP {segment.lap}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {segments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-[#A7AFB9] text-sm font-mono uppercase tracking-wider">
                  NO SPEECH DETECTED
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
