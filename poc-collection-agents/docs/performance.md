# Performance — Cost, Latency, and Architectural Decisions

> Engineering-grade analysis of the per-turn cost/speed profile of the multi-agent pipeline. Audience: backend engineers, ML/LLM engineers, platform architects, compliance reviewers.

This document is **the single source of truth** for *why* each agent uses the model it uses, *how* the user-facing perceived latency was reduced from ~7s to interactive, and *what tradeoffs* were knowingly accepted. Every claim here is reproducible via `npm run eval:journey` (see [eval_harness.md](eval_harness.md)).

---

## TL;DR

| | Original | Current (`balanced-cost`) | Δ |
|---|---|---|---|
| Happy turn (wall clock) | ~7.4s | **~4-6s** | −35 to −47% |
| Threat turn w/ self-correction | ~17.5s | **~7-11s** | −40 to −60% |
| Cost / happy turn | $0.0038 (openai-blend) | **$0.00038** | −90% |
| Cost / threat turn | $0.0085 | **$0.00073** | −91% |
| First-feedback latency (UI) | ~6s (single generic spinner) | **~100ms** (typing indicator `...` in chat bubble) | ~60× |
| Vendor diversity | single or all-one | **2 vendors min, ≥1 non-OpenAI** | enforced via smoke test |

Total OpenRouter spend for two-scenario journey eval: **$0.00111** (one-third of a cent).

---

## Pipeline architecture (refresher)

```
user message
   ↓
[Layer 0: deterministic security gate]   ── api/lib/security.js
   ↓
NLU (Escuta Ativa)                       ── classify intent + sentiment, JSON
   ↓
Motor de Acordo                          ── pick discount + parcels (LLM)
   ↓                                        recompute math deterministically  ── GP-12
                                            via calculateAmortization
   ↓
Empatia (Copywriter)                     ── free-text reply, persona-aware
   ↓
Guardião (Compliance) [L0→L1→L2→L3]      ── 4-layer audit, may self-correct
   ↓                                        max 2 self-corrections (YAML driven)
final response → user
```

GP-01 is non-negotiable: **the Guardião always executes on every turn**. Speed work happened *inside* that constraint, never around it.

---

## Per-agent model selection — rationale matrix

Final assignment in the `balanced-cost` profile (`config/harness_negotiator.yaml`):

| Agent | Model | Pricing ($/1M, in/out) | Why this model |
|---|---|---|---|
| **NLU** | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | Tiny JSON classifier — output is ~100 tokens. Cheapest fast-JSON on OpenRouter that handles Portuguese cleanly. `gemini_flash` prompt hint enforces "no markdown, no fences, only JSON" — critical for parse reliability on small models. |
| **Motor** | `mistralai/mistral-small-2603` | $0.15 / $0.60 | Strict JSON, temperature 0 (GP-05 — determinism for audit). **Math is recomputed by `calculateAmortization` (GP-12)**, so the LLM is a *policy picker*, not a calculator. Mistral Small's JSON adherence is rock-solid (~700-1500ms typical), matching Claude/GPT at a fraction of the cost. |
| **Empatia** | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | The biggest decode-time agent. Gemini Flash Lite produced equally empathic copy to GPT-4o-mini at ~half the time. The `gemini_flash` text-mode hint nudges concision (which compounds with the `EMPATIA_MAX_TOKENS=400` cap to keep wall time low). Tradeoff: a small loss in tone polish vs. GPT-4o-mini — judged acceptable for a 1-2s/turn savings. |
| **Guardião** | `mistralai/mistral-small-2603` | $0.15 / $0.60 | LLM-as-judge runs only after three deterministic layers screen the trivial cases. Mistral was ~5× faster than GPT-4o-mini at this job in journey-eval measurements (~700-1300ms vs 1-5s with bad tails) at equal JSON quality. Temperature 0 — same audit input must produce same audit verdict (GP-05). |

**Two-vendor minimum is enforced by smoke test** (`scripts/smoke-test.mjs`, the `balanced-cost spans ≥ 2 distinct vendors` assertion) — collapsing the harness back to single-vendor would be a real regression.

---

## Speed engineering — what moved the needle

Work is ordered by **measured impact**, descending. All measurements come from `npm run eval:journey balanced-cost` against live OpenRouter.

### 1. In-chat typing indicator — −60× perceived latency (no wall-clock change)

**Before.** A single "Orquestrando Multiagentes..." spinner was displayed for the entire 4-7s pipeline. The user had no signal whether the system was actually doing anything or hung. From a UX-research perspective this is the worst possible loader: indeterminate, identical, slow.

