import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { HfInference } from "@huggingface/inference";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

const hfToken = config.hfToken;
const hf = hfToken ? new HfInference(hfToken) : null;

export interface AcousticFeatures {
  rms: number;
  peak: number;
  zcr: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  energyVariance: number;
  duration: number;
  silenceRatio: number;
  normalizedVocalEnergy?: number;
  pitchMedian?: number | null;
  pitchVariance?: number | null;
}

export interface AudioSignalBreakdown {
  acoustic: number | null;
  text: number | null;
  speechDynamics: number | null;
}

export interface AudioSegmentResult {
  start: number;
  end: number;
  text: string;
  asr_meta?: {
    status: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR";
    modelUsed?: string;
    error?: string;
    latencyMs?: number;
    charCount?: number;
  };
  state: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" | "ANALYSIS INCOMPLETE";
  confidence: number | null;
  scores: { calm: number; stressed: number; tired_like: number } | null;
  signals: AudioSignalBreakdown | null;
  acoustic_features: AcousticFeatures;
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

export interface AudioQualityInfo {
  duration: number;
  speechDuration: number;
  quality: "GOOD" | "MODERATE" | "POOR" | "INSUFFICIENT";
  clippingRatio: number;
  silenceRatio: number;
  snrDb: number;
}

export interface AudioAnalysisResult {
  duration: number;
  sample_rate: number;
  channels: number;
  samples: number;
  format: string;
  is_silent: boolean;
  audioQuality: AudioQualityInfo;
  segments: AudioSegmentResult[];
  overallAsrStatus?: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR";
  overallAsrModel?: string;
  overallAsrError?: string;
  pipelineStatus?: "FULL" | "PARTIAL" | "FAILED";
  sessionState: {
    calm: number;
    stressed: number;
    tired: number;
    dominant: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO";
    confidence: number;
  };
  debug_info?: {
    inputFile: string;
    extension: string;
    mimeType: string;
    container: string;
    audioStream: "FOUND" | "NOT FOUND";
    audioCodec: string;
    sampleRate: string;
    channels: string;
    extractedAudio: "YES" | "NO";
    normalized: string;
    normalizedSize: string;
  };
}

export interface GlobalAcousticStats {
  globalRms: number;
  globalRmsStd: number;
  globalZcr: number;
  globalZcrStd: number;
  globalCentroid: number;
  globalCentroidStd: number;
}

/**
 * Normalizes input audio buffer (MP3, WAV, M4A, WEBM, etc.) to 16kHz Mono 16-bit PCM WAV file
 */
export async function normalizeAudioToWav(
  inputBuffer: Buffer,
  originalFilenameOrMime: string
): Promise<{ 
  wavPath: string; 
  duration: number; 
  sampleRate: number; 
  samples: number; 
  peak: number; 
  rms: number;
  globalStats: GlobalAcousticStats;
  audioQuality: AudioQualityInfo;
  pcmData: Int16Array;
  debugInfo?: any;
}> {
  const tmpDir = path.join(process.cwd(), "uploads", "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const id = Math.random().toString(36).substring(2, 10);
  const lowerName = originalFilenameOrMime.toLowerCase();
  
  let ext = path.extname(lowerName);
  if (!ext) {
    ext = lowerName.includes("mp3") ? ".mp3"
      : lowerName.includes("m4a") ? ".m4a"
      : lowerName.includes("webm") ? ".webm"
      : lowerName.includes("mp4") ? ".mp4"
      : lowerName.includes("aac") ? ".aac"
      : lowerName.includes("flac") ? ".flac"
      : lowerName.includes("ogg") ? ".ogg"
      : ".wav";
  }

  const rawPath = path.join(tmpDir, `raw_${id}${ext}`);
  const wavPath = path.join(tmpDir, `norm_${id}.wav`);

  fs.writeFileSync(rawPath, inputBuffer);

  // Check decoder binary availability in environment
  let ffmpegAvailable = false;
  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
    ffmpegAvailable = true;
  } catch (e) {
    ffmpegAvailable = false;
  }

  if (!ffmpegAvailable) {
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (e) {}
    throw new Error(`AUDIO_DECODING_FAILED: FFmpeg decoder is not available in the system PATH.`);
  }

  // Probe file using ffprobe
  let container = "unknown";
  let codec = "unknown";
  let inSampleRate = 0;
  let inChannels = 0;
  let inDuration = 0;
  let hasAudioTrack = false;
  let ffprobeFailed = false;

  try {
    const ffprobeOut = execSync(
      `ffprobe -v error -show_entries stream=codec_name,codec_type,sample_rate,channels,duration -show_entries format=format_name,duration,size -of json "${rawPath}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const probeData = JSON.parse(ffprobeOut);
    if (probeData?.format?.format_name) {
      container = probeData.format.format_name;
    }
    if (probeData?.format?.duration) {
      inDuration = parseFloat(probeData.format.duration) || 0;
    }
    const audioStream = probeData?.streams?.find((s: any) => s.codec_type === "audio");
    if (audioStream) {
      hasAudioTrack = true;
      codec = audioStream.codec_name || "unknown";
      inSampleRate = parseInt(audioStream.sample_rate, 10) || 0;
      inChannels = parseInt(audioStream.channels, 10) || 0;
      if (!inDuration && audioStream.duration) {
        inDuration = parseFloat(audioStream.duration) || 0;
      }
    }
  } catch (probeErr: any) {
    console.warn("[DECODER] ffprobe check warning:", probeErr.message || probeErr);
    ffprobeFailed = true;
  }

  const isVideoContainer = ext === ".mp4" || ext === ".webm" || lowerName.includes("video") || lowerName.includes("mp4");
  
  if (isVideoContainer) {
    if (ffprobeFailed) {
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (e) {}
      throw new Error(`AUDIO_DECODING_FAILED: The uploaded media container is corrupt or cannot be probed.`);
    }
    if (!hasAudioTrack) {
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (e) {}
      throw new Error(`NO_AUDIO_TRACK: No audio track found in the uploaded media container.`);
    }
  }

  try {
    // Run FFmpeg to decode to 16kHz mono 16-bit PCM WAV
    execSync(`ffmpeg -y -i "${rawPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`, {
      stdio: "pipe"
    });
  } catch (err: any) {
    try {
      execSync(`ffmpeg -y -i "${rawPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`, {
        stdio: "pipe"
      });
    } catch (err2: any) {
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (e) {}
      throw new Error(`AUDIO_DECODING_FAILED: FFmpeg could not decode this audio file (${err2.message || err2})`);
    }
  } finally {
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch (e) {}
  }

