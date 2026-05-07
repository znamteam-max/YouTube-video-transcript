import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInitialPlayerResponse,
  extractVideoId,
  parseJson3Transcript,
  parseTranscriptBody
} from "../src/youtube.js";

test("extractVideoId supports common YouTube URL formats", () => {
  const cases = new Map([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=test", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"]
  ]);

  for (const [input, expected] of cases) {
    assert.equal(extractVideoId(input), expected);
  }
});

test("parseJson3Transcript joins caption segments into readable lines", () => {
  const transcript = parseJson3Transcript({
    events: [
      {
        segs: [
          { utf8: "Hello" },
          { utf8: " world" }
        ]
      },
      {
        segs: [
          { utf8: "Second\nline" }
        ]
      }
    ]
  });

  assert.equal(transcript, "Hello world\nSecond line");
});

test("parseTranscriptBody falls back to YouTube XML captions", () => {
  const transcript = parseTranscriptBody(
    '<transcript><text start="0">Tom &amp; Jerry</text><text start="1">5 &lt; 6</text></transcript>'
  );

  assert.equal(transcript, "Tom & Jerry\n5 < 6");
});

test("parseTranscriptBody supports srv3 and VTT captions", () => {
  assert.equal(
    parseTranscriptBody('<timedtext><body><p t="0"><s>Hello</s> &amp; <s>world</s></p></body></timedtext>'),
    "Hello & world"
  );

  assert.equal(
    parseTranscriptBody("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello &amp; world\n"),
    "Hello & world"
  );
});

test("extractInitialPlayerResponse reads balanced JSON from page html", () => {
  const playerResponse = extractInitialPlayerResponse(
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"A } inside string"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[]}}};</script>'
  );

  assert.equal(playerResponse.videoDetails.title, "A } inside string");
});
