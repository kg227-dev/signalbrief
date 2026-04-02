# SignalBrief - CFO/Growth Strategy & Monetization Playbook

*Moved from `docs/planning/` during the March 20, 2026 docs consolidation. Treat this as a private strategy reference, not as an active execution plan.*

## The Brutal Honest Take on Turning This Into a Business

## Executive TL;DR

- **SignalBrief solves a real pain:** compresses ~45 minutes of daily scanning into a ~3-minute strategic briefing.
- **Best monetization path:** **Freemium + Pro at $29/mo** (fastest path to revenue).
- **Immediate conversion lever:** gate full **"why it matters"** analysis behind Pro.
- **Near-term milestone:** reach **$10K MRR** (~345 Pro subscribers).
- **Big risk:** this is currently more feature than business; moat must come from personalization + workflow lock-in.
- **Priority this week:** ship paywall + Stripe + upgrade CTA in daily digest.

---

## 1) Product Audit

### One-Sentence Pitch (Customer-Facing)

> SignalBrief delivers a personalized, AI-curated daily news briefing across 17 industry and capability topics, with consultant-grade "why it matters" analysis, straight to your Telegram and email inbox every morning.

### Most Obvious Buyer Right Now

- Strategy consultants
- Corporate development professionals
- PE associates
- Senior operators at mid-market companies

These users currently spend **30-60 minutes/day** stitching together Morning Brew, WSJ, niche newsletters, and Google Alerts.

### Core Value

- **Time arbitrage:** turns manual scanning into pre-digested intelligence.
- **Killer feature:** consultant-grade **"why it matters"** framing (not just headlines).

### "Aha" Moment

- User reads SignalBrief at **7:00 AM**.
- Walks into a **9:00 AM** meeting already fluent on a new deal/regulation/trend.
- They look sharp without extra prep.

### Features Screaming for a Paywall (Currently Free)

| Feature | Why It Should Be Paid |
| --- | --- |
| 17-topic multi-industry coverage | Enterprise-grade breadth currently given away |
| Custom topics (`GLP-1`, `DOGE`, `quantum computing`) | Personalization is premium value |
| On-demand `/digest` command | Real-time intelligence on demand |
| Archive browsing | Historical intelligence database |
| "Why it matters" depth toggle | Analysis layer is core moat |
| Bookmark system | Users build their own intelligence library |
| Claude-powered Q&A in Telegram | Effectively a strategy AI assistant |

---

## 2) Pricing & Monetization Models

### Model A: Freemium + Pro (**#1 Bet**)

**Why it fits:** natural free/paid boundaries already exist in the codebase (`items_per_digest`, depth settings, custom topics), so gating is low-effort.

#### Plan Comparison

| Capability | Free | Pro ($29/mo) | Team ($19/seat/mo, min 5) |
| --- | --- | --- | --- |
| Items per digest | 5 | 10+ | 10+ |
| Topics | 5 of 17 | All 17 | All 17 + custom |
| Custom topics | 0 | 3 | Unlimited |
| Analysis depth | Headlines only | Full "why it matters" | Full + executive summary |
| On-demand `/digest` | 1x/week | Unlimited | Unlimited |
| Archive access | Last 7 days | Full history | Full + shared bookmarks |
| AI Q&A replies | None | 10/day | Unlimited |
| Delivery channels | Email only | Email + Telegram | Email + Telegram + Slack |
| Bookmarks | 10 max | Unlimited | Shared team library |

#### Why $29/mo Works

- Sits between "throwaway expense" and "needs procurement".
- Lower than WSJ (~$44/mo).
- Lower than The Information (~$449/yr).
- Replaces high-cost manual workflow (~45 min/day for high-income professionals).

### Model B: Usage-Based / Credit System

**Why it fits:** marginal cost is measurable already (Perplexity Sonar + Claude Haiku).

| Tier | Credits / Limits |
| --- | --- |
| Free | 5 credits/week (1 digest = 1 credit) |
| Starter ($9/mo) | 30 credits |
| Pro ($29/mo) | Unlimited digests + 50 AI Q&A credits |
| Overage | $0.50/credit |

