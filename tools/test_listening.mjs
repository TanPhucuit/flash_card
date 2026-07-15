import assert from "node:assert/strict";
import { appDataToRows, rowsToAppData } from "../api/_googleSheets.js";
import { parseTranslation } from "../api/translate.js";
import { mergeTranscriptCues, parsePlayerResponse, parsePublicTranscript, parseTimedText, parseXmlTimedText, parseYouTubeConfig, rankCaptionTracks, selectCaptionTrack } from "../api/youtube/transcript.js";
import { extractYouTubeVideoId, isListeningAnswerCorrect, normalizeListeningAnswer, parseSubtitles } from "../src/utils/listening.ts";

const srt = `\uFEFF1
00:00:01,200 --> 00:00:03,500
Hello, <i>world!</i>

2
00:04:05.000 --> 00:04:07.250
This is a multiline
subtitle cue.
`;
const parsedSrt = parseSubtitles(srt);
assert.equal(parsedSrt.cues.length, 2);
assert.equal(parsedSrt.cues[0].text, "Hello, world!");
assert.equal(parsedSrt.cues[1].startSeconds, 245);
assert.equal(parsedSrt.cues[1].text, "This is a multiline subtitle cue.");

const vtt = `WEBVTT

intro
00:01.000 --> 00:02.500 align:start
Tom &amp; Jerry

NOTE this block is ignored
metadata

bad cue
not a timestamp
`;
const parsedVtt = parseSubtitles(vtt);
assert.equal(parsedVtt.cues.length, 1);
assert.equal(parsedVtt.cues[0].text, "Tom & Jerry");
assert.equal(parsedVtt.rejectedBlocks, 1);
assert.deepEqual(parseSubtitles("").cues, []);

const videoId = "dQw4w9WgXcQ";
assert.equal(extractYouTubeVideoId(videoId), videoId);
assert.equal(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${videoId}`), videoId);
assert.equal(extractYouTubeVideoId(`https://youtu.be/${videoId}?t=4`), videoId);
assert.equal(extractYouTubeVideoId(`https://www.youtube.com/shorts/${videoId}`), videoId);
assert.equal(extractYouTubeVideoId(`https://www.youtube.com/embed/${videoId}`), videoId);
assert.equal(extractYouTubeVideoId("https://example.com/video"), null);

assert.equal(normalizeListeningAnswer("  Don’t, STOP!  "), "do not stop");
assert.equal(normalizeListeningAnswer("Café"), normalizeListeningAnswer("Cafe\u0301"));
assert.equal(isListeningAnswerCorrect("you have big dream", "You have big dreams!"), true);
assert.equal(isListeningAnswerCorrect("you've big dreams", "You have big dreams."), true);
assert.equal(isListeningAnswerCorrect("you 've big dreams", "You have big dreams."), true);
assert.equal(isListeningAnswerCorrect("we cant stop", "We can't stop."), true);
assert.equal(isListeningAnswerCorrect("you have big dreems", "You have big dreams."), true);
assert.equal(isListeningAnswerCorrect("you have big dreams you can see", "You have big dreams."), false);
assert.equal(isListeningAnswerCorrect(
  "you have big dream, you can see yourself succeeding",
  "You have big dreams. You can see yourself succeeding.",
), true);

const playerResponse = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { languageCode: "vi", baseUrl: "https://www.youtube.com/api/timedtext?lang=vi" },
  { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" },
] } } };
const playerHtml = `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"test-key"});</script>`;
assert.equal(selectCaptionTrack(parsePlayerResponse(playerHtml)).languageCode, "en");
assert.equal(parseYouTubeConfig(playerHtml).apiKey, "test-key");
assert.equal(rankCaptionTracks(playerResponse, "https://www.youtube-nocookie.com")[0].sourceOrigin, "https://www.youtube-nocookie.com");
assert.deepEqual(parseTimedText({ events: [
  { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "SPEAKER: Hello " }, { utf8: "world" }] },
  { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] },
] }), [{ id: "cue-1-1000", startSeconds: 1, endSeconds: 3, text: "Hello world" }]);
assert.deepEqual(parseXmlTimedText('<?xml version="1.0"?><transcript><text start="1.5" dur="2">Tom &amp; Jerry</text></transcript>'), [
  { id: "cue-1-1500", startSeconds: 1.5, endSeconds: 3.5, text: "Tom & Jerry" },
]);
assert.deepEqual(parsePublicTranscript({ language: "English", language_code: "en", transcript: [
  { start: 1.25, duration: 2.5, text: "Hello\u00a0 world" },
] }), {
  language: "English",
  languageCode: "en",
  cues: [{ id: "cue-1-1250", startSeconds: 1.25, endSeconds: 3.75, text: "Hello world" }],
});
assert.equal(parseTranslation([[['Xin chào ', 'Hello '], ['thế giới', 'world']], null, 'en']), "Xin chào thế giới");

const semanticCues = mergeTranscriptCues([
  { id: "raw-1", startSeconds: 0, endSeconds: 4, text: "You visualize yourself succeeding. You imagine the" },
  { id: "raw-2", startSeconds: 4, endSeconds: 7, text: "life you want so clearly," },
  { id: "raw-3", startSeconds: 7, endSeconds: 10, text: "but you never take the first step." },
]);
assert.deepEqual(semanticCues.map((cue) => cue.text), [
  "You visualize yourself succeeding. You imagine the life you want so clearly, but you never take the first step.",
]);

const shortCueGrouping = mergeTranscriptCues([
  { id: "raw-1", startSeconds: 0.16, endSeconds: 4.48, text: "You have big dreams. You can see" },
  { id: "raw-2", startSeconds: 2.32, endSeconds: 6.88, text: "yourself succeeding. You imagine the" },
  { id: "raw-3", startSeconds: 4.48, endSeconds: 9.17, text: "life you want so clearly that it feels almost real." },
]);
assert.equal(shortCueGrouping[0].text, "You have big dreams. You can see yourself succeeding.");
assert.equal(shortCueGrouping[0].endSeconds <= shortCueGrouping[1].startSeconds, true);

const listeningResult = { id: "listen-1", mode: "listening", accuracy: 82, studiedAt: "2026-07-15T00:00:00.000Z" };
const listeningRows = appDataToRows({ sets: [], results: [listeningResult] }).resultRows;
assert.deepEqual(listeningRows[0], ["listen-1", "", "listening", "", "", "", 82, "2026-07-15T00:00:00.000Z", ""]);
const listeningRoundTrip = rowsToAppData({ sets: [], cards: [], results: listeningRows }).results[0];
assert.deepEqual(Object.keys(listeningRoundTrip).sort(), ["accuracy", "id", "mode", "studiedAt"]);

const legacyRows = [["legacy-1", "set-1", "test", 10, 8, 2, 80, "2026-07-14T00:00:00.000Z", '["card-2"]']];
const legacyResult = rowsToAppData({ sets: [], cards: [], results: legacyRows }).results[0];
assert.equal(legacyResult.setId, "set-1");
assert.deepEqual(legacyResult.wrongCardIds, ["card-2"]);

console.log("Listening parser, URL, grading and persistence tests: OK");
