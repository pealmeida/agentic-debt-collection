# Eval Harness — Como Rodar e Interpretar Cenários

O sistema de eval permite validar o comportamento do pipeline multiagente contra casos conhecidos.
Os cenários estão declarados em `config/harness_negotiator.yaml` → `evals.scenarios`.

Inspirado na abordagem de [Harness Engineering da OpenAI](https://openai.com/pt-BR/index/harness-engineering/):
> *"Eval harness: artefatos de primeira classe, versionados no repositório."*

---

## Cenários disponíveis

| ID | Descrição | user_role | Intent esperado |
|----|-----------|-----------|-----------------|
| `ameaca_juridica` | Cliente ameaça Procon | CUSTOMER | Ameaça Jurídica |
| `desemprego_extreme` | Desempregado propõe valor abaixo da alçada | CUSTOMER | Dificuldade Extrema |
| `operador_agressivo` | Operador relata cliente agressivo | AGENT | — |
| `parcelas_extras` | Cliente pede mais parcelas | CUSTOMER | Pedido de desconto |

---

## Critérios de aceite por cenário

Cada cenário define `expect`:
- `compliance_status`: deve ser `APROVADO`
- `detected_intent_contains`: substring esperada no intent
- `sentiment`: sentimento esperado
- `forbidden_in_output`: termos que NÃO podem aparecer na resposta final
- `proposal_in_response`: true = resposta deve conter uma proposta concreta
- `output_format: bullet_points` = resposta deve conter listas numeradas

---

## Como rodar manualmente (hoje)

Ainda sem runner automatizado. Para validar:

1. Inicie o servidor: `npm run dev`
2. Abra `http://localhost:5173`
3. Configure `OPENROUTER_API_KEY` no `.env` (local) ou nas env vars da Vercel
4. Para cada cenário, use o input descrito no YAML
5. Verifique no Inspetor IA:
   - **Thought** do NLU: intent classificado
   - **Tools** do Motor: `calculate_amortization` invocado
   - **Thought** do Guardião: status APROVADO
6. Verifique na resposta final: ausência dos `forbidden_in_output`

---

## Runner automatizado multi-profile — `npm run eval:journey`

`scripts/journey-eval.mjs` exercita o pipeline real (NLU → Motor → Empatia → Guardião)
contra a OpenRouter para **cada `model_profile`** definido no YAML, usando o
`MOCK_CRM_CASE` de `src/constants.js` como contexto de dívida.

```bash
# Todos os profiles (balanced-cost, gemini-flash-lite, openai-blend, claude-haiku, openrouter-specialist)
npm run eval:journey

# Apenas um profile específico (mais barato pra A/B rápido)
npm run eval:journey gemini-flash-lite
npm run eval:journey openai-blend openrouter-specialist
```

Para varrer **todos os chips de demo** (ambas as personas, segurança e multi-turn)
pela pipeline real e validar realismo/compliance de cada cenário:

```bash
npm run eval:sweep          # scripts/scenario-sweep.mjs — ~$0.005, ~1 min
```

O runner imprime, por turno:
- Modelo + estratégia JSON usados em cada agente
- Latência, tokens e custo USD
- Quantas self-corrections o Guardião disparou
- Proposta final (com check matemático contra `calculateAmortization`)
- Preview da resposta + checagem de `forbidden_in_output`

Use isso para validar antes de trocar `OPENROUTER_MODEL_PROFILE` em produção.

**Observações de profiles** (medidas em runs reais — podem variar com fila da OR):

| Profile | Custo/turno | Latência total | Notas |
|---------|-------------|----------------|-------|
| **`balanced-cost`** ★ | **~$0.0004** | **~4-6s** happy / ~7-11s threat | Production default — Gemini Flash Lite (NLU + Empatia) + Mistral Small (Motor + Guardião) + **risk-tiered L3 fast-path no Guardião**. Vendor diversity preservada. |
| `gemini-flash-lite` | ~$0.0004 | ~5s | Single-vendor (sem diversidade), todos os agentes em Gemini Flash Lite |
| `openai-blend` | ~$0.004 | ~10s | Self-correction estável, custo alto no GPT-4o |
| `claude-haiku` | ~$0.005 | ~15s | Resposta verbosa, custo médio |
| `openrouter-specialist` | ~$0.005 | 20-35s | 4 vendors; **Qwen no Empatia pode gerar 3000+ tokens (runaway)** e estourar o `maxDuration` (30s) do Vercel. Só use em ambientes sem timeout agressivo. |

Para a análise profunda das decisões por trás de `balanced-cost` (escolha de modelo por agente, fast-path do Guardião, cap de tokens do Empatia, tradeoffs aceitos), veja [`docs/performance.md`](performance.md).

---

## Como interpretar falhas

| Falha | Causa provável | Fix |
|-------|---------------|-----|
| `detected_intent` errado | System prompt do NLU vago | Adicionar exemplos no `system_prompt` do `agente_escuta_nlu` |
| `compliance_status: REJEITADO` em loop | Empatia gera termos proibidos | Reforçar CRÍTICO no system_prompt do `agente_empatia_copywriter` |
| Proposta matemática errada | `calculate_amortization` não chamado | Verificar se Motor invoca a tool no trace |
| Self-correction não ativa | `max_attempts: 0` no YAML ou bug em orchestrate.js | Checar `state_graph.self_correction` |

---

## Adicionando novos cenários

1. Adicione um bloco em `config/harness_negotiator.yaml` → `evals.scenarios`
2. Documente o resultado esperado em `expect`
3. Teste manualmente conforme a seção acima
4. Registre o resultado no PR

```yaml
- id: meu_cenario
  description: Descrição clara do caso
  input: "Mensagem exata do cliente"
  user_role: CUSTOMER
  expect:
    compliance_status: APROVADO
    forbidden_in_output:
      - termo_proibido
```

---

## Próxima fase: runner automatizado

Quando o backend estiver estável, um script `scripts/run-evals.js` poderá:
1. Ler todos os cenários do YAML
2. Chamar `/api/orchestrate` para cada um
3. Comparar resultados com `expect`
4. Gerar relatório JSON em `evals/results/`

Referência de implementação: seção de eval do [Harness Engineering OpenAI](https://openai.com/pt-BR/index/harness-engineering/).
