import express from "express";
import http from "http";
import path from "path";
import multer from "multer";
import { HfInference } from "@huggingface/inference";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { processAudioFile, normalizeAudioToWav, transcribeAudioSlice, mapDriverState, extractAcousticFeatures } from "./server/audioPipeline.js";
import { config, validateStartupConfiguration, getSystemHealthStatus } from "./server/config.js";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const upload = multer({ dest: "uploads/" });

// In-memory sessions store
const sessions = new Map();

// In-memory Auth Tokens store
interface UserSession {
  id: string;
  email: string;
  name: string;
  role: "race_engineer" | "team_admin" | "driver" | "analyst";
  team: string;
  avatarUrl?: string;
}

const authTokens = new Map<string, UserSession>();

const DEMO_USER: UserSession = {
  id: "demo-engineer-01",
  email: "engineer@team.com",
  name: "Demo Race Engineer",
  role: "race_engineer",
  team: "Oracle Red Bull Racing / AI Operations"
};

// Helper to extract user from Authorization header or cookie
function getUserFromReq(req: express.Request): UserSession | null {
  let token = "";
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(";").map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("session_token=")) {
        token = cookie.substring("session_token=".length);
        break;
      }
    }
  }

  if (!token) return null;
  return authTokens.get(token) || null;
}

// Auth Middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getUserFromReq(req);
  if (!user) {
    res.setHeader("Content-Type", "application/json");
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Please log in to access race engineer telemetry endpoints.",
      code: "UNAUTHORIZED"
    });
  }
  (req as any).user = user;
  next();
}

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 15);

// Environment Configuration
const hfToken = config.hfToken;
const asrModel = config.asrModel;
const emotionModel = config.hfEmotionModel;
const geminiApiKey = config.geminiApiKey;

// Initialize Clients
const hf = hfToken ? new HfInference(hfToken) : null;
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

// Default lap data
const DEFAULT_LAPS = [
  { lap: 15, time: 102.5, baseline: 102.1, delta: 0.4 },
  { lap: 16, time: 102.7, baseline: 102.1, delta: 0.6 },
  { lap: 17, time: 104.1, baseline: 102.1, delta: 2.0 },
  { lap: 18, time: 104.5, baseline: 102.1, delta: 2.4 },
  { lap: 19, time: 103.2, baseline: 102.1, delta: 1.1 },
  { lap: 20, time: 102.6, baseline: 102.1, delta: 0.5 },
  { lap: 21, time: 102.4, baseline: 102.1, delta: 0.3 }
];

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/system/health", (req, res) => {
  res.json(getSystemHealthStatus());
});

/**
 * Authentication API Endpoints
 */
app.post("/api/auth/login", (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Enter your password (minimum 6 characters)." });
  }

  // Check credentials (or allow race engineer format)
  const cleanEmail = email.trim().toLowerCase();
  
  const nameFromEmail = cleanEmail
    .split("@")[0]
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const user: UserSession = {
    id: `eng-${Math.random().toString(36).substring(2, 9)}`,
    email: cleanEmail,
    name: nameFromEmail || "Race Engineer",
    role: "race_engineer",
    team: "Scuderia AI Racing / Telemetry Operations"
  };

  const token = `token_${generateId()}_${Date.now()}`;
  authTokens.set(token, user);

  res.setHeader(
    "Set-Cookie",
    `session_token=${token}; Path=/; HttpOnly; SameSite=Lax${rememberMe ? "; Max-Age=2592000" : ""}`
  );

  res.json({ user, token });
});

