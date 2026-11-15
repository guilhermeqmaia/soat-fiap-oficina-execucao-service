# QA Plan: FLUXO 1 (Execução Service ponta a ponta)

Cobre a US-F4-07 (fila de execução, diagnóstico, catálogo e estoque em DynamoDB) e a parte deste
repositório das US-F4-13 (cobertura + SonarCloud), US-F4-14 (BDD), US-F4-15 (contrato HTTP) e
US-F4-18 (comunicação HTTP com o OS Service). Contrato: [`http-interno.md`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/http-interno.md) no hub.

## Resumo

Valida que a Execução recebe a OS do orquestrador, deixa o mecânico registrar o diagnóstico com
baixa transacional no estoque, avisa o OS Service por callback e executa o serviço aprovado; que a
devolução das peças (cancelamento, orçamento reprovado, recusa do OS) é idempotente mesmo com
chamadas repetidas ou simultâneas; e que falhas do OS Service não deixam o estoque inconsistente.

## Pré-requisitos

| Item                 | Como obter                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 20 e Docker     | Integração e BDD sobem o `amazon/dynamodb-local` por testcontainers                                                                                                               |
| Dependências         | `npm ci`                                                                                                                                                                          |
| Manual (cenários M*) | `docker compose up -d dynamodb`, `npm run dynamodb:create-tables` e `npm run start:dev`; tokens com `mintToken`/`mintServiceToken` do kit (`@guilhermeqmaia/oficina-kit/testing`) |
| Ambiente real (EKS)  | Os 3 serviços no cluster; `OS_SERVICE_URL=http://oficina-app:3000`                                                                                                                |

## Testes automatizados

| Comando                    | O que valida                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `npm run test:unit:cov`    | Domínio, casos de uso e `OsServiceClient`, com gate de 80%                              |
| `npm run test:integration` | `AppModule` real + DynamoDB Local + OS Service fake (callbacks verificados)             |
| `npm run test:bdd`         | 21 cenários Gherkin em `features/`; relatório em `reports/cucumber.html`                |
| `npm run openapi:export`   | Gera o `openapi.yaml` publicado no hub (`docs/contratos/openapi/execucao-service.yaml`) |

## Cenários