  if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size < 44) {
    throw new Error("AUDIO_DECODING_FAILED: Decoded audio file is invalid or empty.");
  }

  const wavBuf = fs.readFileSync(wavPath);
  const wavSize = wavBuf.length;
  const sampleRate = 16000;
  const dataBytes = wavBuf.length - 44;
  const numSamples = Math.floor(dataBytes / 2);
  const duration = numSamples / sampleRate;

  if (numSamples <= 0 || duration <= 0) {
    try { fs.unlinkSync(wavPath); } catch (e) {}
    throw new Error("INSUFFICIENT_AUDIO: Audio file duration is zero.");
  }

  // Safe server-side DECODER logging
  console.log(`[DECODER] decoderAvailable=true, inputContainer=${container}, inputCodec=${codec}, sampleRate=${inSampleRate}Hz, channels=${inChannels}, duration=${inDuration.toFixed(2)}s, extractedAudioSize=${wavSize} bytes, convertedSampleRate=16000Hz, convertedChannels=1, pcmFormat=pcm_s16le`);

  const pcmData = new Int16Array(wavBuf.buffer, wavBuf.byteOffset + 44, numSamples);

  // Compute 50ms frame-level acoustic metrics across the whole recording
  const frameSamples = Math.floor(sampleRate * 0.05); // 800 samples = 50ms
  const frameCount = Math.floor(numSamples / frameSamples);

  const frameRmsList: number[] = [];
  const frameZcrList: number[] = [];
  const frameCentroidList: number[] = [];

  let overallSumSq = 0;
  let overallPeak = 0;
  let clippingCount = 0;
  let silentFrameCount = 0;

  for (let f = 0; f < frameCount; f++) {
    const offset = f * frameSamples;
    let sumSq = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < frameSamples; i++) {
      const sampleVal = pcmData[offset + i];
      const s = sampleVal / 32768.0;
      const absS = Math.abs(s);
      sumSq += s * s;
      overallSumSq += s * s;
      if (absS > overallPeak) overallPeak = absS;
      if (Math.abs(sampleVal) >= 32000) clippingCount++;

      if (i > 0) {
        const prevS = pcmData[offset + i - 1];
        if ((sampleVal >= 0 && prevS < 0) || (sampleVal < 0 && prevS >= 0)) {
          zeroCrossings++;
        }
      }
    }

    const fRms = Math.sqrt(sumSq / frameSamples);
    const fZcr = zeroCrossings / frameSamples;

    frameRmsList.push(fRms);
    frameZcrList.push(fZcr);

    if (fRms < 0.005) {
      silentFrameCount++;
    }

    // Fast spectral centroid calculation
    const centroid = computeFrameSpectralCentroid(pcmData, offset, frameSamples, sampleRate);
    frameCentroidList.push(centroid);
  }

  const overallRms = Math.sqrt(overallSumSq / numSamples);
  const silenceRatio = frameCount > 0 ? silentFrameCount / frameCount : 1.0;
  const clippingRatio = numSamples > 0 ? clippingCount / numSamples : 0.0;

  // Estimate SNR (Signal-to-Noise Ratio in dB)
  const activeFrameRms = frameRmsList.filter(r => r >= 0.005);
  const noiseFrameRms = frameRmsList.filter(r => r < 0.005);
  const avgActiveRms = activeFrameRms.length > 0 ? activeFrameRms.reduce((a, b) => a + b, 0) / activeFrameRms.length : 0.001;
  const avgNoiseRms = noiseFrameRms.length > 0 ? noiseFrameRms.reduce((a, b) => a + b, 0) / noiseFrameRms.length : 0.0001;
  const snrDb = Math.max(0, Math.round(20 * Math.log10((avgActiveRms + 1e-6) / (avgNoiseRms + 1e-6)) * 10) / 10);

  // Global mean and std calculation
  const globalRms = calcMean(frameRmsList);
  const globalRmsStd = calcStd(frameRmsList, globalRms);
  const globalZcr = calcMean(frameZcrList);
  const globalZcrStd = calcStd(frameZcrList, globalZcr);
  const globalCentroid = calcMean(frameCentroidList);
  const globalCentroidStd = calcStd(frameCentroidList, globalCentroid);

  const globalStats: GlobalAcousticStats = {
    globalRms,
    globalRmsStd: Math.max(0.001, globalRmsStd),
    globalZcr,
    globalZcrStd: Math.max(0.001, globalZcrStd),
    globalCentroid,
    globalCentroidStd: Math.max(10, globalCentroidStd)
  };

  const speechDuration = Math.round((duration * (1 - silenceRatio)) * 10) / 10;

  let quality: "GOOD" | "MODERATE" | "POOR" | "INSUFFICIENT" = "GOOD";
  if (overallRms < 0.0008 || speechDuration < 0.3) {
    quality = "INSUFFICIENT";
  } else if (clippingRatio > 0.08 || snrDb < 4) {
    quality = "POOR";
  } else if (snrDb < 12 || clippingRatio > 0.02 || silenceRatio > 0.75) {
    quality = "MODERATE";
  }

  const audioQuality: AudioQualityInfo = {
    duration: Math.round(duration * 10) / 10,
    speechDuration,
    quality,
    clippingRatio: Math.round(clippingRatio * 1000) / 1000,
    silenceRatio: Math.round(silenceRatio * 100) / 100,
    snrDb
  };

  const normalizedSizeKb = Math.round(wavBuf.length / 1024);

  let containerName = "UNKNOWN";
  if (ext === ".mp4") containerName = "MP4";
  else if (ext === ".mp3") containerName = "MP3";
  else if (ext === ".wav") containerName = "WAV";
  else if (ext === ".m4a") containerName = "M4A";
  else if (ext === ".webm") containerName = "WEBM";
  else if (ext === ".ogg") containerName = "OGG";
  else if (ext === ".aac") containerName = "AAC";
  else if (ext === ".flac") containerName = "FLAC";

  let inferredMime = "audio/unknown";
  if (ext === ".mp4") inferredMime = "video/mp4";
  else if (ext === ".webm") inferredMime = "video/webm";
  else if (ext === ".mp3") inferredMime = "audio/mp3";
  else if (ext === ".wav") inferredMime = "audio/wav";
  else if (ext === ".m4a") inferredMime = "audio/m4a";
  else if (ext === ".aac") inferredMime = "audio/aac";
  else if (ext === ".flac") inferredMime = "audio/flac";
  else if (ext === ".ogg") inferredMime = "audio/ogg";

  const debugInfo = {
    inputFile: path.basename(originalFilenameOrMime),
    extension: ext,
    mimeType: inferredMime,
    container: container,
    audioStream: (hasAudioTrack ? "FOUND" : "NOT FOUND") as "FOUND" | "NOT FOUND",
    audioCodec: codec ? codec.toUpperCase() : "UNKNOWN",
    sampleRate: inSampleRate ? `${inSampleRate} Hz` : "UNKNOWN",
    channels: inChannels ? String(inChannels) : "UNKNOWN",
    extractedAudio: (hasAudioTrack ? "YES" : "NO") as "YES" | "NO",
    normalized: "16kHz MONO PCM",
    normalizedSize: `${normalizedSizeKb} KB`
  };

  return {
    wavPath,
    duration,
    sampleRate,
    samples: numSamples,
    peak: overallPeak,
    rms: overallRms,
    globalStats,
    audioQuality,
    pcmData,
    debugInfo
  };
}

