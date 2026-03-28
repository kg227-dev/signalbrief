# I Built a News Briefing That Learns What I Actually Care About

*Draft v2 — March 21, 2026*

> **Image note for Substack:** Upload the digest screenshot (the one with the KKR/Cotiviti, OpenAI, FTC signals) right before or after the "What I Actually Built" section. It does more explanatory work than any description.

---

I spent a long time being badly informed about things I was paid to know well.

I work in healthcare and life sciences strategy. On any given day, something consequential is happening in drug pricing, FDA approvals, M&A, payer dynamics, hospital operations, biotech capital markets, and whatever corner of cell therapy is getting funded this month. I need to walk into client conversations already briefed. That's the baseline expectation of the job.

My morning reading stack was supposed to solve this. What it actually revealed is a more interesting problem than I expected.

---

## The Insight I Kept Ignoring

Here's something I've thought about a lot: Spotify figured out my music taste better than I could describe it myself.

I could tell you I like indie rock with melodic vocals. That's not wrong, but it's not useful — it's a genre label that describes maybe a third of what I actually listen to. What Spotify figured out is that I listen to a specific cluster of artists who share a production aesthetic, that I skip almost everything with a certain kind of synthetic drum sound, and that my listening patterns shift predictably by time of day. Release Radar knows what I want on a Friday morning before I do. The custom playlists it generates and automatically refreshes have introduced me to artists I genuinely love and wouldn't have found on my own.

It did all of this not by asking me what I like, but by watching what I actually do. Behavioral inference, not stated preferences. The distinction matters because people are bad at knowing what they want in advance — including me.

I kept thinking about this in the context of news. Not "what genres do you follow" but: what do you actually click on when you're under time pressure? What do you save for later and then actually read? What do you skip even when you technically care about the topic? Those signals are more accurate than anything you'd say if someone asked.

The failure of my morning reading stack wasn't really that the tools were bad. It was that all of them treated my information needs as static and generic, when they're actually dynamic and specific. The tools that asked me to state my preferences upfront got a self-description. The tools that didn't ask at all gave me everything and let me figure it out.

Neither is what I actually wanted.

---

## Why Everything I Tried Failed

The obvious places to look for healthcare news — Fierce Biotech, Fierce Pharma, STAT News — are link universes. Each headline is a door to another page, which has more links, which have more doors. You open twelve tabs and close nine of them unread. What you do read is often a press release lightly paraphrased: what happened, not why it matters or what the strategic response from the affected parties will be. These are structured for clicks, not comprehension.

Morning Brew, which I also read for a while, is excellent at what it does. What it does is general business news for a general business audience. When I'm three weeks into a healthcare transaction and need to understand how a Medicaid reimbursement change affects a specific operator segment, it's not the tool for that. It was never trying to be. The problem is it's also where most people stop looking, because it feels like it's covering everything.

The WSJ and Bloomberg are thorough but not curated. They cover everything, which means I have to do the filtering. The filtering takes the most time.

I also tried, periodically, asking Claude or GPT to summarize the day's news in my sectors. This worked, in a degraded way — you get a competent summary of whatever you ask for, but you have to ask for it, which means you already have to know what to ask about. And you do it manually, every morning, with no memory of what you cared about yesterday. It's a tool that requires you to already be informed to use effectively.

Each approach had the same underlying failure: stated preferences. Either I was explicitly telling it what I wanted, or it was broadcasting to everyone and implicitly treating my preferences as identical to the median reader's. What I actually consume versus what I say I consume diverge significantly — just like Spotify figured out with my music.

---

## What I Actually Built

So I built SignalBrief.

The basic mechanic: you sign up, pick starting topics from 17 sectors — healthcare, private equity, AI, financial services, policy, life sciences, and more — or add custom ones if your work is niche enough that the defaults don't cover it. At whatever time you choose, you get a personalized email digest. Each story has a "why it matters" layer written at strategy grade — not "here's what happened" but "here's who this moves, and what they'll likely do next." You can also receive it on Telegram and adjust it in natural language: "more healthcare M&A," "less macro," "why does this matter for health systems?"

*[Insert digest screenshot here — the one showing the KKR/Cotiviti, OpenAI, FTC signals with PE×M&A, AI×TECH, POLICY×REGULATORY tags and relevance scores]*

The part I'm more interested in is what comes after that initial setup. The system tracks what you engage with — what you click, what you save, how you instruct it to adjust — and uses that signal to weight future stories. It's the behavioral inference layer. It's not fully where I want it yet, but the direction is toward something that knows your actual information appetite rather than your stated one. More Release Radar, less "pick your genres."

---

## What Building It Taught Me

A few things I didn't expect.

The hardest part isn't finding the news — it's writing the "why it matters" layer at a consistent level of quality. The analysis has to be specific enough to be useful (naming the actual players affected, the likely strategic responses) without being so confident that it overclaims on uncertain situations. Getting that calibration right took longer than the entire rest of the engineering work combined.

I also learned something about my own information consumption that I found uncomfortable. When I started tracking what I actually engaged with versus what I thought I cared about, the gap was significant. I had told myself I needed broad healthcare coverage. What I actually read, consistently, was anything touching healthcare services M&A and anything about how AI was changing clinical documentation. Everything else I opened and mostly skimmed. The stated preferences were aspirational. The behavioral data was honest.

That gap is probably why most personalization attempts fail. If you ask people what they want and then give it to them, you've given them a slightly better version of the thing they already have. The interesting product is the one that gets to the behavioral signal faster.

---

## The Direction This Is Going

I think there's an unsolved problem in the space between "newsletter" and "AI research assistant."

Newsletters are static broadcasts. Research assistants are reactive — they answer what you ask. Neither builds a model of you that improves over time without you having to do the maintenance work. The interesting version of this is something more like a reading companion that gets progressively more accurate, the way a good analyst on a team eventually learns to filter for exactly the kinds of signals their partner needs without being asked.

That's what I'm building toward. Whether I get there is a separate question.

---

## If You Want to Try It

SignalBrief is free right now — I'm in early beta and looking for readers who'll tell me honestly what's working and what isn't. You pick your sectors (17 defaults, custom topics if you need them), set the time you want it to arrive, and get your first digest the next morning. The onboarding takes sixty seconds.

If you work across multiple sectors and feel like your morning reading isn't doing what it's supposed to, I'm genuinely curious whether what I built is useful to you.

[getsignalbrief.com](https://getsignalbrief.com)

---

*Reply here or on Telegram once you're set up — I read everything.*