**Downside:** adds friction to a daily-habit product.

### Model C: Enterprise / Team License

**Why it fits:** consulting firms, PE funds, corp strategy teams have highest WTP.

- **Target pricing:** $200-500/seat/month
- **5-seat minimum**
- **Custom topic packs** (ex: PE deal flow)
- **SSO/SAML** (build required)
- Shared bookmarks + weekly team rollups
- Dedicated Slack delivery
- White-label option

### 🏆 #1 Monetization Bet: Freemium + Pro at $29/mo

**Reasoning:**

- This is a daily individual habit product.
- Individual conversion is faster than 3-6 month enterprise cycles.
- Get to **$10K MRR** with Pro subs, then upsell teams.
- Existing per-user store (`data/user-{chatId}.json`) already supports gating logic.

### Specific Paywall Insertion Points in the Codebase

| File / Function | Monetization Gate |
| --- | --- |
| `digest.js -> selectItems()` | 5 free items vs 10+ paid |
| `digest.js` Claude enrichment step | Free: headline+source; Paid: full analysis |
| `reply-handler.js` AI Q&A | Free 0/day, Pro 10/day |
| `reply-handler.js` custom topics | Block free tier topic adds |
| `store.js` topic weights | Free capped to 5 selected topics |
| `web/server.js -> /api/archive` | Free 7 days vs Pro full history |
| `bot-server.js -> /digest` | Free 1/week rate limit |

### Paid Add-On / Enterprise Upsell Candidates

| Offer | What It Is | Price |
| --- | --- | --- |
| Weekly Executive Summary | Top 10 stories + trend analysis | $49/mo standalone |
| API Access | Pull enriched intelligence into dashboards | $99/mo |
| Custom Topic Packs | Vertical-specific deep dives | $15/mo each |

---

## 3) Go-to-Market Strategy

### ICP (Ideal Customer Profile)

#### Primary ICP: "The Strategy Associate"

| Attribute | Details |
| --- | --- |
| Titles | Associate / Senior Associate / VP |
| Firm types | Strategy consulting (McKinsey/BCG/Bain/Deloitte S&A), middle-market PE |
| Company size | 50-5,000 employees |
| Pain | 30-60 min/day manual scanning before client meetings |
| Current stack | 5+ newsletters + Google Alerts |
| WTP | High; $29/mo is negligible vs salary |
| Trigger | New client engagement or new sector deal |

#### Secondary ICP: "The Corp Dev Director"

| Attribute | Details |
| --- | --- |
| Title | Director of Corp Dev / Strategy |
| Pain | Cross-industry awareness for M&A + CI |
| WTP | Moderate-high, but slower procurement |

### Fastest Path to First Dollar (30-Day Action Plan)

1. **Day 1-3:** Implement Stripe + Freemium/Pro paywall; gate analysis.
2. **Day 3-5:** Add digest upgrade CTA: "Want full analysis? Upgrade to Pro ->".
3. **Day 5-7:** LinkedIn founder post with ROI framing; leverage Duke network.
4. **Day 7-14:** Cold DM 50 strategy/PE pros; offer 30-day Pro trial + referral ask.
5. **Day 14-21:** Launch on Product Hunt, Hacker News, and relevant subreddits.
6. **Day 21-30:** Reach 5 Telegram/Slack communities with tailored topic packs.

### Acquisition Channel Ranking

| Channel | Speed to Revenue | Cost | Scalability | Notes |
| --- | --- | --- | --- | --- |
| LinkedIn organic + DMs | Fast (week 1) | Free | Medium | Founder network is top current asset |
| Product Hunt launch | Fast (day 1 spike) | Free | Low | Good initial surge |
| Referral program | Medium (week 3+) | Low | High | "Give 30 days, get 30 days" |
| SEO/content | Slow (month 3+) | Low | High | Compounding channel |
| Paid LinkedIn ads | Medium | High | High | Use after conversion proof |
| Partnerships (consulting firms) | Slow (month 2+) | Free | Very high | Enterprise wedge |