**After (current).** `src/components/ProgressIndicator.jsx` renders a **WhatsApp-style typing bubble** — three bouncing dots (`...`) inside the same AI message shape (`Bot` avatar + `modeCfg.msgBg` + `rounded-2xl rounded-tl-sm`). It appears in the chat thread the instant `isProcessing` is true (~100ms after send). The user reads it as "the assistant is composing a reply", not as an operational dashboard widget.

| Concern | Where it lives |
|---|---|
| Conversational "someone is typing" affordance | **Chat bubble** (`ProgressIndicator`) |
| Per-agent pipeline state (NLU → Motor → Empatia → Guardião) | **`PipelineMiniBar`** above the chat + **Sidebar Inspector** |
| Chain-of-thought, tools, RAG, tokens/cost | **Engineer Cockpit** / Inspector panel |

This split is intentional: the chat stays conversational; engineers still get full observability outside the message thread. GP-01 is preserved — the bubble never surfaces the un-vetted Empatia draft, only abstract phase via an `sr-only aria-live="polite"` announcement for screen readers ("Escutando sua mensagem" → "Calculando proposta" → "Redigindo resposta empática" → "Verificando conformidade").

Animation respects `prefers-reduced-motion` via the global rule in `src/index.css` (`.typing-dot` keyframe).

### 2. Risk-tiered Guardião (L3 LLM-judge fast-path) — −700 to −1300ms / turn

**Before.** Every turn ran all four Guardião layers, including the L3 LLM-as-judge call (~700-1300ms / ~$0.00020 per call).

**Observation.** Across every journey-eval run on every profile: L3 has *never* disagreed with L0/L1/L2 when the deterministic layers were clean. Its actual value is as a semantic backstop for ambiguous coercion (e.g. *"Caso não pague, será encaminhado ao departamento jurídico"* — passes regex but is borderline coercive).

**After.** `api/lib/agents/guardiao.js` exits early **only when all of**:

```js
L0 leakage scan: clean
L1 regex check : zero CDC violations
L2 upstream    : no security threats raised by the Layer-0 gate
intent         : NOT in HIGH_RISK_INTENT_PATTERNS = /amea[cç]a|risco\s+legal|coerc|jur[ií]dic|contesta|fraude/
```

Risky intents *always* escalate to L3. Null/unknown intent escalates to L3 (safe default). The change is fully audited:
- Trace logs `L3:skipped(low_risk)` so engineers can see which turns took the fast path.
- The `security:llm_judge` tool call is still recorded (`{ skipped: true, reason: 'low_risk_deterministic_pass' }`) for compliance auditing — *not* invisibly elided.

**Smoke-test coverage** (`scripts/smoke-test.mjs`, section *"Guardião: risk-tiered fast-path"*) — 11 assertions including:
- Clean low-risk turn → APROVADO, 0 tokens, **0ms**, `fetch` never called.
- `detected_intent: "Ameaça Jurídica / Risco Legal Elevado"` → forces L3 LLM call.
- Upstream `PROMPT_INJECTION` threat → forces L3 LLM call.
- CDC-forbidden regex hit (e.g. *"sujar nome"*) → short-circuits to REJEITADO at L1, L3 still skipped.
- `detected_intent: null` → escalates to L3 (safe default).

**Compliance review.** GP-01 ("Guardião sempre executa por último") is preserved — the Guardião agent still runs every turn; only the LLM call *inside it* is elided when there's nothing semantically ambiguous to judge. This is the standard risk-tiered audit pattern used in production compliance systems.

### 3. Empatia model swap (GPT-4o-mini → Gemini 2.5 Flash Lite) — −1 to −2s / turn

Empatia is the only free-text agent (no JSON schema to constrain the decode). It's the wall-clock bottleneck of the happy path. Measured comparison on identical input:

| Model | Median decode | $/turn (Empatia only) | Tone quality (subjective)* |
|---|---|---|---|
| `openai/gpt-4o-mini` (prior) | ~3.4s | $0.00018 | Polished, slightly long |
| `google/gemini-2.5-flash-lite` (current) | ~1.9s | $0.00012 | Empathic, more concise — observed: *"Oi João, entendo perfeitamente sua situação..."* |
| `qwen/qwen3.6-flash` (specialist) | ~13s, 3000+ tok output | $0.0030 | Verbose, runaway generation — rejected |

\* Tone quality was assessed against the criteria in `agente_empatia_copywriter.system_prompt` (CUSTOMER persona: 3 short paragraphs, 1 emoji, open question). Both Gemini and GPT-4o-mini meet all criteria; Gemini is more concise.

### 4. `EMPATIA_MAX_TOKENS` cap — −0.5 to −1s / turn

Decode latency is linear in output length. The original 600-token cap was 3-4× the longest realistic reply. Empirical distribution from journey-eval:

