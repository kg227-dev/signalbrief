# SignalBrief — Weekly Metrics Dashboard

*Check every Monday morning before doing anything else. Takes 10 minutes.*
*All data available from: `/admin` dashboard + `data/engagement-events.jsonl` + `data/cost-log.json`*

---

## THE 5 NUMBERS

| # | Metric | This Week | Last Week | Target | Status |
|---|--------|-----------|-----------|--------|--------|
| 1 | Active subscribers | | | → | |
| 2 | 7-day avg open rate | | | >45% | |
| 3 | New signups this week | | | → | |
| 4 | Digest #2 open rate (new users) | | | >40% | |
| 5 | Unsubscribes / pauses this week | | | <3 | |

---

## EXTENDED VIEW (check monthly, not weekly)

| Metric | This Month | Last Month | Target |
|--------|-----------|------------|--------|
| Total digests sent | | | |
| Click-through rate (any link) | | | >15% |
| Telegram interactions | | | |
| Referral signups | | | growing |
| Cost per digest run | | | <$0.50 |
| Resend reputation / spam rate | | | <0.08% |

---

## TRAFFIC LIGHTS

Use this to assess overall health each week:

**🟢 Green (product working)**
- Open rate >45%
- Digest #2 open rate >40%
- Unsubscribes ≤2/week
- New signups ≥3/week

**🟡 Yellow (investigate)**
- Open rate 30–45%
- Digest #2 open rate 30–40%
- 3–5 unsubscribes/week
- New signups 1–2/week

**🔴 Red (stop marketing, fix product first)**
- Open rate <30%
- Digest #2 open rate <30%
- >5 unsubscribes/week
- Any spam complaint

---

## WEEK-BY-WEEK LOG

### Week of ___________

**The 5 numbers:**
1. Active subscribers: ___
2. 7-day open rate: ___%
3. New signups: ___
4. Digest #2 open rate: ___%
5. Unsubscribes/pauses: ___

**Traffic light:** 🟢 / 🟡 / 🔴

**What drove signups this week:**
- [e.g. LinkedIn post on Tuesday / Reddit thread / personal DM]

**What I'm changing next week:**
- [1–2 actions based on the data]

**Best-performing digest this week (highest open/click rate):**
- Date: ___ | Subject line: ___ | Open rate: ___%

---

*(Copy and paste the section above each Monday)*

---

## HOW TO PULL EACH METRIC

**Active subscribers:**
```bash
# Count user files where status = "active"
node -e "
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../data');
const files = fs.readdirSync(dir).filter(f => f.startsWith('user-') && f.endsWith('.json'));
const active = files.filter(f => {
  try { const u = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); return u.status==='active'; } catch { return false; }
});
console.log('Active:', active.length);
"
```

**Open rate (approximate):**
Check your Resend dashboard at resend.com/emails for delivery and open stats. Filter to the last 7 days.

**New signups this week:**
Check user files by `joined_at` date, or check the admin dashboard `/admin` → user roster → sort by joined date.

**Digest #2 open rate:**
Look at `digests_received` field in user files. For users with `digests_received === 1` who joined this week, check if they have `digests_received === 2` yet. If you have engagement tracking working (engagement-events.jsonl), filter for `event_type: "email_open"` from users in their first week.

**Unsubscribes:**
Check `/admin` → user roster → filter by `status: "unsubscribed"` with `last_digest_at` in the last 7 days.

---

## QUARTERLY REVIEW QUESTIONS

Answer these every 30 days:

1. **Is the product getting better?** Is the average quality score (from `quality_history` in user files) trending up?
2. **Is personalization working?** Are power users (5+ digests) clicking at a higher rate than new users?
3. **What's the most common topic combo?** Are there clusters of users with similar profiles I could target with outreach?
4. **What's the most saved story type?** (From `bookmarks` in user files) — this is the product's highest-value content.
5. **What's my referral rate?** What % of new signups this month came from an existing reader?
6. **What would make this a 10/10 product for my best reader?** (Ask them directly.)
