import dotenv from "dotenv";

// Load .env file if available
dotenv.config();

export interface AppConfig {
  // Google AI Secrets & Configs
  geminiApiKey: string;
  geminiModel: string;

  // Hugging Face Secrets & Models
  hfToken: string;
  hfAsrModel: string;
  hfEmotionModel: string;

  // ASR Internal Defaults
  asrProvider: string;
  asrModel: string;
  asrLanguage: string;
  asrTask: string;
  asrDevice: string;
  asrTimeoutMs: number;

  // VAD Internal Defaults
  vadProvider: string;
  vadModel: string;
  vadThreshold: string;
  vadMinSpeechMs: number;
  vadMinSilenceMs: number;
  vadPaddingMs: number;

  // Voice / Acoustic Analysis Defaults
  acousticAnalysisEnabled: boolean;
  pitchAnalysisEnabled: boolean;
  energyAnalysisEnabled: boolean;
  speechRateAnalysisEnabled: boolean;
  dynamicsAnalysisEnabled: boolean;
  voiceBaselineEnabled: boolean;

  // Emotion / Stress Model Defaults
  emotionModelProvider: string;
  emotionModelRevision: string;

  // Text / NLP Defaults
  nlpProvider: string;
  sentimentModel: string;
  frustrationModel: string;
  urgencyModel: string;
  nlpLlmModel: string;

  // Multi-Signal Analysis Weights & Thresholds Defaults
  analysisEnabled: boolean;
  acousticWeight: number;
  textWeight: number;
  dynamicsWeight: number;
  baselineWeight: number;
  telemetryWeight: number;
  stateConfidenceThreshold: number;
  signalAgreementThreshold: number;
  shortRecordingThresholdMs: number;
  lowAsrConfidenceThreshold: number;

  // Driver Baseline Defaults
  baselineEnabled: boolean;
  baselineMinDurationSec: number;
  baselineMinSegments: number;
  baselineWindowSec: number;
  baselineUpdateRate: number;
  personalBaselineAvailable: boolean;

  // Telemetry Defaults
  telemetryEnabled: boolean;
  telemetrySource: string;
  telemetryTimestampColumn: string;
  telemetryLapColumn: string;
  telemetryLapTimeColumn: string;
  telemetrySpeedColumn: string;
  telemetryThrottleColumn: string;
  telemetryBrakeColumn: string;
  telemetryRpmColumn: string;
  telemetryGearColumn: string;
  telemetryTimeToleranceMs: number;
  radioTelemetryAlignmentToleranceMs: number;

  // Database Defaults
  databaseUrl: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;

  // Storage Defaults
  storageProvider: string;
  storageBucket: string;
  storageRegion: string;
  storageEndpoint: string;

  // Audio Pipeline Defaults
  audioMaxFileSizeMb: number;
  audioAllowedExtensions: string[];
  audioAllowedMimeTypes: string[];
  audioSampleRate: number;
  audioChannels: number;
  audioFormat: string;
  audioNormalizationEnabled: boolean;
  audioExtractionEnabled: boolean;
  ffmpegEnabled: boolean;
  ffmpegPath: string;
  ffmpegWasmEnabled: boolean;

  // Production Audio Decoding Defaults
  audioDecoder: string;
  audioDecoderTimeoutMs: number;
  audioFallbackEnabled: boolean;
  audioDebugLogging: boolean;

  // Model Versioning Default
  modelRevision: string;

  // Report Generation Defaults
  reportGenerationEnabled: boolean;
  reportModel: string;
  reportFormat: string;
  pdfGenerationEnabled: boolean;
  reportStorageEnabled: boolean;

  // Logging & Observability Defaults
  logLevel: string;
  enableDebugLogging: boolean;
  enableModelLogging: boolean;
  enableAudioPipelineLogging: boolean;
  enableTelemetryLogging: boolean;
  enablePerformanceMetrics: boolean;
}

// ------------------------------------------------------------
// READ ONLY 4 APPROVED ENVIRONMENT VARIABLES
// ------------------------------------------------------------
const rawGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const rawHfToken = process.env.HF_TOKEN || process.env.HF_API_TOKEN || "";
const rawHfAsrModel = process.env.HF_ASR_MODEL || "openai/whisper-large-v3-turbo";
const rawHfEmotionModel = process.env.HF_AUDIO_EMOTION_MODEL || "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition";

