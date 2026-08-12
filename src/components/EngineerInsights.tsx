import { Insight, SynchronizedSegment, LapData } from '../types';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface EngineerInsightsProps {
  insights: Insight[];
  segments: SynchronizedSegment[];
  laps: LapData[];
}

export function DriverConditionPanel({ segments }: { segments: SynchronizedSegment[] }) {
  const latestSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  let calmPct = 0;
  let stressPct = 0;
  let tiredPct = 0;

  if (latestSegment && latestSegment.scores) {
    calmPct = Math.round(latestSegment.scores.calm * 100);
    stressPct = Math.round(latestSegment.scores.stressed * 100);
    tiredPct = Math.round(latestSegment.scores.tired_like * 100);
  } else if (segments.length > 0) {
    const stressCount = segments.filter(s => s.state === 'STRESSED').length;
    const calmCount = segments.filter(s => s.state === 'CALM').length;
    const tiredCount = segments.filter(s => s.state === 'TIRED-LIKE').length;
    const total = segments.length;
    calmPct = Math.round((calmCount / total) * 100);
    stressPct = Math.round((stressCount / total) * 100);
    tiredPct = Math.round((tiredCount / total) * 100);
  }

  const currentState = latestSegment ? latestSegment.state : null;
  const currentConfidence = latestSegment ? latestSegment.confidence : null;

  const getStateMeta = (state: string | null) => {
    if (state === 'STRESSED') return { label: 'STRESSED', color: 'text-[#E53935]' };
    if (state === 'TIRED-LIKE') return { label: 'TIRED-LIKE', color: 'text-[#E3A43B]' };
    if (state === 'CALM') return { label: 'CALM', color: 'text-[#35C98A]' };
    return { label: 'WAITING FOR AUDIO', color: 'text-[#707984]' };
  };

  const stateMeta = getStateMeta(currentState);

  return (
    <div className="flex flex-col h-auto shrink-0 font-sans">
      <h3 className="text-base font-semibold text-[#F2F4F7] mb-4 tracking-wide flex items-center justify-between">
        <span>DRIVER CONDITION</span>
        {latestSegment && (
          <span className="text-xs font-mono font-medium text-[#35C98A] bg-[#35C98A]/10 border border-[#35C98A]/20 px-2 py-0.5 rounded">
            ACTIVE
          </span>
        )}
      </h3>
      
      <div className="mb-5">
        <p className={twMerge("text-2xl sm:text-3xl font-bold font-mono mb-1", stateMeta.color)}>
          {stateMeta.label}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#A7AFB9] font-medium">
            {currentConfidence !== null ? `${Math.round(currentConfidence * 100)}% confidence score` : 'Confidence: —'}
          </span>
        </div>
      </div>
      
      <div className="space-y-3.5 font-mono">
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
          <span className="w-24 text-[#A7AFB9] shrink-0 font-medium">CALM ({calmPct}%)</span>
          <div className="flex-1 h-3 bg-[#252B31] rounded overflow-hidden">
            <div className="h-full bg-[#35C98A] transition-all duration-300" style={{ width: `${calmPct}%` }}></div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
          <span className="w-24 text-[#A7AFB9] shrink-0 font-medium">STRESSED ({stressPct}%)</span>
          <div className="flex-1 h-3 bg-[#252B31] rounded overflow-hidden">
            <div className="h-full bg-[#E53935] transition-all duration-300" style={{ width: `${stressPct}%` }}></div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
          <span className="w-24 text-[#A7AFB9] shrink-0 font-medium">TIRED ({tiredPct}%)</span>
          <div className="flex-1 h-3 bg-[#252B31] rounded overflow-hidden">
            <div className="h-full bg-[#E3A43B] transition-all duration-300" style={{ width: `${tiredPct}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EngineerInsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <div className="flex flex-col h-auto shrink-0 font-sans">
      <h3 className="text-base font-semibold text-[#F2F4F7] mb-4 tracking-wide flex items-center justify-between">
        <span>ENGINEER INSIGHTS</span>
        <span className="text-xs font-mono text-[#707984]">{insights.length} INSIGHTS</span>
      </h3>
      <div className="space-y-4 pr-1">
        {insights.map((insight, i) => {
          const isHigh = insight.priority.includes('HIGH') || insight.priority.includes('PERFORMANCE');
          
          return (
            <div key={i} className="flex flex-col gap-1.5 pb-4 border-b border-[#292F35] last:border-0 last:pb-0">
              <div className="flex items-center gap-2 mb-0.5">
                <div className={twMerge("w-2 h-2 rounded-full shrink-0", isHigh ? "bg-[#E53935]" : "bg-[#707984]")}></div>
                <span className={twMerge(
                  "text-xs font-bold uppercase tracking-wider",
                  isHigh ? "text-[#E53935]" : "text-[#707984]"
                )}>
                  {insight.priority}
                </span>
              </div>
              
              <p className="text-sm text-[#D5D9DE] leading-relaxed font-normal">{insight.recommendation}</p>
              
              {insight.evidence && (
                <p className="text-xs text-[#707984] mt-1 italic">
                  <span className="font-semibold not-italic text-[#A7AFB9]">Radio:</span> "{insight.evidence}"
                </p>
              )}
              
              {insight.lap ? (
                <p className="text-xs text-[#707984] mt-0.5">
                  <span className="font-semibold text-[#A7AFB9]">Context:</span> Lap {insight.lap}
                </p>
              ) : null}
            </div>
          );
        })}
        {insights.length === 0 && (
          <div className="text-xs text-[#707984] italic">
            No engineer insights generated yet.
          </div>
        )}
      </div>
    </div>
  );
}

export default function EngineerInsights({ insights, segments, laps }: EngineerInsightsProps) {
  return (
    <div className="flex flex-col gap-6 font-sans">
      <DriverConditionPanel segments={segments} />
      <div className="w-full h-px bg-[#292F35]"></div>
      <EngineerInsightsCard insights={insights} />
    </div>
  );
}
