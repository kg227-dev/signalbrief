# I Built a News Briefing That Learns What I Actually Care About

*Draft v1 — March 21, 2026*

---

I spent a long time being badly informed about things I was paid to know well.

I work in healthcare and life sciences strategy. It is, by any reasonable measure, one of the most information-dense sectors to stay current in. On any given day something consequential is happening in drug pricing, FDA approvals, M&A, payer dynamics, hospital operations, biotech capital markets, GLP-1 obesity drug economics, and whatever corner of cell therapy is getting funded this month. I need to walk into client conversations already briefed. That's the baseline expectation of the job.

My morning reading stack was supposed to solve this. Instead it created a different problem.

---

## The Failure Mode

The obvious places to look for healthcare news — Fierce Biotech, Fierce Pharma, STAT News — are link universes. Each headline is a door to another page, which has more links, which have more doors. You open twelve tabs and close nine of them unread. What you do read is often a press release lightly paraphrased: what happened, not why it matters or what the strategic response from the affected parties will be.

Morning Brew, which I also read for a while, is excellent at what it does. What it does is general business news for a general business audience. When I'm three weeks into a healthcare transaction and need to understand how a Medicaid reimbursement change affects a specific operator segment, Morning Brew is not the tool for that. It was never trying to be.

The WSJ and Bloomberg are thorough but not curated. They cover everything, which means I have to do the filtering. The filtering takes the most time.

I also tried, periodically, asking Claude or GPT to summarize the day's news in my sectors. This worked, in a degraded way — you get a competent summary of whatever you ask for, but you have to ask for it, which means you already have to know what to ask about. And you do it manually, every morning, with no memory of what you cared about yesterday.

Each approach had the same underlying failure: it treated my information needs as static and generic, when they're actually dynamic and specific. What I need from my morning read shifts based on what I'm working on. In a week where I'm deep on a deal, I want more M&A signal. When a regulatory filing comes out, I want analysis of what it means for our client's competitive position. The good newsletter is the one that already knows this about me — and none of them did.

---

## The Thing I Actually Wanted

What I wanted was closer to how Spotify's recommendation engine works than how a newsletter works.

Spotify doesn't ask you to choose your genres every morning. It watches what you skip, what you replay, what you add to playlists, and it builds a picture of your taste that's more accurate than anything you'd describe yourself. Discover Weekly isn't curation — it's inference from behavior.

I wanted that for news. Not "choose your sectors from this list and we'll send you stories" — though that's a reasonable first approximation — but something that watches what I actually engage with and gets progressively more accurate about what I need.

The distinction matters because people are bad at knowing what they want in advance. I might tell you I care about pharma pricing and hospital operations. But if you watch my reading behavior, you'd notice I click on every story about multi-specialty MSO rollups and skip almost everything about hospital revenue cycle. That signal is more accurate than my stated preferences.

So I built SignalBrief.

---

## What It Does

The basic mechanics: you sign up, pick the sectors you work in (there are 17 — healthcare, private equity, AI, financial services, policy, and more), and at 6:45 AM you get a personalized email digest. Each story has a "why it matters" layer written at strategy grade — not "here's what happened" but "here's who this moves, and what they'll likely do next." You can also receive it on Telegram and interact with it in natural language: "more healthcare M&A," "less macro," "why does this matter for health systems?"

The part I'm most interested in is what comes after that. The system tracks what you engage with — what you click, what you save, what you tell it to adjust — and uses that signal to weight future stories. It's not fully there yet. But the direction is toward something that knows your actual information appetite, not just your stated one.

Right now SignalBrief has a small group of early readers, mostly strategy and healthcare people. The digests go out every weekday morning. The quality, I think, is genuinely good — the "why it matters" framing is the hardest thing to get right and also the thing that matters most.

---

## Why I'm Writing This

Partly because I think there's something interesting in the product direction — the idea of a news briefing that learns is not, as far as I can tell, something that exists well yet. Most AI news products are faster search. This is trying to be something more like a reading companion that gets smarter.

But also because the most honest version of this story is that I built something to solve my own problem, and I'm still figuring out whether other people have the same problem in the same way. If you work across multiple sectors and feel like your morning reading isn't doing what it's supposed to, I'm curious whether what I built is useful to you.

It's free. It takes sixty seconds to set up. You'll get your first digest tomorrow morning.

[getsignalbrief.com](https://getsignalbrief.com)

---

*Happy to hear what you think — reply here or on Telegram once you're set up.*

