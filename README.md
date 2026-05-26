# agentic-debt-collection

POC multiagente de cobrança com orquestração de IA para recuperação de crédito: negociação autônoma via WhatsApp (B2C) ou copiloto para operadores no CRM (B2B), com compliance CDC e pipeline de quatro agentes LLM.

## O que há neste repositório

Monorepo com uma aplicação completa em [`poc-collection-agents/`](poc-collection-agents/):

| Camada | Descrição |
|--------|-----------|
| **UI** | React + Vite — chat dual-persona, grafo do pipeline, Inspetor IA, Cockpit do Collections Engineer |
| **API** | Vercel Functions — orquestrador SSE, OpenRouter, security gate, self-correction |
| **Harness** | YAML versionável — prompts, modelos, tools MCP, guardrails e cenários de eval |
| **Docs** | PRD, arquitetura, princípios de ouro, eval harness e **guia de prompts** |

## Funcionalidades em destaque

- **Pipeline multiagente:** NLU → Motor de Acordo → Empatia → Guardião (com loop de self-correction até 2×)
- **Dual persona:** Visão Cliente (B2C) e Collections Engineer (B2B)
- **Security layer:** jailbreak, prompt injection e token flooding bloqueados antes do pipeline
- **Inspetor IA:** chain-of-thought, tools MCP e contexto RAG inspecionáveis
- **BYOK:** chave OpenRouter do usuário via Configurações (localStorage)
- **Modo simulação:** sem API key, todas as features são demonstráveis offline

## Quick start

```bash
cd poc-collection-agents
npm install
cp .env.example .env   # opcional: OPENROUTER_API_KEY para LLM real
npm run dev
```

Abra `http://localhost:5173`. Sem chave, a POC roda em **modo simulação** com o mesmo fluxo visual.

Para ver cada feature com mensagens prontas, use o **[Guia de prompts](poc-collection-agents/docs/prompt_guide.md)** (copiar e colar no chat).

## Estrutura do monorepo

```
agentic-debt-collection/
└── poc-collection-agents/
    ├── api/                 # Backend serverless (orchestrate, healthz, agentes)
    ├── config/              # harness_negotiator.yaml — fonte da verdade
    ├── docs/                # PRD, arquitetura, golden principles, prompt guide
    ├── src/                 # React (App, componentes, orchestrator client)
    ├── scripts/             # smoke-test, fallback-demo
    ├── AGENTS.md            # Índice para agentes de IA no Cursor
    └── README.md            # Documentação detalhada da POC
```

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| [README da POC](poc-collection-agents/README.md) | Setup, BYOK, deploy Vercel, tabela de fallback |
| [Guia de prompts](poc-collection-agents/docs/prompt_guide.md) | Prompts prontos para demonstrar cada feature |
| [PRD](poc-collection-agents/docs/prd_requisitos.md) | Requisitos funcionais e critérios de aceite |
| [Arquitetura](poc-collection-agents/docs/arquitetura_poc.md) | Camadas, state graph, stack |
| [Golden principles](poc-collection-agents/docs/golden_principles.md) | Invariantes mecânicas do pipeline |
| [Eval harness](poc-collection-agents/docs/eval_harness.md) | Cenários YAML e como validar |
| [AGENTS.md](poc-collection-agents/AGENTS.md) | Mapa do código para coding agents |
| [Harness YAML](poc-collection-agents/config/harness_negotiator.yaml) | Prompts, models, guardrails, evals |

## Deploy (Vercel)

1. Push para GitHub.
2. [vercel.com/new](https://vercel.com/new) → importe o repositório.
3. **Root Directory:** `poc-collection-agents`
4. Variáveis recomendadas: `OPENROUTER_API_KEY`, `ALLOW_BYOK=true`

Health check após deploy: `https://<seu-deploy>.vercel.app/api/healthz`

## Referências

- [Harness Engineering — OpenAI](https://openai.com/pt-BR/index/harness-engineering/)
- [Collections Engineer — Monest](https://monest.com.br/collections)
