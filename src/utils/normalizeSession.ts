import { SessionData, SynchronizedSegment, LapData, Insight } from '../types';

/**
 * Normalizes any backend session API response into a strictly typed,
 * clean SessionData model for frontend component consumption.
 */
export function normalizeSession(raw: any, fallbackMode: "DEMO" | "LIVE" | "RECORDED" = "RECORDED"): SessionData {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `session-${Date.now()}`,
      mode: fallbackMode,
      status: 'COMPLETE',
      lapDataSource: 'PRELOADED',
      laps: [],
      synchronized_segments: [],
      insights: [],
      correlation: {
        high_stress_delta: 0,
        calm_delta: 0,
        conclusion: 'INSUFFICIENT DATA',
        total_observations: 0
      }
    };
  }

  const id = String(raw.id || `session-${Date.now()}`);
  const mode = (raw.mode === 'LIVE' || raw.mode === 'DEMO' || raw.mode === 'RECORDED')
    ? raw.mode
    : fallbackMode;

  const status = (raw.status === 'ACTIVE' || raw.status === 'PAUSED' || raw.status === 'COMPLETE')
    ? raw.status
    : 'COMPLETE';

  const lapDataSource = raw.lapDataSource || (raw.laps?.length ? (raw.lapDataSource || 'PRELOADED') : 'NONE');

  // Laps normalization
  const rawLaps = Array.isArray(raw.laps) ? raw.laps : [];
  const laps: LapData[] = rawLaps.map((l: any, i: number) => ({
    lap: typeof l.lap === 'number' ? l.lap : (i + 1),
    time: typeof l.time === 'number' ? l.time : 0,
    baseline: typeof l.baseline === 'number' ? l.baseline : 0,
    delta: typeof l.delta === 'number' ? l.delta : 0
  }));

  // Synchronized Segments normalization
  const rawSegments = Array.isArray(raw.synchronized_segments) 
    ? raw.synchronized_segments 
    : Array.isArray(raw.transcript) 
    ? raw.transcript 
    : [];

  const synchronized_segments: SynchronizedSegment[] = rawSegments.map((s: any, idx: number) => {
    const timestamp = typeof s.timestamp === 'number' ? s.timestamp : typeof s.start === 'number' ? s.start : (idx * 5);
    const start = typeof s.start === 'number' ? s.start : timestamp;
    const end = typeof s.end === 'number' ? s.end : (start + 5);

    let state: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" | "ANALYSIS INCOMPLETE" = "CALM";
    const rawState = String(s.state || s.driver_state || '').toUpperCase();
    if (rawState.includes('INCOMPLETE')) state = "ANALYSIS INCOMPLETE";
    else if (rawState.includes('INSUFFICIENT')) state = "INSUFFICIENT AUDIO";
    else if (rawState.includes('STRESS')) state = "STRESSED";
    else if (rawState.includes('TIRED')) state = "TIRED-LIKE";
    else if (rawState.includes('CALM')) state = "CALM";

    const confidence = typeof s.confidence === 'number' ? s.confidence : (state === 'ANALYSIS INCOMPLETE' ? null : 0.85);

    const scores = (state === 'ANALYSIS INCOMPLETE' || s.scores === null) ? null : (s.scores && typeof s.scores === 'object' ? {
      calm: typeof s.scores.calm === 'number' ? s.scores.calm : (state === 'CALM' ? (confidence || 0.85) : 0.1),
      stressed: typeof s.scores.stressed === 'number' ? s.scores.stressed : (state === 'STRESSED' ? (confidence || 0.85) : 0.1),
      tired_like: typeof s.scores.tired_like === 'number' ? s.scores.tired_like : (s.scores.tiredLike ?? (state === 'TIRED-LIKE' ? (confidence || 0.85) : 0.1))
    } : {
      calm: state === 'CALM' ? (confidence || 0.85) : 0.1,
      stressed: state === 'STRESSED' ? (confidence || 0.85) : 0.1,
      tired_like: state === 'TIRED-LIKE' ? (confidence || 0.85) : 0.1
    });

    const signals = (state === 'ANALYSIS INCOMPLETE' || s.signals === null) ? null : (s.signals && typeof s.signals === 'object' ? {
      acoustic: typeof s.signals.acoustic === 'number' ? s.signals.acoustic : null,
      text: typeof s.signals.text === 'number' ? s.signals.text : null,
      speechDynamics: typeof s.signals.speechDynamics === 'number' ? s.signals.speechDynamics : null
    } : null);

    const lapVal = typeof s.lap === 'number' && s.lap !== 0 ? s.lap : null;

    return {
      timestamp,
      start,
      end,
      lap: lapVal,
      text: String(s.text || s.message || s.transcript || ''),
      state,
      confidence,
      time: typeof s.time === 'number' && s.time !== 0 ? s.time : null,
      delta: typeof s.delta === 'number' && s.delta !== 0 ? s.delta : null,
      scores,
      signals,
      acoustic_features: s.acoustic_features || undefined,
      text_features: s.text_features || undefined,
      dynamics_features: s.dynamics_features || undefined
    };
  });

  // Insights normalization
  const rawInsights = Array.isArray(raw.insights) ? raw.insights : [];
  const insights: Insight[] = rawInsights.map((ins: any) => ({
    priority: String(ins.priority || 'INFO').toUpperCase(),
    recommendation: String(ins.recommendation || ins.text || ''),
    evidence: String(ins.evidence || ''),
    lap: typeof ins.lap === 'number' ? ins.lap : 0
  }));

  // Correlation normalization
  const rawCorr = raw.correlation && typeof raw.correlation === 'object' ? raw.correlation : {};
  const correlation = {
    high_stress_delta: typeof rawCorr.high_stress_delta === 'number' ? rawCorr.high_stress_delta : 0,
    calm_delta: typeof rawCorr.calm_delta === 'number' ? rawCorr.calm_delta : 0,
    conclusion: String(rawCorr.conclusion || (laps.length === 0 ? 'Waiting for lap telemetry' : (synchronized_segments.length > 0 ? 'COLLECTING DATA' : 'INSUFFICIENT DATA'))),
    total_observations: typeof rawCorr.total_observations === 'number' ? rawCorr.total_observations : synchronized_segments.length
  };

  return {
    id,
    mode,
    status,
    lapDataSource,
    audio: raw.audio || undefined,
    audioQuality: raw.audioQuality || undefined,
    sessionState: raw.sessionState || undefined,
    laps,
    synchronized_segments,
    insights,
    correlation,
    model_info: raw.model_info || undefined
  };
}
