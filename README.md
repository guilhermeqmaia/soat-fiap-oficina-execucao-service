# soat-fiap-oficina-execucao-service

**Execução Service** do Sistema da Oficina Mecânica — Fase 4 do Tech Challenge FIAP (SOAT).

Responsável pela **fila de execução** das ordens de serviço, **diagnóstico** (itens com preço congelado), **catálogo** de serviços/produtos e **estoque** (reservas e baixas com *conditional writes*). Banco próprio: **DynamoDB** (single-table `oficina-execucao`).

> Repositório 6 de 7. O planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas ficam no hub: [https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/plano-execucao-fase-4.md](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/plano-execucao-fase-4.md).

## Histórias

- [US-F4-07 — Fila de execução, diagnóstico, catálogo e estoque em DynamoDB](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-07-execucao-service.md)
- [US-F4-11 — Compensações (liberar reservas)](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-11-compensacoes-rollback.md)

## Estado

Bootstrap — implementação começa na Onda 2 (após o kit `@soat-fiap/oficina-kit` e a mensageria).