| ID    | Critério                                   | Passos                                                                                                     | Resultado esperado                                                                                                                                                  | Onde                              |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| TS-01 | Enfileirar (`execucao.enfileirar`)         | `POST /execucao/ordens` com token `SERVICO` `{ numeroOS, veiculoId, descricaoProblema }`; repetir          | `201 { numeroOS, posicaoFila }`; repetição devolve a mesma execução; veículo com outra OS em andamento → `409 { motivo }`                                           | BDD `execucao.feature`, e2e       |
| TS-02 | Diagnóstico com baixa transacional         | Mecânico: `atribuir-mecanico` → `servicos` → `servicos/{id}/produtos` → `diagnostico { diagnostico }`      | `200`, `AGUARDANDO_APROVACAO`; saldo baixado; movimentações `BAIXA` por (produto, serviço); callback `execucao.diagnostico-concluido` com itens e preços congelados | BDD `execucao.feature`, unit, e2e |
| TS-03 | Estoque insuficiente                       | Vincular mais peças do que o saldo e concluir o diagnóstico                                                | `409 { motivo }`; nada baixado; nenhum callback; continua `EM_DIAGNOSTICO`                                                                                          | BDD `diagnostico.feature`         |
| TS-04 | OS Service fora do ar (resultado ambíguo)  | OS fake responde 500/503/504 ao callback; depois volta; repetir o `POST .../diagnostico`                   | `502` e baixa mantida; a repetição reenvia o **mesmo** envelope (mesmo `id`) e conclui sem baixar de novo                                                           | BDD `diagnostico.feature`, unit   |
| TS-05 | OS Service recusa o diagnóstico            | OS fake responde 400/404/422                                                                               | `409` com o motivo do OS; peças devolvidas (`DEVOLUCAO`); diagnóstico reaberto (`EM_DIAGNOSTICO`)                                                                   | BDD `diagnostico.feature`, unit   |
| TS-06 | Iniciar (`execucao.iniciar`)               | `POST /execucao/ordens/{n}/iniciar` com `SERVICO`; repetir                                                 | `200 { numeroOS, status: EM_EXECUCAO }`; idempotente; fora de `AGUARDANDO_APROVACAO` → `409 { motivo }`                                                             | BDD, e2e                          |
| TS-07 | Finalizar                                  | Mecânico: `POST /execucao/ordens/{n}/finalizar`                                                            | `EXECUTADA`; callback `execucao.finalizada { numeroOS, finalizadaEm }`; OS fora → status volta para `EM_EXECUCAO` e `502`                                           | BDD `execucao.feature`, unit      |
| TS-08 | Cancelamento (`execucao.liberar-reservas`) | `DELETE /execucao/ordens/{n}` com `SERVICO` em cada status (NA_FILA … EM_EXECUCAO); repetir                | `200 { numeroOS, status, devolucoes[] }`; devolve só o que foi baixado; repetir não devolve de novo; `EXECUTADA` → `409`; OS desconhecida → `200` sem devoluções    | BDD `cancelamento.feature`, e2e   |
| TS-09 | Concorrência                               | 3 `DELETE` simultâneos; 2 `POST /execucao/ordens` simultâneos para a mesma OS                              | Peças devolvidas uma única vez; uma execução criada; conflito de versão residual → `503` + `Retry-After` (nunca `409 { motivo }`)                                   | e2e, unit                         |
| TS-10 | Produto removido depois da baixa           | Remover um produto do catálogo e cancelar a OS                                                             | Devolve os demais produtos; o removido é pulado com log; `200`                                                                                                      | unit                              |
| TS-11 | Rotas e roles                              | Chamar `enfileirar`/`iniciar`/`DELETE` com ADMIN; mecânico operando OS de outro                            | `403` nos dois casos                                                                                                                                                | e2e, unit                         |
| TS-12 | Catálogo e entrada de estoque              | `POST /catalogo/produtos`, `POST /catalogo/produtos/{id}/entradas`, `GET .../movimentacoes`; SKU duplicado | Saldo e extrato auditados (`ENTRADA`); SKU duplicado → `409`                                                                                                        | e2e                               |
| TS-13 | Cobertura e quality gate (US-F4-13)        | CI do PR e da `main`                                                                                       | Jobs `Lint, typecheck, testes (gate 80%) e build`, `BDD (Gherkin + Cucumber)` e `SonarCloud (quality gate)` verdes; cobertura ≥ 80% no Sonar                        | CI                                |
| TS-14 | Contrato publicado (US-F4-15)              | `npm run openapi:export` e comparar com o arquivo do hub                                                   | Sem diferença; `npx -y @redocly/cli lint openapi.yaml` válido                                                                                                       | local                             |
| M-01  | Ponta a ponta no cluster [AMBIENTE REAL]   | Abrir uma OS pelo gateway e seguir até `ENTREGUE` (roteiro do vídeo no hub)                                | Saga passa por `ENFILEIRAR_EXECUCAO` … `INICIAR_EXECUCAO` … `AGUARDAR_FINALIZACAO`; estoque coerente em `GET /execucao/ordens/{n}/movimentacoes`                    | EKS                               |

## Casos de borda

- Diagnóstico com menos de 5 ou mais de 1000 caracteres → `400` antes de tocar o estoque.
- Diagnóstico sem serviço vinculado → `400`.
- `409` do OS no callback (conflito de versão) → repete o mesmo envelope até 3 vezes; persistindo, `502`.
- Queda do processo entre gravar a execução e baixar → a repetição do `POST` conclui de forma idempotente.

## Rastreabilidade

| Critério (US-F4-07 / fluxo)                              | Cenários                   |
| -------------------------------------------------------- | -------------------------- |
| Modelo DynamoDB por agregado (4 tabelas `oficina-`)      | TS-02, TS-08, TS-12        |
| `POST /execucao/ordens` idempotente / recusa por veículo | TS-01                      |
| Diagnóstico em três passos + baixa transacional          | TS-02, TS-03               |
| Callback `execucao.diagnostico-concluido`                | TS-02, TS-04, TS-05        |
| `iniciar` só muda status; `DELETE` devolve o baixado     | TS-06, TS-08, TS-09, TS-10 |
| `finalizar` + callback `execucao.finalizada`             | TS-07                      |
| Catálogo e estoque com roles                             | TS-11, TS-12               |
| Callbacks via kit (`SERVICO`, retry, correlação)         | TS-02, TS-04, TS-07        |
| Testes ≥ 80% + Sonar + BDD                               | TS-13                      |
| Contrato OpenAPI publicado                               | TS-14                      |

## Checklist de validação

- [x] TS-01 a TS-12 automatizados (unit, integração, BDD) e verdes no CI
- [x] TS-13: cobertura de 95,4% no SonarCloud (`main`), quality gate OK
- [x] TS-14: `openapi.yaml` gerado e publicado no hub
- [ ] M-01: executar na sessão de demonstração no EKS
