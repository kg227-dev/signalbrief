# SignalBrief CMO Playbook: 0 → 100 Daily Readers in 90 Days

*Written March 6, 2026 · Grounded in the live product at getsignalbrief.com*

---

## 1. Launch Readiness Audit

### What's built (and it's a lot)

The product is substantially more complete than most things at this stage. You have a live onboarding flow at getsignalbrief.com with a 4-step form (details → topics → depth → schedule), 17 well-structured topics across industries and capabilities, personalization via topic weights and custom topics, a welcome email that actually explains how to use the product, Telegram integration with natural-language commands, an archive viewer, settings page, auto-topic learning from engagement signals, and a quality scoring system. The email template is polished — blue accent, quick-scan header, lead story with blue border, "Why It Matters" analysis, relevance badges, and a forward CTA already baked in.

You're running on Cloudflare Tunnel, Resend for email, Perplexity Sonar for news, Claude Haiku for enrichment. The digest fires at 6:45 AM ET Mon–Sat via LaunchAgent.

### The critical path: signup → first digest → second digest

Here's where the gap is. A stranger signs up today and gets a welcome email confirming their setup. Their first *actual* digest arrives **tomorrow morning**. That's a 12–24 hour gap where the user has zero evidence the product works. By the time the digest arrives, they may have already forgotten they signed up.

**The fix that matters most:** Send a sample digest immediately after signup. Not tomorrow — right now. This is the single highest-leverage engineering task. It doesn't need to be a full personalized run. It can be today's digest (already generated for existing users) with a banner saying "Here's a preview of what you'll get each morning, now personalized to your topics." If no digest exists yet for today, generate a mini one on the fly. The welcome email is nice, but it's not the product. Show the product.

### Personalization signals at signup

You're capturing: name, email, company (optional), role (optional), 17 topic selections, custom topics, depth preference (headline_only, brief, detailed), delivery time, frequency, and days of week. That's genuinely excellent for day-one personalization — far more than most newsletters collect. The 60/40 scoring split (baseScore × topicMatch) means a 5-topic user will get a meaningfully different digest than a 12-topic user from day one.

The cold-start risk is moderate, not severe. The topic selection alone gives you enough to filter and rank. Where it *will* feel generic is the "Why It Matters" analysis — on day one, Haiku doesn't know the user's seniority, their firm type, or what angle they care about. A PE associate and a hospital CFO selecting "HEALTHCARE" want very different analysis. But this is a week-2 problem, not a launch blocker.

### Launch readiness: 7/10

What makes it a 7: the product works, the onboarding captures the right signals, the email is well-designed, the editorial voice is sharp, personalization is real (not fake), and the infrastructure is solid.

What would make it a 10:
- Instant sample digest on signup (the biggest gap)
- A public digest page that non-subscribers can view (you have `buildPublicDigestUrl` — is it live and working? If so, this is your single best acquisition tool)
- One testimonial or social proof element on the landing page
- Email open tracking (do you have this via Resend?)
- A "reply to this email" CTA in the first digest to create a two-way relationship

---

## 2. ICP & Positioning

### The hyper-specific early adopter

Forget "knowledge workers." Your first 100 readers are:

**Primary ICP: The junior-to-mid strategy consultant (analyst through engagement manager) at a generalist firm or boutique, 1–5 years in.** They're at places like McKinsey, Bain, BCG, Deloitte S&O, LEK, OC&C, Kearney, or sector-focused boutiques. They need to sound smart about industries they just got staffed on. They subscribe to Matt Levine, Stratechery, Lenny's Newsletter, and maybe The Diff or Newcomer. They complain on Fishbowl and r/consulting about drowning in pre-read prep. They have 45 minutes on the train and need to know what happened overnight across 3–4 sectors. They forward articles to project Slack channels to look proactive.

**Secondary ICP: The corporate strategy / corp dev associate at a Fortune 500.** They sit in a strategy or M&A team, need to brief their VP on sector trends for board decks, and currently cobble together a morning routine of WSJ, Bloomberg, and 4 niche newsletters. They'd kill for one email that covers their cross-sector scope.

