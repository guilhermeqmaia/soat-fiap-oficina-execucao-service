import { strict as assert } from 'assert';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { aguardarAte } from '../support/polling';
import { ItemDoPlano, Movimentacao, MundoExecucao } from '../support/world';

const planoDaTabela = (tabela: DataTable): ItemDoPlano[] =>
  tabela.hashes().map((l) => ({
    servico: l.servico,
    produto: l.produto || undefined,
    quantidade: l.quantidade ? Number(l.quantidade) : undefined,
  }));

const ordenar = (movs: Movimentacao[]) =>
  [...movs].sort((a, b) => `${a.tipo}${a.quantidade}`.localeCompare(`${b.tipo}${b.quantidade}`));

// ─── Dado: catalogo, estoque e etapa da execucao ─────────────────────────────

Given('que o catálogo tem os serviços:', async function (this: MundoExecucao, t: DataTable) {
  for (const l of t.hashes()) await this.cadastrarServico(l.nome, Number(l.precoBase));
});

Given('que o estoque tem os produtos:', async function (this: MundoExecucao, t: DataTable) {
  for (const l of t.hashes())
    await this.cadastrarProduto(l.nome, Number(l.preco), Number(l.quantidade));
});

Given('que o mecânico vai usar na OS:', function (this: MundoExecucao, t: DataTable) {
  this.plano = planoDaTabela(t);
});

Given(
  'que a execução está com status {string}',
  async function (this: MundoExecucao, status: string) {
    await this.levarAteStatus(status);
  },
);

// ─── Quando: OS Service ──────────────────────────────────────────────────────

When('o OS Service enfileira a OS', async function (this: MundoExecucao) {
  await this.enfileirar();
});

When('o OS Service inicia a execução', async function (this: MundoExecucao) {
  await this.iniciar();
});

When(
  'o OS Service libera as reservas com o motivo {string}',
  async function (this: MundoExecucao, motivo: string) {
    await this.liberarReservas(motivo);
  },
);

When(
  'o OS Service libera as reservas de uma OS que nunca foi enfileirada',
  async function (this: MundoExecucao) {
    await this.liberarReservas('OS cancelada', undefined, `${this.numeroOS}-INEXISTENTE`);
  },
);

// ─── Quando: mecanico ────────────────────────────────────────────────────────

When('o mecânico {string} assume a OS', async function (this: MundoExecucao, mecanico: string) {
  await this.atribuir(mecanico);
});

When(
  /^(?:que )?o mecânico (?:vincula|vinculou) os serviços e as peças:$/,
  async function (this: MundoExecucao, t: DataTable) {
    this.plano = planoDaTabela(t);
    await this.vincularPlano();
  },
);

When(
  /^o mecânico (?:conclui|repete) o diagnóstico "([^"]*)"$/,
  async function (this: MundoExecucao, diagnostico: string) {
    await this.concluirDiagnostico(diagnostico);
  },
);

When('o mecânico finaliza a execução', async function (this: MundoExecucao) {
  await this.finalizar();
});

// ─── Entao: resposta HTTP ────────────────────────────────────────────────────

Then('a resposta tem status HTTP {int}', function (this: MundoExecucao, status: number) {
  assert.ok(this.resposta, 'nenhuma requisicao foi feita no cenario');
  assert.equal(
    this.resposta.status,
    status,
    `corpo da resposta: ${JSON.stringify(this.resposta.body)}`,
  );
});

Then('a resposta traz o motivo {string}', function (this: MundoExecucao, trecho: string) {
  const motivo = String(this.resposta?.body?.motivo ?? '');
  assert.ok(motivo.includes(trecho), `motivo "${motivo}" nao contem "${trecho}"`);
});

Then('a resposta lista {int} devolução/devoluções', function (this: MundoExecucao, qtd: number) {
  assert.equal(this.resposta?.body?.devolucoes?.length, qtd);
});

Then('o valor total do orçamento é {float}', function (this: MundoExecucao, total: number) {
  assert.equal(this.resposta?.body?.valorTotal, total);
});

// ─── Entao: estado da execucao e do estoque (lido pela API) ──────────────────

Then(
  /^a execução (?:fica|continua) com status "([^"]*)"$/,
  async function (this: MundoExecucao, status: string) {
    await this.aguardarStatus(status);
  },
);

Then(
  'o saldo de {string} é {int}',
  async function (this: MundoExecucao, produto: string, saldo: number) {
    await aguardarAte(
      `o saldo de ${produto} ser ${saldo}`,
      () => this.saldo(produto),
      (atual) => atual === saldo,
    );
  },
);

Then('a OS tem as movimentações de estoque:', async function (this: MundoExecucao, t: DataTable) {
  const esperadas = t.hashes().map((l) => ({ tipo: l.tipo, quantidade: Number(l.quantidade) }));
  assert.deepEqual(ordenar(await this.movimentacoes()), ordenar(esperadas));
});

Then('a OS não tem movimentações de estoque', async function (this: MundoExecucao) {
  assert.deepEqual(await this.movimentacoes(), []);
});
