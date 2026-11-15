import { ConflitoDeNegocioError, DadoInvalidoError } from '../../shared/domain/erros-de-dominio';
import { exigirQuantidade, exigirTexto } from '../../shared/domain/validacoes';
import { StatusExecucao, emDiagnostico, podeTransitar } from './status-execucao';
import { TransicaoDeStatusInvalidaError } from './errors/transicao-invalida.error';

/** Peca usada por um servico da OS — preco congelado no momento do vinculo. */
export interface ProdutoDaExecucao {
  produtoId: string;
  nome: string;
  sku: string;
  precoUnitario: number;
  quantidade: number;
}

/** Servico vinculado a OS — snapshot do catalogo (nome/preco congelados). */
export interface ServicoDaExecucao {
  servicoId: string;
  nome: string;
  preco: number;
  produtos: ProdutoDaExecucao[];
}

export interface ExecucaoProps {
  osId: string;
  veiculoId: string;
  descricaoProblema: string | null;
  mecanicoId: string | null;
  status: StatusExecucao;
  diagnostico: string | null;
  servicos: ServicoDaExecucao[];
  estoqueBaixado: boolean;
  /**
   * Identifica a baixa de estoque do diagnostico atual (entra no id das
   * movimentacoes). Mantido apos o cancelamento para auditoria.
   */
  baixaId: string | null;
  /**
   * Envelope do callback `execucao.diagnostico-concluido` ainda nao confirmado
   * pelo OS Service (timeout/5xx). Reenviado com o MESMO id, que o OS deduplica.
   */
  callbackPendente: CallbackPendente | null;
  finalizadaEm: string | null;
  createdAt: string;
  updatedAt: string;
  versao: number;
}

/** Item do orcamento no formato do callback `execucao.diagnostico-concluido` (contrato do OS). */
export interface ItemDiagnostico {
  tipo: 'SERVICO' | 'PRODUTO';
  referenciaId: string;
  nome: string;
  quantidade: number;
  precoUnitario: string;
  servicoId?: string;
}

/** Envelope serializado de um callback ao OS Service (formato do kit `/http`). */
export interface CallbackPendente {
  id: string;
  type: string;
  [campo: string]: unknown;
}

/** Limites do texto do diagnostico — os mesmos do OS Service (`registrarDiagnostico`). */
export const DIAGNOSTICO_MIN = 5;
export const DIAGNOSTICO_MAX = 1000;

export interface ItemDeEstoqueDaExecucao {
  produtoId: string;
  servicoId: string;
  quantidade: number;
}

/**
 * O OS Service pode compensar ate o passo INICIAR_EXECUCAO: se o `iniciar` ja
 * foi aplicado aqui e a resposta se perdeu, o cancelamento chega com a execucao
 * EM_EXECUCAO e precisa ser aceito (contrato: o DELETE nao falha).
 */
const STATUS_CANCELAVEIS = [
  StatusExecucao.NA_FILA,
  StatusExecucao.ATRIBUIDA,
  StatusExecucao.EM_DIAGNOSTICO,
  StatusExecucao.AGUARDANDO_APROVACAO,
  StatusExecucao.EM_EXECUCAO,
];

/**
 * Agregado Execucao (1 por OS): fila, mecanico responsavel, servicos+pecas do
 * diagnostico e o ciclo de vida da execucao. Toda mudanca de status passa por
 * `transitarPara`, que aplica a maquina de estados.
 */
export class Execucao {
  private constructor(private props: ExecucaoProps) {}

  /** `execucao.enfileirar` do OS Service: a OS entra na fila, ainda sem mecanico. */
  static enfileirar(
    input: { osId: string; veiculoId: string; descricaoProblema?: string },
    agora: Date = new Date(),
  ): Execucao {
    const iso = agora.toISOString();
    return new Execucao({
      osId: exigirTexto(input.osId, 'numeroOS'),
      veiculoId: exigirTexto(input.veiculoId, 'veiculoId'),
      descricaoProblema: input.descricaoProblema?.trim() || null,
      mecanicoId: null,
      status: StatusExecucao.NA_FILA,
      diagnostico: null,
      servicos: [],
      estoqueBaixado: false,
      baixaId: null,
      callbackPendente: null,
      finalizadaEm: null,
      createdAt: iso,
      updatedAt: iso,
      versao: 0,
    });
  }

  static reconstituir(props: ExecucaoProps): Execucao {
    // Itens gravados antes de baixaId/callbackPendente existirem.
    return new Execucao(
      structuredClone({
        ...props,
        baixaId: props.baixaId ?? null,
        callbackPendente: props.callbackPendente ?? null,
      }),
    );
  }

