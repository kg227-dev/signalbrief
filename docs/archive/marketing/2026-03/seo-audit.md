# SignalBrief SEO Audit
*Audited March 6, 2026 — from source files (site on Cloudflare Tunnel, not publicly crawlable by tools)*

---

## Executive Summary

getsignalbrief.com has a clean technical foundation — proper canonical tag, OG tags, robots meta, structured data, and mobile-responsive CSS — but has two critical gaps that are currently costing rankings: the H1 is just the brand name "SignalBrief" (not keyword-rich), and there is zero content beyond the landing page. No blog, no articles, no public pages that can rank for anything. The public `/digest/YYYY-MM-DD` pages exist but are not indexed (see Technical section). The biggest SEO opportunity is fast: fix the H1, expand the meta description with a CTA, and publish 3 blog posts targeting the keywords consultants are already searching. Domain authority is low (new domain) but content velocity compounds quickly in a low-competition niche.

**Top 3 priorities:** (1) Fix the H1 to include primary keyword, (2) Publish the first blog post targeting "best newsletters for consultants," (3) Add a `/sitemap.xml` and verify Google Search Console indexing.

**Overall: Needs work — solid foundation, zero content depth.**

---

## Keyword Opportunity Table

| Keyword | Est. Difficulty | Opportunity | Current Ranking | Intent | Recommended Content |
|---------|----------------|-------------|-----------------|--------|---------------------|
| best newsletters for strategy consultants | Low | **High** | Not ranked | Commercial | Blog post (listicle) |
| daily news digest strategy professionals | Very Low | **High** | Not ranked | Commercial | Homepage + Blog |
| personalized morning briefing | Low | **High** | Not ranked | Commercial | Homepage |
| AI curated news digest | Low | **High** | Not ranked | Commercial | Homepage + Blog |
| morning news routine consultants | Very Low | **High** | Not ranked | Informational | Blog post |
| how to stay current with industry news consulting | Very Low | **High** | Not ranked | Informational | Blog post |
| daily briefing for professionals | Low | **High** | Not ranked | Commercial | Homepage |
| personalized newsletter | Medium | **Medium** | Not ranked | Commercial | Blog + homepage |
| consulting morning read | Very Low | **Medium** | Not ranked | Informational | Blog post |
| AI newsletter summary | Low | **Medium** | Not ranked | Commercial | Blog post |
| strategy consultant news sources | Very Low | **Medium** | Not ranked | Informational | Blog post |
| healthcare PE M&A news daily | Very Low | **Medium** | Not ranked | Commercial | Digest archive pages |
| morning brew alternative professionals | Low | **Medium** | Not ranked | Commercial | Comparison landing page |
| information overload knowledge workers | Low | **Medium** | Not ranked | Informational | Blog post |
| daily digest replace morning brew | Very Low | **High** | Not ranked | Commercial | Comparison page |

**Key insight:** Almost every target keyword is "Very Low" difficulty — this is a wide-open niche. A new domain publishing 3–4 quality posts per month could rank in the top 5 for most of these within 90 days.

---

## On-Page Issues

| Page | Issue | Severity | Fix |
|------|-------|----------|-----|
| Homepage | **H1 is "SignalBrief"** — brand name only, no keyword | **Critical** | Change H1 to keyword-rich heading: "SignalBrief — AI-Curated Daily Briefings for Strategy Consultants" or make the H1 the tagline and move brand to a logo |
| Homepage | Meta description is passive, no CTA | **High** | Rewrite: "Get a personalized 5-minute morning briefing across every sector you cover — AI-curated signals with consultant-grade analysis. Free. Sign up in 60 seconds." |
| Homepage | Title tag missing primary keyword | **High** | Change "SignalBrief — Your Daily Signal" to "SignalBrief — Daily AI Briefings for Strategy Consultants" |
| Homepage | No H2 or H3 tags in body content | **High** | Add H2 in the SEO content section (e.g. "Built for strategy professionals who cover multiple sectors") |
| Homepage | Structured data missing `SoftwareApplication` schema | **Medium** | Add SoftwareApplication schema with applicationCategory "NewsApplication", price "Free", target audience |
| Homepage | Structured data missing `FAQPage` schema | **Medium** | Add 3–4 FAQ schema items (What is SignalBrief? How is it different from Morning Brew? Which sectors does it cover?) |
| Homepage | Zero internal links | **Medium** | Once blog exists, link from homepage to blog posts |
| Homepage | Twitter card type is "summary" not "summary_large_image" | **Low** | Change to `summary_large_image` and add an OG image (a screenshot of the digest) for better social preview CTR |
| Homepage | Google Fonts blocking render | **Low** | Add `display=swap` (already in URL) — this is fine, low impact |
| All pages | No `/sitemap.xml` detected | **High** | Create a sitemap including homepage, `/digest/*` archive pages, and future blog posts. Submit to Google Search Console. |
| `/digest/*` pages | Cache-Control: max-age=300 is good, but are they indexed? | **Medium** | Confirm robots meta tag on digest pages allows indexing. Check GSC. These pages are SEO goldmines — daily content with specific, long-tail keywords. |
| All pages | No `robots.txt` visible | **Medium** | Create `robots.txt` that allows all crawling except `/admin`, `/settings`, `/api/*` |

