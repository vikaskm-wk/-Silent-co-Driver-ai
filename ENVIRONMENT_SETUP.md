# Silent Co-Driver AI — Environment Setup & Configuration Guide

This guide provides instructions for setting up the environment variables for **Silent Co-Driver AI**.

---

## Environment Variables Overview

The application requires ONLY four environment variables/secrets:

| Variable | Type | Description | Example / Default Value |
|---|---|---|---|
| `GEMINI_API_KEY` | **Secret (Server-only)** | Google AI Studio Gemini API Key for LLM reasoning and multimodal analysis | `AIzaSy...` |
| `HF_TOKEN` | **Secret (Server-only)** | Hugging Face Access Token for Whisper ASR & emotion inference APIs | `hf_...` |
| `HF_ASR_MODEL` | Configuration | Hugging Face Whisper ASR model identifier | `openai/whisper-tiny.en` |
| `HF_AUDIO_EMOTION_MODEL` | Configuration | Hugging Face Speech Emotion Recognition model identifier | `ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition` |

---

## Internal Defaults & Security

- All additional runtime options (e.g. `GEMINI_MODEL`, audio sampling parameters, VAD thresholds, signal fusion weights) are internally managed with safe defaults in `/server/config.ts`.
- Secrets (`GEMINI_API_KEY` and `HF_TOKEN`) are consumed strictly on the server side (`server.ts` and `server/audioPipeline.ts`) and are never exposed to browser/client-side code or printed in logs.