### PLG vs. Sales-Led Motion

- **Primary motion now:** bottom-up PLG.
- **Later motion:** hybrid PLG + sales-led once team demand is proven.
- Do not over-index enterprise until **200+ individual Pro users** validate value.

### Land-and-Expand Play

1. **Land:** individual upgrades to Pro after seeing analysis gate.
2. **Expand 1:** adds custom topics (`$15/mo` each).
3. **Expand 2:** brings 3-5 colleagues -> team plan (`$19 x 5 = $95/mo`).
4. **Expand 3:** team lead pushes firm-wide pilot (`$200 x 50 = $10K/mo`).

**Spend path:** $29/mo -> $95/mo -> $10K/mo.

### 3 Distribution Channels Where the ICP Lives Right Now

1. **Reddit:** `r/consulting`, `r/PrivateEquity`
2. **Wall Street Oasis** forums
3. **LinkedIn strategy/PE creator ecosystem** (contextual comments + sharing)

---

## 4) Revenue Projections & Financial Model

### Assumptions

- **COGS/user/month:** ~$2.50 (Perplexity + Claude usage)
- **Organic growth:** 20% MoM (base)
- **ARPU:** $29 initially, blended down to ~$25 as team plans launch

| Metric | Conservative | Base | Aggressive |
| --- | --- | --- | --- |
| Free-to-paid conversion | 5% | 8% | 12% |
| Monthly churn | 8% | 5% | 3% |

### 12-Month Revenue Model

#### Conservative Scenario

| Month | Free Users | Paid Users | MRR | ARR |
| --- | --- | --- | --- | --- |
| 1 | 100 | 5 | $145 | $1,740 |
| 3 | 300 | 15 | $435 | $5,220 |
| 6 | 800 | 40 | $1,160 | $13,920 |
| 9 | 1,500 | 68 | $1,972 | $23,664 |
| 12 | 2,500 | 105 | $3,045 | $36,540 |

#### Base Scenario

| Month | Free Users | Paid Users | MRR | ARR |
| --- | --- | --- | --- | --- |
| 1 | 150 | 12 | $348 | $4,176 |
| 3 | 500 | 40 | $1,160 | $13,920 |
| 6 | 1,500 | 120 | $3,480 | $41,760 |
| 9 | 3,500 | 250 | $7,250 | $87,000 |
| 12 | 6,000 | 420 | $12,180 | $146,160 |

#### Aggressive Scenario (1-2 Enterprise Deals)

| Month | Free Users | Paid Users | MRR | ARR |
| --- | --- | --- | --- | --- |
| 1 | 200 | 20 | $580 | $6,960 |
| 3 | 800 | 80 | $2,320 | $27,840 |
| 6 | 3,000 | 300 | $8,700 | $104,400 |
| 9 | 7,000 | 650 | $18,850 | $226,200 |
| 12 | 12,000 | 1,200 | $34,800 | $417,600 |

### Unit Economics Targets

- **LTV:CAC target:** 3:1 minimum
- At $29/mo and 5% monthly churn -> average life ~20 months -> **LTV ~$580**
- CAC target: **<$190**
- Contribution margin at $29/mo with ~$2.50 COGS: **~$26.50/mo**
- Payback goal: **<3 months** (ideal CAC $50-75)
- First major milestone: **$10K MRR = ~345 Pro users** (base case month 8-9)

### Non-Obvious Revenue Streams

| Stream | Offer | Price Range |
| --- | --- | --- |
| Sponsored intelligence items | Native sponsored signals inside relevant digests | $500-2,000/week |
| Data licensing | Sell enriched/tagged corpus to research & CI buyers | $5K-20K/year |
| White-label/API | Embed SignalBrief engine in internal client tools | $500-2K/mo |
| Analyst marketplace | User-generated analysis with rev-share | 20% take rate |

---

