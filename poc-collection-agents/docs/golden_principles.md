# Golden Principles — Invariantes Mecânicas

Regras que não se dobram. Inspiradas no princípio da OpenAI Harness Engineering:
> *"Impondo invariantes, em vez de microgerenciar implementações"*

Quando uma regra for violada pelo código, o comportamento correto é codificá-la como linter/teste, não esperar que alguém leia o documento.

---

## GP-01 — Guardião sempre executa por último

O `agente_guardiao_compliance` é o nó terminal **obrigatório** do pipeline.
Nenhum texto chega ao usuário sem passar por ele.

**Por quê:** CDC Art. 42 é uma obrigação legal, não uma feature opcional.

**Verificação:** `state_graph.pipeline` no YAML termina sempre com `agente_guardiao_compliance`.

---

## GP-02 — Nenhum PII nos logs de terminal

O terminal de logs visível na UI (`ragLogs`) e os traces do inspetor **nunca expõem**:
- CPF/CNPJ (mesmo mascarado)
- Número de conta
- Dados bancários

**Por quê:** Logs são frequentemente copiados em demos/screenshots.

**Implementação:** `api/lib/tools.js` retorna apenas `cpf_masked`. Agentes NLU e Empatia não logam o texto completo da mensagem.

---

## GP-03 — `response_format: json_schema` obrigatório para NLU, Motor e Guardião

Agentes que produzem dados estruturados (intenção, proposta, compliance) devem usar `response_format` com schema estrito.
Parsing regex em cima de texto livre é frágil e proibido.

**Por quê:** O Motor usa os números da proposta para o Empatia — erro aritmético chega ao cliente.

**Implementação:** Ver `responseFormat` em cada `run()` de `api/lib/agents/`.

---

## GP-04 — Tools mock respeitam contrato MCP

Cada função em `api/lib/tools.js` retorna `{ result, source, snippet }`.
`source` deve ser uma URN válida (`urn:mcp:*`).

**Por quê:** Quando MCPs reais forem implementados, a troca é cirúrgica: substitua o corpo da função, não a interface.

---

## GP-05 — Temperatura zero para agentes determinísticos

Motor de Acordo e Guardião usam `temperature: 0.0`.
Duas execuções com o mesmo input devem produzir o mesmo resultado (dado o mesmo modelo).

**Por quê:** Auditoria CDC exige reprodutibilidade. Propostas matemáticas não podem variar por aleatoriedade.

---

## GP-06 — Sem código manual no pipeline UI

`App.jsx` não contém lógica de negócio (cálculo de desconto, detecção de intenção, compliance).
Todo processamento passa pelo backend via `/api/orchestrate`.

**Por quê:** Mantém a UI testável independentemente e o backend auditável.

**Exceção permitida:** O fallback de simulação em `src/services/orchestrator.js` é intencional — garante demo offline.

---

## GP-07 — Self-correction é regida pelo YAML

O loop Guardião → Empatia é configurado em `state_graph.self_correction` no harness.
`api/orchestrate.js` lê `max_attempts` do YAML em runtime — nunca hardcode no JS.

---

## GP-08 — Legibilidade do agente primeiro

Todo contexto relevante para o agente deve estar no repositório em formato versionável.
Decisões de design discutidas fora do repo (Slack, verbal) devem ser registradas em `docs/`.

Inspiração: [Harness Engineering — OpenAI](https://openai.com/pt-BR/index/harness-engineering/)

---

## GP-09 — A persona AGENT é para Engineers, não operadores de script

A visão AGENT não é uma lista de scripts para leitura robótica.
É um cockpit para o **Collections Engineer** — quem projeta, monitora e ajusta as jornadas.

A UI deve refletir isso: métricas de observabilidade, Harness Studio, exportação de traces.

Referência: [Collections Engineer — Monest](https://monest.com.br/collections)

---

## GP-12 — Não confie em aritmética do LLM

O Motor recebe um JSON estruturado do LLM, mas **recomputa** o valor da proposta usando
`calculateAmortization()` antes de retornar. Além disso, `discount_rate` é **clampado**
ao máximo da alçada vigente:

```js
const safeDiscount = Math.max(0, Math.min(rawDiscount, policy.max_discount))
```

Se o LLM tentar exceder a alçada (intencionalmente via injeção ou por engano), o sistema
loga `security:discount_clamped` na trace e aplica o teto. Mesma lógica para `installments`
(clamp em `[1, 12]`).

**Por quê:** mesmo com `temperature: 0`, sob ataques de prompt injection o LLM pode propor
descontos absurdos. A camada matemática garante invariantes financeiros.

---

## GP-11 — Security gate é Layer 0, não opcional

O `runSecurityGate()` em `api/lib/security.js` executa **antes de qualquer chamada LLM**.
Três detectores em ordem: token flooding → prompt injection → jailbreak.

Severidade HIGH → requisição bloqueada imediatamente, SSE `security_block` emitido.
Severidade MEDIUM → pipeline continua, ameaças anotadas no state, Guardião recebe o contexto.

O Guardião executa `scanDraftForLeakage()` no draft do Empatia para detectar se injeção
parcialmente bem-sucedida vazou para o output (Layer 0 do Guardião, antes do regex CDC).

**A ordem importa:**
```
orchestrate.js:  runSecurityGate(message)         → HIGH → block
guardiao.js:     scanDraftForLeakage(draft)        → HIGH → REJEITADO
guardiao.js:     checkGuardrailViolations(draft)   → ALTO → REJEITADO
guardiao.js:     LLM-as-judge (com threat context) → varia
```

**Não remova nem reordene essas camadas.** O Empatia pode ser parcialmente manipulado
por inputs maliciosos que passaram pelo NLU — o scan de leakage é a última barreira antes
do output chegar ao usuário.

---

## GP-10 — Evals são artefatos de primeira classe

`evals.scenarios` no harness YAML define os critérios de aceite automatizáveis.
Quando um cenário falhar, o fix vai para o prompt do agente — não para o cenário.

Ver: [docs/eval_harness.md](eval_harness.md)