/**
 * Helper to compute spectral centroid for a PCM frame using discrete DFT magnitudes
 */
function computeFrameSpectralCentroid(pcmData: Int16Array, offset: number, frameLen: number, sampleRate: number): number {
  const N = Math.min(256, frameLen);
  let weightedSum = 0;
  let totalMag = 0;

  for (let k = 1; k < N / 2; k++) {
    let re = 0;
    let im = 0;
    const freq = (k * sampleRate) / N;

    for (let n = 0; n < N; n++) {
      const val = (pcmData[offset + n] || 0) / 32768.0;
      const angle = (2 * Math.PI * k * n) / N;
      re += val * Math.cos(angle);
      im -= val * Math.sin(angle);
    }

    const mag = Math.sqrt(re * re + im * im);
    weightedSum += freq * mag;
    totalMag += mag;
  }

  return totalMag > 0.0001 ? weightedSum / totalMag : 1000;
}

function calcMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calcStd(arr: number[], mean: number): number {
  if (arr.length === 0) return 0;
  const sqDiffs = arr.map(v => (v - mean) * (v - mean));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

/**
 * Detects speech segments using FFmpeg silencedetect or energy windowing
 */
export function detectSpeechSegments(wavPath: string, totalDuration: number): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];

  try {
    const output = execSync(`ffmpeg -i "${wavPath}" -af silencedetect=noise=${config.vadThreshold}:d=0.3 -f null -`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err: any) {
    const stderr = err.stderr || "";
    const lines = stderr.split("\n");
    const silences: { start: number; end: number }[] = [];
    let currentSilenceStart: number | null = null;

    for (const line of lines) {
      if (line.includes("silence_start:")) {
        const match = line.match(/silence_start:\s*([\d.]+)/);
        if (match) currentSilenceStart = parseFloat(match[1]);
      } else if (line.includes("silence_end:")) {
        const match = line.match(/silence_end:\s*([\d.]+)/);
        if (match && currentSilenceStart !== null) {
          silences.push({ start: currentSilenceStart, end: parseFloat(match[1]) });
          currentSilenceStart = null;
        }
      }
    }

    if (currentSilenceStart !== null) {
      silences.push({ start: currentSilenceStart, end: totalDuration });
    }

    // Invert silences to get speech segments
    let lastPos = 0;
    for (const sil of silences) {
      if (sil.start - lastPos >= 0.4) {
        segments.push({ start: Math.round(lastPos * 10) / 10, end: Math.round(sil.start * 10) / 10 });
      }
      lastPos = sil.end;
    }
    if (totalDuration - lastPos >= 0.4) {
      segments.push({ start: Math.round(lastPos * 10) / 10, end: Math.round(totalDuration * 10) / 10 });
    }
  }

  // Fallback if no speech segments extracted
  if (segments.length === 0) {
    if (totalDuration <= 12) {
      segments.push({ start: 0, end: Math.round(totalDuration * 10) / 10 });
    } else {
      let pos = 0;
      while (pos < totalDuration) {
        const end = Math.min(pos + 10, totalDuration);
        segments.push({ start: Math.round(pos * 10) / 10, end: Math.round(end * 10) / 10 });
        pos += 10;
      }
    }
  }

  return segments;
}

/**
 * Helper to estimate pitch of a PCM frame using autocorrelation
 */
function estimateFramePitch(pcmData: Int16Array, offset: number, len: number, sampleRate: number): number {
  let maxCorr = 0;
  let bestPeriod = -1;
  const minPeriod = Math.floor(sampleRate / 300); // 300 Hz max pitch
  const maxPeriod = Math.floor(sampleRate / 60);  // 60 Hz min pitch

  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    let corr = 0;
    for (let i = 0; i < len - lag; i++) {
      const s1 = (pcmData[offset + i] || 0) / 32768.0;
      const s2 = (pcmData[offset + i + lag] || 0) / 32768.0;
      corr += s1 * s2;
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestPeriod = lag;
    }
  }

  if (bestPeriod > 0 && maxCorr > 0.05) {
    return sampleRate / bestPeriod;
  }
  return 0; // Unvoiced / silent
}

/**
 * Extracts acoustic features for a specific slice of the PCM WAV file
 */