export const config: AppConfig = {
  // Google AI Secrets & Configs (Key from Env, Model internal default)
  geminiApiKey: rawGeminiKey,
  geminiModel: "gemini-2.5-flash",

  // Hugging Face Secrets & Models (from Env)
  hfToken: rawHfToken,
  hfAsrModel: rawHfAsrModel,
  hfEmotionModel: rawHfEmotionModel,

  // ASR Internal Defaults
  asrProvider: "huggingface",
  asrModel: rawHfAsrModel,
  asrLanguage: "en",
  asrTask: "transcribe",
  asrDevice: "auto",
  asrTimeoutMs: 30000,

  // VAD Internal Defaults
  vadProvider: "ffmpeg_silencedetect",
  vadModel: "ffmpeg-silencedetect",
  vadThreshold: "-32dB",
  vadMinSpeechMs: 400,
  vadMinSilenceMs: 300,
  vadPaddingMs: 100,

  // Voice / Acoustic Analysis Internal Defaults
  acousticAnalysisEnabled: true,
  pitchAnalysisEnabled: true,
  energyAnalysisEnabled: true,
  speechRateAnalysisEnabled: true,
  dynamicsAnalysisEnabled: true,
  voiceBaselineEnabled: true,

  // Emotion / Stress Model Internal Defaults
  emotionModelProvider: "multi_signal_classifier",
  emotionModelRevision: "main",

  // Text / NLP Internal Defaults
  nlpProvider: "gemini_rule_hybrid",
  sentimentModel: "f1_racing_lexicon_v1",
  frustrationModel: "lexical_intensity_v1",
  urgencyModel: "keyword_matcher_v1",
  nlpLlmModel: "gemini-2.5-flash",

  // Multi-Signal Analysis Internal Defaults
  analysisEnabled: true,
  acousticWeight: 0.50,
  textWeight: 0.30,
  dynamicsWeight: 0.20,
  baselineWeight: 0.15,
  telemetryWeight: 0.20,
  stateConfidenceThreshold: 0.35,
  signalAgreementThreshold: 0.55,
  shortRecordingThresholdMs: 400,
  lowAsrConfidenceThreshold: 0.20,

  // Driver Baseline Internal Defaults
  baselineEnabled: true,
  baselineMinDurationSec: 30,
  baselineMinSegments: 3,
  baselineWindowSec: 120,
  baselineUpdateRate: 1.0,
  personalBaselineAvailable: false,

  // Telemetry Internal Defaults
  telemetryEnabled: true,
  telemetrySource: "csv",
  telemetryTimestampColumn: "timestamp",
  telemetryLapColumn: "lap",
  telemetryLapTimeColumn: "time",
  telemetrySpeedColumn: "speed",
  telemetryThrottleColumn: "throttle",
  telemetryBrakeColumn: "brake",
  telemetryRpmColumn: "rpm",
  telemetryGearColumn: "gear",
  telemetryTimeToleranceMs: 1000,
  radioTelemetryAlignmentToleranceMs: 2000,

  // Database Internal Defaults
  databaseUrl: "",
  dbHost: "localhost",
  dbPort: 5432,
  dbName: "silent_codriver",
  dbUser: "postgres",
  dbPassword: "",

  // Storage Internal Defaults
  storageProvider: "local",
  storageBucket: "uploads",
  storageRegion: "us-central1",
  storageEndpoint: "",

  // Audio Pipeline Internal Defaults
  audioMaxFileSizeMb: 50,
  audioAllowedExtensions: [".mp3", ".wav", ".m4a", ".webm", ".mp4", ".aac", ".flac", ".ogg"],
  audioAllowedMimeTypes: [
    "audio/wav", "audio/mp3", "audio/mpeg", "audio/m4a", "audio/x-m4a",
    "audio/webm", "video/webm", "video/mp4", "audio/aac", "audio/flac", "audio/ogg"
  ],
  audioSampleRate: 16000,
  audioChannels: 1,
  audioFormat: "pcm",
  audioNormalizationEnabled: true,
  audioExtractionEnabled: true,
  ffmpegEnabled: true,
  ffmpegPath: "ffmpeg",
  ffmpegWasmEnabled: false,

  // Production Audio Decoding Internal Defaults
  audioDecoder: "ffmpeg_pcm_s16le",
  audioDecoderTimeoutMs: 30000,
  audioFallbackEnabled: true,
  audioDebugLogging: true,

  // Model Versioning Default
  modelRevision: "main",

  // Report Generation Internal Defaults
  reportGenerationEnabled: true,
  reportModel: "gemini-2.5-flash",
  reportFormat: "html",
  pdfGenerationEnabled: false,
  reportStorageEnabled: true,

  // Logging & Observability Internal Defaults
  logLevel: "info",
  enableDebugLogging: true,
  enableModelLogging: true,
  enableAudioPipelineLogging: true,
  enableTelemetryLogging: true,
  enablePerformanceMetrics: true,
};

export function validateStartupConfiguration() {
  console.log("=================================================");
  console.log(" SILENT CO-DRIVER AI - CONFIGURATION VALIDATION  ");
  console.log("=================================================");

  console.log(config.geminiApiKey ? " ✓ GEMINI_API_KEY configured" : " ! GEMINI_API_KEY not provided (local fallback mode)");
  console.log(config.hfToken ? " ✓ HF_TOKEN configured" : " ! HF_TOKEN not provided (local fallback mode)");
  console.log(` ✓ HF_ASR_MODEL configured (${config.hfAsrModel})`);
  console.log(` ✓ HF_AUDIO_EMOTION_MODEL configured (${config.hfEmotionModel})`);

  console.log("=================================================\n");
}

export function getSystemHealthStatus() {
  return {
    timestamp: new Date().toISOString(),
    status: (config.geminiApiKey || config.hfToken) ? "READY" : "DEGRADED",
    services: {
      ai_provider: {
        status: config.geminiApiKey ? "READY" : "DEGRADED (No GEMINI_API_KEY)",
        model: config.geminiModel
      },
      asr: {
        status: config.hfToken ? "READY" : "DEGRADED (No HF_TOKEN)",
        provider: config.asrProvider,
        model: config.hfAsrModel
      },
      vad: {
        status: "READY",
        provider: config.vadProvider
      },
      audio_decoder: {
        status: "READY",
        decoder: config.audioDecoder
      }
    }
  };
}