| Persona | Real completion tokens (range) |
|---|---|
| CUSTOMER (WhatsApp reply) | 120-180 |
| AGENT (bullet-point cockpit) | 180-280 |

Cap was tightened to **400** in `api/lib/agents/empatia.js`. Still leaves ~30% headroom over the longest observed reply and is overridable per-agent via `agent.max_tokens` in the YAML.

The cap also serves as a **defense-in-depth** against runaway generation from chatty models — measured: Qwen 3.6 Flash emitted 3000+ tokens without a cap, pushing total turn latency past Vercel's `maxDuration: 30s`.

### 5. Guardião model swap (GPT-4o-mini → Mistral Small) — −1 to −4s / turn

The Guardião's variability was the worst single agent. GPT-4o-mini Guardião measured 1-5s with very bad p99 tails on OpenRouter. Mistral Small returned the same JSON verdict in **700-1300ms** with much tighter latency distribution. Same pricing tier ($0.15/$0.60), same correctness, dramatically better tails.

### 6. Empatia free-text prompt hint = `gemini_flash` — concision via prompt engineering

The `gemini_flash` hint in `api/lib/openrouter.js#applyPromptHints` appends a style directive to free-text agents:
```
ESTILO: seja conciso, direto e mantenha tom natural. Sem markdown pesado, sem listas longas.
```
This is the cheapest possible latency optimization (one extra line in the system prompt, zero infrastructure change) and consistently produces shorter, more readable replies.

---

## Cost analysis

All figures from real OpenRouter calls. Token counts are real (not estimates); pricing is from `agents[].pricing` in the YAML.

### Per-agent breakdown — happy turn (`desemprego_parcelas` scenario, balanced-cost)

| Agent | Tokens (in / out) | Latency | Cost USD |
|---|---|---|---|
| NLU (Gemini 2.5 Flash Lite) | ~370 / ~30 | ~1s | $0.00006 |
| Motor (Mistral Small) | ~600 / ~130 | ~1.5s | $0.00018 |
| Empatia (Gemini 2.5 Flash Lite) | ~700 / ~140 | ~2s | $0.00012 |
| Guardião (Mistral Small, fast-path) | 0 / 0 | **0ms** | **$0.00000** |
| **Total** | ~1670 / ~300 | **~4.5s** | **$0.00038** |

### Per-agent breakdown — threat turn with self-correction (1 retry)

| Agent run | Tokens (in / out) | Latency | Cost USD | Note |
|---|---|---|---|---|
| NLU | ~370 / ~30 | ~1.8s | $0.00006 | |
| Motor | ~580 / ~110 | ~2.3s | $0.00015 | Cannot propose (intent = Ameaça Jurídica) |
| Empatia (pass 1) | ~700 / ~150 | ~2.6s | $0.00017 | Draft contains a forbidden phrase |
| Guardião (pass 1) | 0 / 0 | **0ms** | $0.00000 | L1 regex catches violation (no LLM call) |
| Empatia (pass 2) | ~770 / ~160 | ~2.8s | $0.00015 | Rewritten after Guardião feedback |
| Guardião (pass 2) | ~770 / ~190 | ~1.3s | $0.00020 | L3 fires (high-risk intent forces it) |
| **Total** | ~3190 / ~640 | **~10.8s** | **$0.00073** | |

### Profile comparison

Aggregated across 2 scenarios (1 happy + 1 threat-with-self-correction), measured 26 May 2026 against live OpenRouter:

| Profile | Vendors | Pass / total | Total cost (2 turns) | Median wall clock | Notes |
|---|---|---|---|---|---|
| **`balanced-cost`** ★ | Google + Mistral (+ fast-path) | 2/2 | **$0.00111** | **~7s avg** | Production default |
| `gemini-flash-lite` | Google only | 2/2 | $0.00075 | ~6s | Single-vendor, no diversity |
| `openai-blend` | OpenAI only | 2/2 | $0.00851 | ~10s | Premium tier |
| `claude-haiku` | Anthropic only | 2/2 | $0.01018 | ~13s | Premium tier |
| `openrouter-specialist` | 4 vendors | 2/2 | $0.00688 | ~22-34s | **Risk: Motor can exceed 30s `maxDuration`** |

Cost-per-pass-vs-speed Pareto frontier puts `balanced-cost` at a near-corner solution: it's the cheapest of the multi-vendor blends, the second-fastest profile overall, and the only one with explicit risk-tiered Guardião.

---

## Tradeoffs accepted

Documenting these explicitly so future engineers don't re-relitigate them.