export function extractAcousticFeatures(
  pcmData: Int16Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): AcousticFeatures {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const endIdx = Math.min(pcmData.length, Math.floor(endSec * sampleRate));
  const sliceLen = Math.max(1, endIdx - startIdx);

  const frameSamples = Math.floor(sampleRate * 0.05); // 50ms frames
  const frameCount = Math.max(1, Math.floor(sliceLen / frameSamples));

  let sumSq = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let silentFrames = 0;

  const frameRmsList: number[] = [];
  const frameCentroidList: number[] = [];
  const pitchValues: number[] = [];

  for (let f = 0; f < frameCount; f++) {
    const offset = startIdx + f * frameSamples;
    let fSumSq = 0;

    for (let i = 0; i < frameSamples; i++) {
      if (offset + i >= endIdx) break;
      const s = pcmData[offset + i] / 32768.0;
      fSumSq += s * s;
      sumSq += s * s;
      if (Math.abs(s) > peak) peak = Math.abs(s);

      if (i > 0 && offset + i - 1 < endIdx) {
        const prevS = pcmData[offset + i - 1] / 32768.0;
        if ((s >= 0 && prevS < 0) || (s < 0 && prevS >= 0)) {
          zeroCrossings++;
        }
      }
    }

    const fRms = Math.sqrt(fSumSq / frameSamples);
    frameRmsList.push(fRms);
    if (fRms < 0.005) silentFrames++;

    const centroid = computeFrameSpectralCentroid(pcmData, offset, frameSamples, sampleRate);
    frameCentroidList.push(centroid);

    // Track frame pitch for voiced frames
    if (fRms > 0.005) {
      const pitch = estimateFramePitch(pcmData, offset, frameSamples, sampleRate);
      if (pitch > 60 && pitch < 300) {
        pitchValues.push(pitch);
      }
    }
  }

  const rms = Math.sqrt(sumSq / sliceLen);
  const zcr = zeroCrossings / sliceLen;
  const duration = sliceLen / sampleRate;
  const silenceRatio = silentFrames / frameCount;

  // Energy variance across frames
  const meanFrameRms = calcMean(frameRmsList);
  const energyVariance = calcStd(frameRmsList, meanFrameRms);

  // Spectral Centroid & Rolloff
  const spectralCentroid = calcMean(frameCentroidList);
  const spectralRolloff = spectralCentroid * 1.35; // Approximation
  
  // Spectral Flux (difference between adjacent frame centroids)
  let fluxSum = 0;
  for (let i = 1; i < frameCentroidList.length; i++) {
    fluxSum += Math.abs(frameCentroidList[i] - frameCentroidList[i - 1]);
  }
  const spectralFlux = frameCentroidList.length > 1 ? fluxSum / (frameCentroidList.length - 1) : 0;

  // Compute median pitch and variance for voiced segments
  let pitchMedian: number | null = null;
  let pitchVariance: number | null = null;
  if (pitchValues.length > 2) {
    pitchValues.sort((a, b) => a - b);
    pitchMedian = pitchValues[Math.floor(pitchValues.length / 2)];
    const pitchMean = calcMean(pitchValues);
    pitchVariance = calcStd(pitchValues, pitchMean);
  }

  return {
    rms,
    peak,
    zcr,
    spectralCentroid,
    spectralRolloff,
    spectralFlux,
    energyVariance,
    duration,
    silenceRatio,
    pitchMedian,
    pitchVariance
  };
}

export interface ASRResult {
  status: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR";
  text: string;
  charCount: number;
  modelUsed?: string;
  error?: string;
  latencyMs?: number;
}

/**
 * Transcribes audio slice using Hugging Face Whisper model with fallback model support and safe diagnostics logging
 */
export async function transcribeAudioSlice(wavPath: string, startSec: number, endSec: number): Promise<ASRResult> {
  const requestStarted = new Date().toISOString();
  const sliceTmpPath = path.join(path.dirname(wavPath), `slice_${Math.random().toString(36).substring(2, 8)}.wav`);
  const duration = Math.max(0.4, endSec - startSec);

  try {
    execSync(`ffmpeg -y -ss ${startSec.toFixed(2)} -t ${duration.toFixed(2)} -i "${wavPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${sliceTmpPath}"`, {
      stdio: "pipe"
    });

    if (!fs.existsSync(sliceTmpPath) || fs.statSync(sliceTmpPath).size < 100) {
      console.log(`[ASR DEBUG] mimeType=audio/wav, fileSize=0, duration=${duration.toFixed(2)}s, sampleRate=16000, channels=1, endpoint=local_slice, requestStarted=${requestStarted}, responseStatus=200, responseContentType=application/json, status=ASR_NO_SPEECH`);
      return {
        status: "ASR_NO_SPEECH",
        text: "[NO SPEECH DETECTED]",
        charCount: 0
      };
    }

    const sliceBuf = fs.readFileSync(sliceTmpPath);
    let lastError = "";

    // 1. Try Hugging Face ASR if hfToken is configured
    if (hf) {
      const blob = new Blob([sliceBuf], { type: "audio/wav" });
      const modelsToTry = [config.asrModel, "openai/whisper-large-v3-turbo", "openai/whisper-large-v3"];

      for (const m of modelsToTry) {
        try {
          const reqTime = new Date().toISOString();
          const startMs = Date.now();
          const res = await hf.automaticSpeechRecognition({
            data: blob,
            model: m
          });
          const respTime = new Date().toISOString();
          const latency = Date.now() - startMs;
          const rawText = (res.text || "").trim();

          console.log(`[ASR DEBUG] mimeType=audio/wav, fileSize=${sliceBuf.length}, duration=${duration.toFixed(2)}s, sampleRate=16000, channels=1, endpoint=huggingface/${m}, requestStarted=${reqTime}, responseReceived=${respTime}, responseStatus=200, responseContentType=application/json, charCount=${rawText.length}, latencyMs=${latency}`);

          if (!rawText || rawText === "." || rawText.toLowerCase().includes("[blank_audio]")) {
            return {
              status: "ASR_NO_SPEECH",
              text: "[NO SPEECH DETECTED]",
              charCount: 0,
              modelUsed: m,
              latencyMs: latency
            };
          }

          return {
            status: "ASR_SUCCESS",
            text: rawText,
            charCount: rawText.length,
            modelUsed: m,
            latencyMs: latency
          };
        } catch (mErr: any) {
          lastError = mErr.message || String(mErr);
          console.warn(`[ASR DEBUG] Hugging Face model ${m} attempt failed: ${lastError}`);
        }
      }
    } else {
      lastError = "HF_TOKEN not configured";
    }

    // 2. Try Gemini Audio Speech-to-Text if GEMINI_API_KEY is configured
    if (config.geminiApiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
        const base64Audio = sliceBuf.toString("base64");
        const reqTime = new Date().toISOString();
        const startMs = Date.now();

        const response = await ai.models.generateContent({
          model: config.geminiModel || "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: base64Audio,
                  },
                },
                {
                  text: "You are an accurate Speech-to-Text (ASR) engine for race radio communications. Transcribe the spoken audio verbatim. Return ONLY the verbatim transcribed spoken words. If there is no audible human speech in the audio recording (e.g. only background noise, engine noise, radio static, non-speech sound), return EXACTLY: [NO_SPEECH]",
                },
              ],
            },
          ],
        });

        const respTime = new Date().toISOString();
        const latency = Date.now() - startMs;
        const rawText = (response.text || "").trim();

        console.log(`[ASR DEBUG] mimeType=audio/wav, fileSize=${sliceBuf.length}, duration=${duration.toFixed(2)}s, sampleRate=16000, channels=1, endpoint=gemini-2.5-flash, requestStarted=${reqTime}, responseReceived=${respTime}, responseStatus=200, responseContentType=application/json, charCount=${rawText.length}, latencyMs=${latency}`);

        if (!rawText || rawText.includes("[NO_SPEECH]") || rawText.toLowerCase().includes("no speech")) {
          return {
            status: "ASR_NO_SPEECH",
            text: "[NO SPEECH DETECTED]",
            charCount: 0,
            modelUsed: "gemini-2.5-flash",
            latencyMs: latency
          };
        }

        return {
          status: "ASR_SUCCESS",
          text: rawText,
          charCount: rawText.length,
          modelUsed: "gemini-2.5-flash",
          latencyMs: latency
        };
      } catch (gErr: any) {
        lastError = `Gemini ASR failed: ${gErr.message || String(gErr)}`;
        console.warn(`[ASR DEBUG] Gemini ASR attempt failed: ${lastError}`);
      }
    } else if (!hf) {
      lastError = "Neither HF_TOKEN nor GEMINI_API_KEY configured";
    }

    const respTime = new Date().toISOString();
    console.error(`[ASR DEBUG] endpoint=asr_pipeline, requestStarted=${requestStarted}, responseReceived=${respTime}, responseStatus=500, responseContentType=application/json, error=${lastError}`);

    return {
      status: "ASR_ERROR",
      text: "[ASR unavailable]",
      charCount: 0,
      error: lastError || "ASR request failed"
    };
  } catch (err: any) {
    const respTime = new Date().toISOString();
    console.error(`[ASR] provider=huggingface, modelName=${config.asrModel}, requestStarted=${requestStarted}, responseReceived=${respTime}, httpStatus=500, error=${err.message || err}`);
    return {
      status: "ASR_ERROR",
      text: "[ASR unavailable]",
      charCount: 0,
      error: err.message || "ASR slice transcription error"
    };
  } finally {
    try { if (fs.existsSync(sliceTmpPath)) fs.unlinkSync(sliceTmpPath); } catch (e) {}
  }
}