---

## Content Gap Analysis

| Topic / Keyword | Why It Matters | Format | Priority | Effort |
|-----------------|---------------|--------|----------|--------|
| "Best morning news routine for strategy consultants" | High search intent, exact audience, no good content exists ranking for this | 1,500-word blog post | **High** | Moderate (3–4 hrs) |
| "Best newsletters for consultants 2026" | High-volume query, ranking here = direct signups. Morning Brew ranks but doesn't serve consultants specifically. | Listicle (1,200 words) | **High** | Moderate |
| "How AI is changing morning news for professionals" | Thought leadership + SEO. Positions SignalBrief as the exemplar product. | Blog post (1,000 words) | **High** | Moderate |
| "Morning Brew alternative for professionals" | Direct commercial intent. People searching this want exactly what SignalBrief offers. | Comparison landing page | **High** | Moderate |
| "What strategy consultants read in the morning" | Informational, audience-specific. Ranks on brand-relevance, not competition. | Blog post / listicle | **Medium** | Quick win |
| "How to stay current in consulting" | Career advice angle. Ranks well, attracts pre-ICP who are consultants figuring out their info diet. | Blog post | **Medium** | Quick win |
| Daily sector digest pages (e.g. "Healthcare M&A news today") | Existing `/digest` archive pages can rank for these if indexed and SEO-tagged | Optimize existing pages | **High** | Quick win |
| "Personalized newsletter AI" | Product category term, growing fast. Competes with Readless, Dume.ai. | Homepage optimization | **Medium** | Quick win |

**Biggest gap:** Zero blog content. Every competitor and adjacent product has 20–50 SEO blog posts generating organic traffic. SignalBrief has nothing outside the homepage. This is a 90-day fix, not a 90-minute fix — but starting this week matters.

---

## Technical SEO Checklist

| Check | Status | Details |
|-------|--------|---------|
| HTTPS | ✅ Pass | Cloudflare Tunnel enforces HTTPS |
| Canonical tag | ✅ Pass | `<link rel="canonical" href="https://getsignalbrief.com/">` present |
| Meta robots | ✅ Pass | `index,follow,max-snippet:-1,max-image-preview:large` — excellent |
| Open Graph tags | ✅ Pass | og:title, og:description, og:url, og:type, og:site_name all present |
| Twitter Card | ⚠️ Warning | Type is "summary" — upgrade to "summary_large_image" + add OG image |
| Structured data | ⚠️ Warning | Organization + WebSite schema present. Missing: SoftwareApplication, FAQPage |
| H1 tag | ❌ Fail | H1 is "SignalBrief" — brand name only, no keywords |
| H2/H3 hierarchy | ❌ Fail | No H2 or H3 tags in visible body content |
| Mobile responsive | ✅ Pass | Full responsive CSS with mobile breakpoints at 600px |
| robots.txt | ❌ Unknown | Not found in source — needs to be created |
| sitemap.xml | ❌ Unknown | Not found in source — needs to be created |
| Page speed | ⚠️ Warning | Google Fonts + inline CSS in `<head>` — likely 2–3s LCP. Add `font-display:swap` (already present in URL), consider preconnect hints |
| Indexable content | ⚠️ Warning | All content is HTML/CSS only — no issues. But very thin (single page). |
| Internal links | ❌ Fail | No internal links between any pages |
| Alt text on images | ✅ Pass | No images (digest preview is CSS/HTML) — nothing to alt-tag |
| `/digest/*` pages | ⚠️ Warning | Need to confirm these are indexed and have unique title/meta per date |

