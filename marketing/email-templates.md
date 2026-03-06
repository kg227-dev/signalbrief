# SignalBrief — Operational Email Templates

*These are transactional/lifecycle emails sent by you personally from your Gmail, not from the digest system. They should feel human — short, direct, no HTML formatting.*

---

## 1. RE-ENGAGEMENT: 3-Day Non-Opener

**Trigger:** User hasn't opened a digest in 3 consecutive days.
**Implement in:** `mailer.js` or a separate re-engagement cron.
**Send from:** digest@getsignalbrief.com

---

**Subject:** `Your SignalBrief is still running — want to adjust anything?`

**Body:**

> Hi [first name],
>
> I noticed you haven't opened SignalBrief in a few days. No judgment — inboxes are brutal.
>
> A few things that might help:
>
> **Wrong topics?** You're currently getting [their topic list, e.g. "Healthcare, AI, and Strategy"]. You can swap any of them out in 30 seconds: [settings link]
>
> **Wrong time?** Your digest arrives at [their delivery time, e.g. "7:00 AM ET"]. Too early, too late? Adjust it here: [settings link]
>
> **Too much text?** Switch to "headline only" depth for a faster scan: [settings link]
>
> Or just reply to this email and tell me what's not working. I read every reply.
>
> — Kush

---

## 2. RE-ENGAGEMENT: 8-Day Non-Opener (Pause Warning)

**Trigger:** User hasn't opened in 8+ consecutive days AND didn't open the 3-day email.
**Action after this:** If no open in 3 more days, auto-pause their digest.

---

**Subject:** `Should I pause your SignalBrief?`

**Body:**

> Hi [first name],
>
> You haven't opened SignalBrief in about a week. I don't want to fill your inbox if it's not useful.
>
> Two options:
>
> **Keep it going:** [One-click reactivate link] — I'll keep sending as normal.
>
> **Pause it:** [One-click pause link] — I'll stop for now. You can restart anytime from [settings link].
>
> No wrong answer. If the timing or topics aren't right, I'd rather pause than have it become noise.
>
> — Kush
>
> P.S. If there's something specific about the digest that isn't working, reply here. Genuinely trying to improve it.

---

## 3. AUTO-PAUSE CONFIRMATION

**Trigger:** User has been auto-paused after 11+ days of no opens.
**Tone:** No guilt, easy reactivation.

---

**Subject:** `We've paused your SignalBrief`

**Body:**

> Hi [first name],
>
> We haven't heard from you in a while, so I've paused your SignalBrief digest to keep your inbox clean.
>
> If you want to restart, it takes one click: [reactivate link]
>
> Your topics and settings are all saved — you'll pick up right where you left off.
>
> And if you want to give me feedback on why it wasn't working for you, hit reply. I genuinely read every one.
>
> — Kush

---

## 4. TESTIMONIAL ASK

**Trigger:** User has received 5+ digests and has opened at least 3 of them.
**Send from:** your personal Gmail (kush@... or wherever), not the digest address — feels more human.

---

**Subject:** `Quick favor — 2 sentences`

**Body:**

> Hi [first name],
>
> You've been reading SignalBrief for about a week. If it's been useful, would you mind sending me 1–2 sentences on what you like about it?
>
> Something like: "It replaced 3 newsletters for me" or "The why-it-matters layer is actually useful, not generic." Anything honest is great — I'm not looking for marketing copy.
>
> I'm collecting quotes from early readers for the website. If you're happy for me to use it, I'd mention your name and company. No pressure to include either.
>
> Just reply here.
>
> — Kush

**What to do with responses:**

Paste the quote, name, and company into a testimonials section on `web/index.html`. Format:

```
"[Quote]"
— [Name], [Role] at [Company]
```

Even adding 3 testimonials with recognizable company names significantly improves landing page conversion.

---

## 5. REFERRAL THANK-YOU

**Trigger:** A new user signs up via a referral link (`?ref=[token]`) from an existing reader.
**Send to:** The reader who made the referral.

---

**Subject:** `Your recommendation just brought someone in 🙌`

**Body:**

> Hey [first name],
>
> Just wanted to let you know — someone signed up for SignalBrief using your referral link. They'll get their first digest tomorrow morning.
>
> Thanks for sharing it. The only way this grows is word of mouth from people like you.
>
> If there's anyone else in your network who covers [their sectors] and drowns in newsletters — now you've got the social proof that someone already took the plunge.
>
> — Kush

*Note: This email requires referral tracking to be implemented (see CMO-PLAYBOOK.md, Day 70 task).*

---

## 6. WEEK-1 CHECK-IN

**Trigger:** 7 days after signup.
**Purpose:** Create two-way relationship before they have a chance to go cold.

---

**Subject:** `One week in — how's SignalBrief working for you?`

**Body:**

> Hi [first name],
>
> You've been reading SignalBrief for a week. I wanted to check in.
>
> Honest question: is it earning a spot in your morning routine? Or is there something about the topics, timing, depth, or analysis quality that isn't quite right?
>
> I'm still in the early stages and every piece of feedback shapes the product. Specifically helpful:
>
> - Are the topics you picked giving you the signals you actually need?
> - Is the "why it matters" analysis hitting the right level — too basic, too detailed, or about right?
> - Is anything feeling like noise?
>
> Just reply here with whatever's on your mind. No pressure to write an essay.
>
> — Kush

---

## 7. WINBACK: 30-DAY CHURNED USER

**Trigger:** User unsubscribed or was auto-paused 30+ days ago.
**Send once, never follow up.**

---

**Subject:** `SignalBrief has changed a bit since you left`

**Body:**

> Hi [first name],
>
> It's been about a month since you stopped getting SignalBrief. I wanted to reach out because the product has changed a lot since then.
>
> [1–2 specific improvements made since they left. E.g.: "The 'why it matters' analysis is now more sector-specific — it names the exact players affected rather than speaking in generalities. We also added custom topic support, so if you work in a niche (GLP-1 drugs, offshore wind, whatever), you can add it directly."]
>
> If those were the reasons it wasn't working, it might be worth another try: [reactivate link]
>
> If the timing or your needs have changed, totally fine. I just wanted to give you one honest update before we lose touch.
>
> — Kush

---

## EMAIL SENDING NOTES

**Which email address to use:**
- Automated lifecycle emails (re-engagement, pause, auto-pause, referral thank-you): `digest@getsignalbrief.com` via Resend
- Personal emails (testimonial ask, week-1 check-in, winback): Your personal Gmail. These need to feel like a human wrote them, not a system.

**Timing:**
- Re-engagement: Day 4 after last open, not day 2 (too eager)
- Pause warning: Day 8 after last open
- Auto-pause: Day 11 after last open
- Week-1 check-in: Day 7 after signup
- Testimonial ask: Day 7–10 after signup, if they've opened 3+ digests
- Winback: 30 days after unsubscribe

**List hygiene:**
After auto-pausing users, remove them from active delivery. They'll still have settings and can reactivate. This protects your Resend sender reputation score. Watch for: spam complaint rate >0.08% (dangerous), unsubscribe rate >0.5%/week (product problem signal).
