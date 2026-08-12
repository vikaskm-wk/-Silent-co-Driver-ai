export interface LapData {
  lap: number;
  time: number;
  baseline: number;
  delta: number;
}

export interface AsrMeta {
  status: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR";
  modelUsed?: string;
  error?: string;
  latencyMs?: number;
  charCount?: number;
}

export interface AsrDebugInfo {
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  endpoint?: string;
  requestStarted?: string;
  responseStatus?: number;
  responseContentType?: string;
  httpStatus?: number;
}

export interface SynchronizedSegment {
  timestamp: number;
  start?: number;
  end?: number;
  lap: number | null;
  text: string;
  asr_meta?: AsrMeta;
  state: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" | "ANALYSIS INCOMPLETE";
  confidence: number | null;
  time: number | null;
  delta: number | null;
  scores?: {
    calm: number;
    stressed: number;
    tired_like: number;
  } | null;
  signals?: {
    acoustic: number | null;
    text: number | null;
    speechDynamics: number | null;
  } | null;
  acoustic_features?: {
    rms: number;
    peak: number;
    zcr: number;
    duration: number;
    normalizedVocalEnergy?: number;
  };
  text_features?: {
    sentimentScore: number | null;
    urgencyKeywordsCount: number | null;
    negativeMarkersCount: number | null;
    positiveMarkersCount: number | null;
    speechIntensity: number | null;
  } | null;
  dynamics_features?: {
    speechRate: number | null;
    pauseDuration: number | null;
    energyVariation: number | null;
    pitchProsody?: number | null;
  } | null;
  reasons?: string[];
}

export interface Insight {
  priority: string;
  recommendation: string;
  evidence: string;
  lap: number;
}

export interface AudioMeta {
  duration?: number;
  sample_rate?: number;
  channels?: number;
  samples?: number;
  format?: string;
  fileName?: string;
  sizeMB?: string;
  url?: string;
}

export interface ModelInfo {
  asr_model?: string;
  emotion_model?: string;
  device?: string;
}

export interface SessionData {
  id: string;
  mode: "DEMO" | "LIVE" | "RECORDED";
  status: "ACTIVE" | "COMPLETE" | "PAUSED";
  transcript?: string;
  audioDuration?: number;
  asr_status?: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR";
  asr_model?: string;
  asr_error?: string;
  pipeline_status?: "FULL" | "PARTIAL" | "FAILED";
  lapDataSource?: "PRELOADED" | "CUSTOM_CSV" | "DEFAULT" | "NONE";
  audio?: AudioMeta;
  audioQuality?: {
    duration: number;
    speechDuration: number;
    quality: "GOOD" | "MODERATE" | "POOR" | "INSUFFICIENT";
    clippingRatio: number;
    silenceRatio: number;
    snrDb: number;
  };
  sessionState?: {
    calm: number;
    stressed: number;
    tired: number;
    dominant: string;
    confidence: number;
  };
  laps: LapData[];
  synchronized_segments: SynchronizedSegment[];
  insights: Insight[];
  correlation: {
    high_stress_delta: number;
    calm_delta: number;
    conclusion: string;
    total_observations?: number;
  };
  model_info?: ModelInfo;
  asr_debug_info?: AsrDebugInfo;
}

export interface ModelStatus {
  asr_model: string;
  emotion_model: string;
  device: string;
  status: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "race_engineer" | "team_admin" | "driver" | "analyst";
  team?: string;
  avatarUrl?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
