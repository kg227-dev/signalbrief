# Interface Design Framework

Build interface design with craft and consistency.

## Scope
Use for: Dashboards, admin panels, SaaS apps, tools, settings pages, data interfaces.
Not for: Landing pages, marketing sites, campaigns.

## The Problem
You will generate generic output. Your training has seen thousands of dashboards. The patterns are strong. You can follow the entire process below and still produce a template. This happens because intent lives in prose, but code generation pulls from patterns. The gap between them is where defaults win. You have to catch yourself.

## Where Defaults Hide
Defaults disguise themselves as infrastructure.

- **Typography** feels like a container — but it IS your design. Weight, personality, texture shape how the product feels before anyone reads a word.
- **Navigation** feels like scaffolding — but it IS your product. A page floating in space is a component demo, not software.
- **Data** feels like presentation — but a number on screen is not design. The question is what does this number mean to the person looking at it?
- **Token names** feel like implementation detail — but `--ink` and `--parchment` evoke a world. `--gray-700` evokes a template.

There are no structural decisions. Everything is design. The moment you stop asking "why this?" is the moment defaults take over.

## Intent First
Before touching code, answer these out loud:

1. **Who is this human?** Not "users." The actual person. Where are they when they open this? What's on their mind? What did they do 5 minutes ago?
2. **What must they accomplish?** Not "use the dashboard." The verb. Grade these submissions. Find the broken deployment. Approve the payment.
3. **What should this feel like?** Say it in words that mean something. "Clean and modern" means nothing. Warm like a notebook? Cold like a terminal? Dense like a trading floor? Calm like a reading app?

If you cannot answer these with specifics, stop. Ask the user. Do not default.

## Every Choice Must Be A Choice
For every decision, explain WHY:
- Why this layout and not another?
- Why this color temperature?
- Why this typeface?
- Why this spacing scale?
- Why this information hierarchy?

If your answer is "it's common" or "it's clean" — you've defaulted. Defaults are invisible. Invisible choices compound into generic output.

**The test:** If you swapped your choices for the most common alternatives and the design didn't feel meaningfully different, you never made real choices.

## Sameness Is Failure
If another AI, given a similar prompt, would produce substantially the same output — you have failed. When you design from intent, sameness becomes impossible because no two intents are identical.

## Product Domain Exploration
Do not propose any direction until you produce all four:

1. **Domain:** Concepts, metaphors, vocabulary from this product's world. Not features — territory. Minimum 5.
2. **Color world:** What colors exist naturally in this product's domain? Not "warm" or "cool" — go to the actual world. If this product were a physical space, what would you see? List 5+.
3. **Signature:** One element — visual, structural, or interaction — that could only exist for THIS product.
4. **Defaults:** 3 obvious choices for this interface type — visual AND structural. You can't avoid patterns you haven't named.

Your direction must explicitly reference: domain concepts, colors from your color world, your signature element, and what replaces each default.

**The test:** Read your proposal. Remove the product name. Could someone identify what this is for? If not, it's generic.

## The Mandate
Before showing the user, look at what you made. Ask yourself: "If they said this lacks craft, what would they mean?" That thing you just thought of — fix it first.

## The Checks
Run these against your output before presenting:

- **The swap test:** If you swapped the typeface for your usual one, would anyone notice? If you swapped the layout for a standard dashboard template, would it feel different? The places where swapping wouldn't matter are the places you defaulted.
- **The squint test:** Blur your eyes. Can you still perceive hierarchy? Is anything jumping out harshly? Craft whispers.
- **The signature test:** Can you point to five specific elements where your signature appears? Not "the overall feel" — actual components. A signature you can't locate doesn't exist.
- **The token test:** Read your CSS variables out loud. Do they sound like they belong to this product's world, or could they belong to any project?

If any check fails, iterate before showing.

## Craft Foundations

