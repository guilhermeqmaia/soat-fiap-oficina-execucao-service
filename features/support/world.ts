import { randomUUID } from 'crypto';
import { IWorldOptions, setWorldConstructor, World } from '@cucumber/cucumber';
import request, { Response } from 'supertest';
import { ambiente } from './ambiente';
import { aguardarAte } from './polling';
import { tokens } from './tokens';

/** Linha do plano do mecanico: um servico e, opcionalmente, uma peca usada nele. */
export interface ItemDoPlano {
  servico: string;
  produto?: string;
  quantidade?: number;
}

export interface CallbackRecebido {
  id: string;
  type: string;
  producer: string;
  data: Record<string, unknown>;
}

export interface Movimentacao {
  tipo: string;
  quantidade: number;
}

/** Ordem do caminho feliz, usada para levar a execucao ate um status (`Dado`). */
const CAMINHO = [
  'NA_FILA',
  'ATRIBUIDA',
  'EM_DIAGNOSTICO',
  'AGUARDANDO_APROVACAO',
  'EM_EXECUCAO',
  'EXECUTADA',
] as const;

/**
 * Estado de um cenario + operacoes de dominio da Execucao, sempre pela API HTTP.
 * Os steps ficam finos: so traduzem o texto do Gherkin para estas operacoes.
 */
export class MundoExecucao extends World {
  readonly numeroOS = `OS-BDD-${randomUUID().slice(0, 8)}`;
  readonly veiculoId = `veiculo-${randomUUID().slice(0, 8)}`;
  readonly servicos = new Map<string, string>();
  readonly produtos = new Map<string, string>();
  plano: ItemDoPlano[] = [];
  mecanicoId = 'mec-1';
  resposta?: Response;

  constructor(opcoes: IWorldOptions) {
    super(opcoes);
  }

  private http() {
    if (!ambiente.app) throw new Error('Aplicacao nao iniciada (BeforeAll)');
    return request(ambiente.app.getHttpServer());
  }

