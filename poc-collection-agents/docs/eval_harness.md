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