## 5) Competitive Positioning & Moats

### Top 5 Competitors

| Competitor | What They Do | Price | SignalBrief Advantage |
| --- | --- | --- | --- |
| Morning Brew / The Hustle | General business digest | Free (ads) | Personalized, multi-vertical, strategic framing |
| The Rundown AI / Superhuman AI | AI-only digest | Free | Wider topic scope (17 topics), different ICP |
| Signal AI | Enterprise media intelligence | $10K+/yr | Individual-first at much lower price |
| AlphaSense / Tegus | Deep research tools | $10K-50K/yr | Daily briefing habit, not heavy research workflow |
| Feedly / Artifact (RIP) | AI RSS/news reader | Free-$18/mo | Curation + analysis, not just feed management |

### Defensible Moat (What Could Become One)

- **Personalization data flywheel:** bookmarks, topic weights, interactions improve relevance over time.
- **Team/community effects:** shared bookmarks and team workflows increase switching costs.
- **Content corpus:** proprietary enriched archive across 17 verticals compounds daily.
- **Niche brand ownership:** "daily intelligence for strategy professionals."

### The Wedge

Own **"daily intelligence for strategy consultants and PE professionals"** first, then expand to corp strategy, IR, and executive office workflows.

### Technical Differentiator

- Zero-dependency Node.js stack is cost-efficient but not a moat.
- True edge is two-model pipeline: **Perplexity Sonar (search) -> Claude (analysis)**.
- Relevance engine (60% base + 40% topic match + sector interleaving) is useful, but must evolve with richer feedback signals.

### Biggest Competitive Risk

A larger player launches the same product shape with broader distribution. Defense is speed, niche depth, and user-specific switching costs before generalists catch up.

---

## 6) 30-60-90 Day Revenue Roadmap

### Days 1-30: Get to First Revenue

- [ ] Implement Stripe billing: Pro at **$29/mo**, annual at **$249/yr**
- [ ] Gate full "why it matters" analysis behind Pro
- [ ] Add upgrade CTA in all free digests (email + Telegram)
- [ ] Launch on Product Hunt (day 7) with a strong demo GIF
- [ ] Outreach to 50 strategy/PE professionals (30-day Pro trial)
- [ ] Founder posts on LinkedIn + Reddit + Hacker News
- [ ] Referral program: "Give 30 days, get 30 days"
- [ ] **Target:** 100+ free users, 10+ paid (**$290 MRR**)

### Days 31-60: Establish Repeatable Revenue

- [ ] Launch team plan: **$19/seat**, 5-seat minimum
- [ ] Build weekly executive summary add-on (**$49/mo**)
- [ ] Add Slack delivery for Team plan
- [ ] Run 5 lunch-and-learn demos via warm intros
- [ ] Pilot sponsored signal placements (3 B2B SaaS prospects)
- [ ] Optimize onboarding and A/B test free vs trial-with-card
- [ ] **Target:** 500+ free users, 40+ paid, 1 team deal (**$1.5K+ MRR**)

### Days 61-90: Build the Growth Engine

- [ ] Launch custom topic packs add-on (**$15/mo each**)
- [ ] Build content engine: weekly "State of [Industry]" from archive data
- [ ] Implement NPS at day 14 and day 30
- [ ] Launch API beta (**$99/mo**)
- [ ] Start first enterprise pilot conversation (25+ seats)
- [ ] **Target:** 1,500+ free users, 120+ paid, 2-3 team deals (**$5K+ MRR**)

---

## 7) Feature ROI & Prioritization Analysis

### ROI Scoring Framework (Applied)

This prioritization uses the assumptions in this playbook:

- **ARPU:** $29/mo
- **COGS:** ~$2.50/user/month
- **Base conversion:** 8%
- **Base churn:** 5%

ROI score (10 max) is weighted by:

- Near-term revenue impact
- Time-to-value
- Engineering effort
- Strategic defensibility

### ROI-Ranked Feature Prioritization

