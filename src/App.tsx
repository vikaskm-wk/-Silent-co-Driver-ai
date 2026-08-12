import React, { useState, useEffect, useRef } from 'react';
import { SessionData, ModelStatus, SynchronizedSegment, LapData, User } from './types';
import LapChart from './components/LapChart';
import Transcript from './components/Transcript';
import EngineerInsights, { DriverConditionPanel, EngineerInsightsCard } from './components/EngineerInsights';
import LiveWaveform from './components/LiveWaveform';
import LoginPage from './components/LoginPage';
import { AiPipelineHealthPanel } from './components/AiPipelineHealthPanel';
import { TranscriptionPanel } from './components/TranscriptionPanel';
import { AsrDebugDrawer } from './components/AsrDebugDrawer';
import { Radio, Mic, Upload, Activity, Zap, Play, Pause, Square, AlertCircle, FileText, CheckCircle2, RefreshCw, LogOut, UserCheck, Shield, PlusCircle, HelpCircle } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { normalizeSession } from './utils/normalizeSession';
import LocalErrorBoundary from './components/LocalErrorBoundary';

const DEFAULT_LAPS: LapData[] = [
  { lap: 15, time: 102.5, baseline: 102.1, delta: 0.4 },
  { lap: 16, time: 102.7, baseline: 102.1, delta: 0.6 },
  { lap: 17, time: 104.1, baseline: 102.1, delta: 2.0 },
  { lap: 18, time: 104.5, baseline: 102.1, delta: 2.4 },
  { lap: 19, time: 103.2, baseline: 102.1, delta: 1.1 },
  { lap: 20, time: 102.6, baseline: 102.1, delta: 0.5 },
  { lap: 21, time: 102.4, baseline: 102.1, delta: 0.3 }
];

