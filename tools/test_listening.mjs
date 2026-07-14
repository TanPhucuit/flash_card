import assert from "node:assert/strict";
import { appDataToRows, rowsToAppData } from "../api/_googleSheets.js";
import { parsePlayerResponse, parseTimedText, parseYouTubeConfig, selectCaptionTrack } from "../api/youtube/transcript.js";
import { extractYouTubeVideoId, normalizeListeningAnswer, parseSubtitles } from "../src/utils/listening.ts";

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

assert.equal(normalizeListeningAnswer("  Don’t, STOP!  "), "dont stop");
assert.equal(normalizeListeningAnswer("Café"), normalizeListeningAnswer("Cafe\u0301"));

const playerResponse = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { languageCode: "vi", baseUrl: "https://www.youtube.com/api/timedtext?lang=vi" },
  { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" },
] } } };
const playerHtml = `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"test-key"});</script>`;
assert.equal(selectCaptionTrack(parsePlayerResponse(playerHtml)).languageCode, "en");
assert.equal(parseYouTubeConfig(playerHtml).apiKey, "test-key");
assert.deepEqual(parseTimedText({ events: [
  { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "SPEAKER: Hello " }, { utf8: "world" }] },
  { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] },
] }), [{ id: "cue-1-1000", startSeconds: 1, endSeconds: 3, text: "Hello world" }]);

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