  /** Atribui (NA_FILA -> ATRIBUIDA) ou troca o mecanico enquanto o diagnostico esta aberto. */
  atribuirMecanico(mecanicoId: string, agora: Date = new Date()): void {
    const id = exigirTexto(mecanicoId, 'mecanicoId');
    if (this.props.status === StatusExecucao.NA_FILA) {
      this.transitarPara(StatusExecucao.ATRIBUIDA, agora);
    } else if (!emDiagnostico(this.props.status)) {
      throw new ConflitoDeNegocioError(
        `Nao e possivel atribuir mecanico com a execucao em ${this.props.status}`,
      );
    }
    this.props.mecanicoId = id;
    this.tocar(agora);
  }

  /** Vincula servico do catalogo; o primeiro vinculo inicia o diagnostico (ATRIBUIDA -> EM_DIAGNOSTICO). */
  adicionarServico(
    servico: Omit<ServicoDaExecucao, 'produtos'>,
    agora: Date = new Date(),
  ): boolean {
    this.exigirDiagnosticoAberto();
    if (this.props.servicos.some((s) => s.servicoId === servico.servicoId)) return false;
    if (this.props.status === StatusExecucao.ATRIBUIDA) {
      this.transitarPara(StatusExecucao.EM_DIAGNOSTICO, agora);
    }
    this.props.servicos.push({ ...servico, produtos: [] });
    this.tocar(agora);
    return true;
  }

  removerServico(servicoId: string, agora: Date = new Date()): void {
    this.exigirDiagnosticoAberto();
    this.servico(servicoId);
    this.props.servicos = this.props.servicos.filter((s) => s.servicoId !== servicoId);
    this.tocar(agora);
  }

  /** Vincula peca a um servico da OS; o mesmo produto pode atender varios servicos. */
  vincularProduto(servicoId: string, produto: ProdutoDaExecucao, agora: Date = new Date()): void {
    this.exigirDiagnosticoAberto();
    exigirQuantidade(produto.quantidade, 'quantidade');
    const servico = this.servico(servicoId);
    const existente = servico.produtos.find((p) => p.produtoId === produto.produtoId);
    if (existente) existente.quantidade += produto.quantidade;
    else servico.produtos.push({ ...produto });
    this.tocar(agora);
  }

  /**
   * Conclui o diagnostico (-> AGUARDANDO_APROVACAO) e abre uma baixa nova
   * (`baixaId` unico por versao). Devolve as pecas a baixar.
   */
  concluirDiagnostico(diagnostico: string, agora: Date = new Date()): ItemDeEstoqueDaExecucao[] {
    if (!this.props.servicos.length) {
      throw new DadoInvalidoError('Diagnostico sem servicos: vincule ao menos um servico a OS');
    }
    const texto = exigirTexto(diagnostico, 'diagnostico');
    if (texto.length < DIAGNOSTICO_MIN || texto.length > DIAGNOSTICO_MAX) {
      throw new DadoInvalidoError(
        `diagnostico deve ter entre ${DIAGNOSTICO_MIN} e ${DIAGNOSTICO_MAX} caracteres`,
      );
    }
    this.transitarPara(StatusExecucao.AGUARDANDO_APROVACAO, agora);
    this.props.diagnostico = texto;
    this.props.estoqueBaixado = true;
    this.props.baixaId = `${this.props.osId}@v${this.props.versao}`;
    this.props.callbackPendente = null;
    return this.itensDeEstoque();
  }

  /** Guarda o envelope do callback do diagnostico ate o OS Service confirmar. */
  registrarCallbackPendente(envelope: CallbackPendente, agora: Date = new Date()): void {
    this.props.callbackPendente = structuredClone(envelope);
    this.tocar(agora);
  }

  /** O OS Service confirmou o callback pendente. */
  confirmarCallback(agora: Date = new Date()): void {
    this.props.callbackPendente = null;
    this.tocar(agora);
  }

  /**
   * Compensacao do diagnostico quando o OS Service o recusa (4xx): volta para
   * EM_DIAGNOSTICO com os mesmos servicos/pecas, sem baixa e sem laudo, para o
   * mecanico corrigir e concluir de novo. As pecas sao devolvidas por quem chama.
   */
  reabrirDiagnostico(agora: Date = new Date()): void {
    this.transitarPara(StatusExecucao.EM_DIAGNOSTICO, agora);
    this.props.diagnostico = null;
    this.props.estoqueBaixado = false;
    this.props.baixaId = null;
    this.props.callbackPendente = null;
  }

  /** Diagnostico concluido aqui, mas o OS Service ainda nao confirmou o callback. */
  get aguardandoConfirmacaoDoOs(): boolean {
    return (
      this.props.status === StatusExecucao.AGUARDANDO_APROVACAO && !!this.props.callbackPendente
    );
  }

  /** `execucao.iniciar` (orcamento aprovado). Idempotente: false se ja estava em execucao/executada. */
  iniciarExecucao(agora: Date = new Date()): boolean {
    if (
      this.props.status === StatusExecucao.EM_EXECUCAO ||
      this.props.status === StatusExecucao.EXECUTADA
    ) {
      return false;
    }
    this.transitarPara(StatusExecucao.EM_EXECUCAO, agora);
    // O `iniciar` so chega depois de o OS aplicar o diagnostico: callback confirmado.
    this.props.callbackPendente = null;
    return true;
  }