/**
 * Textual Context Analysis Signal Score
 */
function evaluateTextSignals(text: string): { calm: number; stressed: number; tired: number } | null {
  const lower = text.toLowerCase().trim();
  if (!lower) {
    return null;
  }

  let calmScore = 0.2;
  let stressedScore = 0.2;
  let tiredScore = 0.2;

  const stressKeywords = [
    "no grip", "gone", "disaster", "struggling", "understeer", "oversteer",
    "crash", "lost", "bad", "traffic", "sliding", "unstable", "cannot turn",
    "can't turn", "front tyres", "rear", "hard", "problem", "pushing too hard",
    "move around", "losing time", "locking", "spin", "shit", "too much",
    "no power", "engine", "brakes", "hot", "overheating", "broken", "vibration",
    "stress", "panic", "fuck", "damn", "slow", "yellow flag", "safety car", "hurry"
  ];

  const calmKeywords = [
    "copy", "okay", "box", "pushing fine", "holding", "stable", "good",
    "fine", "clear", "radio check", "gap is", "p2", "p1", "copy that",
    "tyre temp is stable", "everything feels okay", "pace is good", "no issue",
    "understood", "yes", "acknowledged", "affirmative"
  ];

  const tiredKeywords = [
    "tired", "heavy", "manage", "struggling to focus", "long stint",
    "fading", "exhausted", "try to manage", "long way to go", "losing focus",
    "sleepy", "arms", "legs", "eyes", "hot in here", "long race", "energy", "draining"
  ];

  let stressCount = 0;
  let calmCount = 0;
  let tiredCount = 0;

  for (const kw of stressKeywords) {
    if (lower.includes(kw)) {
      stressCount += 1.5;
    }
  }

  for (const kw of calmKeywords) {
    if (lower.includes(kw)) {
      calmCount += 1.5;
    }
  }

  for (const kw of tiredKeywords) {
    if (lower.includes(kw)) {
      tiredCount += 1.5;
    }
  }

  // Factor in emotional intensity
  const exclamationCount = (lower.match(/!/g) || []).length;
  if (exclamationCount > 0) {
    stressCount += exclamationCount * 1.0;
  }

  const words = text.trim().split(/\s+/);
  let upperWords = 0;
  for (const w of words) {
    if (w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) {
      upperWords++;
    }
  }
  if (upperWords > 0) {
    stressCount += upperWords * 0.8;
  }

  const calmScoreFinal = calmScore + calmCount;
  const stressedScoreFinal = stressedScore + stressCount;
  const tiredScoreFinal = tiredScore + tiredCount;

  const sum = calmScoreFinal + stressedScoreFinal + tiredScoreFinal;
  if (sum <= 0) return { calm: 0.34, stressed: 0.33, tired: 0.33 };

  return {
    calm: calmScoreFinal / sum,
    stressed: stressedScoreFinal / sum,
    tired: tiredScoreFinal / sum
  };
}

/**
 * Speech Dynamics Signal Score
 */
function evaluateSpeechDynamics(
  wordCount: number,
  durationSec: number,
  silenceRatio: number,
  energyVariance: number,
  spectralCentroid: number
): { calm: number; stressed: number; tired: number } | null {
  if (durationSec <= 0.15) {
    return null;
  }

  const speechRate = wordCount / durationSec;
  const pauseDuration = silenceRatio * durationSec;
  const voiceActivityRatio = 1 - silenceRatio;

  let calm = 0.33;
  let stressed = 0.33;
  let tired = 0.34;

  if (speechRate > 3.0) {
    stressed += 0.4 * (speechRate - 3.0);
    calm -= 0.15;
    tired -= 0.15;
  }
  if (voiceActivityRatio > 0.8) {
    stressed += 0.2;
    tired -= 0.1;
  }
  if (energyVariance > 0.02) {
    stressed += 0.25;
    calm -= 0.1;
  }

  if (speechRate > 0 && speechRate < 1.5) {
    tired += 0.35;
    calm -= 0.15;
    stressed -= 0.15;
  }
  if (silenceRatio > 0.45 || pauseDuration > 1.2) {
    tired += 0.3;
    calm -= 0.15;
  }

  if (speechRate >= 1.5 && speechRate <= 3.0) {
    calm += 0.4;
    stressed -= 0.15;
    tired -= 0.15;
  }
  if (energyVariance < 0.01 && silenceRatio < 0.3) {
    calm += 0.2;
  }

  calm = Math.max(0.01, calm);
  stressed = Math.max(0.01, stressed);
  tired = Math.max(0.01, tired);

  const sum = calm + stressed + tired;
  return { calm: calm / sum, stressed: stressed / sum, tired: tired / sum };
}

/**
 * Multi-Signal Driver State Mapper combining Acoustic Features, Text, and Speech Dynamics
 */
