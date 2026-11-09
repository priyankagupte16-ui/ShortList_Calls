# ShortlistCalls: bulk hiring screening calls

A full-stack app for small businesses that get hundreds of applications for delivery, telecaller or store-helper jobs.
Load the candidate list once, make the same five screening calls from one console, and get a ranked shortlist.

## Stack
- Backend: Node.js, Express, SQLite (better-sqlite3), JWT login, bcrypt, Gnani AI speech APIs
- Frontend: plain HTML, CSS and JavaScript in `public/index.html`

## Run it
```bash
npm install
cp .env.example .env      # then set JWT_SECRET (or export the variables yourself)
JWT_SECRET=your-long-secret npm start
```
Open http://localhost:3000, create an account and a campaign.

## Voice screening with Gnani AI
In the Call console, **Start voice screening** asks the five questions aloud and listens to the answers.
- **Text-to-speech:** Gnani Timbre v2.5 (voices Nalini for Hindi, Zahira for Marathi, Pranav for English).
- **Speech-to-text:** Gnani Prisma v3.0 (falls back to v2.5 if your key does not have v3.0), with numbers returned as digits.
- `voice-parse.js` turns Hindi, Marathi, English and mixed answers into yes/no, rupees, days and years. Anything it cannot read is flagged for the recruiter to fill in.
- The recruiter always reviews the filled-in answers before saving, so a mis-heard word never silently rejects a candidate.

Setup: put your key in `.env` as `GNANI_API_KEY=...` (create keys at https://app.gnani.ai/voice). The key stays on the server.
Microphone access needs `http://localhost` or HTTPS. Run `npm test` to check the answer parser.

## How it works
1. Create a campaign with the role, shift, salary ceiling and longest acceptable notice period.
2. Paste or upload a CSV of `name,phone` rows. Phones are normalised to 10 digits and duplicates skipped.
3. In the Call console, the next candidate is shown with the five questions. Save answers or mark "No answer". Unanswered candidates are retried up to 3 times.
4. Each answered call is scored (0-100):
   - Not looking, or cannot do the location or shift: not a fit.
   - Otherwise 45 base points, plus salary within budget (25), notice within limit (15) and experience (5 per year, up to 3 years).
   - 75 and above: shortlist. 45 to 74: maybe. Below 45: not a fit.
5. The Shortlist tab shows the ranked list and a CSV download.

Edit `evaluate()` in `server.js` to change the scoring rules.

## API summary
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | Account and token |
| GET, POST | /api/campaigns | List or create |
| GET, DELETE | /api/campaigns/:id | Details and stats, or delete |
| POST | /api/campaigns/:id/candidates | Add candidates from CSV text |
| GET | /api/campaigns/:id/next | Next candidate to call |
| POST | /api/candidates/:id/result | Save a call outcome |
| GET | /api/campaigns/:id/report, /report.csv | Ranked results |

## Next steps
- Fully automated dialling: connect a telephony provider (Exotel or Twilio) so the same voice questions run over real phone calls.
- Candidate self-service link: send each applicant a link on WhatsApp so they answer by voice on their own phone.
- Multi-user teams: add a `caller` role under each employer.
- Deployment: set a strong `JWT_SECRET`, put it behind HTTPS and keep `data.db` on a persistent disk.