  /** Guarda a resposta (para os `Entao`) e, se pedido, exige o status esperado. */
  private registrar(res: Response, acao: string, esperado?: number): Response {
    this.resposta = res;
    if (esperado !== undefined && res.status !== esperado) {
      throw new Error(
        `${acao}: esperado HTTP ${esperado}, recebido ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res;
  }

  // ─── Catalogo e estoque ─────────────────────────────────────────────────────

  async cadastrarServico(nome: string, precoBase: number) {
    const res = await this.http()
      .post('/catalogo/servicos')
      .set('Authorization', tokens.admin())
      .send({ nome, precoBase });
    this.registrar(res, `cadastrar servico ${nome}`, 201);
    this.servicos.set(nome, res.body.servicoId);
  }

  async cadastrarProduto(nome: string, preco: number, quantidadeEstoque: number) {
    const res = await this.http()
      .post('/catalogo/produtos')
      .set('Authorization', tokens.estoquista())
      .send({ nome, sku: `BDD-${randomUUID()}`, preco, quantidadeEstoque });
    this.registrar(res, `cadastrar produto ${nome}`, 201);
    this.produtos.set(nome, res.body.produtoId);
  }

  idDoServico(nome: string): string {
    const id = this.servicos.get(nome);
    if (!id) throw new Error(`Servico "${nome}" nao foi cadastrado no cenario`);
    return id;
  }

  idDoProduto(nome: string): string {
    const id = this.produtos.get(nome);
    if (!id) throw new Error(`Produto "${nome}" nao foi cadastrado no cenario`);
    return id;
  }

  async saldo(produto: string): Promise<number> {
    const res = await this.http()
      .get(`/catalogo/produtos/${this.idDoProduto(produto)}`)
      .set('Authorization', tokens.admin())
      .expect(200);
    return res.body.quantidadeEstoque;
  }

  // ─── Acoes sobre a execucao (OS Service e mecanico) ─────────────────────────

  async enfileirar(esperado?: number) {
    const res = await this.http()
      .post('/execucao/ordens')
      .set('Authorization', tokens.osService())
      .send({ numeroOS: this.numeroOS, veiculoId: this.veiculoId, descricaoProblema: 'Barulho' });
    return this.registrar(res, 'enfileirar', esperado);
  }

  async atribuir(mecanicoId: string, esperado?: number) {
    this.mecanicoId = mecanicoId;
    const res = await this.http()
      .post(`/execucao/ordens/${this.numeroOS}/atribuir-mecanico`)
      .set('Authorization', tokens.mecanico(mecanicoId))
      .send({ mecanicoId });
    return this.registrar(res, 'atribuir mecanico', esperado);
  }

  /** Vincula os servicos do plano (na ordem) e depois as pecas de cada servico. */
  async vincularPlano() {
    const servicos = [...new Set(this.plano.map((i) => i.servico))];
    await this.registrar(
      await this.http()
        .post(`/execucao/ordens/${this.numeroOS}/servicos`)
        .set('Authorization', tokens.mecanico(this.mecanicoId))
        .send({ servicoIds: servicos.map((s) => this.idDoServico(s)) }),
      'vincular servicos',
      201,
    );
    for (const servico of servicos) {
      const produtos = this.plano
        .filter((i) => i.servico === servico && i.produto)
        .map((i) => ({ produtoId: this.idDoProduto(i.produto!), quantidade: i.quantidade }));
      if (produtos.length === 0) continue;
      await this.registrar(
        await this.http()
          .post(`/execucao/ordens/${this.numeroOS}/servicos/${this.idDoServico(servico)}/produtos`)
          .set('Authorization', tokens.mecanico(this.mecanicoId))
          .send({ produtos }),
        `vincular pecas em ${servico}`,
        201,
      );
    }
  }

  async concluirDiagnostico(diagnostico: string, esperado?: number) {
    const res = await this.http()
      .post(`/execucao/ordens/${this.numeroOS}/diagnostico`)
      .set('Authorization', tokens.mecanico(this.mecanicoId))
      .send({ diagnostico });
    return this.registrar(res, 'concluir diagnostico', esperado);
  }

  async iniciar(esperado?: number) {
    const res = await this.http()
      .post(`/execucao/ordens/${this.numeroOS}/iniciar`)
      .set('Authorization', tokens.osService());
    return this.registrar(res, 'iniciar', esperado);
  }

  async finalizar(esperado?: number) {
    const res = await this.http()
      .post(`/execucao/ordens/${this.numeroOS}/finalizar`)
      .set('Authorization', tokens.mecanico(this.mecanicoId));
    return this.registrar(res, 'finalizar', esperado);
  }

  async liberarReservas(motivo?: string, esperado?: number, numeroOS = this.numeroOS) {
    const res = await this.http()
      .delete(`/execucao/ordens/${numeroOS}`)
      .set('Authorization', tokens.osService())
      .send(motivo ? { motivo } : {});
    return this.registrar(res, 'liberar reservas', esperado);
  }

  /** Leva a execucao pelo caminho feliz ate `status` (CANCELADA = aguardando aprovacao + DELETE). */
  async levarAteStatus(status: string) {
    if (status === 'CANCELADA') {
      await this.levarAteStatus('AGUARDANDO_APROVACAO');
      await this.liberarReservas('Orcamento reprovado', 200);
      return;
    }
    const alvo = CAMINHO.indexOf(status as (typeof CAMINHO)[number]);
    if (alvo < 0) throw new Error(`Status desconhecido: ${status}`);
    const passos = [
      () => this.enfileirar(201),
      () => this.atribuir(this.mecanicoId, 200),
      () => this.vincularPlano(),
      () => this.concluirDiagnostico('Diagnostico padrao do cenario', 200),
      () => this.iniciar(200),
      () => this.finalizar(200),
    ];
    for (const passo of passos.slice(0, alvo + 1)) await passo();
    await this.aguardarStatus(status);
  }

  // ─── Consultas ──────────────────────────────────────────────────────────────

  async consultarExecucao() {
    return this.http()
      .get(`/execucao/ordens/${this.numeroOS}`)
      .set('Authorization', tokens.admin());
  }

  async aguardarStatus(status: string) {
    await aguardarAte(
      `a execucao ${this.numeroOS} ficar ${status}`,
      async () => (await this.consultarExecucao()).body?.status,
      (atual) => atual === status,
    );
  }

  async movimentacoes(): Promise<Movimentacao[]> {
    const res = await this.http()
      .get(`/execucao/ordens/${this.numeroOS}/movimentacoes`)
      .set('Authorization', tokens.admin())
      .expect(200);
    return res.body.map((m: Movimentacao) => ({ tipo: m.tipo, quantidade: m.quantidade }));
  }

  /** Callbacks que o OS Service fake recebeu para a OS do cenario (em ordem de chegada). */
  callbacks(): CallbackRecebido[] {
    return ambiente.osService.recebidas
      .filter((r) => r.method === 'POST' && r.url === `/ordens-servico/${this.numeroOS}/eventos`)
      .map((r) => r.body as CallbackRecebido);
  }

  requisicoesDeCallback() {
    return ambiente.osService.recebidas.filter(
      (r) => r.url === `/ordens-servico/${this.numeroOS}/eventos`,
    );
  }
}

setWorldConstructor(MundoExecucao);