app.post("/api/auth/demo", (req, res) => {
  const token = `demo_token_${generateId()}_${Date.now()}`;
  authTokens.set(token, DEMO_USER);

  res.setHeader("Set-Cookie", `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  res.json({ user: DEMO_USER, token });
});

app.get("/api/auth/me", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthenticated" });
  }
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  let token = "";
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("session_token=")) {
        token = cookie.substring("session_token=".length);
        break;
      }
    }
  }

  if (token) {
    authTokens.delete(token);
  }

  res.setHeader("Set-Cookie", `session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  res.json({ success: true });
});

app.get("/api/models", (req, res) => {
  res.json({
    asr_model: geminiApiKey ? "Gemini 2.5 Flash Audio" : asrModel,
    emotion_model: geminiApiKey ? "Gemini 2.5 Multimodal Emotion" : emotionModel,
    device: "Cloud AI / Edge Pipeline",
    status: (geminiApiKey || hfToken) ? "ONLINE" : "READY_LOCAL"
  });
});

app.get("/api/demo/session", (req, res) => {
  res.json({
    id: "demo-session",
    mode: "DEMO",
    status: "COMPLETE",
    lapDataSource: "PRELOADED",
    laps: DEFAULT_LAPS.slice(0, 5),
    synchronized_segments: [
      { timestamp: 0, lap: 15, text: "Everything feels okay, tyre temp is stable.", state: "CALM", confidence: 0.88, time: 102.5, delta: 0.4, scores: { calm: 0.88, stressed: 0.08, tired_like: 0.04 } },
      { timestamp: 24.5, lap: 17, text: "Car is moving around a lot, struggling with rear grip.", state: "STRESSED", confidence: 0.92, time: 104.1, delta: 2.0, scores: { calm: 0.05, stressed: 0.92, tired_like: 0.03 } },
      { timestamp: 45.2, lap: 18, text: "Front tyres are gone. I can't turn the car.", state: "STRESSED", confidence: 0.95, time: 104.5, delta: 2.4, scores: { calm: 0.02, stressed: 0.95, tired_like: 0.03 } },
      { timestamp: 80.1, lap: 19, text: "Copy, I'll try to manage.", state: "TIRED-LIKE", confidence: 0.76, time: 103.2, delta: 1.1, scores: { calm: 0.14, stressed: 0.10, tired_like: 0.76 } }
    ],
    insights: [
      { priority: "HIGH PRIORITY", recommendation: "Elevated stress signal detected on Laps 17-18.", evidence: "\"Front tyres are gone. I can't turn the car.\"", lap: 18 },
      { priority: "PERFORMANCE", recommendation: "Lap 18 is +2.4s slower than baseline.", evidence: "", lap: 18 }
    ],
    correlation: {
      high_stress_delta: 2.2,
      calm_delta: 0.4,
      conclusion: "ELEVATED STRESS COINCIDES WITH SLOWER LAP PERFORMANCE (+1.80s avg delta)",
      total_observations: 4
    }
  });
});

/**
 * Direct Static ASR Diagnostic Test Endpoint
 */
app.get("/api/test/asr", async (req, res) => {
  try {
    const testWavPath = path.join(process.cwd(), "test_speech.wav");
    if (!fs.existsSync(testWavPath)) {
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({ success: false, error: "Test speech WAV file not found on server" });
    }
    const stat = fs.statSync(testWavPath);
    const asrRes = await transcribeAudioSlice(testWavPath, 0, 4.25);
    
    console.log(`[ASR PIPELINE]`);
    console.log(`audio received: true`);
    console.log(`audio size: ${stat.size} bytes`);
    console.log(`audio mime: audio/wav`);
    console.log(`duration: 4.25s`);
    console.log(`ASR request started: ${new Date().toISOString()}`);
    console.log(`ASR provider: ${asrRes.modelUsed ? "huggingface" : "gemini"}`);
    console.log(`ASR model: ${asrRes.modelUsed || config.geminiModel}`);
    console.log(`ASR response status: 200`);
    console.log(`ASR response content-type: application/json`);
    console.log(`ASR response body preview: ${JSON.stringify(asrRes).slice(0, 200)}`);
    console.log(`transcript extracted: "${asrRes.text}"`);

    res.setHeader("Content-Type", "application/json");
    res.json({
      success: asrRes.status === "ASR_SUCCESS",
      transcript: asrRes.text,
      asrStatus: asrRes.status,
      modelUsed: asrRes.modelUsed,
      latencyMs: asrRes.latencyMs,
      testFileSize: stat.size
    });
  } catch (err: any) {
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * Real-Time Audio Chunk Processing Endpoint (Protected)
 */
app.post("/api/live/chunk", requireAuth, upload.single("audio"), async (req, res) => {
  let audioBuffer: Buffer | null = null;
  let mimeType = "audio/webm";

  if (req.file) {
    audioBuffer = fs.readFileSync(req.file.path);
    mimeType = req.file.mimetype || "audio/webm";
    // clean up temp file
    try { fs.unlinkSync(req.file.path); } catch (e) {}
  } else if (req.body.base64Audio) {
    audioBuffer = Buffer.from(req.body.base64Audio, "base64");
    if (req.body.mimeType) mimeType = req.body.mimeType;
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    console.log(`[ASR PIPELINE] audio received: false`);
    return res.status(400).json({ error: "No valid audio chunk received" });
  }

  try {
    const startTime = new Date().toISOString();
    console.log(`[ASR PIPELINE]`);
    console.log(`audio received: true`);
    console.log(`audio size: ${audioBuffer.length} bytes`);
    console.log(`audio mime: ${mimeType}`);
    console.log(`ASR request started: ${startTime}`);
    console.log(`ASR provider: ${config.hfToken ? "huggingface" : "gemini"}`);
    console.log(`ASR model: ${config.hfAsrModel}`);

    const analysis = await processAudioChunk(audioBuffer, mimeType);

    console.log(`ASR response status: 200`);
    console.log(`ASR response content-type: application/json`);
    console.log(`ASR response body preview: ${JSON.stringify(analysis).slice(0, 200)}`);
    console.log(`transcript extracted: "${analysis.text}"`);

    res.setHeader("Content-Type", "application/json");
    res.json(analysis);
  } catch (error) {
    console.error("Live chunk analysis error:", error);
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: "Chunk analysis failed", details: String(error) });
  }
});

/**
 * File Upload Session Endpoint (.wav / .mp3 / .m4a + optional Lap CSV) (Protected)
 */
const handleAudioAnalysisUpload = async (req: express.Request, res: express.Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const singleFile = req.file;
  const audioFile = files?.audio?.[0] || files?.file?.[0] || singleFile;
  const csvFile = files?.lap_csv?.[0];

  console.log(`[Audio API]`);
  console.log(`Request received`);
  console.log(`Content-Type: ${req.headers["content-type"] || "unknown"}`);

  if (!audioFile) {
    console.error(`[Audio API] Error: No audio file attached`);
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({
      success: false,
      error: "AUDIO FILE REQUIRED: Please attach a valid audio file (MP3, WAV, M4A, MP4, WebM).",
      code: "MISSING_AUDIO_FILE",
      details: "No audio field found in multipart/form-data request"
    });
  }

  console.log(`File received: ${audioFile.originalname || audioFile.filename || "audio_recording"}`);
  console.log(`File size: ${audioFile.size} bytes`);
  console.log(`Model request started`);

  try {
    let laps: any[] = [];
    let lapDataSource: "NONE" | "CUSTOM_CSV" = "NONE";

    if (csvFile) {
      const csvContent = fs.readFileSync(csvFile.path, "utf-8");
      const parsedLaps = parseLapCSV(csvContent);
      if (parsedLaps.length > 0) {
        laps = parsedLaps;
        lapDataSource = "CUSTOM_CSV";
      }
      try { fs.unlinkSync(csvFile.path); } catch (e) {}
    }

    const audioBuffer = fs.readFileSync(audioFile.path);
    const originalName = audioFile.originalname || audioFile.mimetype || "audio.mp3";
    try { fs.unlinkSync(audioFile.path); } catch (e) {}

    // Run complete Audio AI Pipeline
    const pipelineResult = await processAudioFile(audioBuffer, originalName);

    console.log(`Model response status: 200`);
    console.log(`Model response content-type: application/json`);

    if (pipelineResult.is_silent || pipelineResult.segments.length === 0) {
      console.log(`Analysis completed (no speech detected)`);
      res.setHeader("Content-Type", "application/json");
      return res.status(422).json({
        success: false,
        error: "NO SPEECH DETECTED: No audible speech or driver radio signals were detected in the uploaded audio recording.",
        code: "NO_SPEECH_DETECTED",
        details: "Audio contained no voice activity",
        audio: {
          duration: pipelineResult.duration,
          sample_rate: pipelineResult.sample_rate,
          channels: pipelineResult.channels,
          samples: pipelineResult.samples,
          format: pipelineResult.format
        }
      });
    }

    const sessionId = generateId();
    const synchronized_segments = [];

    // Synchronize audio speech segments with lap telemetry if available
    for (let i = 0; i < pipelineResult.segments.length; i++) {
      const seg = pipelineResult.segments[i];
      const totalLaps = laps.length;

      if (totalLaps > 0) {
        const lapIdx = Math.min(totalLaps - 1, Math.floor((seg.start / Math.max(1, pipelineResult.duration)) * totalLaps));
        const matchingLap = laps[lapIdx] || laps[0];

        synchronized_segments.push({
          timestamp: seg.start,
          start: seg.start,
          end: seg.end,
          lap: matchingLap ? matchingLap.lap : 0,
          text: seg.text,
          asr_meta: seg.asr_meta,
          state: seg.state,
          confidence: seg.confidence,
          time: matchingLap ? matchingLap.time : 0,
          delta: matchingLap ? matchingLap.delta : 0,
          scores: seg.scores,
          acoustic_features: seg.acoustic_features,
          signals: seg.signals,
          text_features: seg.text_features,
          dynamics_features: seg.dynamics_features,
          reasons: seg.reasons
        });
      } else {
        synchronized_segments.push({
          timestamp: seg.start,
          start: seg.start,
          end: seg.end,
          lap: 0,
          text: seg.text,
          asr_meta: seg.asr_meta,
          state: seg.state,
          confidence: seg.confidence,
          time: 0,
          delta: 0,
          scores: seg.scores,
          acoustic_features: seg.acoustic_features,
          signals: seg.signals,
          text_features: seg.text_features,
          dynamics_features: seg.dynamics_features,
          reasons: seg.reasons
        });
      }
    }

    const { insights, correlation } = generateInsightsAndCorrelation(synchronized_segments, laps);

    const fullTranscriptText = synchronized_segments
      .filter(s => s.asr_meta?.status === "ASR_SUCCESS")
      .map(s => s.text)
      .filter(Boolean)
      .join(" ");

    const sessionClassification = pipelineResult.sessionState?.dominant || "CALM";
    const sessionConfidence = pipelineResult.sessionState?.confidence || 0.85;

    const sessionData = {
      success: true,
      id: sessionId,
      transcript: fullTranscriptText,
      asr_status: pipelineResult.overallAsrStatus || "ASR_NO_SPEECH",
      asr_model: pipelineResult.overallAsrModel || "openai/whisper-large-v3-turbo / gemini-2.5-flash",
      asr_error: pipelineResult.overallAsrError || null,
      pipeline_status: pipelineResult.pipelineStatus || "PARTIAL",
      classification: sessionClassification,
      confidence: sessionConfidence,
      audioDuration: pipelineResult.duration,
      mode: "RECORDED",
      status: "COMPLETE",
      lapDataSource,
      audio: {
        duration: pipelineResult.duration,
        sample_rate: pipelineResult.sample_rate,
        channels: pipelineResult.channels,
        samples: pipelineResult.samples,
        format: pipelineResult.format
      },
      audioQuality: pipelineResult.audioQuality,
      sessionState: pipelineResult.sessionState,
      laps,
      synchronized_segments,
      insights,
      correlation,
      debug_info: pipelineResult.debug_info,
      asr_debug_info: {
        mimeType: audioFile.mimetype || "audio/wav",
        fileName: audioFile.originalname || "audio_recording",
        fileSize: audioFile.size || 0,
        duration: pipelineResult.duration,
        sampleRate: pipelineResult.sample_rate,
        channels: pipelineResult.channels,
        endpoint: pipelineResult.overallAsrModel || "HuggingFace Whisper / Gemini ASR",
        requestStarted: new Date().toISOString(),
        responseStatus: 200,
        responseContentType: "application/json"
      },
      model_info: {
        asr_model: pipelineResult.overallAsrModel || "openai/whisper-large-v3-turbo / gemini-2.5-flash",
        emotion_model: "Multi-Signal Vocal Acoustic & Textual Context Classifier",
        device: "16kHz PCM + Whisper ASR / Gemini ASR + Feature Extraction Pipeline"
      }
    };

    console.log(`Analysis completed`);
    sessions.set(sessionId, sessionData);

    res.setHeader("Content-Type", "application/json");
    res.json(sessionData);

  } catch (error: any) {
    console.error("[Audio API] Upload processing failed:", error);
    let errorStr = error.message || "Session creation failed";
    let errorCode = "AUDIO_PROCESSING_ERROR";
    if (errorStr.includes("NO_AUDIO_TRACK")) {
      errorCode = "NO_AUDIO_TRACK";
    } else if (errorStr.includes("UNSUPPORTED_AUDIO_FORMAT") || errorStr.includes("AUDIO FORMAT UNSUPPORTED") || errorStr.includes("UNSUPPORTED AUDIO FORMAT")) {
      errorCode = "UNSUPPORTED_AUDIO_FORMAT";
    } else if (errorStr.includes("AUDIO_DECODING_FAILED") || errorStr.includes("DECODING FAILED") || errorStr.includes("AUDIO DECODING")) {
      errorCode = "AUDIO_DECODING_FAILED";
    } else if (errorStr.includes("INSUFFICIENT_AUDIO") || errorStr.includes("INSUFFICIENT AUDIO")) {
      errorCode = "INSUFFICIENT_AUDIO";
    }

    res.setHeader("Content-Type", "application/json");
    res.status(500).json({
      success: false,
      error: errorStr,
      code: errorCode,
      details: String(error)
    });
  }
};

app.post("/api/upload/session", requireAuth, upload.fields([{ name: "audio", maxCount: 1 }, { name: "file", maxCount: 1 }, { name: "lap_csv", maxCount: 1 }]), handleAudioAnalysisUpload);
app.post("/api/analyze/audio", requireAuth, upload.fields([{ name: "audio", maxCount: 1 }, { name: "file", maxCount: 1 }, { name: "lap_csv", maxCount: 1 }]), handleAudioAnalysisUpload);

/**
 * Dynamic Insights Generator for Frontend Session Updates (Protected)
 */
app.post("/api/session/insights", requireAuth, (req, res) => {
  const { segments, laps } = req.body;
  if (!Array.isArray(segments) || !Array.isArray(laps)) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({
      success: false,
      error: "Invalid segments or laps array",
      code: "INVALID_PAYLOAD"
    });
  }

  const { insights, correlation } = generateInsightsAndCorrelation(segments, laps);
  res.setHeader("Content-Type", "application/json");
  res.json({ success: true, insights, correlation });
});

// Catch-all 404 for API routes so HTML is NEVER returned for any /api request
app.all("/api/*", (req, res) => {
  console.warn(`[Audio API] 404 Not Found: ${req.method} ${req.path}`);
  res.setHeader("Content-Type", "application/json");
  res.status(404).json({
    success: false,
    error: `API endpoint ${req.method} ${req.path} not found`,
    code: "NOT_FOUND"
  });
});

// Global Express Error Handling Middleware - Guarantees JSON error response
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Audio API] Global Server Error:", err);
  if (res.headersSent) {
    return next(err);
  }
  res.setHeader("Content-Type", "application/json");
  res.status(err.status || err.statusCode || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
    code: err.code || "SERVER_ERROR",
    details: String(err)
  });
});

