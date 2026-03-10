# SignalBrief — Landing Page Copy Improvements
*Current state audit + specific rewrites. All changes are surgical — don't rebuild, just sharpen.*

---

## CRITICAL: Fix the H1 (biggest SEO + conversion impact)

**Current H1:** `SignalBrief` — the brand name. This is both an SEO failure and a conversion missed opportunity. A visitor who doesn't know what SignalBrief is reads the H1 and learns nothing.

**Recommended change:**

Option A (clearest conversion):
```
H1: The daily briefing built for strategy professionals
Subhead (current tagline, promote to tagline position): Your daily signal across AI, strategy, and business
```

Option B (more SEO-targeted):
```
H1: AI-Curated Daily Briefings for Strategy Professionals
Subhead: Personalized across every sector you cover. 5 minutes every morning.
```

Option C (most differentiated, tests the enemy angle):
```
H1: One email. Every sector. No scatter.
Subhead: SignalBrief delivers analyst-grade morning intelligence across the industries you cover — personalized, in 5 minutes.
```

**Recommendation:** Option A or C. Option A is cleanest and most honest. Option C is more aggressive and tests better in high-intent contexts. A/B test after you have 50+ visitors/day.

**Implementation:** In `web/index.html`, change the `<h1>` tag from `SignalBrief` to the chosen headline. Move "SignalBrief" to a brand badge above it.

---

## Hero Description (medium impact)

**Current:** `AI-curated news digests for strategy professionals. 5 minutes every morning across every vertical that matters.`

**Issues:** "every vertical that matters" is vague. "AI-curated news digests" undersells the analysis layer. No urgency or emotion.

**Rewrite:**
```
A personalized 5-minute morning briefing across every sector you cover — with the strategic implications already written out. Built for professionals who need to be briefed before their first call.
```

Or, more direct:
```
Stop reading 6 newsletters and retaining none of them. SignalBrief gives you analyst-grade morning intelligence across your sectors — personalized, completable in 5 minutes.
```

---

## Hero CTA Button (small copy fix, high conversion impact)

**Current:** `Get started — it's free  →`

**Issue:** "Get started" is generic. "It's free" is a parenthetical, not a headline. The free-ness should be louder.

**Rewrite options:**
- `Get your free daily briefing →` — leads with value, free is prominent
- `Start reading free — takes 60 seconds →` — adds friction-reducing specificity
- `Personalize my morning briefing →` — outcome-oriented, slightly more conversational

**Recommendation:** `Get your free daily briefing →` — simple, direct, value-first.

---

## Social Proof Section (HIGH PRIORITY — currently missing entirely)

**Current state:** Zero testimonials, zero subscriber count, zero company logos. A cold visitor has no reason to trust the product.

**Add after the digest preview mockup:**

```html
<!-- Add this between the digest preview and the CTA button -->
<div class="social-proof">
  <p class="sp-label">Read by strategy professionals at</p>
  <div class="sp-logos">
    [Company name pills — add as you get readers from recognizable firms]
  </div>
  <div class="sp-quotes">
    <blockquote>"[Testimonial quote — 1 sentence]"
      <cite>— [Name], [Role] at [Company]</cite>
    </blockquote>
  </div>
</div>
```

**Placeholder copy until you have real testimonials:**
```
Trusted by consultants and strategy professionals at [Firm], [Firm], and [Firm].
```

Even a single real quote from someone at McKinsey, Bain, Deloitte, Goldman, or a Fortune 500 strategy team transforms cold conversion. Go get 3 quotes from your first readers before adding this section — fake social proof is worse than none.

---

## SEO Content Section (currently has an `.seo-content` CSS class — needs actual content)

**Current:** The `.seo-content` div exists in CSS but I couldn't find what's in it in the HTML. Add or strengthen it with keyword-rich copy:

```html
<div class="seo-content">
  <h2>Built for strategy professionals who cover multiple sectors</h2>
  <p>
    Most daily newsletters were built for general business readers. SignalBrief was built
    for the consultant who covers healthcare on Monday, private equity on Wednesday, and AI
    policy on Friday — and needs to walk into every conversation already briefed.
  </p>
  <p>
    Choose from 17 sectors and capabilities including Healthcare, Private Equity & M&A,
    Financial Services, AI & Technology, Policy & Regulatory, Energy, Life Sciences, and more.
    The briefing adapts to what you actually read, getting more personalized every week.
  </p>
  <p>
    Free. No credit card. Setup takes 60 seconds.
  </p>
</div>
```