**Why these people, specifically:** They have an *acute daily need* (they're evaluated on being informed), they're *multi-sector* (so the 17-topic architecture serves them perfectly), and they *talk to each other constantly* (consulting cohorts, MBA group chats, project teams). One reader at McKinsey who finds this valuable will share it with their case team of 4.

### Positioning statement

"SignalBrief gives strategy professionals a personalized 5-minute morning briefing across every sector and capability they cover — with 'why it matters' analysis written at the level you'd put in a client deck."

### The enemy

**Tab hoarding.** Not information overload in the abstract — the specific behavior of opening 8 newsletters, 3 news sites, and a Bloomberg terminal, skimming none of them thoroughly, and still feeling behind. The villain is the 35-minute morning scatter where you read a lot and retain nothing useful. SignalBrief replaces that with 5 focused minutes.

### The promise

"Every morning, you'll get the 5–7 signals that actually matter across your sectors — with the 'so what' already written — so you never have to wonder what you missed before a client call."

### Honest differentiation from Morning Brew / Feedly / RSS

Morning Brew is consumer-grade entertainment written for people who want to sound smart at brunch. It's not sector-specific, not personalized, and the analysis is shallow. Feedly and RSS are tools, not products — they require you to curate your own sources and do your own filtering. The real differentiator here is the **cross-sector personalization + consultant-grade analysis combo.** No one else gives you healthcare M&A + AI policy + PE deal flow + sustainability in one personalized email with analysis that names who's affected and what moves. That's genuinely novel. The closest competitor is a well-staffed research team, and those cost $50k/year.

---

## 3. Quiet Launch: First 100 Users Playbook

### The sourcing mix

| Channel | Target | Users |
|---------|--------|-------|
| Personal network | Consultants, corp strategy people you know | 15 |
| LinkedIn content | Strategy/consulting audience | 25 |
| Community seeding | Reddit, Fishbowl, Slack groups | 25 |
| Direct outreach (DMs) | Targeted consultants and corp dev people | 20 |
| Referrals from early readers | Friends-of-friends | 15 |

### Channel 1: Personal network (15 users)

**The ask (send via text or DM, not email — higher response rate):**

> Hey [name] — I built something I think you'd actually use. It's a daily email digest that covers signals across [their sectors — e.g. "healthcare, PE, and AI"] with a "why it matters" layer written at strategy-grade level. Think of it like having a research analyst curate your morning read. I'm looking for 20 people to try it for 2 weeks and tell me if it earns a spot in your morning. Takes 60 seconds to set up: getsignalbrief.com — would you give it a shot?

**Key:** Don't ask "would you be interested?" Ask "would you give it a shot?" The first is a question about feelings. The second is a request for action. Also: personalize the sectors to what they actually work on. If they're in healthcare PE, say "healthcare and PE deal flow."

**Qualifying signal:** If they respond with a question about what sectors it covers or how it works, they're a likely daily reader. If they say "cool, I'll check it out" — follow up in 48 hours with "did you get your first digest?"

### Channel 2: LinkedIn content (25 users)

**The strategy:** Don't post "I built a newsletter, please sign up." Instead, post the *output* of the product as content. Take today's digest, extract the most interesting signal, and write a 200-word LinkedIn post about it. End with: "I get signals like this every morning via a daily briefing I built for strategy professionals. If you want to try it: getsignalbrief.com"

**5 post formats that work:**

1. **The "I almost missed this" post:** "Everyone's talking about [big news]. But the signal that actually matters for consulting is [your WIM analysis]. This is exactly the kind of thing I built SignalBrief to catch — the second-order implication that doesn't make the Bloomberg headline."

2. **The "cross-sector collision" post:** "A healthcare policy change is about to create a $2B PE opportunity. Here's how..." (Draw from two topics in your digest to show the cross-sector value.)

3. **The "morning routine" post:** "My morning used to be: open WSJ, open Bloomberg, open 4 newsletters, skim all of them, retain nothing. Now it's: read one 5-minute briefing, know exactly what matters across my sectors. I built SignalBrief because the scatter was killing my mornings."

4. **The "hot take" post:** Take a contrarian angle from your WIM analysis. "Everyone thinks [X] is bullish for [sector]. Here's why it's actually a red flag for [specific players]."

5. **The "this week in signals" Friday roundup:** "5 signals from this week that strategy teams should be tracking" — with a CTA to get them daily.

**Post frequency:** 3x/week. Monday, Wednesday, Friday. Morning between 7–8 AM ET (when your ICP is commuting).

**Where to find the audience:** Search LinkedIn for "strategy consultant," "engagement manager McKinsey," "associate Bain," "corporate strategy," "corp dev." Comment on their posts first. Build familiarity before posting. Join LinkedIn groups: "Management Consulting Network," "Strategy & Corporate Finance Professionals."

### Channel 3: Community seeding (25 users)

**Reddit:**

- **r/consulting** (340k members) — The epicenter. Don't post a promo. Instead, find the weekly "what's happening in your practice" thread and share a genuinely useful insight from your digest. Add "I get this from a daily briefing I built — happy to share the link if anyone wants it." Let people ask. Then DM.
- **r/MBA** (220k members) — Post in "career advice" context: "How I stay on top of sector news across 5 industries without drowning in newsletters." Then mention SignalBrief as the tool.
- **r/FinancialCareers** — Same approach. The PE×M&A and Financial Services topics are catnip here.

**Fishbowl:**
- The "Consulting" and "Strategy" bowls. Post: "What's your morning news routine? I've been using an AI-curated briefing that covers [sectors] with a 'why it matters' layer and it's honestly replaced 4 of my newsletters." This reads as organic sharing, not promo.

**Slack groups:**
- **Rand (On Deck's community)** — tech-forward professionals who'd appreciate the AI angle
- **Lenny's Newsletter community** — product-minded people who appreciate well-built tools
- **Pavilion (Revenue Collective)** — senior strategy/ops people

**The approach everywhere:** Lead with value, not with the product. Share an insight. If people engage, mention the source. Never post a signup link as your first interaction in any community.

### Channel 4: Direct outreach via DMs (20 users)

**Who to DM:** Search Twitter/X for people who tweet about consulting, strategy, or sector analysis. Look for people who share newsletter recommendations. They're already newsletter-curious and multi-sector.

**The DM script (Twitter/X):**

> Hey [name] — saw your thread on [topic]. I built a daily briefing for strategy professionals that covers signals across [relevant sectors] with a "why it matters" analysis. I'm looking for 20 early readers to shape the product. Would you want to try it for a week? Takes 60 seconds: getsignalbrief.com

**LinkedIn DM script (for people you have a mutual connection with):**

> Hi [name] — [mutual connection] mentioned you're in [role]. I'm building a daily briefing for people who cover multiple sectors — AI-curated signals with consultant-grade analysis. Looking for early readers from [their firm type]. Would you try it for a week and tell me if it saves you time? getsignalbrief.com

**Volume:** Send 5 DMs/day. Expect a 20% response rate, 50% of responders will sign up. That's 0.5 signups/day, 20 in 40 days.

### The invite framing

Use **"early reader"** — not "beta" (implies bugs), not "founding member" (overused), not "early access" (implies a waitlist that doesn't exist). "Early reader" says: you're one of the first people reading this, your feedback shapes it, and there's something intimate about being in the first cohort. It's honest and creates soft exclusivity.

Add to the welcome email: "You're one of SignalBrief's first 50 readers. Reply to any digest with feedback — I read every one."

---

## 4. Email Strategy: Engineering Daily Opens

### Subject line strategy

The subject line for a daily digest has one job: be useful enough that skipping it feels like a risk. No clickbait. No emojis (you're writing for consultants, not creators). The best formula: **[Topic tag] + [Specific signal] + [Implication hint]**.

**5 subject lines for a busy professional at 7 AM:**

1. `PE deal flow slowing — but not where you'd expect`
2. `Healthcare M&A: CMS rule could unwind 3 pending mergers`
3. `AI × Energy: the infrastructure bottleneck nobody's pricing in`
4. `Your Wednesday signals: 7 moves across healthcare, PE, and policy`
5. `The sustainability signal that hit financial services this week`

**The pattern:** Specificity signals value. "Weekly news roundup" gets a 15% open rate. "CMS rule could unwind 3 pending mergers" gets 55%. Use the lead story's WIM angle as the subject line. Rotate between sector-specific hooks (lines 1–3) and digest-summary framing (lines 4–5).

**What to A/B test once you have 50+ readers:** Sector tag in subject vs. no tag. Question format vs. statement. Signal-forward ("AI × Energy bottleneck") vs. implication-forward ("Nobody's pricing this in").

### Send time

**6:45 AM ET is correct.** Research from Mailchimp, HubSpot, and Superhuman all converge on the same window for B2B professionals: 6:30–7:30 AM. Your ICP is either commuting, in bed checking email, or at their desk early. The digest needs to be there when they first open their inbox — not competing with the 9 AM meeting avalanche.

One refinement: you already capture `delivery_time` per user. Consider shifting the default to **6:30 AM ET** — catching people 15 minutes earlier means you're the first thing they see, not the third.

**Weekend sends:** Your cron runs Mon–Sat. Saturday at 6:45 AM is fine for the "daily all" crowd, but watch open rates. If Saturday consistently drops below 30%, suggest users switch to weekday-only (you already support this with `days_of_week`). Don't send Sundays unless users opt in.

### The hook: first 3 lines

Your "Quick Scan" section is already doing the right thing — it gives readers a scannable index of today's signals before they commit to scrolling. That's the hook. The first 3 lines of the email (in the preview pane) need to be the Quick Scan or a one-line editorial note.

**Recommendation:** Add a rotating one-line editorial note above the Quick Scan, visible in the email preview:

- *"3 signals worth flagging to your team today."*
- *"The PE story in #4 has implications for anyone in healthcare."*
- *"Light day for macro, heavy day for sector-specific moves."*

This editorial voice — brief, opinionated, useful — is what makes someone scroll instead of archive.

### Personalization signals to track

You're already tracking engagement events (opens, clicks, saves, topic adjustments). The minimum viable personalization loop:

1. **Click-through by topic tag** — if a user consistently clicks Healthcare and PE links but ignores Sustainability, boost Healthcare/PE weights automatically. You have `applyAutoTopicLearning` — make sure it's running.
2. **Save behavior** — "save 3" on Telegram is an extremely high-intent signal. Items that get saved should boost their topic's weight 2x more than a click.
3. **Topic adjustment commands** — "more PE" and "less healthcare" are explicit preferences. These are already implemented.
4. **Open rate per user** — if a user opens 6 of 7 digests, they're hooked. If they open 2 of 7, they're at risk. This should trigger different re-engagement behavior.

**What you don't need yet:** Scroll depth, time-on-email, or click-through rates per story. Those are scale metrics. At 100 users, the signals above are sufficient.

### Re-engagement: the 3-day non-opener email

A user hasn't opened in 3 days. Here's the email:

**Subject:** `Your SignalBrief is still running — want to adjust anything?`

**Body:**

> Hi [name],
>
> I noticed you haven't opened SignalBrief in a few days. No judgment — inboxes are brutal.
>
> A few things that might help:
> - **Wrong topics?** [Update your topics](settings link) — takes 30 seconds
> - **Wrong time?** Your digest arrives at [their delivery time]. You can change it [here](settings link).
> - **Too much?** Switch to "headline only" depth for a faster scan — [adjust here](settings link).
>
> Or just reply to this email and tell me what's not working. I read every reply.
>
> — Kush

**When to send it:** Day 4 of consecutive non-opens. Not day 2 (too eager) and not day 7 (too late — they've already mentally unsubscribed).

**If they don't open the re-engagement email:** Send one more on day 8 with subject "Should I pause your digest?" and a one-click pause option. After that, auto-pause and stop sending. Dead subscribers hurt deliverability.

### Unsubscribe prevention

**The churn moment:** Day 3–5 is the highest-risk window. The novelty has worn off, and the digest either has or hasn't earned its place. The most common reason for early churn isn't "bad content" — it's "not personalized enough yet." The user selected Healthcare and AI but keeps getting Industrial and Sustainability stories ranked too high.

**Intervention:** After digest #3, include a one-line note in the email: "Your brief is getting smarter. Tap 'more' or 'less' on any topic to tune it, or [update your topics here](settings link)." Remind them that the product improves with use. This reframes "not perfect yet" as "learning phase" instead of "bad product."

---

## 5. Organic & Content Strategy

### SEO: 5 search queries worth targeting

1. `best newsletters for consultants` — high intent, moderate competition
2. `daily news digest for strategy professionals` — low competition, exact match for your product
3. `AI curated news briefing` — growing search volume, tech-forward audience
4. `morning news routine for professionals` — broad but captures the behavior you're replacing
5. `personalized news digest` — product-category search

Your homepage already has good meta tags and structured data. The missing piece is **content pages** that rank for these terms.

### Content wedge

**The play:** Publish the top 3 signals from each day's digest as a public page. You already have `buildPublicDigestUrl(dateKey)` generating URLs like `getsignalbrief.com/digest/2026-03-06`. If these pages are publicly accessible with proper SEO, they become your content engine. Each day's page targets long-tail queries like "healthcare M&A news March 2026" or "PE deal flow this week."

**The "demo in public" strategy:** The public digest page *is* the demo. Share it on LinkedIn/Twitter. Let people see exactly what they'd get — but with a banner at the top: "This is today's SignalBrief. Get yours personalized and delivered every morning → [sign up]."

**LinkedIn post that shows, not tells:**

> This morning's SignalBrief caught something I would have missed:
>
> [One-line description of the most interesting signal]
>
> The "why it matters": [2-sentence WIM analysis from the digest]
>
> I get 5–7 of these every morning, personalized to the sectors I cover. If you're in strategy/consulting and want to try it: getsignalbrief.com

### 3 blog post topics that rank and convert

1. **"The Best Morning News Routine for Strategy Consultants (2026)"** — Listicle format. Mention 5–6 tools/newsletters, position SignalBrief as the "one email that replaces the stack." Targets: "morning routine consultant," "best newsletters consultant."

2. **"How AI Is Changing How Professionals Consume News"** — Thought leadership angle. Discuss the shift from curated-by-humans to curated-by-AI. Reference Perplexity, Claude, etc. Position SignalBrief as a live example. Targets: "AI news curation," "AI newsletter."

3. **"What Strategy Consultants Actually Need to Know Each Morning"** — Framework piece. Break down the information diet of a good consultant: sector signals, policy moves, deal flow, cross-sector implications. Position SignalBrief as the product that delivers this framework daily. Targets: "consulting news," "strategy consultant resources."

Publish these on a `/blog` route on getsignalbrief.com. No WordPress needed — static HTML served by your existing Node server is fine. SEO value compounds over 2–3 months.

---

## 6. Word-of-Mouth & Viral Loops

### The forward trigger

Your email already has "Share today's brief →" and "Forward to a colleague →" buttons. Good. But the *content* trigger matters more than the button. The most forwarded content is:

1. **Cross-sector collision stories** — "A healthcare policy change creates a PE opportunity" gets forwarded because it surprises. The reader thinks: "My colleague in PE needs to see this."
2. **Contrarian WIM analysis** — When your "Why It Matters" says something the mainstream narrative doesn't, readers forward it as intellectual ammunition.
3. **The lead story** — Your ★ LEAD with blue border is the natural forward candidate. Make sure it's always the most forward-worthy story, not just the highest-scored.

**Addition to engineer forwards:** After the lead story, add a one-line CTA: *"Know someone who covers [lead story's sector]? They'd want to see this → [forward link]"*. Make the forward feel like a favor to the colleague, not a favor to you.

### Referral mechanic (no engineering required)

**Version 1 (today, zero code):** In every email footer, add: "Enjoying SignalBrief? Forward this to a colleague. When they sign up, they'll get a personalized version of what you just read." The forward CTA is already there — this just adds the "why" framing.

**Version 2 (minimal engineering):** Add a `?ref=[user_token]` parameter to the signup URL. When someone signs up via a referral link, log it. Send the referrer a thank-you email: "Thanks for sharing SignalBrief with [first name]. Your briefing is making the rounds." No rewards — just acknowledgment. The dopamine hit of "my recommendation led to a signup" is enough for the first 100 users. Add tracking via a `ref` query param on getsignalbrief.com → capture in signup payload.

### 3 communities with highest ICP concentration

1. **r/consulting** (Reddit, 340k members) — The single highest concentration of strategy consultants online. Post insights, never promos. Participate for 2 weeks before mentioning SignalBrief.

2. **Fishbowl "Consulting" bowl** — Verified professionals. The tone is candid and recommendation-friendly. "What newsletters do you read?" threads appear weekly. That's your opening.

3. **MBA WhatsApp/Slack groups from top programs** (Wharton, HBS, CBS, Booth, Kellogg) — If you or anyone in your network has access, a personal recommendation in these groups converts at 30%+. These are tight-trust networks where peer recommendations carry enormous weight.

### Turning first 20 users into a marketing asset

After a user has received 5+ digests, send this email:

> Subject: Quick favor — 2 sentences
>
> Hi [name],
>
> You've been reading SignalBrief for a week now. If it's been useful, would you mind sending me 1–2 sentences on what you like about it? I'm collecting feedback from early readers.
>
> No pressure — but if you do, I might feature it (with your permission) on the site.
>
> — Kush

Collect 5–8 of these. Add them to the landing page as: **"Read by strategy professionals at [Company 1], [Company 2], [Company 3]"** — with their one-line quotes. Even 3 testimonials from recognizable firms (McKinsey, Deloitte, Goldman, Google Strategy) transforms the landing page conversion rate.

---

## 7. Metrics That Actually Matter

### Primary KPI: Daily open rate

**Target: >45%.** Why this benchmark? The average newsletter open rate is 21% (Mailchimp 2025 data). The best daily newsletters (Morning Brew, The Hustle at peak) hit 40–45%. For a *personalized* digest with a *niche professional audience*, 45% is the minimum bar that says "this is a daily habit, not an occasional skim." Below 35%, you have a content or personalization problem. Below 25%, you have a product-market fit problem.

**How to track it:** Resend provides open tracking via pixel. Check if it's enabled. If not, add an invisible tracking pixel to the email template with a unique URL per user per digest (e.g., `getsignalbrief.com/t/[digest_id]/[user_token]/o.gif`). Log the request in your existing engagement-events system.

### Leading indicators of retention (week 1)

- **Opens digest #2:** If they open the second digest, they're 3x more likely to be a daily reader at week 4. This is the single strongest early signal.
- **Clicks a link in digest #1 or #2:** A click means they found something worth investigating. Retention correlation: very high.
- **Adjusts topics or settings in week 1:** Self-customization = ownership = retention. Anyone who tweaks their setup in the first 3 days is almost certainly going to stick.
- **Saves an item via Telegram:** Very high-intent action. Users who save in week 1 have the strongest retention.

### The metric that kills the product

**Digest #2 open rate below 40%.** If fewer than 40% of people who open the first digest open the second, the first digest failed to demonstrate enough value to earn the second open. At that point, you have a content quality problem or a personalization cold-start problem — no amount of marketing fixes a product that doesn't earn the second open.

### Weekly Monday dashboard (5 numbers)

1. **Total active subscribers** (status = active, email_enabled = true)
2. **Daily open rate** (trailing 7-day average)
3. **New signups this week** (with source if you track it)
4. **Digest #2 open rate** (of users who received their first digest this week)
5. **Unsubscribes this week** (and which digest they churned on)

### Tracking setup

You already have a solid data layer: cost-log.json, engagement-events.jsonl, per-user JSON files with `digests_received`, `last_digest_at`, and quality history. What you need is a view.

**Simplest approach:** Extend your existing admin dashboard (`/admin`) to show the 5 Monday numbers. You already have the admin page with cost cards and user roster. Add an "Engagement" section with open rates and a retention cohort view. This is a 2–3 hour engineering task using your existing data.

**If you want something external:** Use a Google Sheet with a daily cron that appends a row with the 5 metrics. No Notion, no Loops, no analytics tools. A spreadsheet you check every Monday morning.

---

## 8. 30-60-90 Day Marketing Roadmap

### Days 1–30: Get to 30 daily readers

- [ ] **Day 1–2: Instant sample digest on signup.** This is the #1 engineering priority. When someone completes onboarding, send them today's digest (or a sample) immediately. Do not let them wait 24 hours for proof of value. (Engineering required)
- [ ] **Day 1–2: Verify email open tracking is working.** Confirm Resend is sending open events. If not, add a tracking pixel endpoint. Without this, you're flying blind. (Engineering required)
- [ ] **Day 1–3: Personal outreach to 15 people you know.** Use the DM script above. Text, WhatsApp, LinkedIn DM — not email. Follow up on day 3 if they haven't signed up.
- [ ] **Day 3: Send first "early reader" ask to your 15.** After they've received 2+ digests: "Is this earning a spot in your morning? What would make it better?"
- [ ] **Day 3–7: Post 2 LinkedIn pieces.** Use the "demo in public" format — share an actual insight from the digest, link to signup. Target the consulting/strategy audience.
- [ ] **Day 7: Add referral CTA to email footer.** Simple text: "Enjoying this? Share with a colleague → [signup link with ref tracking]." (Minimal engineering for ref param)
- [ ] **Day 7–14: Community seeding — r/consulting.** Start participating. Share insights. Don't mention the product for 5+ days. Then mention it naturally in a relevant thread.
- [ ] **Day 14: Collect 3–5 testimonials from early readers.** Send the "quick favor" email. Add quotes + company logos to the landing page.
- [ ] **Day 14–21: Direct outreach round — 20 DMs.** Twitter and LinkedIn. Use the scripts above. Target people who engage with consulting/strategy content.
- [ ] **Day 21: Fishbowl seeding.** Post in Consulting and Strategy bowls. Frame as "what newsletters do you read" participation, not promo.
- [ ] **Day 21–30: Post 4 more LinkedIn pieces.** Rotate between hot-take, cross-sector collision, and "my morning routine" formats.
- [ ] **Day 30 checkpoint:** 30+ active readers with >45% daily open rate. If open rate is below 35%, stop all marketing and fix the product.

### Days 31–60: Establish the daily habit loop

- [ ] **Day 31: Implement re-engagement email.** Auto-send to 3-day non-openers using the template above. (Engineering required)
- [ ] **Day 35: Add the editorial one-liner above Quick Scan.** A rotating sentence that makes the preview pane more compelling. (Engineering required)
- [ ] **Day 35: Publish public digest pages.** Make `getsignalbrief.com/digest/[date]` publicly accessible with proper SEO (title, meta description, structured data). Each day's digest becomes a content page. (Engineering required)
- [ ] **Day 40: Write and publish blog post #1.** "The Best Morning News Routine for Strategy Consultants (2026)." Publish on your site. Share on LinkedIn.
- [ ] **Day 40–50: Second round of personal outreach.** Ask your first 15 readers: "Who else would find this useful?" Get 3 warm intros per reader = 45 intros. Even a 10% conversion = 4–5 new readers per intro batch.
- [ ] **Day 50: Subject line A/B testing.** Split your list 50/50. Test sector-tag vs. implication-forward subject lines. Run for 2 weeks.
- [ ] **Day 50: Launch auto-pause for churned users.** If a user hasn't opened in 10+ days, auto-pause and send a "we've paused your digest" email with a one-click reactivate. Protect deliverability. (Engineering required)
- [ ] **Day 60 checkpoint:** 60+ active readers, >45% daily open rate, at least 5 readers who came from referrals.

### Days 61–90: Build the word-of-mouth engine

- [ ] **Day 61: Publish blog post #2.** "How AI Is Changing How Professionals Consume News." Link to SignalBrief as a live example. Share on LinkedIn, Reddit.
- [ ] **Day 65: Add "read by professionals at..." social proof to landing page.** Use the company names from your testimonials. This alone can double conversion rate for cold traffic.
- [ ] **Day 70: Implement referral tracking.** `?ref=[token]` on signup URL → log referral source → send thank-you email to referrer. You don't need a fancy dashboard — just log it. (Engineering required)
- [ ] **Day 70: Publish blog post #3.** "What Strategy Consultants Actually Need to Know Each Morning." This is your evergreen SEO play.
- [ ] **Day 75: Launch a weekly "share your top signal" CTA.** Friday's digest includes: "What was your most useful signal this week? Reply with the number and we'll feature the community's picks next Monday." Creates engagement loop + content.
- [ ] **Day 80: Second community wave.** Revisit r/consulting, Fishbowl, and add r/MBA and r/FinancialCareers. You now have testimonials and public digest pages to reference — you're not promoting vaporware.
- [ ] **Day 85: MBA group outreach.** If you have any MBA network connections, now is the time. "I built this for people like us" in a Wharton/HBS Slack group converts at 25%+.
- [ ] **Day 90 checkpoint:** 100+ active readers, >45% daily open rate, 20%+ of new signups coming from referrals, public digest pages getting organic search traffic.

---

## 9. Hard Truths & Risk Flags

### #1 reason personalized digests fail to build daily habits

**The content isn't surprising enough.** A daily email that tells you what you already know from Twitter or Bloomberg is dead on arrival. The value of SignalBrief isn't aggregation — any RSS reader does that. The value is the WIM analysis and the cross-sector signals you'd miss. If the "Why It Matters" layer starts feeling generic ("this could have significant implications for the sector"), users will stop opening. The editorial voice — sharp, specific, naming who's affected and what moves — is the product. If that quality degrades, nothing else matters.

**How to avoid it:** Read your own digest every morning as a user. Ask yourself: "Did I learn something I wouldn't have known otherwise?" If the answer is no for 2 days in a row, the enrichment prompts need tuning. The quality score system you've built is good — use it. Set an alert if average quality score drops below 7/10.

### Cold start problem

Moderate, not severe. The 17-topic architecture + depth selection gives you enough signal to make day 1 feel non-generic. The risk is that a user who selects 3 topics gets a digest that feels thin (only 3 of 7 items match their topics), while a user who selects 12 gets a digest that feels scattered. The mitigation: for users with 3 or fewer topics, weight their topics at 80% instead of 40%, and fill the remaining slots with high-baseScore stories regardless of topic match. For users with 10+ topics, cap the topic weight at 30% and let quality dominate. This is a personalization tuning task, not a marketing task.

### Biggest competitor threat: the behavior, not the company

**The threat is "I'll just check Twitter."** The habit of opening Twitter/X at 7 AM and scrolling the timeline for 10 minutes is deeply entrenched. It feels more current, more social, and more serendipitous than an email. SignalBrief's counter: **email is completable, Twitter is not.** You finish a digest. You never finish Twitter. The positioning should lean into this: "5 minutes, done, you're briefed." Completeness is the product's secret weapon. A consultant with a 7:30 AM meeting needs to feel briefed in 5 minutes, not 5 minutes into an infinite scroll.

### Why would someone open this instead of their existing morning routine?

Honest answer: they won't — not at first. The first 3 digests are a trial. They'll open SignalBrief *and* check their other sources. By day 5, if SignalBrief is consistently catching signals they didn't see elsewhere, they'll start skipping one newsletter. By day 10, they'll forward a story to a colleague and realize this is the only digest they do that with. The switch isn't sudden — it's gradual replacement. That's why the first 5 digests have to be excellent. Not good. Excellent.

---

## CMO's TL;DR

**The single most important thing to get right in the first 30 days is the first-to-second digest conversion.** If someone signs up, receives their first digest, and opens the second one the next morning, you have a reader. If they don't open the second, you've lost them — probably forever. Everything else — the LinkedIn posts, the community seeding, the referral loops — is pipeline filling. The product's job is conversion and retention. Right now, the biggest threat to that is the 12–24 hour gap between signup and first digest. Fix that first. Send a sample digest immediately on signup. Then make sure every single digest earns the next open with sharp, specific, surprising analysis that a consultant would be embarrassed to have missed. If your digest #2 open rate is below 40% after the first 30 signups, stop all marketing and fix the product. Acquiring users into a leaky bucket is the most expensive mistake a solo founder can make. Fill the bucket first. Then turn on the tap.
