import fs from "fs";
import path from "path";
import { processAudioFile, transcribeAudioSlice } from "../server/audioPipeline";

async function runAcceptanceTest() {
  console.log("==================================================");
  console.log(" ASR & DRIVER INTELLIGENCE PIPELINE ACCEPTANCE TEST");
  console.log("==================================================");

  const testWavPath = path.join(process.cwd(), "test_speech.wav");
  if (!fs.existsSync(testWavPath)) {
    console.error("FAIL: test_speech.wav not found!");
    process.exit(1);
  }

  // 1. Direct ASR Test
  console.log("\n[STEP 1] Testing direct transcribeAudioSlice on speech WAV...");
  const asrRes = await transcribeAudioSlice(testWavPath, 0, 4.25);
  console.log("ASR Result Status:", asrRes.status);
  console.log("Transcribed Text:", `"${asrRes.text}"`);
  console.log("Model Used:", asrRes.modelUsed);
  console.log("Latency:", asrRes.latencyMs, "ms");

  if (asrRes.status !== "ASR_SUCCESS" || !asrRes.text || asrRes.text.includes("[NO SPEECH")) {
    console.error("FAIL: Direct ASR failed to transcribe speech audio!");
    process.exit(1);
  }
  console.log("✓ STEP 1 PASSED: Direct speech-to-text succeeded.");

  // 2. Full Audio Pipeline Test
  console.log("\n[STEP 2] Testing full processAudioFile pipeline on speech WAV...");
  const wavBuf = fs.readFileSync(testWavPath);
  const pipelineResult = await processAudioFile(wavBuf, "test_speech.wav");

  console.log("Pipeline Duration:", pipelineResult.duration.toFixed(2), "s");
  console.log("Overall ASR Status:", pipelineResult.overallAsrStatus);
  console.log("Segments count:", pipelineResult.segments.length);

  if (pipelineResult.segments.length === 0) {
    console.error("FAIL: Pipeline returned 0 segments!");
    process.exit(1);
  }

  const seg = pipelineResult.segments[0];
  console.log("\n--- SEGMENT OUTPUT DETAILS ---");
  console.log("Segment Text:", `"${seg.text}"`);
  console.log("Driver State:", seg.state);
  console.log("Confidence:", seg.confidence);
  console.log("Acoustic Signal Score:", seg.signals.acoustic + "%");
  console.log("Dynamics Signal Score:", seg.signals.speechDynamics + "%");
  console.log("Text Signal Score:", seg.signals.text + "%");
  console.log("Text Features (Sentiment/Urgency/Markers):", JSON.stringify(seg.text_features));
  console.log("Evidence Reasons:", seg.reasons);

  // Assertions
  if (!seg.text || seg.text.includes("[engine transmission")) {
    console.error("FAIL: Transcript is missing or contains placeholder!");
    process.exit(1);
  }

  if (!seg.text_features) {
    console.error("FAIL: Text features missing from segment!");
    process.exit(1);
  }

  if (!seg.reasons || seg.reasons.length === 0) {
    console.error("FAIL: Classification evidence reasons missing!");
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log(" ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!          ");
  console.log("==================================================");
}

runAcceptanceTest().catch(err => {
  console.error("Acceptance test exception:", err);
  process.exit(1);
});
