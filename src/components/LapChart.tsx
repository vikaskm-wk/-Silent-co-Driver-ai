import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { LapData, SynchronizedSegment } from '../types';

interface LapChartProps {
  laps: LapData[];
  segments: SynchronizedSegment[];
  onLapSelect: (lap: number) => void;
  selectedLap: number | null;
}

export default function LapChart({ laps, segments, onLapSelect, selectedLap }: LapChartProps) {
  if (!laps || laps.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-[#15191D] border border-dashed border-[#292F35] rounded-md font-sans">
        <span className="text-xs font-bold text-[#E3A43B] tracking-wider uppercase mb-1">NO LAP TELEMETRY</span>
        <p className="text-xs text-[#707984] max-w-sm">
          Upload a lap CSV to correlate driver state with lap performance and time deltas.
        </p>
      </div>
    );
  }

  // Add state data to laps for coloring/tooltips
  const data = laps.map(lap => {
    const lapSegments = segments.filter(s => s.lap === lap.lap);
    const hasStress = lapSegments.some(s => s.state === 'STRESSED');
    const hasTired = lapSegments.some(s => s.state === 'TIRED-LIKE');
    return {
      ...lap,
      state: hasStress ? 'STRESSED' : hasTired ? 'TIRED-LIKE' : 'CALM',
      radio_evidence: lapSegments.length > 0 ? lapSegments[0].text : ''
    };
  });

  return (
    <div className="w-full h-full relative overflow-hidden border-l border-b border-[#292F35] pl-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 5 }} onClick={(e: any) => {
            if (e && e.activePayload && e.activePayload.length > 0) {
              onLapSelect(e.activePayload[0].payload.lap);
            }
          }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#20252B" vertical={false} />
          <XAxis dataKey="lap" stroke="#707984" tick={{ fill: '#707984', fontSize: 12, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} stroke="#707984" tick={{ fill: '#707984', fontSize: 12, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={(val) => val.toFixed(1) + 's'} />
          <Tooltip
            contentStyle={{ backgroundColor: '#15191D', borderColor: '#292F35', color: '#F2F4F7', borderRadius: '4px', fontFamily: 'sans-serif', fontSize: '13px' }}
            itemStyle={{ color: '#F2F4F7' }}
            cursor={{ stroke: '#292F35', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-[#15191D] border border-[#292F35] p-3 rounded-md shadow-lg min-w-[200px] font-sans">
                    <div className="text-[#E53935] font-bold text-sm mb-2">LAP {data.lap}</div>
                    <div className="flex justify-between mb-1 text-sm">
                      <span className="text-[#A7AFB9]">TIME:</span>
                      <span className="font-mono text-[#F2F4F7]">{data.time.toFixed(2)}s</span>
                    </div>
                    <div className="flex justify-between mb-1 text-sm">
                      <span className="text-[#A7AFB9]">BASELINE:</span>
                      <span className="font-mono text-[#F2F4F7]">{data.baseline.toFixed(2)}s</span>
                    </div>
                    <div className="flex justify-between mb-1 text-sm">
                      <span className="text-[#A7AFB9]">DELTA:</span>
                      <span className={`font-mono font-semibold ${data.delta > 0 ? 'text-[#E53935]' : 'text-[#35C98A]'}`}>
                        {data.delta > 0 ? '+' : ''}{data.delta.toFixed(2)}s
                      </span>
                    </div>
                    <div className="flex justify-between mt-2 pt-2 border-t border-[#292F35] text-sm">
                      <span className="text-[#A7AFB9]">STATE:</span>
                      <span className={`font-semibold ${data.state === 'STRESSED' ? 'text-[#E53935]' : data.state === 'TIRED-LIKE' ? 'text-[#E3A43B]' : 'text-[#35C98A]'}`}>
                        {data.state}
                      </span>
                    </div>
                    {data.radio_evidence && (
                      <div className="mt-2 text-xs italic text-[#707984] border-l-2 border-[#292F35] pl-2 line-clamp-2">
                        "{data.radio_evidence}"
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          {/* Highlight stressed laps */}
          {data.map((entry, index) => {
            if (entry.state === 'STRESSED') {
              return (
                <ReferenceArea key={index} x1={entry.lap - 0.5} x2={entry.lap + 0.5} fill="rgba(229, 57, 53, 0.06)" />
              );
            }
            return null;
          })}
          {selectedLap && (
            <ReferenceArea x1={selectedLap - 0.5} x2={selectedLap + 0.5} fill="rgba(242, 244, 247, 0.05)" stroke="#292F35" strokeDasharray="3 3" />
          )}
          <Line type="monotone" dataKey="time" stroke="#E53935" strokeWidth={2.5} dot={(props) => {
            const { cx, cy, payload } = props;
            const fill = payload.state === 'STRESSED' ? '#E53935' : payload.state === 'TIRED-LIKE' ? '#E3A43B' : '#35C98A';
            const radius = payload.lap === selectedLap ? 5 : 3.5;
            return (
              <circle key={`dot-${payload.lap}`} cx={cx} cy={cy} r={radius} fill={fill} stroke={payload.lap === selectedLap ? '#F2F4F7' : 'none'} strokeWidth={1.5} style={{ cursor: 'pointer' }} />
            );
          }} activeDot={{ r: 5, fill: '#F2F4F7' }} />
          <Line type="monotone" dataKey="baseline" stroke="#35C98A" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