async function safeFetchJson(url: string, options?: RequestInit) {
  try {
    const token = localStorage.getItem('session_token');
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });
    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      if (contentType.includes("application/json")) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Audio API failed (${res.status})`);
      } else {
        const text = await res.text().catch(() => "");
        throw new Error(`Audio API failed (${res.status}): ${text.slice(0, 300)}`);
      }
    }

    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      throw new Error(`Audio API returned non-JSON response (${contentType}): ${text.slice(0, 300)}`);
    }

    return await res.json();
  } catch (err: any) {
    console.warn(`API call warning (${url}):`, err.message || err);
    throw err;
  }
}

export default function App() {
  // Authentication & Routing State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [currentRoute, setCurrentRoute] = useState<'login' | 'dashboard'>('login');

  const [session, setSession] = useState<SessionData | null>(null);
  const [rawApiResponse, setRawApiResponse] = useState<any>(null);
  const [lastHttpStatus, setLastHttpStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<
    'IDLE' | 'FILE_SELECTED' | 'VALIDATING' | 'DECODING' | 'NORMALIZING' | 'VAD' | 'ASR' | 'FEATURE_ANALYSIS' | 'CLASSIFICATION' | 'COMPLETED' | 'ERROR'
  >('IDLE');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Live Radio Recording & Web Audio States
  const [isLiveRadioActive, setIsLiveRadioActive] = useState(false);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [isMicConnected, setIsMicConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [aiProcessingState, setAiProcessingState] = useState<'IDLE' | 'LISTENING' | 'ANALYSING' | 'ERROR'>('IDLE');
  const [liveDuration, setLiveDuration] = useState(0);
  const [customLaps, setCustomLaps] = useState<LapData[]>(DEFAULT_LAPS);
  const [lapSourceLabel, setLapSourceLabel] = useState<'PRELOADED' | 'CUSTOM_CSV'>('PRELOADED');

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const demoPlaybackTimerRef = useRef<number | null>(null);
  const virtualRadioTimerRef = useRef<number | null>(null);
  const currentLapIdxRef = useRef<number>(0);

  // File upload & audio player states and refs
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileMeta, setSelectedFileMeta] = useState<{
    name: string;
    durationStr: string;
    durationSec: number;
    format: string;
    sizeMB: string;
  } | null>(null);
  const [audioPlayerUrl, setAudioPlayerUrl] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    safeFetchJson('/api/models')
      .then(data => setModelStatus(data))
      .catch(() => {
        setModelStatus({
          asr_model: "Gemini 2.5 Flash Audio",
          emotion_model: "Gemini 2.5 Multimodal Emotion",
          device: "Cloud AI / Edge Pipeline",
          status: "ONLINE"
        });
      });

    return () => {
      cleanupLiveRadio();
      if (demoPlaybackTimerRef.current) clearInterval(demoPlaybackTimerRef.current);
    };
  }, []);

  // Check auth session on startup
  useEffect(() => {
    safeFetchJson('/api/auth/me')
      .then(data => {
        if (data && data.user) {
          setUser(data.user);
          setCurrentRoute('dashboard');
          if (window.location.pathname === '/login') {
            window.history.replaceState(null, '', '/dashboard');
          }
        } else {
          setUser(null);
          setCurrentRoute('login');
          if (window.location.pathname !== '/login') {
            window.history.replaceState(null, '', '/login');
          }
        }
      })
      .catch(() => {
        setUser(null);
        setCurrentRoute('login');
        if (window.location.pathname !== '/login') {
          window.history.replaceState(null, '', '/login');
        }
      })
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, []);

  // Sync browser back/forward buttons & URL path
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/login' && user) {
        window.history.replaceState(null, '', '/dashboard');
        setCurrentRoute('dashboard');
      } else if (path === '/dashboard' && !user) {
        window.history.replaceState(null, '', '/login');
        setCurrentRoute('login');
      } else if (path === '/login') {
        setCurrentRoute('login');
      } else if (path === '/dashboard') {
        setCurrentRoute('dashboard');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  const handleLoginSuccess = (authenticatedUser: User, token: string) => {
    localStorage.setItem('session_token', token);
    setUser(authenticatedUser);
    setCurrentRoute('dashboard');
    window.history.pushState(null, '', '/dashboard');
  };

  const handleLogout = async () => {
    try {
      await safeFetchJson('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn("Logout error:", e);
    } finally {
      localStorage.removeItem('session_token');
      cleanupLiveRadio();
      setUser(null);
      setSession(null);
      setCurrentRoute('login');
      window.history.pushState(null, '', '/login');
    }
  };

  // Timer for live radio session duration
  useEffect(() => {
    if (isLiveRadioActive && !isLivePaused) {
      liveTimerRef.current = window.setInterval(() => {
        setLiveDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    }
    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [isLiveRadioActive, isLivePaused]);

  const cleanupLiveRadio = () => {
    if (virtualRadioTimerRef.current) {
      clearInterval(virtualRadioTimerRef.current);
      virtualRadioTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close(); } catch (e) {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsMicConnected(false);
    setIsLiveRadioActive(false);
    setIsLivePaused(false);
    setIsSpeaking(false);
    setAiProcessingState('IDLE');
  };

  /**
   * START LIVE VIRTUAL RADIO MODE (Disabled - strictly real microphone required)
   */
  const startVirtualRadio = () => {
    cleanupLiveRadio();
    setErrorMessage('VIRTUAL SIMULATION DISABLED: Live radio requires an actual microphone input.');
  };

  /**
   * START LIVE MIC RADIO MODE
   */
  const startLiveRadio = async () => {
    cleanupLiveRadio();
    if (audioPlayerUrl) {
      URL.revokeObjectURL(audioPlayerUrl);
      setAudioPlayerUrl(null);
    }
    setErrorMessage(null);
    setAiProcessingState('IDLE');

    try {
      // 1. Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      setIsMicConnected(true);

      // 2. Initialize Web Audio API Analyser
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 3. VAD (Voice Activity Detection) loop
      const vadData = new Uint8Array(analyser.frequencyBinCount);
      const checkVAD = () => {
        if (!analyserRef.current || !mediaStreamRef.current) return;
        analyserRef.current.getByteFrequencyData(vadData);
        let sum = 0;
        for (let i = 0; i < vadData.length; i++) sum += vadData[i];
        const average = sum / vadData.length;
        setIsSpeaking(average > 18);
        if (mediaStreamRef.current && mediaStreamRef.current.active) {
          requestAnimationFrame(checkVAD);
        }
      };
      requestAnimationFrame(checkVAD);

      // 4. Initialize Live Session Data - STRICTLY ISOLATED FROM DEMO DATA
      const isCustomCsv = lapSourceLabel === 'CUSTOM_CSV';
      const initialSession: SessionData = {
        id: `live-${Date.now()}`,
        mode: 'LIVE',
        status: 'ACTIVE',
        lapDataSource: isCustomCsv ? 'CUSTOM_CSV' : 'NONE',
        laps: isCustomCsv ? customLaps : [],
        synchronized_segments: [],
        insights: [],
        correlation: {
          high_stress_delta: 0,
          calm_delta: 0,
          conclusion: isCustomCsv ? 'COLLECTING DATA (0 observations)' : 'Telemetry unavailable for live session.'
        }
      };

      setSession(initialSession);
      setIsLiveRadioActive(true);
      setIsLivePaused(false);
      setLiveDuration(0);
      currentLapIdxRef.current = 0;

      // 5. Setup MediaRecorder for chunk-based transmission (3.5 second chunks)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      let chunkBuffers: Blob[] = [];

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          chunkBuffers.push(e.data);
          const chunkBlob = new Blob(chunkBuffers, { type: mimeType });
          chunkBuffers = [];

          if (chunkBlob.size > 1000 && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            sendAudioChunkToBackend(chunkBlob, mimeType);
          }
        }
      };

      mediaRecorder.start(3500);

    } catch (err: any) {
      console.error('Microphone access error:', err);
      cleanupLiveRadio();
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('MICROPHONE ACCESS DENIED: Please grant microphone access in browser permissions to stream live radio.');
      } else if (err.name === 'NotFoundError' || err.message?.includes('not found') || err.message?.includes('Requested device')) {
        setErrorMessage('NO MICROPHONE DETECTED: An input microphone device is required for live radio streaming.');
      } else {
        setErrorMessage(`MICROPHONE ERROR: ${err.message || 'Unable to access audio input device.'}`);
      }
    }
  };

  /**
   * Process incoming audio chunk from microphone
   */
  const sendAudioChunkToBackend = async (blob: Blob, mimeType: string) => {
    setAiProcessingState('ANALYSING');

    try {
      const formData = new FormData();
      formData.append('audio', blob, 'chunk.webm');

      const data = await safeFetchJson('/api/live/chunk', {
        method: 'POST',
        body: formData,
      });

      setAiProcessingState('LISTENING');

      if (data && (data.has_speech || data.text || data.state)) {
        setSession(prev => {
          if (!prev) return prev;

          const currentLaps = prev.laps;
          const hasLaps = currentLaps && currentLaps.length > 0;
          const currentLapObj = hasLaps ? (currentLaps[currentLapIdxRef.current % currentLaps.length] || currentLaps[0]) : { lap: 0, time: 0, delta: 0 };
          
          if (hasLaps && prev.synchronized_segments.length > 0 && prev.synchronized_segments.length % 2 === 0) {
            currentLapIdxRef.current = (currentLapIdxRef.current + 1) % currentLaps.length;
          }

          const newTimestamp = liveDuration;
          const segDuration = data.duration || 3.5;
          const newSegment: SynchronizedSegment = {
            timestamp: newTimestamp,
            start: newTimestamp,
            end: newTimestamp + segDuration,
            lap: currentLapObj.lap,
            text: data.text || (data.has_speech ? "" : "[NO SPEECH DETECTED]"),
            asr_meta: data.asr_meta,
            state: data.state || "INSUFFICIENT AUDIO",
            confidence: data.confidence || 0,
            time: currentLapObj.time,
            delta: currentLapObj.delta,
            scores: data.scores || { calm: 0.33, stressed: 0.33, tired_like: 0.34 },
            acoustic_features: data.acoustic_features,
            signals: data.signals || { acoustic: 20, text: 0, speechDynamics: 20 },
            text_features: data.text_features,
            dynamics_features: data.dynamics_features,
            reasons: data.reasons || []
          };

          const updatedSegments = [...prev.synchronized_segments, newSegment];

          safeFetchJson('/api/session/insights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: updatedSegments, laps: prev.laps })
          })
            .then(resData => {
              if (resData.insights) {
                setSession(p => p ? { ...p, insights: resData.insights, correlation: resData.correlation } : p);
              }
            })
            .catch(console.error);

          setCurrentTime(newTimestamp);

          return {
            ...prev,
            synchronized_segments: updatedSegments
          };
        });
      }

    } catch (e: any) {
      console.error('Chunk transmission error:', e);
      setAiProcessingState('ERROR');
    }
  };

  const pauseLiveRadio = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsLivePaused(true);
      setAiProcessingState('IDLE');
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsLivePaused(false);
      setAiProcessingState('LISTENING');
    }
  };

  const stopLiveRadio = () => {
    cleanupLiveRadio();
    if (session) {
      setSession({
        ...session,
        status: 'COMPLETE'
      });
    }
  };

  /**
   * LOAD DEMO SESSION MODE
   */
  const loadDemo = async () => {
    cleanupLiveRadio();
    if (audioPlayerUrl) {
      URL.revokeObjectURL(audioPlayerUrl);
      setAudioPlayerUrl(null);
    }
    setSession(null);
    setErrorMessage(null);
    setLoading(true);
    setLoadingStep(1);

    const steps = [
      "RADIO INGESTION",
      "TRANSCRIPTION COMPLETE",
      "TONE ANALYSIS COMPLETE",
      "LAP SYNC COMPLETE",
      "INSIGHTS READY"
    ];

    for (let i = 0; i < steps.length; i++) {
      setLoadingMsg(steps[i]);
      await new Promise(r => setTimeout(r, 400));
      setLoadingStep(i + 2);
    }

    try {
      const rawData = await safeFetchJson('/api/demo/session');
      const sessionData = normalizeSession(rawData, "DEMO");
      setSession(sessionData);
      setCurrentTime(0);
    } catch (e) {
      console.error(e);
      setErrorMessage('Failed to load demo session data from server.');
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  /**
   * RECORDED AUDIO FILE SELECTION (.wav / .mp3 / .m4a)
   */
  /**
   * RECORDED AUDIO FILE SELECTION (.wav / .mp3 / .m4a)
   */
  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (audioPlayerUrl) {
      URL.revokeObjectURL(audioPlayerUrl);
      setAudioPlayerUrl(null);
    }
    setSession(null);
    setErrorMessage(null);
    setAnalysisError(null);
    setSelectedFile(file);
    setAnalysisStatus('FILE_SELECTED');

    const objectUrl = URL.createObjectURL(file);
    const tempAudio = new Audio();
    tempAudio.src = objectUrl;

    tempAudio.onloadedmetadata = () => {
      const dur = tempAudio.duration || 0;
      const mins = Math.floor(dur / 60);
      const secs = Math.floor(dur % 60);
      const durationStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      const ext = file.name.split('.').pop()?.toUpperCase() || 'MP3';
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

      setSelectedFileMeta({
        name: file.name,
        durationStr,
        durationSec: dur,
        format: ext,
        sizeMB
      });
      URL.revokeObjectURL(objectUrl);
    };

    tempAudio.onerror = () => {
      const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      setSelectedFileMeta({
        name: file.name,
        durationStr: '--:--',
        durationSec: 0,
        format: ext,
        sizeMB
      });
      URL.revokeObjectURL(objectUrl);
    };
  };

  /**
   * RUN AUDIO AI PIPELINE (FFmpeg -> VAD -> Whisper ASR -> Acoustic Mapping -> Insights)
   */
  const runAudioAnalysis = async (fileToProcess?: File) => {
    const file = fileToProcess || selectedFile;
    if (!file) {
      setErrorMessage("No file selected.");
      setAnalysisError("No file selected.");
      setAnalysisStatus('ERROR');
      return;
    }

    cleanupLiveRadio();
    if (audioPlayerUrl) {
      URL.revokeObjectURL(audioPlayerUrl);
      setAudioPlayerUrl(null);
    }
    setSession(null);
    setRawApiResponse(null);
    setErrorMessage(null);
    setAnalysisError(null);

    // 1. VALIDATING
    setAnalysisStatus('VALIDATING');
    setProgressPercent(10);
    setProgressMsg('UPLOADING AUDIO / VALIDATING FILE');

    if (file.size === 0) {
      setErrorMessage("UNSUPPORTED AUDIO FORMAT");
      setAnalysisError("UNSUPPORTED AUDIO FORMAT");
      setAnalysisStatus('ERROR');
      return;
    }

    const supportedExts = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.aac', '.flac'];
    const fileNameLower = file.name.toLowerCase();
    const isSupportedExt = supportedExts.some(ext => fileNameLower.endsWith(ext));
    const isSupportedMime = file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type === 'application/octet-stream';

    if (!isSupportedExt && !isSupportedMime) {
      setErrorMessage("UNSUPPORTED AUDIO FORMAT");
      setAnalysisError("UNSUPPORTED AUDIO FORMAT");
      setAnalysisStatus('ERROR');
      return;
    }

    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      setErrorMessage("AUDIO FILE TOO LARGE");
      setAnalysisError("AUDIO FILE TOO LARGE");
      setAnalysisStatus('ERROR');
      return;
    }

    try {
      // 2. DECODING
      setAnalysisStatus('DECODING');
      setProgressPercent(25);
      setProgressMsg('DECODING AUDIO WITH BROWSER AUDIOCONTEXT');

      let audioBuffer: AudioBuffer | null = null;
      let duration = 5.0; // default for fallback
      let sampleRate = 16000; // default for fallback
      let numberOfChannels = 1; // default for fallback
      let pcmRms = 0.01;  // default for fallback
      const rmsThreshold = 0.0005;

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const tempCtx = new AudioCtx();
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close();

        if (audioBuffer) {
          duration = audioBuffer.duration;
          sampleRate = audioBuffer.sampleRate;
          numberOfChannels = audioBuffer.numberOfChannels;

          if (duration > 0 && sampleRate > 0 && numberOfChannels > 0) {
            const channelData = audioBuffer.getChannelData(0);
            if (channelData && channelData.length > 0) {
              // Valid browser decode!
              for (let i = 0; i < Math.min(1000, channelData.length); i++) {
                const s = channelData[i];
                if (typeof s !== 'number' || !Number.isFinite(s) || Number.isNaN(s)) {
                  throw new Error("INVALID_AUDIO_BUFFER");
                }
              }

              // 8. NORMALIZING & PCM VALIDATION
              setAnalysisStatus('NORMALIZING');
              setProgressPercent(35);
              setProgressMsg('NORMALIZING & VALIDATING PCM DATA');

              // 9. VAD
              setAnalysisStatus('VAD');
              setProgressPercent(45);
              setProgressMsg('DETECTING DRIVER SPEECH ACTIVITY (VAD)');

              const checkLen = Math.min(channelData.length, 320000);
              let sumSq = 0;
              for (let i = 0; i < checkLen; i++) {
                sumSq += channelData[i] * channelData[i];
              }
              pcmRms = Math.sqrt(sumSq / checkLen);
            }
          }
        }
      } catch (decodeErr) {
        console.warn("Browser decoding failed or skipped (falling back to server-side FFmpeg):", decodeErr);
        // Do not crash or block. Server side FFmpeg will normalize and process everything securely!
        duration = 5.0; // dummy value to pass local check
        pcmRms = 0.01;  // dummy value to pass local check
      }

      if (duration < 0.4) {
        throw new Error("INSUFFICIENT AUDIO");
      }

      if (pcmRms < rmsThreshold) {
        // No speech detected / silent audio
        setAnalysisStatus('COMPLETED');
        setProgressPercent(100);
        setProgressMsg('COMPLETE');
        
        setSession({
          id: `session-silent-${Date.now()}`,
          mode: 'RECORDED',
          status: 'COMPLETE',
          lapDataSource: csvFileInputRef.current?.files?.[0] ? 'CUSTOM_CSV' : 'NONE',
          laps: customLaps,
          synchronized_segments: [],
          insights: [],
          correlation: {
            high_stress_delta: 0,
            calm_delta: 0,
            conclusion: 'NO SPEECH DETECTED',
            total_observations: 0
          }
        });
        return;
      }

      // 11. ASR (Whisper request to server)
      setAnalysisStatus('ASR');
      setProgressPercent(60);
      setProgressMsg('TRANSCRIBING SPEECH WITH WHISPER ASR');

      const formData = new FormData();
      formData.append('audio', file);

      if (csvFileInputRef.current?.files?.[0]) {
        formData.append('lap_csv', csvFileInputRef.current.files[0]);
      }

      console.log("[UPLOAD] file name:", file.name, "file size:", file.size, "MIME type:", file.type);
      console.log("[DECODE] duration:", duration, "sample rate:", sampleRate, "channels:", numberOfChannels);

      const token = localStorage.getItem('session_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/upload/session', {
        method: 'POST',
        headers,
        body: formData
      });

      const contentType = res.headers.get("content-type") || "";
      console.log("[ASR] HTTP status:", res.status, "Content-Type:", contentType);

      if (!res.ok) {
        if (res.status === 422 && contentType.includes("application/json")) {
          // Empty or silent audio on server
          setAnalysisStatus('COMPLETED');
          setProgressPercent(100);
          setProgressMsg('COMPLETE');
          setSession({
            id: `session-silent-${Date.now()}`,
            mode: 'RECORDED',
            status: 'COMPLETE',
            lapDataSource: csvFileInputRef.current?.files?.[0] ? 'CUSTOM_CSV' : 'NONE',
            laps: customLaps,
            synchronized_segments: [],
            insights: [],
            correlation: {
              high_stress_delta: 0,
              calm_delta: 0,
              conclusion: 'NO SPEECH DETECTED',
              total_observations: 0
            }
          });
          return;
        }

        if (contentType.includes("application/json")) {
          const rawErr = await res.json().catch(() => null);
          throw new Error(rawErr?.error || rawErr?.message || `Audio API failed (${res.status})`);
        } else {
          const text = await res.text().catch(() => "");
          throw new Error(`Audio API failed (${res.status}): ${text.slice(0, 300)}`);
        }
      }

      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`Audio API returned non-JSON response (${contentType}): ${text.slice(0, 300)}`);
      }

      const rawSession = await res.json();
      console.log("[ASR] response parsed:", rawSession);

      // FEATURE_ANALYSIS
      setAnalysisStatus('FEATURE_ANALYSIS');
      setProgressPercent(80);
      setProgressMsg('EXTRACTING ACOUSTIC & SPECTRAL FEATURES');

      // CLASSIFICATION
      setAnalysisStatus('CLASSIFICATION');
      setProgressPercent(90);
      setProgressMsg('CLASSIFYING DRIVER COGNITIVE STATE');

      await new Promise(r => setTimeout(r, 400));

      const sessionData = normalizeSession(rawSession, "RECORDED");

      // Log features
      if (sessionData.synchronized_segments.length > 0) {
        const firstSeg = sessionData.synchronized_segments[0];
        console.log("[FEATURES] RMS:", firstSeg.acoustic_features?.rms, "Peak:", firstSeg.acoustic_features?.peak, "ZCR:", firstSeg.acoustic_features?.zcr, "Speech duration:", firstSeg.acoustic_features?.duration);
        console.log("[CLASSIFIER] acoustic score:", firstSeg.signals?.acoustic, "text score:", firstSeg.signals?.text, "dynamics score:", firstSeg.signals?.speechDynamics, "final state:", firstSeg.state);
      }

      setAnalysisStatus('COMPLETED');
      setProgressPercent(100);
      setProgressMsg('COMPLETE');

      const playerUrl = URL.createObjectURL(file);
      setAudioPlayerUrl(playerUrl);
      setRawApiResponse(rawSession);
      setSession(sessionData);
      setCurrentTime(0);
      setSelectedFile(null);
      setSelectedFileMeta(null);

      console.log("[COMPLETE]");

    } catch (err: any) {
      console.error("[ERROR] Audio analysis failed:", err);
      let errMsg = err.message || String(err);
      if (errMsg.includes("UNSUPPORTED_AUDIO_FORMAT") || errMsg.includes("AUDIO FORMAT UNSUPPORTED") || errMsg.includes("UNSUPPORTED AUDIO FORMAT")) {
        errMsg = "UNSUPPORTED AUDIO FORMAT";
      } else if (errMsg.includes("NO_AUDIO_TRACK") || errMsg.includes("NO AUDIO TRACK FOUND") || errMsg.includes("NO AUDIO TRACK")) {
        errMsg = "NO AUDIO TRACK FOUND";
      } else if (errMsg.includes("AUDIO_DECODING_FAILED") || errMsg.includes("DECODING FAILED") || errMsg.includes("AUDIO DECODING")) {
        errMsg = "AUDIO DECODING FAILED";
      } else if (errMsg.includes("AUDIO_NORMALIZATION_FAILED") || errMsg.includes("NORMALIZATION FAILED")) {
        errMsg = "AUDIO NORMALIZATION FAILED";
      } else if (errMsg.includes("NO_SPEECH_DETECTED") || errMsg.includes("NO SPEECH DETECTED")) {
        errMsg = "NO SPEECH DETECTED";
      } else if (errMsg.includes("ASR_ERROR") || errMsg.includes("Whisper") || errMsg.includes("transcrib") || errMsg.includes("ASR")) {
        errMsg = "ASR ERROR";
      } else if (errMsg.includes("INVALID_AUDIO_BUFFER")) {
        errMsg = "INVALID_AUDIO_BUFFER";
      } else if (errMsg.includes("INSUFFICIENT AUDIO") || errMsg.includes("duration") || errMsg.includes("short")) {
        errMsg = "INSUFFICIENT AUDIO";
      }
      setErrorMessage(errMsg);
      setAnalysisError(errMsg);
      setAnalysisStatus('ERROR');
    } finally {
      if (audioFileInputRef.current) audioFileInputRef.current.value = '';
    }
  };

  const handleResetSession = () => {
    cleanupLiveRadio();
    setSession(null);
    setRawApiResponse(null);
    setSelectedFile(null);
    setSelectedFileMeta(null);
    setErrorMessage(null);
    setAnalysisError(null);
    setAnalysisStatus('IDLE');
  };

  /**
   * Direct upload compatibility helper
   */
  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleAudioFileSelect(e);
  };

  /**
   * LAP CSV UPLOAD
   */
  const handleLapCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
        const parsed: LapData[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          if (cols.length >= 2) {
            parsed.push({
              lap: parseInt(cols[0]) || i,
              time: parseFloat(cols[1]) || 102.0,
              baseline: parseFloat(cols[2]) || 102.1,
              delta: parseFloat(cols[3]) || (parseFloat(cols[1]) - 102.1)
            });
          }
        }
        if (parsed.length > 0) {
          setCustomLaps(parsed);
          setLapSourceLabel('CUSTOM_CSV');
          if (session) {
            setSession({ ...session, laps: parsed, lapDataSource: 'CUSTOM_CSV' });
          }
        }
      }
    };
    reader.readAsText(file);
  };

  const startDemoPlayback = () => {
    if (!session) return;
    setIsPlaying(true);
    demoPlaybackTimerRef.current = window.setInterval(() => {
      setCurrentTime(prev => {
        const maxTime = Math.max(100, ...session.synchronized_segments.map(s => s.timestamp)) + 10;
        if (prev >= maxTime) {
          stopDemoPlayback();
          return 0;
        }
        return prev + 0.2;
      });
    }, 200);
  };

  const stopDemoPlayback = () => {
    setIsPlaying(false);
    if (demoPlaybackTimerRef.current) {
      clearInterval(demoPlaybackTimerRef.current);
      demoPlaybackTimerRef.current = null;
    }
  };

  const togglePlayback = () => {
    if (!session) return;

    if (audioPlayerUrl && audioPlayerRef.current) {
      if (isPlaying) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.play().catch(e => console.error("Audio playback error:", e));
        setIsPlaying(true);
      }
    } else {
      if (isPlaying) {
        stopDemoPlayback();
      } else {
        startDemoPlayback();
      }
    }
  };

  const handleSegmentClick = (time: number) => {
    setCurrentTime(time);
    const segment = session?.synchronized_segments.find(s => Math.abs(s.timestamp - time) < 2);
    if (segment) {
      setSelectedLap(segment.lap);
    }

    if (audioPlayerUrl && audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = time;
      audioPlayerRef.current.play().catch(e => console.error("Seek play error:", e));
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const activeSegment = session?.synchronized_segments.find((s, i, arr) => {
    const nextTime = arr[i + 1]?.timestamp || Infinity;
    return currentTime >= s.timestamp && currentTime < nextTime;
  }) || session?.synchronized_segments[session.synchronized_segments.length - 1];

  // Auth checking state
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#0B0D10] text-white flex flex-col items-center justify-center font-mono select-none">
        <div className="w-8 h-8 border-2 border-racing-red border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-xs uppercase tracking-widest text-text-muted">INITIALIZING TELEMETRY SESSION...</div>
      </div>
    );
  }

  const isAnalyzing = [
    'VALIDATING', 'DECODING', 'NORMALIZING', 'VAD', 'ASR', 'FEATURE_ANALYSIS', 'CLASSIFICATION'
  ].includes(analysisStatus);

  const getStepIndex = () => {
    switch (analysisStatus) {
      case 'VALIDATING': return 0;
      case 'DECODING':
      case 'NORMALIZING': return 1;
      case 'VAD': return 2;
      case 'ASR': return 3;
      case 'FEATURE_ANALYSIS':
      case 'CLASSIFICATION': return 4;
      default: return -1;
    }
  };

  // Unauthenticated user -> render Login Page
  if (!user || currentRoute === 'login') {
    return <LoginPage onLoginSuccess={handleLoginSuccess} modelStatus={modelStatus} />;
  }

  return (
    <div className="min-h-screen bg-base text-text-primary flex flex-col font-sans selection:bg-racing-red selection:text-white">
      {/* Hidden Audio Player for Real MP3/WAV Playback */}
      <audio 
        ref={audioPlayerRef} 
        src={audioPlayerUrl || undefined} 
        onTimeUpdate={() => {
          if (audioPlayerRef.current) {
            setCurrentTime(audioPlayerRef.current.currentTime);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {/* Hidden File Inputs */}
      <input 
        type="file" 
        ref={audioFileInputRef} 
        onChange={handleAudioFileUpload} 
        accept=".wav,.mp3,.m4a,audio/wav,audio/mp3,audio/mpeg,audio/m4a,audio/x-m4a,audio/mp4" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={csvFileInputRef} 
        onChange={handleLapCSVUpload} 
        accept=".csv" 
        className="hidden" 
      />

      {/* Header */}
      <header className="bg-[#111417] border-b border-[#20252B] shrink-0">
        <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 h-16 sm:h-17 flex items-center justify-between">
          {/* Left Header */}
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F2F4F7] leading-none flex items-center gap-2.5 font-sans">
                <span className="whitespace-nowrap">SILENT CO-DRIVER <span className="text-[#E53935]">AI</span></span>
                {session && (
                  <span className={`text-xs px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                    session.mode === 'LIVE' ? 'bg-[#E53935]/10 text-[#E53935] border border-[#E53935]/25' :
                    session.mode === 'RECORDED' ? 'bg-[#E3A43B]/10 text-[#E3A43B] border border-[#E3A43B]/25' :
                    'bg-[#15191D] text-[#A7AFB9] border border-[#292F35]'
                  }`}>
                    {session.mode} SESSION
                  </span>
                )}
              </h1>
              <p className="text-xs sm:text-sm text-[#707984] mt-1 font-normal leading-none">Driver Intelligence & Radio Analysis</p>
            </div>
          </div>

          {/* Center & Right Navigation Controls */}
          <div className="flex items-center gap-4 sm:gap-6 text-sm">
            <button 
              onClick={() => audioFileInputRef.current?.click()}
              className="font-medium text-[#A7AFB9] hover:text-[#F2F4F7] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Upload Driver Radio (.wav, .mp3, .m4a)"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden md:inline">Upload Audio</span>
            </button>
            <button 
              onClick={() => csvFileInputRef.current?.click()}
              className="font-medium text-[#A7AFB9] hover:text-[#F2F4F7] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Upload Custom Lap CSV"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden md:inline">Upload Lap CSV</span>
            </button>
            <button 
              onClick={loadDemo}
              className="font-semibold text-[#A7AFB9] hover:text-[#F2F4F7] transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-4 h-4 text-[#E3A43B]" />
              <span className="hidden md:inline">Load Demo</span>
            </button>

            {session && (
              <button 
                onClick={() => { cleanupLiveRadio(); setSession(null); setErrorMessage(null); }}
                className="px-3.5 py-1.5 min-h-[36px] bg-[#E53935] hover:bg-[#F04A46] text-white font-semibold text-xs sm:text-sm rounded-md transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>New Session</span>
              </button>
            )}

            {/* AI Status Badge & User Logout */}
            {user && (
              <div className="flex items-center gap-3 border-l border-[#20252B] pl-4 ml-1 shrink-0">
                <div className="flex items-center gap-1.5 bg-[#15191D] border border-[#292F35] px-3 py-1 rounded-md text-xs sm:text-sm font-semibold text-[#35C98A]">
                  <span className="w-2 h-2 rounded-full bg-[#35C98A]"></span>
                  <span>● AI READY</span>
                </div>
                <div className="flex flex-col text-right leading-tight hidden sm:flex">
                  <span className="text-sm font-semibold text-[#F2F4F7]">{user.name}</span>
                  <span className="text-xs text-[#707984]">
                    {user.role === 'race_engineer' ? 'Race Engineer' : user.role}
                  </span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="text-xs sm:text-sm font-semibold text-[#E53935] hover:text-[#F04A46] transition-colors border border-[#E53935]/25 bg-[#E53935]/10 hover:bg-[#E53935]/14 px-3.5 py-1.5 min-h-[38px] rounded-md flex items-center gap-1.5 cursor-pointer"
                  title="Sign out of Race Engineer session"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Error Message Alert */}
      {errorMessage && (
        <div className="bg-[#E53935]/10 border-b border-[#E53935]/25 px-6 py-3 flex items-center justify-between text-xs sm:text-sm text-[#E53935]">
          <div className="w-full max-w-[1280px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              {(errorMessage.includes('MICROPHONE') || errorMessage.includes('HARDWARE')) && (
                <button 
                  onClick={startVirtualRadio} 
                  className="bg-[#E53935]/20 hover:bg-[#E53935]/30 px-3 py-1 rounded-md text-[#F1F3F5] font-semibold text-xs transition-colors border border-[#E53935]/30 cursor-pointer"
                >
                  Launch Virtual Radio Stream
                </button>
              )}
              <button 
                onClick={() => setErrorMessage(null)} 
                className="text-[#E53935] font-bold hover:underline cursor-pointer"
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
      )}

      {!session ? (
        /* LANDING & SESSION LAUNCH PAD */
        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 bg-[#0D0F12] relative">
          <div className="w-full max-w-[1140px] mx-auto flex flex-col items-center text-center">
            
            {/* Subtle Radio Icon */}
            <div className="mb-4 flex justify-center">
              <div className="w-10 h-10 border border-[#292E35] rounded-md bg-[#13161A] flex items-center justify-center text-[#E53935]">
                <Radio className="w-5 h-5" />
              </div>
            </div>

            {/* Hero Title */}
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F1F3F5] mb-3 font-sans">
              Silent Co-Driver <span className="text-[#E53935]">AI</span>
            </h1>
            <p className="text-sm sm:text-base text-[#A6ADB7] mb-10 max-w-2xl font-normal leading-relaxed">
              Listen to what the lap times can't hear. Near-real-time ASR & vocal acoustic tone classification.
            </p>

            {isAnalyzing ? (
              <div className="w-full max-w-xl bg-[#13161A] border border-[#292F35] p-6 sm:p-8 rounded-lg text-left shadow-lg">
                <div className="flex justify-between text-xs font-semibold text-[#A6ADB7] mb-4 uppercase tracking-wider font-mono">
                  <span>{progressMsg || 'SYSTEM INITIALIZATION'}</span>
                  <span>{progressPercent}%</span>
                </div>
                {/* Visual Progress Bar */}
                <div className="w-full h-1.5 bg-[#252B31] rounded-full overflow-hidden mb-6">
                  <div className="h-full bg-[#E53935] transition-all duration-300" style={{ width: `${progressPercent}%` }}></div>
                </div>
                <div className="space-y-4">
                  {[
                    "Validating Audio File",
                    "Decoding & Normalizing Audio",
                    "Detecting Speech Activity (VAD)",
                    "Transcribing Speech (Whisper ASR)",
                    "Analyzing Driver State (Acoustics & Tone)"
                  ].map((step, idx) => {
                    const stepIdx = getStepIndex();
                    const isDone = stepIdx > idx;
                    const isCurrent = stepIdx === idx;
                    return (
                      <div key={idx} className="flex items-center gap-4">
                        <div className={twMerge(
                          "w-2 h-2 rounded-full",
                          isDone ? "bg-[#27C985]" : isCurrent ? "bg-[#E5A93D] animate-pulse" : "bg-[#292E35]"
                        )}></div>
                        <span className={twMerge(
                          "text-xs font-medium font-sans",
                          isDone ? "text-[#F1F3F5]" : isCurrent ? "text-[#E5A93D]" : "text-[#A6ADB7]"
                        )}>
                          {step}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : loading ? (
              <div className="w-full max-w-xl bg-[#13161A] border border-[#292E35] p-6 sm:p-8 rounded-lg text-left shadow-lg">
                <div className="flex justify-between text-xs font-semibold text-[#A6ADB7] mb-6 uppercase tracking-wider">
                  <span>{loadingMsg || 'SYSTEM INITIALIZATION'}</span>
                  <span>{Math.round((loadingStep / 5) * 100)}%</span>
                </div>
                <div className="space-y-4">
                  {["Radio Ingestion", "Speech Transcription", "Acoustic Tone Analysis", "Telemetry Lap Sync", "Engineer Insight Generation"].map((step, idx) => (
                    <div key={idx} className="flex items-center gap-4">
                      <div className={twMerge("w-2 h-2 rounded-full", loadingStep > idx ? "bg-[#27C985]" : loadingStep === idx ? "bg-[#E5A93D] animate-pulse" : "bg-[#292E35]")}></div>
                      <span className={twMerge("text-xs font-medium", loadingStep > idx ? "text-[#F1F3F5]" : loadingStep === idx ? "text-[#E5A93D]" : "text-[#A6ADB7]")}>
                        {step}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : analysisStatus === 'ERROR' ? (
              <div className="w-full max-w-xl bg-[#13161A] border border-[#E53935]/30 p-6 sm:p-8 rounded-lg text-left shadow-lg">
                <div className="flex items-center gap-3 mb-4 text-[#E53935]">
                  <AlertCircle className="w-6 h-6" />
                  <h3 className="text-sm font-bold tracking-wider uppercase font-mono">ANALYSIS ERROR</h3>
                </div>
                <p className="text-sm text-[#F1F3F5] mb-6 leading-relaxed">
                  Audio processing failed: <span className="font-semibold text-[#E53935]">{errorMessage || 'An unexpected error occurred.'}</span>
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => runAudioAnalysis()}
                    className="flex-1 py-2.5 bg-[#E53935] hover:bg-[#F04A46] text-white font-bold text-xs uppercase tracking-widest rounded transition-colors cursor-pointer"
                  >
                    [ RETRY ANALYSIS ]
                  </button>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setSelectedFileMeta(null);
                      setErrorMessage(null);
                      setAnalysisStatus('IDLE');
                    }}
                    className="flex-1 py-2.5 bg-[#1C2025] hover:bg-[#252B31] text-[#A6ADB7] hover:text-white font-bold text-xs uppercase tracking-widest rounded border border-[#292F35] transition-colors cursor-pointer"
                  >
                    [ START NEW SESSION ]
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6 w-full max-w-3xl">
                {/* 3-Option Mode Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* START LIVE MIC */}
                  <button 
                    onClick={startLiveRadio}
                    className="p-5 bg-[#E53935] hover:bg-[#F04440] rounded-md flex flex-col items-center justify-center gap-1.5 transition-all shadow-md group text-white cursor-pointer"
                  >
                    <Mic className="w-5 h-5 text-white group-hover:scale-105 transition-transform" />
                    <span className="font-semibold text-sm">START LIVE MIC</span>
                    <span className="text-xs text-white/80 font-normal">Microphone Input</span>
                  </button>

                  {/* VIRTUAL RADIO */}
                  <button 
                    onClick={startVirtualRadio}
                    className="p-5 bg-[#13161A] hover:bg-[#181C21] border border-[#292E35] rounded-md flex flex-col items-center justify-center gap-1.5 transition-all shadow-sm group cursor-pointer"
                  >
                    <Radio className="w-5 h-5 text-[#E53935] group-hover:scale-105 transition-transform" />
                    <span className="font-semibold text-sm text-[#F1F3F5]">VIRTUAL RADIO</span>
                    <span className="text-xs text-[#A6ADB7] font-normal">Simulated Stream</span>
                  </button>

                  {/* DEMO SESSION */}
                  <button 
                    onClick={loadDemo}
                    className="p-5 bg-[#13161A] hover:bg-[#181C21] border border-[#292E35] rounded-md flex flex-col items-center justify-center gap-1.5 transition-all shadow-sm group cursor-pointer"
                  >
                    <Zap className="w-5 h-5 text-[#E5A93D] group-hover:scale-105 transition-transform" />
                    <span className="font-semibold text-sm text-[#F1F3F5]">DEMO SESSION</span>
                    <span className="text-xs text-[#A6ADB7] font-normal">Preloaded Multi-Lap</span>
                  </button>
                </div>

                {/* Recorded File Mode / Selected File Box */}
                {selectedFileMeta ? (
                  <div className="p-5 bg-[#13161A] border border-[#E5A93D]/40 rounded-md flex flex-col gap-4 text-left shadow-lg">
                    <div className="flex items-center justify-between border-b border-[#292E35] pb-3">
                      <div className="flex items-center gap-2">
                        <Upload className="w-4 h-4 text-[#E5A93D]" />
                        <span className="text-xs font-semibold text-[#F1F3F5] uppercase tracking-wider">
                          SELECTED AUDIO FILE FOR AI PIPELINE
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-[#27C985] px-2 py-0.5 rounded bg-[#27C985]/10 border border-[#27C985]/20">
                        READY FOR AI ANALYSIS
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0D0F12] p-3 rounded border border-[#292E35]">
                      <div>
                        <span className="text-[11px] text-[#A6ADB7] block">FILE NAME</span>
                        <span className="text-xs font-semibold text-[#F1F3F5] truncate block">{selectedFileMeta.name}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#A6ADB7] block">DURATION</span>
                        <span className="text-xs font-semibold text-[#F1F3F5] block">{selectedFileMeta.durationStr}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#A6ADB7] block">FORMAT</span>
                        <span className="text-xs font-semibold text-[#F1F3F5] block">{selectedFileMeta.format}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[#A6ADB7] block">SIZE</span>
                        <span className="text-xs font-semibold text-[#F1F3F5] block">{selectedFileMeta.sizeMB}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button 
                        onClick={() => csvFileInputRef.current?.click()}
                        className="text-xs font-medium text-[#A6ADB7] hover:text-[#F1F3F5] transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{lapSourceLabel === 'CUSTOM_CSV' ? '✓ Custom CSV Attached' : '+ Attach Lap CSV'}</span>
                      </button>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setSelectedFile(null); setSelectedFileMeta(null); }}
                          className="px-3 py-2 bg-[#181C21] hover:bg-[#22272E] text-xs font-medium text-[#A6ADB7] rounded transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => runAudioAnalysis()}
                          className="px-5 py-2 bg-[#E53935] hover:bg-[#F04440] text-xs font-bold text-white rounded shadow transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <Zap className="w-4 h-4 fill-current" />
                          <span>RUN AI ANALYSIS</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-[#13161A] border border-[#292E35] rounded-md flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                    <div>
                      <p className="text-sm font-semibold text-[#F1F3F5]">RECORDED FILE MODE</p>
                      <p className="text-xs text-[#A6ADB7] mt-0.5">Upload driver radio (.wav, .mp3, .m4a) & telemetry CSV</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button 
                        onClick={() => csvFileInputRef.current?.click()}
                        className="px-4 py-2 bg-[#181C21] hover:bg-[#22272E] text-xs font-semibold rounded-md border border-[#292E35] text-[#F1F3F5] transition-colors cursor-pointer"
                      >
                        {lapSourceLabel === 'CUSTOM_CSV' ? '✓ CSV Loaded' : '+ LAP CSV'}
                      </button>
                      <button 
                        onClick={() => audioFileInputRef.current?.click()}
                        className="px-4 py-2 bg-[#E53935] hover:bg-[#F04440] text-xs font-semibold rounded-md text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        SELECT AUDIO
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-xs text-[#A6ADB7]/80 text-center pt-2">
                  🔒 Privacy Note: Live audio is processed for this session. Recording stops when the session ends.
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ACTIVE DASHBOARD */
        <LocalErrorBoundary onReset={handleResetSession}>
          <div className="flex-1 flex flex-col bg-[#0B0D0F] overflow-y-auto">
          {/* Top Telemetry Strip */}
          <div className="bg-[#111417] border-b border-[#20252B] shrink-0">
            <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                
                {/* Driver State */}
                <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-4 flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-[#707984] uppercase tracking-wider mb-1">DRIVER STATE</span>
                  <div className="flex items-baseline gap-2">
                    <span className={twMerge("text-2xl sm:text-3xl font-bold font-mono", activeSegment?.state === 'STRESSED' ? 'text-[#E53935]' : activeSegment?.state === 'TIRED-LIKE' ? 'text-[#E3A43B]' : activeSegment?.state === 'CALM' ? 'text-[#35C98A]' : 'text-[#A7AFB9]')}>
                      {activeSegment ? activeSegment.state : (session.synchronized_segments.length > 0 ? session.synchronized_segments[session.synchronized_segments.length - 1].state : 'NO DATA')}
                    </span>
                    <span className="text-xs font-medium text-[#707984]">
                      {activeSegment ? `${Math.round(activeSegment.confidence * 100)}%` : (session.synchronized_segments.length > 0 ? `${Math.round(session.synchronized_segments[session.synchronized_segments.length - 1].confidence * 100)}%` : '')}
                    </span>
                  </div>
                </div>

                {/* Lap */}
                <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-4 flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-[#707984] uppercase tracking-wider mb-1">LAP</span>
                  <span className="text-2xl sm:text-3xl font-bold font-mono text-[#F2F4F7]">
                    {activeSegment && activeSegment.lap > 0 ? `LAP ${activeSegment.lap}` : (session.laps && session.laps.length > 0 ? `LAP ${session.laps[0].lap}` : 'N/A')}
                  </span>
                </div>

                {/* Lap Time */}
                <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-4 flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-[#707984] uppercase tracking-wider mb-1">LAP TIME</span>
                  <span className="text-2xl sm:text-3xl font-bold font-mono text-[#F2F4F7]">
                    {activeSegment && activeSegment.time > 0 ? `${activeSegment.time.toFixed(3)}s` : (session.laps && session.laps.length > 0 ? `${session.laps[0].time.toFixed(3)}s` : 'N/A')}
                  </span>
                </div>

                {/* Delta */}
                <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-4 flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-[#707984] uppercase tracking-wider mb-1">DELTA</span>
                  <span className={twMerge("text-2xl sm:text-3xl font-bold font-mono", activeSegment && typeof activeSegment.delta === 'number' && activeSegment.delta > 0 ? 'text-[#E53935]' : activeSegment && typeof activeSegment.delta === 'number' && activeSegment.delta < 0 ? 'text-[#35C98A]' : 'text-[#A7AFB9]')}>
                    {activeSegment && session.laps.length > 0 && typeof activeSegment.delta === 'number' ? ((activeSegment.delta > 0 ? '+' : '') + activeSegment.delta.toFixed(3) + 's') : (session.laps && session.laps.length > 0 && typeof session.laps[0].delta === 'number' ? ((session.laps[0].delta > 0 ? '+' : '') + session.laps[0].delta.toFixed(3) + 's') : 'N/A')}
                  </span>
                </div>

                {/* Lap Data Source */}
                <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-4 flex flex-col justify-between col-span-2 md:col-span-1">
                  <span className="text-[11px] font-semibold text-[#707984] uppercase tracking-wider mb-1">LAP DATA SOURCE</span>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#F2F4F7]">
                      {session.lapDataSource === 'CUSTOM_CSV' ? 'CSV UPLOADED' : (session.laps && session.laps.length > 0 ? 'PRELOADED' : 'NOT LOADED')}
                    </span>
                    {session.mode === 'LIVE' && (
                      <span className="flex items-center gap-1.5 text-xs text-[#E53935] font-semibold bg-[#E53935]/10 border border-[#E53935]/25 px-2 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#E53935] animate-pulse"></span>
                        LIVE
                      </span>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Main Content Dashboard Container */}
          <main className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6 flex-1 flex flex-col gap-6">
            
            {/* AI PIPELINE HEALTH & STATUS PANEL */}
            <AiPipelineHealthPanel session={session} />

            {/* FIRST-CLASS TRANSCRIPTION PANEL */}
            <TranscriptionPanel session={session} />

            {/* Row 1: Driver Radio (Left) & Driver Condition (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Driver Radio Panel (Hero Component) */}
              <div className="lg:col-span-8 bg-[#15191D] border border-[#343A40] shadow-md rounded-lg p-6 flex flex-col gap-5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base sm:text-lg font-semibold text-[#F2F4F7] flex items-center gap-2">
                      <Radio className="w-5 h-5 text-[#E53935]" />
                      DRIVER RADIO ● CH-1
                    </h3>
                    {session.mode === 'LIVE' && (
                      <span className="text-xs bg-[#E53935]/10 text-[#E53935] font-semibold px-2.5 py-1 rounded-md border border-[#E53935]/25">
                        {isLivePaused ? 'PAUSED' : 'LIVE TRANSMISSION'}
                      </span>
                    )}
                  </div>

                  {/* Live & Playback Controls */}
                  <div className="flex items-center gap-3">
                    {session.mode === 'LIVE' ? (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={pauseLiveRadio}
                          className="px-4 py-2 min-h-[42px] bg-[#191E23] hover:bg-[#20252B] text-sm font-semibold text-[#F2F4F7] rounded-md border border-[#292F35] transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          {isLivePaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                          {isLivePaused ? 'Resume' : 'Pause'}
                        </button>
                        <button 
                          onClick={stopLiveRadio}
                          className="px-4 py-2 min-h-[42px] bg-[#E53935] hover:bg-[#F04A46] text-sm font-semibold text-white rounded-md transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                        >
                          <Square className="w-4 h-4 fill-current" />
                          Stop Radio
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={startLiveRadio}
                          className="px-4 py-2 min-h-[42px] bg-[#E53935] hover:bg-[#F04A46] text-sm font-semibold text-white rounded-md transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                        >
                          <Mic className="w-4 h-4" />
                          Start Live Radio
                        </button>
                        <button 
                          onClick={togglePlayback}
                          className="w-10 h-10 min-h-[42px] rounded-md flex items-center justify-center transition-colors text-[#F2F4F7] bg-[#191E23] hover:bg-[#20252B] border border-[#292F35] cursor-pointer"
                        >
                          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Audio Visualizer */}
                {session.mode === 'LIVE' ? (
                  <LiveWaveform 
                    analyser={analyserRef.current} 
                    isListening={isLiveRadioActive && !isLivePaused} 
                    isSpeaking={isSpeaking} 
                  />
                ) : (
                  <div className="h-16 relative group bg-[#0B0D0F] rounded-md border border-[#292F35] overflow-hidden">
                    <div className="absolute inset-0 flex items-center gap-[2px] px-2">
                      {Array.from({ length: 120 }).map((_, i) => (
                        <div key={i} className={twMerge("flex-1 rounded-full", Math.random() > 0.75 ? "bg-[#E53935]/50" : "bg-white/10")} style={{ height: `${Math.max(10, Math.random() * 80)}%` }}></div>
                      ))}
                    </div>
                    <div 
                      className="absolute top-0 bottom-0 w-px bg-[#E53935] z-10 transition-all duration-100 ease-linear"
                      style={{ left: `${Math.min(100, (currentTime / (Math.max(...session.synchronized_segments.map(s => s.timestamp), 60))) * 100)}%` }}
                    ></div>
                  </div>
                )}

                {/* Active Radio Segment */}
                {activeSegment ? (
                  <div className="p-4 bg-[#111417] border border-[#20252B] border-l-[3px] border-l-[#35C98A] rounded-md flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={twMerge("w-2.5 h-2.5 rounded-full", activeSegment.state === 'STRESSED' ? 'bg-[#E53935]' : activeSegment.state === 'TIRED-LIKE' ? 'bg-[#E3A43B]' : 'bg-[#35C98A]')}></div>
                        <span className="text-xs sm:text-sm font-semibold text-[#A7AFB9] uppercase tracking-wider">
                          ACTIVE RADIO SEGMENT // LAP {activeSegment.lap}
                        </span>
                      </div>
                      <span className="text-sm font-mono text-[#707984]">
                        {formatTime(activeSegment.timestamp)}
                      </span>
                    </div>

                    <p className="text-base sm:text-lg font-medium text-[#F2F4F7] leading-relaxed">
                      "{activeSegment.text}"
                    </p>

                    {/* ASR Status Badge & Latency */}
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono pt-1 text-[#A7AFB9]">
                      <span className={twMerge(
                        "flex items-center gap-1 font-bold px-2 py-0.5 rounded border",
                        activeSegment.asr_meta?.status === 'ASR_SUCCESS' ? "bg-[#35C98A]/10 text-[#35C98A] border-[#35C98A]/30" :
                        activeSegment.asr_meta?.status === 'ASR_ERROR' ? "bg-[#E53935]/10 text-[#E53935] border-[#E53935]/30" :
                        "bg-[#6366F1]/10 text-[#6366F1] border-[#6366F1]/30"
                      )}>
                        {activeSegment.asr_meta?.status === 'ASR_SUCCESS' ? 'ASR ✓ TRANSCRIBED' :
                         activeSegment.asr_meta?.status === 'ASR_ERROR' ? 'ASR ✕ FAILED' :
                         'ASR ● NO SPEECH'}
                      </span>
                      {activeSegment.asr_meta?.modelUsed && (
                        <span>Model: <strong className="text-[#F2F4F7]">{activeSegment.asr_meta.modelUsed}</strong></span>
                      )}
                      {typeof activeSegment.asr_meta?.latencyMs === 'number' && activeSegment.asr_meta.latencyMs > 0 && (
                        <span>Latency: <strong className="text-[#F2F4F7]">{(activeSegment.asr_meta.latencyMs / 1000).toFixed(2)}s</strong></span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm font-medium pt-1">
                      <span className={activeSegment.state === 'STRESSED' ? 'text-[#E53935] font-bold' : activeSegment.state === 'TIRED-LIKE' ? 'text-[#E3A43B] font-bold' : 'text-[#35C98A] font-bold'}>
                        {activeSegment.state}
                      </span>
                      <span className="text-[#A7AFB9]">· Confidence {Math.round(activeSegment.confidence * 100)}%</span>
                      <span className="text-[#A7AFB9] ml-auto">Lap Delta: {typeof activeSegment.delta === 'number' ? (activeSegment.delta > 0 ? `+${activeSegment.delta.toFixed(2)}s` : `${activeSegment.delta.toFixed(2)}s`) : '—'}</span>
                    </div>

                    {/* Telemetry Signal Decomposition */}
                    <div className="mt-3 pt-3 border-t border-[#20252B] flex flex-col gap-3">
                      <div className="text-xs font-mono font-bold text-[#707984] uppercase tracking-wider">
                        MULTI-SIGNAL TELEMETRY DECOMPOSITION
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                        {/* 1. Acoustic Signal Details */}
                        <div className="flex flex-col gap-1.5 pb-2 md:pb-0">
                          <div className="flex justify-between items-center pb-1 border-b border-[#20252B]/50">
                            <span className="text-[#A7AFB9] font-bold">1. ACOUSTIC SIGNAL</span>
                            <span className="text-[#35C98A] font-bold">
                              {typeof activeSegment?.signals?.acoustic === 'number' ? `${activeSegment.signals.acoustic}%` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">RMS Energy:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.acoustic_features?.rms === 'number' ? activeSegment.acoustic_features.rms.toFixed(4) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Peak Amplitude:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.acoustic_features?.peak === 'number' ? activeSegment.acoustic_features.peak.toFixed(3) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Zero Crossing Rate:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.acoustic_features?.zcr === 'number' ? `${activeSegment.acoustic_features.zcr.toFixed(1)} Hz` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Normalized Vocal Energy:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.acoustic_features?.normalizedVocalEnergy === 'number' ? `${activeSegment.acoustic_features.normalizedVocalEnergy.toFixed(2)}x baseline` : 'Unavailable'}
                            </span>
                          </div>
                        </div>

                        {/* 2. Text Signal Details */}
                        <div className="flex flex-col gap-1.5 pb-2 md:pb-0">
                          <div className="flex justify-between items-center pb-1 border-b border-[#20252B]/50">
                            <span className="text-[#A7AFB9] font-bold">2. TEXT SIGNAL</span>
                            <span className="text-[#35C98A] font-bold">
                              {typeof activeSegment?.signals?.text === 'number' ? `${activeSegment.signals.text}%` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Sentiment Index:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.text_features?.sentimentScore === 'number' ? (
                                `${activeSegment.text_features.sentimentScore > 0 ? '+' : ''}${activeSegment.text_features.sentimentScore.toFixed(2)} (${activeSegment.text_features.sentimentScore > 0.15 ? 'Positive' : activeSegment.text_features.sentimentScore < -0.15 ? 'Stress/Negative' : 'Neutral'})`
                              ) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Urgency Keywords:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.text_features?.urgencyKeywordsCount === 'number' ? `${activeSegment.text_features.urgencyKeywordsCount} detected` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Linguistic Markers:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.text_features?.positiveMarkersCount === 'number' ? (
                                `${activeSegment.text_features.positiveMarkersCount}(+) / ${activeSegment.text_features.negativeMarkersCount || 0}(-)`
                              ) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Speech Intensity Index:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.text_features?.speechIntensity === 'number' ? `${activeSegment.text_features.speechIntensity} (scale: 0-10)` : 'Unavailable'}
                            </span>
                          </div>
                        </div>

                        {/* 3. Dynamics Signal Details */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex justify-between items-center pb-1 border-b border-[#20252B]/50">
                            <span className="text-[#A7AFB9] font-bold">3. DYNAMICS SIGNAL</span>
                            <span className="text-[#35C98A] font-bold">
                              {typeof activeSegment?.signals?.speechDynamics === 'number' ? `${activeSegment.signals.speechDynamics}%` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Speech Rate:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.dynamics_features?.speechRate === 'number' ? `${activeSegment.dynamics_features.speechRate} words/sec` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Pause Duration:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.dynamics_features?.pauseDuration === 'number' ? `${activeSegment.dynamics_features.pauseDuration}s` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Energy Variation:</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.dynamics_features?.energyVariation === 'number' ? activeSegment.dynamics_features.energyVariation.toFixed(4) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#707984]">Vocal Centroid (Pitch):</span>
                            <span className="text-[#F2F4F7]">
                              {typeof activeSegment?.dynamics_features?.pitchProsody === 'number' ? `${activeSegment.dynamics_features.pitchProsody.toFixed(1)} Hz` : 'Unavailable'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Explainability Evidence Reasons ("WHY?") */}
                      {activeSegment.reasons && activeSegment.reasons.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[#20252B]/80 font-sans">
                          <span className="text-[10px] font-mono font-bold text-[#E3A43B] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                            <HelpCircle className="w-3 h-3 text-[#E3A43B]" />
                            CLASSIFICATION EVIDENCE & REASONS ("WHY?")
                          </span>
                          <ul className="flex flex-col gap-1 text-xs text-[#F2F4F7]">
                            {activeSegment.reasons.map((reason, rIdx) => (
                              <li key={rIdx} className="flex items-center gap-1.5 font-medium">
                                <span className="text-[#35C98A] font-bold">✓</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-[#111417] border border-dashed border-[#20252B] rounded-md text-center text-[#A7AFB9] text-sm">
                    {session.mode === 'LIVE' ? 'Speak into the microphone to stream live radio...' : 'Click play or select a transcript row to view radio segments.'}
                  </div>
                )}
              </div>

              {/* Driver Condition Card */}
              <div className="lg:col-span-4 bg-[#15191D] border border-[#292F35] rounded-lg p-6 flex flex-col h-fit">
                <DriverConditionPanel segments={session.synchronized_segments} />
              </div>

            </div>

            {/* Row 2: Lap Performance Chart (Left) & Engineer Insights (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Lap Performance Chart */}
              <div className="lg:col-span-8 bg-[#15191D] border border-[#292F35] rounded-lg p-6 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-base font-semibold text-[#F2F4F7] tracking-wide">
                    LAP PERFORMANCE × DRIVER STATE CORRELATION
                  </h3>
                  <span className="text-sm font-medium text-[#707984]">
                    Observations: {session.correlation?.total_observations || session.synchronized_segments.length}
                  </span>
                </div>

                <div className="h-[340px] w-full">
                  <LapChart 
                    laps={session.laps} 
                    segments={session.synchronized_segments} 
                    onLapSelect={setSelectedLap} 
                    selectedLap={selectedLap} 
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-[#111417] border border-[#20252B] rounded-md">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#E53935]"></div>
                      <span className="text-sm font-medium text-[#A7AFB9]">High Stress Lap</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-0.5 bg-[#35C98A]"></div>
                      <span className="text-sm font-medium text-[#A7AFB9]">Optimal Baseline</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#E53935]/20 rounded-sm"></div>
                      <span className="text-sm font-medium text-[#A7AFB9]">Stress Window</span>
                    </div>
                  </div>

                  <div className="text-sm font-semibold text-[#F2F4F7]">
                    {session.correlation?.conclusion || 'COLLECTING DATA'}
                  </div>
                </div>
              </div>

              {/* Engineer Insights Card */}
              <div className="lg:col-span-4 bg-[#15191D] border border-[#292F35] rounded-lg p-6 flex flex-col h-fit">
                <EngineerInsightsCard insights={session.insights} />
              </div>

            </div>

            {/* Row 3: Session Live Transcript (Full Width) */}
            <div className="bg-[#15191D] border border-[#292F35] rounded-lg overflow-hidden">
              <Transcript 
                segments={session.synchronized_segments} 
                currentTime={currentTime} 
                onSegmentClick={handleSegmentClick} 
              />
            </div>

            {/* ASR PIPELINE TECHNICAL DEBUG AUDIT LOGS */}
            <AsrDebugDrawer session={session} />

          </main>

          {/* System Footer Status */}
          <footer className="border-t border-[#20252B] bg-[#0B0D0F] shrink-0">
            <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[#A7AFB9]">
              <div className="flex items-center gap-4 sm:gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#35C98A]"></div>
                  <span className="text-xs font-mono bg-[rgba(99,102,241,0.10)] text-[#6366F1] px-2 py-0.5 rounded border border-[rgba(99,102,241,0.20)]">ASR: HF-Whisper / Gemini</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#35C98A]"></div>
                  <span className="text-xs font-mono bg-[rgba(99,102,241,0.10)] text-[#6366F1] px-2 py-0.5 rounded border border-[rgba(99,102,241,0.20)]">VAD: WebAudio</span>
                </div>
              </div>
              <span className="font-mono text-xs text-[#707984]">v2.4.0-LIVE</span>
            </div>
          </footer>

          {/* Developer ANALYSIS DEBUG Panel (DEV ONLY - Hidden in Production) */}
          {(import.meta as any).env?.DEV && (
            <div className="bg-[#0D0F12] border-t border-[#292E35] p-4 text-xs sm:text-sm font-mono text-[#A6ADB7] shrink-0">
              <div className="max-w-7xl mx-auto flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[#292E35] pb-1.5">
                  <span className="font-bold text-[#F1F3F5] tracking-wider text-sm flex items-center gap-2">
                    <span>ANALYSIS DEBUG PANEL</span>
                    <span className="text-xs bg-[#E5A93D]/10 text-[#E5A93D] px-2 py-0.5 rounded font-mono border border-[#E5A93D]/25">DEV ONLY</span>
                  </span>
                  <span className="text-xs text-[#27C985] font-bold">DEV ACTIVE</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  <div><span className="text-[#A6ADB7] block text-xs">Audio duration:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.audioQuality?.duration ? `${session.audioQuality.duration}s` : selectedFileMeta?.durationStr || 'N/A'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Speech duration:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.audioQuality?.speechDuration ? `${session.audioQuality.speechDuration}s` : 'N/A'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">VAD segments:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.synchronized_segments?.length ?? 0}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Audio Quality:</span> <span className="text-[#27C985] font-bold block">{session?.audioQuality?.quality || 'GOOD'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">ASR Status:</span> <span className="text-[#27C985] font-bold block">ONLINE (WHISPER V3)</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Active Segment RMS:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.acoustic_features?.rms === 'number' ? activeSegment.acoustic_features.rms.toFixed(4) : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Active Peak:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.acoustic_features?.peak === 'number' ? activeSegment.acoustic_features.peak.toFixed(3) : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Active ZCR:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.acoustic_features?.zcr === 'number' ? activeSegment.acoustic_features.zcr.toFixed(3) : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Acoustic Signal:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.signals?.acoustic === 'number' ? `${activeSegment.signals.acoustic}%` : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Text Signal:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.signals?.text === 'number' ? `${activeSegment.signals.text}%` : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Dynamics Signal:</span> <span className="text-[#F1F3F5] font-semibold block">{typeof activeSegment?.signals?.speechDynamics === 'number' ? `${activeSegment.signals.speechDynamics}%` : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Calm / Stress / Tired:</span> <span className="text-[#F1F3F5] font-semibold block">{activeSegment?.scores ? `${Math.round(activeSegment.scores.calm * 100)} / ${Math.round(activeSegment.scores.stressed * 100)} / ${Math.round(activeSegment.scores.tired_like * 100)}` : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Final Confidence:</span> <span className="text-[#35C98A] font-bold block">{typeof activeSegment?.confidence === 'number' ? `${Math.round(activeSegment.confidence * 100)}%` : 'Unavailable'}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Lap records:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.laps?.length ?? 0}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Insights:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.insights?.length ?? 0}</span></div>
                  <div><span className="text-[#A6ADB7] block text-xs">Session Mode:</span> <span className="text-[#F1F3F5] font-semibold block">{session?.mode || 'N/A'}</span></div>
                </div>
                {rawApiResponse?.debug_info && (
                  <div className="border border-[#292E35] rounded bg-[#111417] p-3 mt-3 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Input file:</span> <span className="text-[#F1F3F5] font-semibold text-xs block truncate" title={rawApiResponse.debug_info.inputFile}>{rawApiResponse.debug_info.inputFile || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Extension:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.extension || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">MIME:</span> <span className="text-[#F1F3F5] font-semibold text-xs block truncate" title={rawApiResponse.debug_info.mimeType}>{rawApiResponse.debug_info.mimeType || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Container:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.container || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Audio stream:</span> <span className={`font-bold text-xs block ${rawApiResponse.debug_info.audioStream === 'FOUND' ? 'text-[#35C98A]' : 'text-[#E53935]'}`}>{rawApiResponse.debug_info.audioStream || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Audio codec:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.audioCodec || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Sample rate:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.sampleRate || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Channels:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.channels || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Extracted audio:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.extractedAudio || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Normalized:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.normalized || '—'}</span></div>
                    <div><span className="text-[#A6ADB7] block text-[10px] uppercase font-bold tracking-wider">Normalized size:</span> <span className="text-[#F1F3F5] font-semibold text-xs block">{rawApiResponse.debug_info.normalizedSize || '—'}</span></div>
                  </div>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-mono font-bold text-[#E5A93D] hover:underline">
                    Expand Raw API Response JSON
                  </summary>
                  <pre className="p-3 bg-[#13161A] text-xs font-mono text-[#27C985] overflow-x-auto max-h-60 mt-2 rounded border border-[#292E35]">
                    {JSON.stringify(rawApiResponse || session, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}
          </div>
        </LocalErrorBoundary>
      )}
    </div>
  );
}