export function mapDriverState(
  text: string,
  acoustics: AcousticFeatures,
  globalStats: GlobalAcousticStats,
  audioQuality: AudioQualityInfo,
  asrStatus: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR" = "ASR_SUCCESS"
): {
  state: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" | "ANALYSIS INCOMPLETE";
  confidence: number | null;
  scores: { calm: number; stressed: number; tired_like: number } | null;
  signals: AudioSignalBreakdown | null;
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
} {
  if (audioQuality.quality === "INSUFFICIENT" || acoustics.duration < 0.2) {
    return {
      state: "INSUFFICIENT AUDIO",
      confidence: 0.20,
      scores: { calm: 0.33, stressed: 0.33, tired_like: 0.34 },
      signals: { acoustic: 20, text: null, speechDynamics: 20 },
      text_features: null,
      dynamics_features: null,
      reasons: ["Audio duration or quality insufficient for analysis"]
    };
  }

  // --- 1. ACOUSTIC SCORE CALCULATION (100% COVERAGE) ---
  const normEnergyVal = globalStats.globalRms > 0 ? acoustics.rms / globalStats.globalRms : 1.0;
  acoustics.normalizedVocalEnergy = Math.round(normEnergyVal * 100) / 100;

  const scoreRms = Math.min(100, Math.round((acoustics.rms / 0.1) * 100));
  const scorePeak = Math.min(100, Math.round(acoustics.peak * 100));
  const scoreZcr = Math.min(100, Math.round((acoustics.zcr / 0.15) * 100));
  const scoreNormEnergy = Math.min(100, Math.round((normEnergyVal / 2.0) * 100));

  const acousticScore = Math.round(
    0.40 * scoreRms +
    0.25 * scorePeak +
    0.20 * scoreZcr +
    0.15 * scoreNormEnergy
  );

  // --- 2. TEXT SCORE CALCULATION ---
  let textScore: number | null = null;
  let text_features: any = null;
  const hasText = asrStatus === "ASR_SUCCESS" && Boolean(text && text.trim() && !text.startsWith("["));

  if (hasText) {
    const lower = text.toLowerCase();
    
    // Configurable case-insensitive keywords matching Sections 3 & 12
    const urgencyKeywords = ["disaster", "crash", "lost", "problem", "panic", "hurry", "urgency", "emergency", "broken", "overheating", "brakes", "hot", "hazard"];
    const frustrationKeywords = ["shit", "fuck", "damn", "struggling", "can't", "cannot", "bad", "slow", "gone", "unstable", "losing", "crushing", "frustrated", "idiot"];
    const racingKeywords = ["understeer", "oversteer", "front tyres", "rear", "locking", "spin", "no power", "engine", "brakes", "hot", "vibration", "grip", "handling"];

    let urgencyCount = 0;
    for (const kw of urgencyKeywords) {
      if (lower.includes(kw)) urgencyCount++;
    }

    let frustrationCount = 0;
    for (const kw of frustrationKeywords) {
      if (lower.includes(kw)) frustrationCount++;
    }

    let racingCount = 0;
    for (const kw of racingKeywords) {
      if (lower.includes(kw)) racingCount++;
    }

    // Repetition check (repeated consecutive or nearby words)
    const wordsList = lower.match(/\b\w+\b/g) || [];
    let repeatCount = 0;
    const seenWords = new Set<string>();
    for (const w of wordsList) {
      if (seenWords.has(w)) {
        repeatCount++;
      } else {
        seenWords.add(w);
      }
    }
    const repetitionScore = wordsList.length > 0 ? repeatCount / wordsList.length : 0;

    const positiveKeywords = ["yes", "ok", "okay", "copy", "fine", "good", "stable", "clear", "understood", "acknowledged", "affirmative", "box"];
    let positiveCount = 0;
    for (const kw of positiveKeywords) {
      if (lower.includes(kw)) positiveCount++;
    }

    const totalWords = wordsList.length || 1;
    let sentimentScore = (positiveCount - (urgencyCount + frustrationCount)) / totalWords;
    sentimentScore = Math.max(-1.0, Math.min(1.0, sentimentScore));

    const sentimentStress = Math.round((1 - (sentimentScore + 1) / 2) * 100);
    const frustrationStress = Math.min(100, frustrationCount * 30);
    const urgencyStress = Math.min(100, urgencyCount * 35);
    const racingStress = Math.min(100, racingCount * 25);
    const repetitionStress = Math.min(100, Math.round(repetitionScore * 100));

    // Exclamation and uppercase logic
    const exclamationCount = (text.match(/!/g) || []).length;
    let upperWordsCount = 0;
    for (const w of text.split(/\s+/)) {
      if (w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) {
        upperWordsCount++;
      }
    }
    const speechIntensity = Math.min(10, exclamationCount * 2 + upperWordsCount + (text.length > 50 ? 1 : 0));

    text_features = {
      sentimentScore: Math.round(sentimentScore * 100) / 100,
      urgencyKeywordsCount: urgencyCount,
      negativeMarkersCount: frustrationCount,
      positiveMarkersCount: positiveCount,
      speechIntensity: speechIntensity
    };

    textScore = Math.round(
      0.30 * sentimentStress +
      0.25 * frustrationStress +
      0.20 * urgencyStress +
      0.15 * racingStress +
      0.10 * repetitionStress
    );
  }

  // --- 3. DYNAMICS SCORE WITH ADAPTIVE WEIGHT REDISTRIBUTION ---
  let dynamicsScore: number | null = null;
  let dynamics_features: any = null;

  if (acoustics.duration >= 0.2) {
    const wordCount = hasText ? text.split(/\s+/).length : 0;
    const speechRate = wordCount / acoustics.duration;
    const pauseDuration = acoustics.silenceRatio * acoustics.duration;
    const voiceActivityRatio = 1 - acoustics.silenceRatio;

    const pitchAvailable = typeof acoustics.pitchMedian === 'number' && acoustics.pitchMedian > 0;

    const scoreSpeechRate = Math.min(100, Math.round((speechRate / 4.0) * 100));
    const scoreEnergyVar = Math.min(100, Math.round((acoustics.energyVariance / 0.05) * 100));
    const scoreVoiceActivity = Math.round(voiceActivityRatio * 100);

    let scorePitch = 0;
    if (pitchAvailable) {
      const deviation = Math.abs((acoustics.pitchMedian || 150) - 150);
      scorePitch = Math.min(100, Math.round((deviation / 50) * 50 + ((acoustics.pitchVariance || 0) / 20) * 50));
    }

    // Adaptive weights redistribution (Section 6)
    let wRate = 0.30;
    let wEnergyVar = 0.25;
    let wVoiceAct = 0.25;
    let wPitch = 0.20;

    if (!pitchAvailable) {
      wRate = 0.30 / 0.80;
      wEnergyVar = 0.25 / 0.80;
      wVoiceAct = 0.25 / 0.80;
      wPitch = 0.0;
    }

    dynamicsScore = Math.round(
      wRate * scoreSpeechRate +
      wEnergyVar * scoreEnergyVar +
      wVoiceAct * scoreVoiceActivity +
      wPitch * scorePitch
    );

    dynamics_features = {
      speechRate: hasText ? Math.round(speechRate * 10) / 10 : null,
      pauseDuration: Math.round(pauseDuration * 100) / 100,
      energyVariation: Math.round(acoustics.energyVariance * 10000) / 10000,
      pitchProsody: pitchAvailable ? acoustics.pitchMedian : null
    };
  }

  // Fail-safe
  if (dynamicsScore === null) {
    return {
      state: "ANALYSIS INCOMPLETE",
      confidence: null,
      scores: null,
      signals: null,
      text_features: null,
      dynamics_features: null
    };
  }

  // --- 4. MULTI-SIGNAL DRIVER STATE CLASSIFICATION (Section 7) ---
  let stressedProb = acousticScore / 100;
  if (textScore !== null) {
    const acWeight = config.acousticWeight;
    const txtWeight = config.textWeight;
    const dynWeight = config.dynamicsWeight;
    const totalW = acWeight + txtWeight + dynWeight || 1.0;
    stressedProb = ((acWeight * acousticScore + txtWeight * textScore + dynWeight * dynamicsScore) / totalW) / 100;
  } else {
    const acWeight = config.acousticWeight;
    const dynWeight = config.dynamicsWeight;
    const totalW = acWeight + dynWeight || 1.0;
    stressedProb = ((acWeight * acousticScore + dynWeight * dynamicsScore) / totalW) / 100;
  }

  const lowEnergyFactor = Math.max(0, 1.0 - (acoustics.rms / 0.03));
  const silenceFactor = acoustics.silenceRatio;
  let tiredProb = (lowEnergyFactor * 0.5 + silenceFactor * 0.5) * (1 - stressedProb);
  if (text_features?.sentimentScore < -0.15) {
    tiredProb += 0.1 * (1 - stressedProb);
  }

  let calmProb = Math.max(0, 1.0 - stressedProb - tiredProb);
  const totalProb = calmProb + stressedProb + tiredProb;
  const calm = Math.round((calmProb / totalProb) * 100) / 100;
  const stressed = Math.round((stressedProb / totalProb) * 100) / 100;
  const tired_like = Math.round((1.0 - calm - stressed) * 100) / 100;

  let state: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" | "ANALYSIS INCOMPLETE" = "CALM";
  if (stressed >= calm && stressed >= tired_like) {
    state = "STRESSED";
  } else if (tired_like >= calm && tired_like >= stressed) {
    state = "TIRED-LIKE";
  } else {
    state = "CALM";
  }

  // --- 5. SIGNAL-AGREEMENT & QUALITY-BASED CONFIDENCE (Section 8) ---
  const acDominant = acousticScore > 50 ? "STRESSED" : acousticScore < 20 ? "TIRED-LIKE" : "CALM";
  const dynDominant = dynamicsScore > 50 ? "STRESSED" : dynamicsScore < 25 ? "TIRED-LIKE" : "CALM";
  const textDominant = textScore !== null ? (textScore > 45 ? "STRESSED" : textScore < 15 ? "TIRED-LIKE" : "CALM") : null;

  let agreementMultiplier = 1.0;
  if (textDominant) {
    if (acDominant === textDominant && textDominant === dynDominant) {
      agreementMultiplier = 1.0;
    } else if (acDominant === textDominant || textDominant === dynDominant || acDominant === dynDominant) {
      agreementMultiplier = 0.8;
    } else {
      agreementMultiplier = 0.55;
    }
  } else {
    if (acDominant === dynDominant) {
      agreementMultiplier = 0.95;
    } else {
      agreementMultiplier = 0.7;
    }
  }

  const snrFactor = Math.min(1.0, Math.max(0.4, audioQuality.snrDb / 15.0));
  const clippingFactor = Math.max(0.5, 1.0 - audioQuality.clippingRatio * 5.0);
  const silenceQualFactor = Math.max(0.5, 1.0 - audioQuality.silenceRatio * 0.5);
  const qualityMultiplier = snrFactor * clippingFactor * silenceQualFactor;

  const totalPossibleFeatures = 15;
  const actualFeaturesCount = 6 + (textScore !== null ? 5 : 0) + (dynamicsScore !== null ? (dynamics_features.pitchProsody ? 4 : 3) : 0);
  const coverageMultiplier = actualFeaturesCount / totalPossibleFeatures;

  let confidence = (state === "STRESSED" ? stressed : state === "TIRED-LIKE" ? tired_like : calm)
                   * agreementMultiplier
                   * qualityMultiplier
                   * coverageMultiplier;

  confidence = Math.min(0.98, Math.max(0.15, Math.round(confidence * 100) / 100));

  const signals: AudioSignalBreakdown = {
    acoustic: acousticScore,
    text: textScore,
    speechDynamics: dynamicsScore
  };

  // --- 6. EXPLAINABILITY EVIDENCE GENERATION ---
  const reasons: string[] = [];
  if (acoustics.normalizedVocalEnergy && acoustics.normalizedVocalEnergy > 1.3) {
    reasons.push(`Elevated vocal energy (${acoustics.normalizedVocalEnergy.toFixed(1)}x baseline)`);
  }
  if (acoustics.rms > 0.04) {
    reasons.push(`High acoustic RMS sound pressure (${acoustics.rms.toFixed(3)})`);
  }
  if (acoustics.zcr > 0.08) {
    reasons.push(`Elevated zero-crossing rate (${(acoustics.zcr * 100).toFixed(0)} Hz)`);
  }

  if (text_features) {
    if (text_features.urgencyKeywordsCount && text_features.urgencyKeywordsCount > 0) {
      reasons.push(`Urgency/hazard keywords detected in radio transcript (${text_features.urgencyKeywordsCount} found)`);
    }
    if (text_features.negativeMarkersCount && text_features.negativeMarkersCount > 0) {
      reasons.push(`Frustration / negative markers detected (${text_features.negativeMarkersCount} found)`);
    }
    if (text_features.sentimentScore !== null && text_features.sentimentScore < -0.15) {
      reasons.push(`Negative sentiment index (${text_features.sentimentScore.toFixed(2)})`);
    } else if (text_features.sentimentScore !== null && text_features.sentimentScore > 0.15) {
      reasons.push(`Positive confirmation sentiment (${text_features.sentimentScore.toFixed(2)})`);
    }
  } else {
    reasons.push(`ASR transcript unavailable (Text signal omitted)`);
  }

  if (dynamics_features) {
    if (dynamics_features.speechRate && dynamics_features.speechRate > 3.0) {
      reasons.push(`Rapid speech cadence (${dynamics_features.speechRate} words/sec)`);
    } else if (dynamics_features.speechRate && dynamics_features.speechRate < 1.5 && dynamics_features.speechRate > 0) {
      reasons.push(`Slowed / hesitant speech cadence (${dynamics_features.speechRate} words/sec)`);
    }
    if (dynamics_features.pauseDuration && dynamics_features.pauseDuration > 1.0) {
      reasons.push(`Extended pause duration (${dynamics_features.pauseDuration.toFixed(1)}s)`);
    }
  }

  if (reasons.length === 0) {
    if (state === "CALM") reasons.push("Stable vocal energy, neutral tone, normal speech rate");
    else if (state === "STRESSED") reasons.push("Elevated vocal acoustic intensity and pitch variation");
    else if (state === "TIRED-LIKE") reasons.push("Low RMS vocal energy and high pause duration");
  }

  return {
    state,
    confidence,
    scores: { calm, stressed, tired_like },
    signals,
    text_features,
    dynamics_features,
    reasons
  };
}

