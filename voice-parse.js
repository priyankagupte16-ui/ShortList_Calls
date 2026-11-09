// Turns a spoken-answer transcript (Hindi, Marathi, English or a mix) into a value
// for one of the five screening questions. Returns { value, understood }.
// If understood is false, the recruiter types the value in by hand.

const tokens = (t) => String(t || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];

const YES = new Set(["हाँ", "हां", "हा", "हो", "होय", "जी", "बिल्कुल", "बिलकुल", "ठीक", "yes", "yeah", "yep", "haan", "haa", "ha", "ji", "sure", "ok", "okay", "correct", "right"]);
const NO = new Set(["नहीं", "नही", "नहि", "नाही", "नको", "no", "nahi", "nahin", "nope", "not"]);
const PROBLEM = new Set(["दिक्कत", "दिक्कतें", "समस्या", "प्रॉब्लम", "problem", "अडचण", "issue"]);

const WORD_NUM = {
  एक: 1, दो: 2, दोन: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, पाच: 5, छह: 6, छः: 6, छे: 6, सहा: 6, सात: 7, आठ: 8, नौ: 9, नऊ: 9, दस: 10, दहा: 10,
  पंद्रह: 15, पंधरा: 15, बीस: 20, वीस: 20, तीस: 30, पचास: 50, पन्नास: 50, सौ: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, fifty: 50,
};
const IMMEDIATE = new Set(["तुरंत", "तुरन्त", "अभी", "लगेच", "आजच", "immediately", "immediate", "now", "abhi", "today", "आज"]);
const NONE = new Set(["फ्रेशर", "फ्रेश", "fresher", "none", "zero", "शून्य", "नहीं", "नही", "नाही", "no", "new", "नया"]);

function parseYesNo(text) {
  const t = tokens(text);
  const yes = t.some((w) => YES.has(w));
  const no = t.some((w) => NO.has(w));
  const problem = t.some((w) => PROBLEM.has(w));
  if (no && problem) return { value: true, understood: true }; // "no problem" means yes
  if (no) return { value: false, understood: true };
  if (yes) return { value: true, understood: true };
  return { value: null, understood: false };
}

// First number in the text. Handles 15,000 / ₹15000 / 15 thousand / words like "पंद्रह".
function firstNumber(text) {
  const s = String(text || "").toLowerCase();
  const m = s.match(/\d[\d,]*(?:\.\d+)?/);
  let n = null;
  if (m) n = parseFloat(m[0].replace(/,/g, ""));
  else {
    for (const w of tokens(s)) if (w in WORD_NUM) { n = WORD_NUM[w]; break; }
  }
  if (n === null) return null;
  if (/हज़ार|हजार|हजार|thousand|\bk\b/.test(s) && n < 1000) n *= 1000;
  if (/लाख|lakh|lac/.test(s) && n < 100) n *= 100000;
  return n;
}

function parseSalary(text) {
  const n = firstNumber(text);
  return n === null ? { value: null, understood: false } : { value: Math.round(n), understood: true };
}

function parseNotice(text) {
  const t = tokens(text);
  if (t.some((w) => IMMEDIATE.has(w))) return { value: 0, understood: true };
  let n = firstNumber(text);
  if (n === null) return { value: null, understood: false };
  const s = String(text).toLowerCase();
  if (/हफ़्त|हफ्त|सप्ताह|आठवड|week/.test(s)) n *= 7;
  else if (/महीन|महिन|month/.test(s)) n *= 30;
  return { value: Math.round(n), understood: true };
}

function parseExperience(text) {
  const s = String(text || "").toLowerCase();
  if (/डेढ़|डेढ|दीड|one and a half/.test(s)) return { value: 1.5, understood: true };
  if (/ढाई|अडीच|two and a half/.test(s)) return { value: 2.5, understood: true };
  let n = firstNumber(s);
  if (n === null) {
    if (tokens(s).some((w) => NONE.has(w))) return { value: 0, understood: true };
    return { value: null, understood: false };
  }
  if (/महीन|महिन|month/.test(s)) n = Math.round((n / 12) * 10) / 10;
  return { value: n, understood: true };
}

const PARSERS = { looking: parseYesNo, shiftOk: parseYesNo, salary: parseSalary, noticeDays: parseNotice, experienceYears: parseExperience };

function parseAnswer(question, text) {
  const p = PARSERS[question];
  return p ? p(text) : { value: null, understood: false };
}

module.exports = { parseAnswer, parseYesNo, parseSalary, parseNotice, parseExperience };
