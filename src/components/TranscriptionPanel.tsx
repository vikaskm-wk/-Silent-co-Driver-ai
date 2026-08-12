import React from 'react';
import { SessionData } from '../types';
import { FileText, Cpu, CheckCircle2, AlertCircle, VolumeX, ShieldAlert } from 'lucide-react';

interface TranscriptionPanelProps {
  session: SessionData;
}

export function TranscriptionPanel({ session }: TranscriptionPanelProps) {
  const asrStatus = session.asr_status || (session.transcript ? "ASR_SUCCESS" : "ASR_NO_SPEECH");
  const asrModel = session.asr_model || session.model_info?.asr_model || "HuggingFace Whisper / Gemini 2.5 Flash";
  const transcriptText = session.transcript || "";
  const hasTranscript = Boolean(transcriptText && transcriptText.trim() && !transcriptText.startsWith("["));

  return (
    <div className="bg-[#15191D] border border-[#292F35] rounded-lg p-6 flex flex-col gap-4 font-sans">
      <div className="flex items-center justify-between border-b border-[#20252B] pb-4">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-[#6366F1]" />
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-[#F2F4F7] tracking-wide flex items-center gap-2">
              TRANSCRIPTION ENGINE
            </h3>
            <p className="text-xs text-[#A7AFB9] mt-0.5 font-mono">
              Verbatim Driver Radio Speech Recognition (ASR)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {asrStatus === 'ASR_SUCCESS' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold bg-[#35C98A]/10 text-[#35C98A] border border-[#35C98A]/30">
              <CheckCircle2 className="w-4 h-4" />
              ASR SUCCESS
            </span>
          )}
          {asrStatus === 'ASR_NO_SPEECH' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/30">
              <VolumeX className="w-4 h-4" />
              NO SPEECH DETECTED
            </span>
          )}
          {asrStatus === 'ASR_ERROR' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold bg-[#E53935]/10 text-[#E53935] border border-[#E53935]/30">
              <ShieldAlert className="w-4 h-4" />
              ASR UNAVAILABLE
            </span>
          )}
        </div>
      </div>

      {/* Main Transcript Display Box */}
      <div className="bg-[#0B0D0F] border border-[#20252B] rounded-lg p-5 flex flex-col gap-3 min-h-[110px]">
        {hasTranscript ? (
          <div>
            <span className="text-[10px] font-mono font-bold text-[#707984] uppercase tracking-wider block mb-1">
              VERBATIM RECONSTRUCTED TRANSCRIPT
            </span>
            <p className="text-base sm:text-xl font-medium text-[#F2F4F7] leading-relaxed font-sans">
              "{transcriptText}"
            </p>
          </div>
        ) : asrStatus === 'ASR_NO_SPEECH' ? (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <VolumeX className="w-8 h-8 text-[#A7AFB9] mb-2" />
            <span className="text-sm font-mono font-bold text-[#F2F4F7] tracking-wider uppercase">
              [NO SPEECH DETECTED]
            </span>
            <p className="text-xs text-[#A7AFB9] mt-1 max-w-md">
              The audio recording contained background telemetry or engine sounds without audible human driver radio speech.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <AlertCircle className="w-8 h-8 text-[#E53935] mb-2" />
            <span className="text-sm font-mono font-bold text-[#E53935] tracking-wider uppercase">
              TRANSCRIPTION FAILED / UNAVAILABLE
            </span>
            <p className="text-xs text-[#A7AFB9] mt-1 max-w-md">
              Reason: {session.asr_error || "HuggingFace Whisper / Gemini ASR model did not return a valid transcript."}
            </p>
          </div>
        )}
      </div>

      {/* ASR Engine Metadata Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-2 text-[#A7AFB9] border-t border-[#20252B]">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-[#35C98A]" />
          <span>Model: <strong className="text-[#F2F4F7]">{asrModel}</strong></span>
        </div>
        <div className="flex items-center gap-4">
          <span>Audio Length: <strong className="text-[#F2F4F7]">{session.audioDuration ? `${session.audioDuration.toFixed(1)}s` : '—'}</strong></span>
          <span>Chars: <strong className="text-[#F2F4F7]">{transcriptText.length}</strong></span>
          <span>Text Signal: <strong className={hasTranscript ? "text-[#35C98A]" : "text-[#A7AFB9]"}>{hasTranscript ? 'Analyzed (30% weight)' : 'Unavailable (0% weight)'}</strong></span>
        </div>
      </div>
    </div>
  );
}
