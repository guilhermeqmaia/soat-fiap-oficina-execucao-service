# **REPO**

[![CI](https://github.com/guilhermeqmaia/soat-fiap-oficina-execucao-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guilhermeqmaia/soat-fiap-oficina-execucao-service/actions/workflows/ci.yml) [![CD AWS](https://github.com/guilhermeqmaia/soat-fiap-oficina-execucao-service/actions/workflows/cd-aws.yml/badge.svg)](https://github.com/guilhermeqmaia/soat-fiap-oficina-execucao-service/actions/workflows/cd-aws.yml)

****DESCRICAO**** — microsserviço do Sistema da Oficina Mecânica (Tech Challenge FIAP, Fase 4). Gerado pelo template do [`@guilhermeqmaia/oficina-kit`](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit).

> Planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas: [hub](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/plano-execucao-fase-4.md).

## Responsabilidades

**Possui:** fila de execução das OS, diagnóstico (itens com preço congelado), **Catálogo** de serviços/produtos e **Estoque** (reservas e baixas com *conditional writes*). Banco próprio **DynamoDB** single-table `oficina-execucao` ([RFC-0007](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/arquitetura/rfcs/RFC-0007-banco-nosql.md)).

**Não possui:** a OS e seu ciclo de vida (OS Service), orçamento/pagamento (Billing).

## Eventos e comandos

| Direção | Mensagem |
|---|---|
| consome (fila `execucao-comandos`) | `execucao.enfileirar`, `execucao.iniciar`, `execucao.liberar-reservas` |
| publica (tópico `oficina-execucao`) | `execucao.enfileirada`, `execucao.recusada`, `execucao.diagnostico-concluido`, `execucao.iniciada`, `execucao.finalizada`, `execucao.reservas-liberadas` |

Contratos: [`docs/contratos/asyncapi.yaml`](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/contratos/asyncapi.yaml).

## Histórias

- [US-F4-04 — Repositórios dos serviços com CI/CD independente](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-04-repos-e-cicd-por-servico.md) *(este scaffold)*
- [US-F4-07 — Fila de execução, diagnóstico, catálogo e estoque em DynamoDB](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-07-execucao-service.md)
- [US-F4-11 — Compensações (liberar reservas)](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-11-compensacoes-rollback.md)

> **Estado do scaffold:** gerado pelo template padrão (Postgres/Prisma para outbox e dedup). A **US-F4-07** troca a persistência para DynamoDB (`@aws-sdk/lib-dynamodb`, outbox via Streams) e remove o Prisma — o restante (auth, logs, métricas, health, CI/CD) permanece.

## Execução local

```bash
cp .env.example .env
npm ci && npx prisma generate
npm run docker:up                 # Postgres próprio + LocalStack com a topologia da RFC-0006
npx prisma migrate deploy
npm run start:dev                 # http://localhost:3002/api (Swagger)
```

Token para testar: a Lambda de auth (`POST {gateway}/auth`) ou, localmente, `mintToken` do kit (`@guilhermeqmaia/oficina-kit/testing`) com o mesmo `JWT_SECRET`.

## Testes e qualidade

```bash
npm run test:unit:cov        # gate 80% (jest.unit.config.js)
npm run test:integration     # e2e com Postgres via testcontainers
```

<!-- Evidências de cobertura: badge do SonarCloud + print em docs/evidencias/ -->

## Deploy

CD automático (`cd-aws.yml`): `homolog` → homologação, `main` → produção. Build → ECR → EKS (`k8s-aws/`) → migrations → smoke.

| Secret/var do repo                      | Uso                                                        |
| --------------------------------------- | ---------------------------------------------------------- |
| `AWS_ROLE_ARN` (secret)                 | OIDC da role `github-actions-oficina`                      |
| `EKS_CLUSTER_NAME`, `AWS_REGION` (vars) | cluster alvo                                               |
| `DB_SECRET_ID` (var)                    | segredo do banco **próprio** no Secrets Manager (infra-db) |
| `JWT_SECRET_ID` (var)                   | segredo HS256 compartilhado com a Lambda                   |
| `SNS_TOPIC_ARN`, `SQS_QUEUE_URL` (vars) | saídas do stage `messaging/` (infra-k8s)                   |

O Service expõe o **NodePort `30082`**, alvo do target group deste serviço no NLB interno único (ADR-0013).

## Arquitetura do serviço

```mermaid
flowchart LR
  GW[API Gateway] -->|/execucao*| S[oficina-execucao-service]
  S --> DB[(Postgres oficina_execucao)]
  S -->|outbox → SNS| T[(oficina-execucao.fifo)]
  Q[(execucao-comandos.fifo)] -->|SQS| S
```