| Rank | Feature | ROI Score (10) | Decision |
| --- | --- | --- | --- |
| 1 | Gate full **"why it matters"** analysis | 9.8 | **Build now** |
| 2 | Stripe checkout + entitlement enforcement | 9.4 | **Build now** |
| 3 | Upgrade CTA in every free digest | 9.0 | **Build now** |
| 4 | Free-tier limits (items/topics/archive/Q&A/on-demand) | 8.3 | **Build now** |
| 5 | Annual plan (`$249/yr`) | 7.4 | **Build now** |
| 6 | Referral loop ("give 30 days/get 30 days") | 6.8 | **Build next** |
| 7 | Team plan + shared bookmarks/admin controls | 6.3 | **Build next** |
| 8 | Slack delivery | 6.0 | **Build next** |
| 9 | Weekly Executive Summary add-on (`$49/mo`) | 5.9 | **Build next** |
| 10 | Custom topic packs (`$15/mo`) | 5.7 | **Build later** |
| 11 | API beta (`$99/mo`) | 4.4 | **Build later** |
| 12 | Sponsored signals | 4.1 | **Deprioritize** |
| 13 | SSO/SAML enterprise | 2.8 | **Deprioritize** |

### Recommended Build Order (ROI-Optimized)

#### Phase A (0-30 days): Monetization Foundation

1. Gate full analysis
2. Stripe + entitlements
3. Digest upgrade CTAs
4. Free-tier enforcement limits
5. Annual pricing option

#### Phase B (31-60 days): Growth & Expansion

1. Referral loop
2. Team plan basics (shared bookmarks/admin controls)
3. Slack delivery
4. Weekly Executive Summary add-on

#### Phase C (61-90 days): Optionality Layer

1. Custom topic packs
2. API beta

#### Defer Until Core PMF Is Clear

1. Sponsored signal monetization mechanics
2. SSO/SAML enterprise features
3. Archive UX polish as a major initiative
4. Telegram-only enhancement work that does not improve conversion
5. Admin dashboard polish not tied to buyer value

### CFO Sensitivity Notes

- At **1,500 free users**, each +1pp conversion = **+15 paid users** = **+$435 MRR**.
- At **6,000 free users**, each +1pp conversion = **+60 paid users** = **+$1,740 MRR**.
- Conversion levers (analysis gate + CTA + hard limits) are the highest ROI engineering investments right now.

---

## 8) Red Flags & Hard Truths

### Single Biggest Threat

This is currently a **feature-shaped product**, not yet a defensible company. Upstream API providers or well-funded incumbents could productize this quickly.

### Features Being Built That May Not Drive Revenue

- Telegram-first delivery is a channel constraint in US professional workflows.
- Admin dashboard/cost tracking are useful internally but weak buyer value drivers.
- Archive browsing is useful, but unlikely to be primary conversion driver.

### Are We Building Something People Want?

- **Yes, with caveat:** problem is real and analysis quality is differentiated.
- **Risk:** over-building before validating willingness to pay.
- **Directive:** ship paywall in week 1 and force signal.

### Honest Kill-Switch Scenario

If after 90 days of a live paywall there are fewer than **30 paying users** (~**$870 MRR**), this likely remains a vitamin, not a painkiller.

Watch this signal:

- If users complain when analysis is gated -> strong demand signal.
- If users silently stay free/churn -> weak monetization signal.

Secondary kill-switch risk: if Perplexity ships a native personalized daily briefing feature, the core value proposition commoditizes quickly.

---

## Final TL;DR

SignalBrief is a strong MVP with real user value for a high-WTP audience. The product quality and architecture are strong. The business layer is not.

Right now, core premium value is being given away for free. The single highest-leverage move is to implement Stripe and gate full analysis behind a **$29/mo** paywall.

The opportunity is real but time-limited. Move fast, own the strategy/PE wedge, get to **$10K MRR** in 6-9 months, then decide whether to optimize for a durable bootstrapped business or push into team/enterprise/API expansion.

Everything depends on one immediate step: **ship the paywall this week.**