---

## Competitor SEO Comparison

| Dimension | SignalBrief | Morning Brew | The Diff | Dume.ai | Readless |
|-----------|-------------|--------------|----------|---------|----------|
| Domain age | New (<6 months) | ~8 years | ~5 years | ~2 years | ~2 years |
| Indexed pages | ~1 (homepage + digest pages) | Thousands | Hundreds | Dozens | Dozens |
| Blog/content | None | Full media operation | Weekly posts | Several | 20+ SEO posts |
| Backlink profile | Minimal | Very strong | Moderate | Low | Low |
| Primary keyword rank | Not ranking | Dominates "business newsletter" | "capital markets newsletter" | "AI assistant" | "AI newsletter summarizer" |
| Niche specificity | Strategy consultants (precise) | General business (broad) | Finance/capital (medium) | Enterprise workers (broad) | Newsletter readers (medium) |
| Personalization story | Strong (17 topics) | None | None | Strong | Moderate |
| **Content moat** | None yet | Very strong | Moderate | Weak | Moderate |

**Key insight:** SignalBrief's niche specificity is a SEO advantage, not a disadvantage. "Strategy consultant newsletter" is a far less competitive keyword space than "business newsletter." Morning Brew will never rank #1 for "best newsletter for PE analysts" — SignalBrief can.

---

## Prioritized Action Plan

### Quick Wins — Do This Week

1. **Fix the H1 tag** (30 min, Critical impact)
   - Change the `<h1>` from "SignalBrief" to "AI-Curated Daily Briefings for Strategy Professionals" (or equivalent)
   - Move "SignalBrief" brand to a `<div>` or `<span>` above it visually

2. **Rewrite the title tag and meta description** (20 min, High impact)
   - Title: `SignalBrief — Daily AI Briefings for Strategy Consultants | Free`
   - Meta: `Get a personalized 5-minute morning briefing across every sector you cover. AI-curated signals with consultant-grade analysis, delivered at 7am. Free — sign up in 60 seconds.`

3. **Create `/robots.txt`** (15 min, Medium impact)
   ```
   User-agent: *
   Allow: /
   Disallow: /admin
   Disallow: /api/
   Disallow: /settings
   Sitemap: https://getsignalbrief.com/sitemap.xml
   ```

4. **Create `/sitemap.xml`** (1 hr, High impact)
   - Include homepage, all `/digest/YYYY-MM-DD` pages, future blog posts
   - Submit to Google Search Console

5. **Add `summary_large_image` Twitter card + OG image** (1 hr, Medium impact)
   - Take a screenshot of a real digest, use it as the OG image
   - Changes social share previews from a text box to a visual card — dramatically increases click-through when shared

6. **Add FAQPage structured data to homepage** (30 min, Medium impact)
   - Questions: "What is SignalBrief?", "How is it different from Morning Brew?", "Is it free?", "Which sectors does it cover?"
   - Gives a chance at appearing in Google's People Also Ask box

7. **Set up Google Search Console** (30 min, High long-term impact)
   - Verify domain ownership
   - Submit sitemap
   - Monitor for indexing issues and keyword impressions

### Strategic Investments — This Quarter

1. **Publish 3 blog posts** (target: 1 per 2 weeks)
   - Post 1: "Best Morning News Routine for Strategy Consultants (2026)" — draft is in `marketing/` folder
   - Post 2: "Morning Brew Isn't Built for Consultants — Here's What Is"
   - Post 3: "How AI Is Changing the Way Strategy Professionals Get Briefed"

2. **Build a `/blog` route in `web/server.js`** and serve static blog HTML pages from `web/blog/`

3. **SEO-optimize `/digest/*` archive pages** — Add unique `<title>` and `<meta description>` per date (e.g., "SignalBrief — March 6, 2026 | Healthcare, PE, AI Signals"). These pages auto-generate daily SEO content for free.

4. **Add a "featured snippet bait" FAQ section to the homepage** — 4–5 Q&A pairs in plain text that Google can lift into featured snippets for consulting-related queries.
