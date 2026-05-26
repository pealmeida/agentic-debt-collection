# AGENTS.md — POC Multiagente de Cobrança

Índice para agentes de IA trabalhando neste repositório.
Mantenha este arquivo curto (~100 linhas). Aponte para fontes de verdade, não replique conteúdo.

---

## O que é este projeto

Sistema multiagente de cobrança que orquestra 4 agentes LLM em sequência para negociar dívidas.
Suporta dois perfis: **CUSTOMER** (cliente via WhatsApp/chat) e **AGENT** (Collections Engineer no CRM).

---

## Mapa do repositório

```
poc-collection-agents/
├── AGENTS.md                    ← você está aqui
├── config/
│   └── harness_negotiator.yaml  ← fonte da verdade dos agentes (prompts, models, tools, evals)
├── api/
│   ├── orchestrate.js           ← endpoint principal (SSE, pipeline, self-correction)
│   ├── healthz.js               ← health check
│   └── lib/
│       ├── harness.js           ← parser do YAML (getAgent, getPipeline, getSelfCorrection)
│       ├── openrouter.js        ← wrapper OpenRouter (callOpenRouter, parseJSON)
│       ├── security.js          ← detectores: token flooding, prompt injection, jailbreak, leakage
│       ├── tools.js             ← mocks MCP determinísticos (debt_status, políticas, CDC)
│       └── agents/
│           ├── nlu.js           ← Escuta Ativa (intenção + sentimento)
│           ├── motor.js         ← Motor de Acordo (cálculo + RAG)
│           ├── empatia.js       ← Copywriter (persona CUSTOMER/AGENT)
│           └── guardiao.js      ← Compliance (regex + LLM-as-judge)
├── src/
│   ├── App.jsx                  ← composição de alto nível (~280 linhas)
│   ├── constants.js             ← MODES, PIPELINE_STEPS, SUGGESTIONS, INITIAL_AGENT_STATE
│   ├── utils.js                 ← formatTime, session helpers, getStepStatus, downloadJSON
│   ├── main.jsx                 ← React entrypoint
│   ├── shared/security.js       ← re-export client-side dos detectores de segurança
│   ├── services/
│   │   ├── orchestrator.js      ← cliente SSE + fallback simulação
│   │   ├── fallback-scenarios.js← 7 cenários determinísticos para demo offline
│   │   └── pipeline-events.js   ← handler que aplica eventos SSE no state React
│   └── components/
│       ├── ChatMessage.jsx      ← bolha de mensagem (todas as variantes)
│       ├── ModeSwitchBar.jsx    ← tabs Cliente / Engineer
│       ├── PipelineMiniBar.jsx  ← mini-progresso (mobile)
│       ├── SidebarPanel.jsx     ← painel direito (Grafo / Inspetor / Cockpit)
│       ├── InspectorPanel.jsx   ← terminal dark de Thought/Tools/RAG
│       └── EngineerCockpit.jsx  ← Cockpit Collections Engineer (Observability + Harness Studio)
└── docs/
    ├── prompt_guide.md          ← prompts prontos para demo (copiar/colar)
    ├── prd_requisitos.md        ← PRD completo
    ├── arquitetura_poc.md       ← diagrama e stack
    ├── golden_principles.md     ← invariantes mecânicas (leia antes de editar agentes)
    └── eval_harness.md          ← como rodar e interpretar os cenários de eval
```

---

## Fontes de verdade

| O que | Onde |
|-------|------|
| Prompts de todos os agentes | `config/harness_negotiator.yaml` → `agents[].system_prompt` |
| Modelos e temperaturas | `config/harness_negotiator.yaml` → `model_profiles[active].agents[].*` (com fallback em `agents[].model / temperature`) |
| Estratégia JSON + prompt hints | `config/harness_negotiator.yaml` → `model_profiles[active].agents[].{json_strategy, prompt_hints}` |
| Profile ativo | `OPENROUTER_MODEL_PROFILE` env var → fallback `active_profile` no YAML |
| Cost / pricing | `model_profiles[*].agents[*].pricing.{input,output}_per_1m_usd` |
| Guardrails CDC + Security | `config/harness_negotiator.yaml` → `agents[*].guardrails` |
| Detectores de segurança | `api/lib/security.js` (token flooding, injection, jailbreak, leakage) |
| Self-correction config | `config/harness_negotiator.yaml` → `state_graph.self_correction` |
| Eval scenarios | `config/harness_negotiator.yaml` → `evals.scenarios` |
| Dados mock (dívida, alçadas) | `api/lib/tools.js` |
| Invariantes de qualidade | `docs/golden_principles.md` |

---

## Pipeline obrigatório

```
mensagem → NLU → Motor de Acordo → Empatia → Guardião → resposta
                                         ↑____________↓ self-correction (max 2x)
```

O Guardião é **sempre o último nó**. Nenhuma resposta chega ao usuário sem passar por ele.

---

## O que NÃO fazer

- Não acesse o banco de dados diretamente. Use `api/lib/tools.js` (contrato MCP).
- Não escreva respostas com termos de `guardrails[].patterns` do YAML.
- Não mude a ordem do pipeline sem atualizar `state_graph.pipeline` no YAML.
- Não coloque lógica de negócio em `App.jsx` — pertence aos agentes em `api/lib/agents/`.

---

## Ver também

- [Guia de prompts](docs/prompt_guide.md)
- [PRD e requisitos](docs/prd_requisitos.md)
- [Arquitetura](docs/arquitetura_poc.md)
- [Princípios de ouro](docs/golden_principles.md)
- [Como rodar evals](docs/eval_harness.md)
- [**Performance — análise cost/speed e decisões arquiteturais**](docs/performance.md) — leitura obrigatória antes de mexer em models/profiles/Guardião
- [Harness Engineering (OpenAI)](https://openai.com/pt-BR/index/harness-engineering/) — inspiração da estrutura
- [Collections Engineer (Monest)](https://monest.com.br/collections) — inspiração da persona operador