  finalizar(agora: Date = new Date()): void {
    this.transitarPara(StatusExecucao.EXECUTADA, agora);
    this.props.finalizadaEm = agora.toISOString();
  }

  /** Lanca se a execucao nao pode mais ser cancelada (EXECUTADA). CANCELADA passa (idempotente). */
  exigirCancelavel(): void {
    if (this.props.status === StatusExecucao.CANCELADA) return;
    if (!STATUS_CANCELAVEIS.includes(this.props.status)) {
      throw new TransicaoDeStatusInvalidaError(this.props.status, StatusExecucao.CANCELADA);
    }
  }

  /**
   * `execucao.liberar-reservas` (OS cancelada/orcamento reprovado). Idempotente.
   * As pecas sao devolvidas por quem chama ANTES de gravar o cancelamento.
   */
  cancelar(agora: Date = new Date()): boolean {
    if (this.props.status === StatusExecucao.CANCELADA) return false;
    this.exigirCancelavel();
    this.transitarPara(StatusExecucao.CANCELADA, agora);
    this.props.estoqueBaixado = false;
    this.props.callbackPendente = null;
    return true;
  }

  transitarPara(novo: StatusExecucao, agora: Date = new Date()): void {
    if (!podeTransitar(this.props.status, novo)) {
      throw new TransicaoDeStatusInvalidaError(this.props.status, novo);
    }
    this.props.status = novo;
    this.tocar(agora);
  }

  itensDeEstoque(): ItemDeEstoqueDaExecucao[] {
    return this.props.servicos.flatMap((s) =>
      s.produtos.map((p) => ({
        produtoId: p.produtoId,
        servicoId: s.servicoId,
        quantidade: p.quantidade,
      })),
    );
  }

  /** Itens com precos congelados no formato do OS Service (servicos e, sob cada um, as pecas). */
  itensDoDiagnostico(): ItemDiagnostico[] {
    return this.props.servicos.flatMap((s) => [
      {
        tipo: 'SERVICO' as const,
        referenciaId: s.servicoId,
        nome: s.nome,
        quantidade: 1,
        precoUnitario: s.preco.toFixed(2),
      },
      ...s.produtos.map((p) => ({
        tipo: 'PRODUTO' as const,
        referenciaId: p.produtoId,
        nome: p.nome,
        quantidade: p.quantidade,
        precoUnitario: p.precoUnitario.toFixed(2),
        servicoId: s.servicoId,
      })),
    ]);
  }

  /** Orcamento consolidado: mao de obra + pecas. */
  get valorTotal(): number {
    const total = this.props.servicos.reduce(
      (acc, s) =>
        acc + s.preco + s.produtos.reduce((a, p) => a + p.precoUnitario * p.quantidade, 0),
      0,
    );
    return Math.round(total * 100) / 100;
  }

  get osId() {
    return this.props.osId;
  }
  get veiculoId() {
    return this.props.veiculoId;
  }
  get mecanicoId() {
    return this.props.mecanicoId;
  }
  get status() {
    return this.props.status;
  }
  get diagnostico() {
    return this.props.diagnostico;
  }
  get finalizadaEm() {
    return this.props.finalizadaEm;
  }
  get createdAt() {
    return this.props.createdAt;
  }
  get versao() {
    return this.props.versao;
  }
  get servicos(): readonly ServicoDaExecucao[] {
    return this.props.servicos;
  }
  get estoqueBaixado() {
    return this.props.estoqueBaixado;
  }
  get baixaId() {
    return this.props.baixaId;
  }
  get callbackPendente(): CallbackPendente | null {
    return this.props.callbackPendente ? structuredClone(this.props.callbackPendente) : null;
  }

  /** Chamado pelo repositorio apos gravar (lock otimista). */
  marcarPersistida(): void {
    this.props.versao += 1;
  }

  toJSON(): ExecucaoProps {
    return structuredClone(this.props);
  }

  private servico(servicoId: string): ServicoDaExecucao {
    const servico = this.props.servicos.find((s) => s.servicoId === servicoId);
    if (!servico) {
      throw new DadoInvalidoError(
        `Servico ${servicoId} nao esta vinculado a OS ${this.props.osId}`,
      );
    }
    return servico;
  }

  private exigirDiagnosticoAberto(): void {
    if (!emDiagnostico(this.props.status)) {
      throw new ConflitoDeNegocioError(
        `Servicos e pecas so podem ser alterados durante o diagnostico (status atual: ${this.props.status})`,
      );
    }
  }

  private tocar(agora: Date): void {
    this.props.updatedAt = agora.toISOString();
  }
}
