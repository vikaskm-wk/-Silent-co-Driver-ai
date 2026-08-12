import React from 'react';
import { SessionData } from '../types';
import { Activity, CheckCircle2, AlertTriangle, XCircle, Cpu, Mic, FileText, Radio, ShieldCheck } from 'lucide-react';

interface AiPipelineHealthPanelProps {
  session: SessionData;
}

export function AiPipelineHealthPanel({ session }: AiPipelineHealthPanelProps) {
  const asrStatus = session.asr_status || (session.transcript ? "ASR_SUCCESS" : "ASR_NO_SPEECH");
  const pipelineStatus = session.pipeline_status || (asrStatus === "ASR_SUCCESS" ? "FULL" : "PARTIAL");
  const asrModel = session.asr_model || session.model_info?.asr_model || "HuggingFace Whisper / Gemini 2.5 Flash";
  
  const hasTranscript = Boolean(session.transcript && session.transcript.trim() && !session.transcript.startsWith("["));

  return (
    <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-5 flex flex-col gap-4 font-sans text-xs">
      <div className="flex items-center justify-between border-b border-[#20252B] pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#35C98A]" />
          <h3 className="text-sm font-semibold text-[#F2F4F7] uppercase tracking-wider">
            AI PIPELINE HEALTH & STATUS
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {pipelineStatus === 'FULL' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-[#35C98A]/10 text-[#35C98A] border border-[#35C98A]/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              FULL MULTI-SIGNAL ANALYSIS
            </span>
          )}
          {pipelineStatus === 'PARTIAL' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-[#E3A43B]/10 text-[#E3A43B] border border-[#E3A43B]/30">
              <AlertTriangle className="w-3.5 h-3.5" />
              PARTIAL ANALYSIS (ACOUSTICS & DYNAMICS)
            </span>
          )}
          {pipelineStatus === 'FAILED' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-[#E53935]/10 text-[#E53935] border border-[#E53935]/30">
              <XCircle className="w-3.5 h-3.5" />
              PIPELINE DEGRADED
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 font-mono">
        {/* Stage 1: Audio Capture */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <Mic className="w-3 h-3 text-[#35C98A]" /> 1. CAPTURE
          </span>
          <span className="text-[#35C98A] font-bold text-xs mt-1">16kHz PCM</span>
        </div>

        {/* Stage 2: Audio Extraction/Decoder */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <Radio className="w-3 h-3 text-[#35C98A]" /> 2. DECODER
          </span>
          <span className="text-[#35C98A] font-bold text-xs mt-1">FFmpeg S16LE</span>
        </div>

        {/* Stage 3: Voice Activity Detection */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#35C98A]" /> 3. VAD
          </span>
          <span className="text-[#35C98A] font-bold text-xs mt-1">SilenceDetect</span>
        </div>

        {/* Stage 4: ASR Speech-to-Text */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <Cpu className="w-3 h-3 text-[#35C98A]" /> 4. ASR ENGINE
          </span>
          {asrStatus === 'ASR_SUCCESS' && <span className="text-[#35C98A] font-bold text-xs mt-1">✓ INFERRED</span>}
          {asrStatus === 'ASR_NO_SPEECH' && <span className="text-[#6366F1] font-bold text-xs mt-1">NO SPEECH</span>}
          {asrStatus === 'ASR_ERROR' && <span className="text-[#E53935] font-bold text-xs mt-1">✕ FAILED</span>}
        </div>

        {/* Stage 5: Transcript */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <FileText className="w-3 h-3 text-[#35C98A]" /> 5. TRANSCRIPT
          </span>
          {hasTranscript ? (
            <span className="text-[#35C98A] font-bold text-xs mt-1">AVAILABLE</span>
          ) : (
            <span className="text-[#A7AFB9] font-bold text-xs mt-1">UNAVAILABLE</span>
          )}
        </div>

        {/* Stage 6: Acoustic Feature Engine */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#35C98A]" /> 6. ACOUSTICS
          </span>
          <span className="text-[#35C98A] font-bold text-xs mt-1">100% ACTIVE</span>
        </div>

        {/* Stage 7: Text Signal Engine */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <FileText className="w-3 h-3 text-[#35C98A]" /> 7. TEXT NLP
          </span>
          {hasTranscript ? (
            <span className="text-[#35C98A] font-bold text-xs mt-1">ANALYZED</span>
          ) : (
            <span className="text-[#A7AFB9] font-bold text-xs mt-1">OMITTED</span>
          )}
        </div>

        {/* Stage 8: Weighted Fusion */}
        <div className="bg-[#111417] p-2.5 rounded border border-[#20252B] flex flex-col justify-between">
          <span className="text-[#707984] text-[10px] uppercase font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-[#35C98A]" /> 8. FUSION
          </span>
          <span className="text-[#35C98A] font-bold text-xs mt-1">WEIGHTED</span>
        </div>
      </div>

      {asrStatus === 'ASR_ERROR' && session.asr_error && (
        <div className="p-3 bg-[#E53935]/10 border border-[#E53935]/30 rounded text-[#F2F4F7] font-mono text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#E53935] shrink-0" />
          <span><strong>ASR Notice:</strong> {session.asr_error}. Acoustic & Speech Dynamics signals are active.</span>
        </div>
      )}
    </div>
  );
}
