# PRD — Orquestrador Multiagente de Cobrança

## 1. Visão do Produto

Reduzir o **Cost-to-Collect** através de uma orquestração de IA capaz de:

- Negociar de forma autônoma via **WhatsApp** (B2C), ou
- Atuar como **Copiloto** para operadores (B2B),

mantendo **100% de compliance jurídico** (CDC).

## 2. Objetivo da POC

Validar o fluxo ponta a ponta entre interface, grafo de agentes e harness configurável — com simulação local antes da integração LangGraph + MCP em produção.

## 3. Requisitos Técnicos

### RT01 — Agnosticismo de Canal

O mesmo pipeline de agentes (LangGraph) deve processar requisições do WhatsApp ou do CRM Interno, guiando-se pelo parâmetro `user_role`:

| `user_role` | Canal | Output esperado |
|-------------|-------|-----------------|
| `CUSTOMER` | WhatsApp / B2C | Mensagem empática, formato conversacional |
| `AGENT` | CRM / B2B | Táticas, scripts e alertas para o operador |

### RT02 — Isolamento de Dados (MCP)

O modelo **não acessa a BD diretamente**. Utiliza o Model Context Protocol para requerer limites de desconto à URN `mcp:crm:debt_status` e políticas via `mcp:vector-store:politicas_desconto`.

### RT03 — Self-Correction

O Agente **Guardião** deve ter autoridade para vetar mensagens que soem ameaçadoras, devolvendo-as ao Agente de **Empatia** para reescrita antes do envio (`reject_and_rework`).

## 4. Requisitos Funcionais

### RF01 — Dual persona (Visão Cliente / Visão Operador)

Toggle na UI altera tom, formato e conteúdo da resposta final.

### RF02 — Pipeline multiagente

Fluxo obrigatório:

1. **Escuta Ativa (NLU)** — intenção e sentimento
2. **Motor de Acordo** — RAG + cálculo matemático
3. **Empatia (Copywriter)** — tradução por persona
4. **Guardião (Compliance)** — auditoria CDC + self-correction

### RF03 — Inspetor IA

Exibir chain-of-thought numerado, tools MCP invocadas (nome, args, status) e snippets RAG recuperados.

### RF04 — Simulação de cenários

Atalhos para objeções comuns: desemprego, parcelamento, ameaça Procon, cliente agressivo, promessa futura.

## 5. Estrutura de Estado (State Graph)

O JSON traficado entre os nós do grafo conterá:

```json
{
  "session_id": "sess_abc123",
  "user_role": "CUSTOMER",
  "detected_intent": "Ameaça Jurídica / Risco Legal Elevado",
  "calculated_proposal": {
    "total": 840,
    "parcelas": 4,
    "valorParcela": 210,
    "desconto": "30%"
  },
  "compliance_status": "APROVADO"
}
```

## 6. Requisitos Não Funcionais

| ID | Requisito |
|----|-----------|
| RNF01 | Harness declarativo em `config/harness_negotiator.yaml`, versionável em Git |
| RNF02 | POC executável localmente via `npm run dev` (LLM mockado na UI) |
| RNF03 | Guardrails do Guardião bloqueiam padrões: `sujar nome`, `processo`, `penhora`, `polícia`, `delegacia`, `prisão`, `ameaça`, `coação` |
| RNF04 | Deploy compatível com Vercel (Vite/React) |

## 7. Critérios de Aceite

- [x] Toggle Visão Cliente / Visão Operador altera respostas
- [x] Pipeline visualiza progresso dos 4 agentes em tempo real
- [x] Inspetor exibe thought, tools MCP e contexto RAG
- [x] Terminal logs registram cada etapa do grafo
- [x] Cenários de ameaça jurídica acionam desescalada e self-correction

## 8. Fora de Escopo (fase 2+)

- Integração WhatsApp/telefonia real
- LangGraph backend em produção
- Persistência de sessões em BD
- CRM/ERP live