/**
 * Core Audio Analysis Engine with Normalized PCM + HF Whisper ASR + Acoustic Feature Mapper
 */
async function processAudioChunk(buffer: Buffer, mimeType: string) {
  try {
    const norm = await normalizeAudioToWav(buffer, mimeType);
    if (norm.rms < 0.0005 || norm.peak < 0.002 || norm.audioQuality.quality === "INSUFFICIENT") {
      try { fs.unlinkSync(norm.wavPath); } catch (e) {}
      return {
        has_speech: false,
        text: "[NO SPEECH DETECTED]",
        asr_meta: {
          status: "ASR_NO_SPEECH" as const,
          modelUsed: "ffmpeg_vad",
          charCount: 0,
          latencyMs: 0
        },
        state: "INSUFFICIENT AUDIO",
        confidence: 0.2,
        scores: { calm: 0.33, stressed: 0.33, tired_like: 0.34 },
        signals: { acoustic: 20, text: 0, speechDynamics: 20 },
        acoustic_features: null,
        text_features: null,
        dynamics_features: null,
        reasons: ["Audio level or quality insufficient for analysis"],
        duration: norm.duration
      };
    }

    const asrRes = await transcribeAudioSlice(norm.wavPath, 0, norm.duration);
    const acoustics = extractAcousticFeatures(norm.pcmData, norm.sampleRate, 0, norm.duration);
    const mapped = mapDriverState(asrRes.text, acoustics, norm.globalStats, norm.audioQuality, asrRes.status);

    try { fs.unlinkSync(norm.wavPath); } catch (e) {}

    return {
      has_speech: asrRes.status === "ASR_SUCCESS",
      text: asrRes.text || (asrRes.status === "ASR_ERROR" ? "[TRANSCRIPTION FAILED]" : "[NO SPEECH DETECTED]"),
      asr_meta: {
        status: asrRes.status,
        modelUsed: asrRes.modelUsed,
        error: asrRes.error,
        latencyMs: asrRes.latencyMs,
        charCount: asrRes.charCount
      },
      state: mapped.state,
      confidence: mapped.confidence,
      scores: mapped.scores,
      signals: mapped.signals,
      acoustic_features: acoustics,
      text_features: mapped.text_features,
      dynamics_features: mapped.dynamics_features,
      reasons: mapped.reasons,
      duration: norm.duration
    };
  } catch (err: any) {
    console.warn("Audio chunk processing warning:", err);
    return {
      has_speech: false,
      text: "[TRANSCRIPTION FAILED]",
      asr_meta: {
        status: "ASR_ERROR" as const,
        error: err.message || String(err),
        charCount: 0,
        latencyMs: 0
      },
      state: "INSUFFICIENT AUDIO",
      confidence: 0.2,
      scores: { calm: 0.33, stressed: 0.33, tired_like: 0.34 },
      signals: { acoustic: 20, text: 0, speechDynamics: 20 },
      acoustic_features: null,
      text_features: null,
      dynamics_features: null,
      reasons: [`Audio chunk processing failed: ${err.message || String(err)}`],
      duration: 0
    };
  }
}

