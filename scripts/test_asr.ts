import path from "path";
import fs from "fs";
import { processAudioFile, transcribeAudioSlice } from "../server/audioPipeline";
import { config } from "../server/config";

async function main() {
  console.log("==================================================");
  console.log(" ASR PIPELINE DIAGNOSTIC TEST                     ");
  console.log("==================================================");
  console.log("Gemini API Key configured:", !!config.geminiApiKey);
  console.log("HuggingFace Token configured:", !!config.hfToken);
  console.log("HuggingFace ASR Model:", config.hfAsrModel);

  const testWavPath = path.join(process.cwd(), "test_speech.wav");
  if (!fs.existsSync(testWavPath)) {
    console.error("Error: test_speech.wav does not exist!");
    process.exit(1);
  }

  const stat = fs.statSync(testWavPath);
  console.log(`Test WAV file size: ${stat.size} bytes`);

  console.log("\n[1] Testing transcribeAudioSlice directly...");
  const asrRes = await transcribeAudioSlice(testWavPath, 0, 4.25);
  console.log("Direct ASR Result:", JSON.stringify(asrRes, null, 2));

  console.log("\n[2] Testing full processAudioFile pipeline...");
  const wavBuf = fs.readFileSync(testWavPath);
  const result = await processAudioFile(wavBuf, "test_speech.wav");
  console.log("Full Pipeline Result:", JSON.stringify({
    duration: result.duration,
    overallAsrStatus: result.overallAsrStatus,
    segmentsCount: result.segments.length,
    segments: result.segments.map(s => ({
      text: s.text,
      state: s.state,
      confidence: s.confidence,
      asr_meta: s.asr_meta,
      signals: s.signals,
      text_features: s.text_features,
      reasons: s.reasons
    }))
  }, null, 2));

  console.log("==================================================");
}

main().catch(err => {
  console.error("ASR Test failed:", err);
  process.exit(1);
});
