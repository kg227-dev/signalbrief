# SignalBrief Format Rules
*Locked from Batch 1 feedback — Feb 28 2026 | Updated for 17-topic architecture + Batch 7 format*

## Item Format (Telegram)
```
[N]⃣ *[VERTICAL×SUBTAG]* Headline
_First sentence of "why it matters." (250-char cap)_
→ source.com
```

## Rules
1. **Number items** with keycap emojis: 1⃣ 2⃣ 3⃣ etc.
2. **Max 2 items per tag** — never stack same-tag items adjacently. Interleave verticals.
3. **Links**: `→ domain.com` — clean, no emoji, direct article URL (not homepage).
4. **5 items default**, configurable 5/10 per user.
5. **Freshness signal**: add `(2d ago)` only when item is >24h old. Nothing if today.
6. **Every item must have a strategic so-what** — one clause answering "why should a strategy consultant care about this tomorrow morning?" Specific, implication-forward, not generic. Displayed as italic WIM sentence in Telegram, full paragraph in email.
7. **Cross-vertical tags** (×) are a feature: `[AI×TECH]`, `[PE×M&A]`, `[POLICY×REGULATORY]`
8. **WIM sentence**: strip all HTML before splitting on sentence boundaries. First sentence only, hard cap at 250 chars. Use `(?<=[.!?])\s+(?=[A-Z])` to split (avoids firing on abbreviations like `vs.`). Never send multiple Telegram messages — shorten rather than split.
9. **Single message always** — if content exceeds 4096 chars, shorten WIM sentences. Do not paginate or split digest across multiple messages.

## Email-Specific Rules
1. **Quick-scan header**: TODAY'S SIGNALS bar before items. 10-second read.
2. **Item length**: factual lede + 2-3 sentence "why it matters" = 4-5 sentences total.
3. **Lead story**: `★ LEAD` — slightly more room, left blue border accent.
4. **Subject line**: date + 3 punchy topic teasers.
   e.g. `SignalBrief — Mon, Mar 3 | OpenAI's enterprise push, PE deal drought ends, DOGE cuts bite`
5. **"Why it matters" first clause**: bold (`<strong>`) — speed-reader anchor.
6. **Relevance badge**: color-coded score shown on each item (green >8.5, yellow >5.0, orange >3.5, red <3.5).
7. **Footer**: Forward CTA button (primary growth vector), preferences link, unsubscribe.

## Header
```
☀️ SignalBrief — [Day, Mon DD]
Your daily signal across AI, strategy, and business
```

## Footer (Telegram — short version after 5 digests)
```
───
📧 Deeper takes in your email
💾 save [#] · 📊 more/less [topic] · ⚙️ settings
```

## Topic Tags Reference (17 total)

### Industries (10)
| Tag | Covers |
|-----|--------|
| `HEALTHCARE` | Payers, providers, pharma, FDA, clinical AI |
| `FINANCIAL SERVICES` | Banking, fintech, insurance, capital markets |
| `PE×M&A` | Private equity, deal flow, leveraged buyouts, M&A activity |
| `ENERGY` | Transition, utilities, grid, industrials, IRA |
| `CONSUMER` | Retail, DTC, brand, supply chain, consumer trends |
| `LIFE SCIENCES` | Biotech, medical devices, genomics, drug pipelines |
| `TECHNOLOGY` | Enterprise tech, SaaS, cloud infrastructure |
| `INDUSTRIALS` | Manufacturing, logistics, automation, supply chain |
| `REAL ESTATE` | CRE, proptech, construction, data centers |
| `PUBLIC SECTOR` | Government, defense, federal procurement, municipalities |

### Capabilities (7)
| Tag | Covers |
|-----|--------|
| `AI×TECH` | Enterprise AI, foundation models, infrastructure, Big Tech |
| `STRATEGY` | Consulting, corporate strategy, transformation, firm moves |
| `POLICY×REGULATORY` | Federal regulation, antitrust, trade, DOGE, budget |
| `SUSTAINABILITY` | ESG, net zero, carbon, climate policy, reporting |
| `DIGITAL` | Digital transformation, platforms, product strategy |
| `M&A ADVISORY` | Deal advisory, integration, synergy capture, valuation |
| `TALENT` | Workforce trends, hiring, org restructuring, compensation |

Custom tags supported: `GLP-1`, `DOGE`, `quantum`, `defense`, etc.