This section will be picked up by Google for long-tail queries about sector-specific newsletters and consulting morning reads. It's pure SEO content that doesn't pollute the hero UX.

---

## Meta Title & Description (quick wins)

**Current title:** `SignalBrief — Your Daily Signal`
**Issues:** "Your Daily Signal" is brand language, not keyword language. Google reads this as an 18-character title that provides no context.

**Rewrite:** `SignalBrief — Daily AI Briefings for Strategy Consultants | Free`
*(60 chars — hits the limit perfectly)*

**Current meta description:** `SignalBrief is a daily AI-curated business news digest for strategy professionals across healthcare, finance, private equity, technology, and policy.`
**Issues:** Passive voice, no CTA, starts with brand name (wasted first impression in SERP).

**Rewrite:** `Get a personalized 5-minute morning briefing across every sector you cover. Analyst-grade signals for strategy professionals. Free — set up in 60 seconds.`
*(157 chars — just under the 160 limit)*

---

## FAQ Section (add to bottom of page before footer)

This serves two purposes: (1) Converts visitors who have objections, (2) Earns Google "People Also Ask" rich results.

```html
<div class="faq-section">
  <h2>Common questions</h2>

  <div class="faq-item">
    <h3>Is SignalBrief free?</h3>
    <p>Yes. SignalBrief is completely free. No credit card required.</p>
  </div>

  <div class="faq-item">
    <h3>How is it different from Morning Brew?</h3>
    <p>Morning Brew is a general business newsletter written for a broad audience. SignalBrief is personalized to your specific sectors and written at strategy grade — the "why it matters" analysis names who's affected and what they'll likely do next, not just what happened.</p>
  </div>

  <div class="faq-item">
    <h3>Which sectors does it cover?</h3>
    <p>17 total: Healthcare, Financial Services, Private Equity & M&A, Energy, Consumer & Retail, Life Sciences, Technology, Industrials, Real Estate, Public Sector, AI & Technology, Strategy, Policy & Regulatory, Sustainability & ESG, Digital Transformation, M&A Advisory, and Talent & Workforce. You can also add custom topics (a specific drug class, a company you track, a policy area).</p>
  </div>

  <div class="faq-item">
    <h3>How personalized is it really?</h3>
    <p>At signup, you choose your sectors and analysis depth. Over time, the algorithm learns from what you click, save, and tell it — via natural language commands like "more healthcare, less energy." After a week, it reflects what you actually care about, not just what you selected at signup.</p>
  </div>

  <div class="faq-item">
    <h3>How long does it take to read?</h3>
    <p>5 minutes for 5 stories with full "why it matters" analysis, or under 2 minutes if you choose headline-only depth. You choose when you sign up and can change it anytime.</p>
  </div>
</div>
```

Add `FAQPage` structured data matching these Q&As (see SEO audit for technical details).

---

## Digest Preview Mockup (no changes needed — it's excellent)

The current digest preview showing KKR/Cotiviti, OpenAI, and FTC stories is genuinely good. It shows real format, real depth, real sector coverage. Keep it exactly as is. The only improvement: update it when you have a particularly sharp real digest — using a real story is more credible than a sample.

---

## Summary of Changes, By Priority

| Change | Where | Effort | Impact |
|--------|--------|--------|--------|
| Fix H1 tag | `web/index.html` | 10 min | **Critical** (SEO + conversion) |
| Rewrite meta title | `web/index.html` | 5 min | **High** (SEO) |
| Rewrite meta description | `web/index.html` | 5 min | **High** (SEO) |
| Rewrite hero description | `web/index.html` | 15 min | **High** (conversion) |
| Rewrite CTA button text | `web/index.html` | 5 min | **Medium** (conversion) |
| Add/strengthen SEO content section | `web/index.html` | 30 min | **High** (SEO) |
| Add FAQ section + schema | `web/index.html` | 1 hr | **Medium** (SEO + conversion) |
| Add social proof section | `web/index.html` | After getting quotes | **Critical** (conversion) |
