# agentic-debt-collection

POC Multiagente de Cobrança — orquestração de IA para recuperação de crédito via WhatsApp (B2C) ou copiloto para operadores (B2B), com compliance CDC.

## Estrutura

```
poc-collection-agents/   ← interface React + docs + harness YAML
├── docs/                ← PRD, arquitetura
├── config/              ← harness_negotiator.yaml (LangGraph)
└── src/                 ← App.jsx
```

## Quick start

```bash
cd poc-collection-agents
npm install
npm run dev
```

## Documentação

- [PRD](poc-collection-agents/docs/prd_requisitos.md)
- [Arquitetura](poc-collection-agents/docs/arquitetura_poc.md)
- [Harness LangGraph](poc-collection-agents/config/harness_negotiator.yaml)

## Deploy (Vercel)

Push para GitHub → Vercel **Add New Project** → root `poc-collection-agents` se monorepo.