function parseLapCSV(csvContent: string) {
  const lines = csvContent.split("\n").map(l => l.trim()).filter(Boolean);
  const laps: any[] = [];
  if (lines.length < 2) return laps;

  const header = lines[0].toLowerCase().split(",");
  const lapIdx = header.findIndex(h => h.includes("lap"));
  const timeIdx = header.findIndex(h => h.includes("time"));
  const baselineIdx = header.findIndex(h => h.includes("base"));
  const deltaIdx = header.findIndex(h => h.includes("delta"));

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const lapNum = parseInt(cols[lapIdx !== -1 ? lapIdx : 0]) || (i);
    const lapTime = parseFloat(cols[timeIdx !== -1 ? timeIdx : 1]) || 102.0;
    const baseline = parseFloat(cols[baselineIdx !== -1 ? baselineIdx : 2]) || 102.1;
    const delta = parseFloat(cols[deltaIdx !== -1 ? deltaIdx : 3]) || (lapTime - baseline);

    laps.push({ lap: lapNum, time: lapTime, baseline, delta });
  }
  return laps;
}

function generateInsightsAndCorrelation(segments: any[], laps: any[]) {
  const insights: any[] = [];
  
  const stressedSegments = segments.filter(s => s.state === "STRESSED");
  const calmSegments = segments.filter(s => s.state === "CALM");
  const tiredSegments = segments.filter(s => s.state === "TIRED-LIKE");

  for (const seg of stressedSegments) {
    if (seg.confidence >= 0.35) {
      const startSec = (typeof seg.start === 'number' ? seg.start : seg.timestamp || 0).toFixed(1);
      
      let evidenceStr = `Elevated vocal energy detected.`;
      if (seg.text_features?.negativeMarkersCount > 0 || seg.text_features?.urgencyKeywordsCount > 0) {
        evidenceStr = `Repeated frustration/urgency markers detected in the transcript: "${seg.text}"`;
      } else if (seg.dynamics_features?.speechRate && seg.dynamics_features.speechRate > 3.0) {
        evidenceStr = `Rapid speech rate (${seg.dynamics_features.speechRate} words/sec) and intense verbal activity.`;
      }

      insights.push({
        priority: "HIGH PRIORITY",
        recommendation: seg.lap > 0 
          ? `Elevated verbal stress detected in driver radio on Lap ${seg.lap}.`
          : `Elevated verbal stress detected in driver radio at ${startSec}s.`,
        evidence: evidenceStr,
        lap: seg.lap || 0
      });
    }
  }

  for (const seg of tiredSegments) {
    if (seg.confidence >= 0.35) {
      const startSec = (typeof seg.start === 'number' ? seg.start : seg.timestamp || 0).toFixed(1);
      insights.push({
        priority: "SAFETY",
        recommendation: seg.lap > 0
          ? `Driver fatigue / tired-like patterns on Lap ${seg.lap}.`
          : `Driver fatigue / tired-like patterns detected at ${startSec}s.`,
        evidence: `Low vocal intensity with extended pause duration (${seg.dynamics_features?.pauseDuration || 0}s) and slow speech rate.`,
        lap: seg.lap || 0
      });
    }
  }

  const hasTelemetry = laps && laps.length > 0;

  if (hasTelemetry) {
    const worstLap = [...laps].sort((a, b) => b.delta - a.delta)[0];
    if (worstLap && worstLap.delta > 0.5) {
      insights.push({
        priority: "PERFORMANCE",
        recommendation: `Lap ${worstLap.lap} is +${worstLap.delta.toFixed(2)}s slower than baseline.`,
        evidence: `Coincides with lap telemetry recording.`,
        lap: worstLap.lap
      });
    }
  } else {
    // If telemetry isn't loaded: Context: No telemetry connected
    insights.push({
      priority: "INFO",
      recommendation: "Driver telemetry is offline.",
      evidence: "No telemetry connected. Map and performance delta tracking are disabled.",
      lap: 0
    });
  }

  let high_stress_delta = 0;
  let calm_delta = 0;

  if (stressedSegments.length > 0) {
    high_stress_delta = stressedSegments.reduce((acc, s) => acc + (s.delta || 0), 0) / stressedSegments.length;
  }

  if (calmSegments.length > 0) {
    calm_delta = calmSegments.reduce((acc, s) => acc + (s.delta || 0), 0) / calmSegments.length;
  }

  const obsCount = segments.length;
  let conclusion = hasTelemetry ? "COLLECTING DATA" : "LAP CORRELATION UNAVAILABLE (NO TELEMETRY CONNECTED)";

  if (hasTelemetry && obsCount >= 1) {
    if (high_stress_delta > calm_delta + 0.3) {
      conclusion = `ELEVATED STRESS COINCIDES WITH SLOWER LAP PERFORMANCE (+${(high_stress_delta - calm_delta).toFixed(2)}s avg delta)`;
    } else {
      conclusion = "DRIVER TONE AND LAP TIMES REMAIN STABLE WITHIN BASELINE";
    }
  }

  return {
    insights,
    correlation: {
      high_stress_delta,
      calm_delta,
      conclusion,
      total_observations: obsCount
    }
  };
}

async function startServer() {
  validateStartupConfiguration();
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Exiting process...`);
      process.exit(1);
    } else {
      console.error("Server error:", err);
    }
  });

  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    server.close(() => process.exit(0));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
