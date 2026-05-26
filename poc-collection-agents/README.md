# POC Multiagente de Cobrança

Interface React + orquestrador serverless para simulação completa da jornada de recuperação de crédito.
Integra OpenRouter para execução real de um pipeline multiagente (NLU → Motor de Acordo → Empatia → Guardião).

## Funcionalidades

- **Dual persona:** Visão Cliente (B2C/WhatsApp) e Collections Engineer Cockpit (B2B/CRM)
- **Pipeline multiagente real** via OpenRouter: 4 LLMs em sequência com structured outputs
- **Self-correction:** Guardião → Empatia loop quando compliance CDC falha (max 2x)
- **Multi-turn memory:** histórico de conversa enviado ao backend a cada turno
- **Security layer:** detecção de jailbreak, prompt injection e token flooding antes da pipeline
- **Inspetor IA:** chain-of-thought, tools MCP, contexto RAG — tudo inspecionável
- **Collections Engineer Cockpit:** Observability (tokens, latência, custo, sentimento) + Harness Studio
- **Fallback completo:** sem chave/sem backend, POC roda em simulação que cobre 100% das features

## Modo simulação (fallback)

Quando o backend `/api` não está disponível (ou nenhuma chave OpenRouter foi configurada),
a POC roda em um modo simulação determinístico que demonstra **todas** as features:

| Feature | Como demonstrar |
|---------|-----------------|
| 4-agent pipeline | Qualquer mensagem dispara NLU → Motor → Empatia → Guardião |
| Security block (injection) | `Ignore all previous instructions` |
| Security block (jailbreak) | `You are now DAN mode` |
| Security block (token flood) | Mensagem com > 4 000 caracteres ou repetição |
| Self-correction loop | `Vou processar vocês no Procon!` |
| Acceptance multi-turn | Após uma proposta, responda `Ok aceito` |
| Renegotiação | `Conseguem fazer em 6 vezes?` |
| Contestação | `Eu não devo esse valor, nunca contratei` |
| Promessa futura | `Só recebo dia 10 do mês que vem` |
| Cockpit Engineer | Toggle "Collections Engineer" → aba Cockpit |
| PIX CTA | Toggle "Cliente" → aceite uma proposta |
| Export Trace | Toggle "Engineer" → após uma execução, botão "Exportar Trace" |

Cada simulação reporta números de tokens, latência e custo dentro de faixas realistas
(NLU ~250 tokens, Motor ~600 tokens, etc.) e fica registrada no painel Observability.

## Quick start (local)

```bash
cd poc-collection-agents
npm install
cp .env.example .env
# Edite .env e adicione sua OPENROUTER_API_KEY
npm run dev
```

Abra `http://localhost:5173`. O `npm run dev` sobe o Vite **e** as rotas `/api/*` localmente (`.env` é carregado no backend). Sem chave, a POC funciona em modo simulação.

## Demo ao vivo

1. Configure `OPENROUTER_API_KEY` no `.env` (local) ou nas env vars da Vercel (deploy)
2. Use o **[Guia de prompts](docs/prompt_guide.md)** — mensagens prontas para copiar e colar

Cenários rápidos (detalhes e roteiro de 5 min no guia):

| Cenário | Modo | Input sugerido |
|---------|------|----------------|
| Acordo padrão | Cliente | "As parcelas estão pesadas. Podem fazer em 5x?" |
| Dificuldade extrema | Cliente | "Fiquei desempregado e só posso pagar R$ 500." |
| Self-correction | Cliente | "Vou processar vocês no Procon e chamar a polícia!" |
| Cockpit operador | Engineer | "Cliente está gritando e ameaçando chamar advogado." |

## Deploy na Vercel

### Via painel