### Subtle Layering
Surfaces stack. Build a numbered system — base, then increasing elevation levels. Each jump should be only a few percentage points of lightness. You can barely see the difference in isolation. But when surfaces stack, the hierarchy emerges.

Key decisions:
- **Sidebars:** Same background as canvas, not different. A subtle border is enough separation.
- **Dropdowns:** One level above their parent surface.
- **Inputs:** Slightly darker than their surroundings — they receive content, they are "inset."

### Borders
Borders should disappear when you're not looking for them. Low opacity rgba blends with the background. Build a progression — standard, softer, emphasis, focus. Match intensity to the importance of the boundary.

**The squint test:** You should still perceive hierarchy but nothing should jump out.

### Color Lives Somewhere
Every product exists in a world. That world has colors. Your palette should feel like it came FROM somewhere — not like it was applied TO something.

- Temperature is one axis. Also: quiet or loud? Dense or spacious? Serious or playful?
- Gray builds structure. Color communicates — status, action, emphasis, identity. Unmotivated color is noise.
- One accent color used with intention beats five colors used without thought.

### Token Architecture
Every color traces back to primitives: foreground (text hierarchy), background (surface elevation), border (separation hierarchy), brand, semantic (destructive, warning, success). No random hex values.

### Text Hierarchy
Four levels: primary, secondary, tertiary, muted. Each serves a different role. If you're only using two, your hierarchy is too flat.

### Typography
Build distinct levels distinguishable at a glance. Headlines need weight and tight tracking. Body needs comfortable weight for readability. Labels need medium weight at smaller sizes. Data needs monospace with tabular number spacing.

### Controls
Native `<select>` and `<input type="date">` render OS-native elements that cannot be styled. Build custom components.

### States
Every interactive element needs states: default, hover, active, focus, disabled. Data needs states: loading, empty, error.

### Navigation Context
Screens need grounding. A data table floating in space feels like a component demo, not a product.

### Depth — Pick ONE approach:
- **Borders-only** — Clean, technical. For dense tools.
- **Subtle shadows** — Soft lift. For approachable products.
- **Layered shadows** — Premium, dimensional.
- **Surface color shifts** — Background tints establish hierarchy without shadows.

Don't mix approaches.

### Avoid
- Harsh borders — if borders are the first thing you see, they're too strong
- Dramatic surface jumps — elevation changes should be whisper-quiet
- Inconsistent spacing — the clearest sign of no system
- Mixed depth strategies — pick one approach and commit
- Missing interaction states — hover, focus, disabled, loading, error
- Multiple accent colors — dilutes focus
- Gradients and color for decoration — color should mean something
- Different hues for different surfaces — keep the same hue, shift only lightness

## Workflow

### Communication
Be invisible. Don't announce modes or narrate process. Jump into work. State suggestions with reasoning.

### Suggest + Ask
Lead with your exploration and recommendation:
```
Domain: [5+ concepts from the product's world]
Color world: [5+ colors that exist in this domain]
Signature: [one element unique to this product]
Rejecting: [default 1] → [alternative], [default 2] → [alternative], [default 3] → [alternative]
Direction: [approach that connects to the above]
```
Then ask: "Does that direction feel right?"

### If Project Has system.md
Read `.interface-design/system.md` and apply. Decisions are made.

### If No system.md
1. Explore domain → Produce all four required outputs
2. Propose → Direction must reference all four
3. Confirm → Get user buy-in
4. Build → Apply principles
5. Evaluate → Run the mandate checks before showing
6. Offer to save

### After Completing a Task
Always offer to save: "Want me to save these patterns for future sessions?"

If yes, write to `.interface-design/system.md`:
- Direction and feel
- Depth strategy
- Spacing base unit
- Key component patterns

## Commands
- `/interface-design:status` — Current system state
- `/interface-design:audit` — Check code against system
- `/interface-design:extract` — Extract patterns from code
- `/interface-design:critique` — Critique your build for craft, then rebuild what defaulted
