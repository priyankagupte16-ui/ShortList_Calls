// Thin client for Gnani's speech APIs. The API key stays on the server and is never sent to the browser.
// Docs: https://docs.gnani.ai (STT REST: POST /stt/v3, TTS REST: POST /api/v1/tts/inference)

const BASE = process.env.GNANI_BASE_URL || "https://api.vachana.ai";
const STT_MODEL = process.env.GNANI_STT_MODEL || "prisma-v3.0"; // set to prisma-v2.5 to use the default model
const TTS_MODEL = process.env.GNANI_TTS_MODEL || "timbre-v2.5";

// Each Timbre v2.5 voice has one preferred language, so we pick a voice per language.
const VOICES = {
  "hi-IN": process.env.GNANI_VOICE_HI || "Nalini",
  "mr-IN": process.env.GNANI_VOICE_MR || "Zahira",
  "en-IN": process.env.GNANI_VOICE_EN || "Pranav",
};
const LANGS = Object.keys(VOICES);

class GnaniError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const key = () => {
  if (!process.env.GNANI_API_KEY) throw new GnaniError("GNANI_API_KEY is not set on the server", 503);
  return process.env.GNANI_API_KEY;
};

function explain(status, body) {
  const m = body?.error?.message || body?.detail?.message || (Array.isArray(body?.detail) && body.detail[0]?.msg) || body?.message;
  if (status === 401) return "Gnani rejected the API key. Check GNANI_API_KEY.";
  if (status === 402) return "Gnani credits are used up.";
  if (status === 429) return "Gnani is busy (one request at a time). Try again in a moment.";
  return m || `Gnani request failed (${status})`;
}

// wav: Buffer of a WAV file, at most 30 seconds. Returns the transcript text.
async function transcribe(wav, lang) {
  const send = async (useV3) => {
    const form = new FormData();
    form.append("audio_file", new Blob([wav], { type: "audio/wav" }), "answer.wav");
    if (useV3) {
      form.append("model", "prisma-v3.0");
      // Candidates mix languages, so let the model listen for English too.
      form.append("language_code", lang === "en-IN" ? "en-IN" : `${lang},en-IN`);
    } else {
      form.append("language_code", lang);
    }
    form.append("format", "transcribe"); // numbers and rupees come back as digits
    const r = await fetch(`${BASE}/stt/v3`, { method: "POST", headers: { "X-API-Key-ID": key() }, body: form });
    const body = await r.json().catch(() => ({}));
    return { r, body };
  };

  let { r, body } = await send(STT_MODEL === "prisma-v3.0");
  // If v3.0 is not available for this key, fall back once to the default model (Prisma v2.5).
  if (!r.ok && STT_MODEL === "prisma-v3.0" && [400, 403, 422, 500, 504].includes(r.status)) ({ r, body } = await send(false));
  if (!r.ok) throw new GnaniError(explain(r.status, body), r.status === 429 ? 429 : 502);
  return String(body.transcript || "").trim();
}

// Returns a WAV Buffer of the spoken text.
async function synthesize(text, lang) {
  const language = LANGS.includes(lang) ? lang : "hi-IN";
  const r = await fetch(`${BASE}/api/v1/tts/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key-ID": key() },
    body: JSON.stringify({
      text, voice: VOICES[language], model: TTS_MODEL, language, speed: 1.0,
      audio_config: { sample_rate: 48000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" },
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new GnaniError(explain(r.status, body), r.status === 429 ? 429 : 502);
  }
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { transcribe, synthesize, GnaniError, LANGS };
