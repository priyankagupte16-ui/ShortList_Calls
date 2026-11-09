const { parseAnswer } = require("./voice-parse");
const cases = [
  ["looking", "हाँ, अभी भी ढूंढ रहा हूँ", true], ["looking", "नहीं", false], ["looking", "yes sir", true],
  ["shiftOk", "हाँ बिल्कुल, कोई दिक्कत नहीं है", true], ["shiftOk", "नाही, मला जमणार नाही", false], ["shiftOk", "होय", true], ["looking", "hmm", null],
  ["salary", "₹15,000", 15000], ["salary", "15000 रुपये", 15000], ["salary", "15 thousand", 15000], ["salary", "पंद्रह हज़ार", 15000], ["salary", "पाहिजे बारा हजार", null],
  ["noticeDays", "तुरंत", 0], ["noticeDays", "15 दिन", 15], ["noticeDays", "एक हफ्ते में", 7], ["noticeDays", "2 महीने", 60], ["noticeDays", "लगेच", 0],
  ["experienceYears", "2 साल", 2], ["experienceYears", "डेढ़ साल", 1.5], ["experienceYears", "6 महीने", 0.5], ["experienceYears", "fresher हूँ", 0], ["experienceYears", "तीन वर्ष", 3],
];
let bad = 0;
for (const [q, t, want] of cases) {
  const r = parseAnswer(q, t), got = r.understood ? r.value : null;
  const ok = got === want; if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", q.padEnd(16), JSON.stringify(t).padEnd(34), "->", got, ok ? "" : `(wanted ${want})`);
}
console.log(bad ? `${bad} failing` : "all passing"); process.exit(bad ? 1 : 0);