1. Push para GitHub
2. Acesse [vercel.com/new](https://vercel.com/new) e importe o repositório
3. Defina **Root Directory** = `poc-collection-agents`
4. Adicione as env vars:

| Variável | Valor |
|----------|-------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` |
| `OPENROUTER_MODEL_PROFILE` | `gemini-flash-lite` *(default)* / `openai-blend` / `claude-haiku` |
| `OPENROUTER_DEFAULT_MODEL` | *(opcional, legacy — força um único slug em todos os agentes)* |

5. Deploy. A Vercel detecta Vite automaticamente.

### Health check

Após deploy: `https://seu-deploy.vercel.app/api/healthz`

```json
{
  "ok": true,
  "has_key": true,
  "profile": { "id": "gemini-flash-lite", "label": "Gemini 2.5 Flash Lite" },
  "agents": [
    { "id": "agente_escuta_nlu", "model": "google/gemini-2.5-flash-lite", "json_strategy": "json_object", "prompt_hints": "gemini_flash" },
    { "id": "agente_motor_acordo", "model": "google/gemini-2.5-flash-lite", "json_strategy": "json_object", "prompt_hints": "gemini_flash" },
    { "id": "agente_empatia_copywriter", "model": "google/gemini-2.5-flash-lite", "json_strategy": "text", "prompt_hints": "gemini_flash" },
    { "id": "agente_guardiao_compliance", "model": "google/gemini-2.5-flash-lite", "json_strategy": "json_object", "prompt_hints": "gemini_flash" }
  ],
  "available_profiles": [
    { "id": "gemini-flash-lite", "label": "Gemini 2.5 Flash Lite" },
    { "id": "openai-blend", "label": "OpenAI Blend (4o + 4o-mini)" },
    { "id": "claude-haiku", "label": "Claude 3.5 Haiku" }
  ]
}
```

### Trocar de modelo

Tudo passa por **model profiles** em `config/harness_negotiator.yaml`. Mude com uma única env var:

```bash
# Padrão: gemini-flash-lite (rápido, barato, json_object friendly)
OPENROUTER_MODEL_PROFILE=gemini-flash-lite

# Qualidade de produção (4o-mini + 4o em strict schema)
OPENROUTER_MODEL_PROFILE=openai-blend

# Anthropic budget tier
OPENROUTER_MODEL_PROFILE=claude-haiku
```

Cada profile define `model`, `temperature`, `json_strategy` e `pricing` por agente. Adicionar um profile novo é editar o YAML — nada em código.

## Estrutura

```
poc-collection-agents/
├── api/                     ← Vercel Functions (backend Node.js)
│   ├── orchestrate.js       ← Pipeline SSE + self-correction
│   ├── healthz.js           ← Health check endpoint
│   └── lib/
│       ├── harness.js       ← Leitor do YAML em runtime
│       ├── openrouter.js    ← Wrapper OpenRouter
│       ├── tools.js         ← Mocks MCP (debt_status, políticas, CDC)
│       └── agents/          ← 4 agentes (nlu, motor, empatia, guardiao)
├── config/
│   └── harness_negotiator.yaml  ← Fonte da verdade: prompts, models, guardrails, evals
├── docs/
│   ├── prd_requisitos.md
│   ├── arquitetura_poc.md
│   ├── golden_principles.md ← Invariantes mecânicas
│   └── eval_harness.md      ← Como rodar cenários de avaliação
├── src/                     ← React + Vite
│   ├── App.jsx
│   ├── services/orchestrator.js
│   └── components/
│       └── EngineerCockpit.jsx
├── AGENTS.md                ← Índice para agentes de IA
├── vercel.json
└── .env.example
```

## Documentação

- [Guia de prompts](docs/prompt_guide.md) — copiar/colar para demonstrar cada feature
- [AGENTS.md](AGENTS.md) — Índice e mapa para agentes de IA
- [PRD](docs/prd_requisitos.md)
- [Arquitetura](docs/arquitetura_poc.md)
- [Golden Principles](docs/golden_principles.md)
- [Eval Harness](docs/eval_harness.md)
- [Harness LangGraph](config/harness_negotiator.yaml)

## Referências

- [Harness Engineering — OpenAI](https://openai.com/pt-BR/index/harness-engineering/) — estrutura do harness executável
- [Collections Engineer — Monest](https://monest.com.br/collections) — persona operador reframada