| Tradeoff | Decision | Why |
|---|---|---|
| Vendor diversity vs Empatia latency | Took 1-2s saving over the third vendor | Two vendors still proves multi-model wiring; chatty third-vendor copywriting (Qwen) was a UX regression |
| L3 fast-path vs absolute audit coverage | Skip L3 on demonstrably-low-risk turns | L3 never disagreed with L0/L1/L2-clean in measurement, and high-risk intents still always escalate. Saves ~1.3s on the majority case |
| 400-tok Empatia cap vs occasional truncation | Tight cap | Real outputs fit in 280 tok max; truncation hasn't been observed in 100+ runs |
| Gemini Flash Lite tone vs GPT-4o-mini polish | Flash Lite | Saves ~1.5s/turn — perceived UX win > marginal tone polish |
| Single sample vs full statistical sweep | Single sample per turn, 3-run sanity checks | OpenRouter tail variance is real; published numbers are median + caveat. Full p50/p99 distribution would require a load test (out of scope for POC) |

---

## How to verify these claims (reviewer's playbook)

Every measurement is reproducible. From `poc-collection-agents/`:

1. **Smoke layer** (deterministic, no network):
   ```bash
   npm test                     # 152 assertions, < 1s
   ```
   Covers: security gate, harness loader, MCP contracts, profile resolution, max_tokens plumbing, **Guardião risk-tiered fast-path**, MOCK_CRM_CASE fixture, post-clamp `desconto` merge regression.

2. **End-to-end journey** against live OpenRouter:
   ```bash
   npm run eval:journey                   # all profiles, ~3min, ~$0.03
   npm run eval:journey balanced-cost     # one profile, ~10-15s, ~$0.001
   ```
   Prints per-agent model, latency, tokens, cost. Verifies Motor math via `calculateAmortization`, scans final reply for CDC forbidden words, confirms compliance status.

3. **Per-profile A/B**:
   ```bash
   OPENROUTER_MODEL_PROFILE=balanced-cost     npm run eval:journey balanced-cost
   OPENROUTER_MODEL_PROFILE=openai-blend      npm run eval:journey openai-blend
   ```
   Cost and latency in the summary footer.

4. **UI**:
   ```bash
   npm run dev
   # → open http://localhost:5173, send "Perdi meu emprego" — watch the (...) typing bubble in chat;
   #   expand PipelineMiniBar / Sidebar for per-agent progress
   ```

---

## Future levers (not done yet — listed for follow-up reviewers)

These are the next-most-promising optimizations not implemented in this iteration. Each is annotated with rough expected impact and the reason it wasn't taken.

| # | Lever | Expected | Why not now |
|---|---|---|---|
| 1 | Pre-fetch MCP tools (`getDebtStatus`, `getDiscountPolicy`) in parallel with NLU | 0ms in mock mode, ~200ms when MCP is real network I/O | No real ROI on mocks; revisit at MCP integration |
| 2 | Stream Empatia tokens to the Inspector panel (engineer cockpit only, never chat) | Real-time visual feedback in cockpit | Adds SSE streaming plumbing; chat-side typing indicator already covers end-user UX |
| 3 | Pre-warm an OR HTTP/2 connection at function cold start | ~50-100ms on first request | Vercel function lifecycle makes this brittle; revisit if cold starts become a complaint |
| 4 | Trim Motor input context (drop unused debt fields) | ~50-100 tokens × $0.15/1M = trivial | Cost already negligible; readability of the audit trail matters more |
| 5 | Replace L3 LLM with a smaller fine-tuned classifier for CDC compliance | -300-500ms when L3 does fire | Requires labelled training corpus; production-only path |
| 6 | OpenRouter `transforms: ['middle-out']` for long histories | Minor on current 6-turn window | Re-evaluate at production history sizes |
| 7 | Specialist Guardião only for risky intents (cascade) | -200ms on the fraction of risky turns | Diminishing returns now that fast-path covers most volume |

---

## Files of record

| File | Owns |
|---|---|
| `config/harness_negotiator.yaml` | Active profile, per-agent model + pricing + JSON strategy + prompt hints |
| `api/lib/agents/guardiao.js` | Risk-tiered Guardião with L3 fast-path |
| `api/lib/agents/empatia.js` | `EMPATIA_MAX_TOKENS` cap |
| `api/lib/openrouter.js` | `maxTokens` plumbing on the request body |
| `src/components/ProgressIndicator.jsx` | In-chat typing indicator (`...` bubble) |
| `src/components/PipelineMiniBar.jsx` | Compact per-agent progress above chat |
| `src/index.css` | `.typing-dot` animation (respects reduced motion) |
| `scripts/journey-eval.mjs` | End-to-end measurement harness (also `npm run eval:journey`) |
| `scripts/smoke-test.mjs` | All deterministic regression assertions (152 currently) |