/**
 * Main complete processing function for audio session uploads
 */
export async function processAudioFile(
  inputBuffer: Buffer,
  filenameOrMime: string
): Promise<AudioAnalysisResult> {
  const norm = await normalizeAudioToWav(inputBuffer, filenameOrMime);

  if (norm.audioQuality.quality === "INSUFFICIENT" || norm.rms < 0.0005) {
    try { fs.unlinkSync(norm.wavPath); } catch (e) {}
    return {
      duration: norm.duration,
      sample_rate: norm.sampleRate,
      channels: 1,
      samples: norm.samples,
      format: filenameOrMime,
      is_silent: true,
      audioQuality: norm.audioQuality,
      segments: [],
      overallAsrStatus: "ASR_NO_SPEECH",
      pipelineStatus: "FAILED",
      sessionState: {
        calm: 0,
        stressed: 0,
        tired: 0,
        dominant: "INSUFFICIENT AUDIO",
        confidence: 0
      },
      debug_info: norm.debugInfo
    };
  }

  const rawSegments = detectSpeechSegments(norm.wavPath, norm.duration);
  const segments: AudioSegmentResult[] = [];

  let overallAsrStatus: "ASR_SUCCESS" | "ASR_NO_SPEECH" | "ASR_ERROR" = "ASR_NO_SPEECH";
  let overallAsrModel: string | undefined = undefined;
  let overallAsrError: string | undefined = undefined;

  for (const seg of rawSegments) {
    const asrRes = await transcribeAudioSlice(norm.wavPath, seg.start, seg.end);
    const acoustics = extractAcousticFeatures(norm.pcmData, norm.sampleRate, seg.start, seg.end);
    const mappedState = mapDriverState(asrRes.text, acoustics, norm.globalStats, norm.audioQuality, asrRes.status);

    if (asrRes.status === "ASR_SUCCESS") {
      overallAsrStatus = "ASR_SUCCESS";
      if (asrRes.modelUsed) overallAsrModel = asrRes.modelUsed;
    } else if (asrRes.status === "ASR_ERROR" && overallAsrStatus !== "ASR_SUCCESS") {
      overallAsrStatus = "ASR_ERROR";
      if (asrRes.error) overallAsrError = asrRes.error;
    }

    if (asrRes.text || acoustics.rms > 0.002) {
      segments.push({
        start: seg.start,
        end: seg.end,
        text: asrRes.text,
        asr_meta: {
          status: asrRes.status,
          modelUsed: asrRes.modelUsed,
          error: asrRes.error,
          latencyMs: asrRes.latencyMs,
          charCount: asrRes.charCount
        },
        state: mappedState.state,
        confidence: mappedState.confidence,
        scores: mappedState.scores,
        signals: mappedState.signals,
        acoustic_features: acoustics,
        text_features: mappedState.text_features,
        dynamics_features: mappedState.dynamics_features,
        reasons: mappedState.reasons
      });
    }
  }

  // Cleanup normalized wav
  try { fs.unlinkSync(norm.wavPath); } catch (e) {}

  // Calculate session-level aggregated state
  let totalCalm = 0;
  let totalStressed = 0;
  let totalTired = 0;
  let totalConf = 0;
  let totalSpeechDur = 0;

  for (const seg of segments) {
    const dur = seg.acoustic_features.duration;
    totalCalm += seg.scores.calm * dur;
    totalStressed += seg.scores.stressed * dur;
    totalTired += seg.scores.tired_like * dur;
    totalConf += seg.confidence * dur;
    totalSpeechDur += dur;
  }

  const divisor = totalSpeechDur > 0 ? totalSpeechDur : 1;
  const avgCalm = Math.round((totalCalm / divisor) * 100);
  const avgStressed = Math.round((totalStressed / divisor) * 100);
  const avgTired = 100 - avgCalm - avgStressed;
  const avgConf = Math.round((totalConf / divisor) * 100) / 100;

  let dominantSessionState: "CALM" | "STRESSED" | "TIRED-LIKE" | "INSUFFICIENT AUDIO" = "CALM";
  if (avgStressed >= avgCalm && avgStressed >= avgTired) dominantSessionState = "STRESSED";
  else if (avgTired >= avgCalm && avgTired >= avgStressed) dominantSessionState = "TIRED-LIKE";
  else dominantSessionState = "CALM";

  if (segments.length === 0) dominantSessionState = "INSUFFICIENT AUDIO";

  const pipelineStatus: "FULL" | "PARTIAL" | "FAILED" = 
    overallAsrStatus === "ASR_SUCCESS" ? "FULL" : 
    segments.length > 0 ? "PARTIAL" : "FAILED";

  return {
    duration: norm.duration,
    sample_rate: norm.sampleRate,
    channels: 1,
    samples: norm.samples,
    format: filenameOrMime,
    is_silent: segments.length === 0,
    audioQuality: norm.audioQuality,
    segments,
    overallAsrStatus,
    overallAsrModel,
    overallAsrError,
    pipelineStatus,
    sessionState: {
      calm: avgCalm,
      stressed: avgStressed,
      tired: avgTired,
      dominant: dominantSessionState,
      confidence: avgConf
    },
    debug_info: norm.debugInfo
  };
}
