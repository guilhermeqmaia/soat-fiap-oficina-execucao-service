import { Inject, Injectable, Logger } from '@nestjs/common';
import { ItemDeBaixa, planejarBaixa, planejarDevolucao, validarSaldo } from '../../domain/estoque';
import { MovimentacaoEstoque } from '../../domain/movimentacao-estoque';
import { MovimentacaoJaRegistradaError } from '../../domain/errors/movimentacao-ja-registrada.error';
import {
  ESTOQUE_REPOSITORY,
  EstoqueRepository,
  PRODUTO_REPOSITORY,
  ProdutoRepository,
} from '../../domain/produto.repository';

/**
 * Porta de estoque usada pela Execucao: baixa das pecas no fechamento do
 * diagnostico e devolucao (rollback) quando a OS e cancelada / o orcamento e
 * reprovado / o OS Service recusa o diagnostico.
 *
 * As duas operacoes sao idempotentes: as movimentacoes tem id deterministico por
 * (baixaId, produto, servico) e a transacao recusa id repetido. A devolucao parte
 * das BAIXAS lidas por id com leitura consistente — nunca do indice por OS, que
 * e eventualmente consistente e podia nao mostrar uma baixa recem-gravada.
 */
@Injectable()
export class EstoqueService {
  private readonly logger = new Logger(EstoqueService.name);

  constructor(
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
    @Inject(ESTOQUE_REPOSITORY) private readonly estoque: EstoqueRepository,
  ) {}

  /** Baixa as pecas do diagnostico `baixaId`. Repetir devolve as baixas ja gravadas. */
  async baixarParaOs(
    osId: string,
    baixaId: string,
    itens: ItemDeBaixa[],
  ): Promise<MovimentacaoEstoque[]> {
    if (!itens.length) return [];
    const movimentacoes = planejarBaixa(osId, baixaId, itens);
    const jaGravadas = await this.estoque.buscarMovimentacoes(
      movimentacoes.map((m) => m.movimentacaoId),
    );
    // A transacao e tudo ou nada: achar qualquer baixa deste diagnostico = ja aplicada.
    if (jaGravadas.length) return jaGravadas;
    const produtos = await this.produtos.buscarPorIds([...new Set(itens.map((i) => i.produtoId))]);
    validarSaldo(itens, produtos);
    try {
      await this.estoque.aplicar(movimentacoes);
    } catch (e) {
      if (!(e instanceof MovimentacaoJaRegistradaError)) throw e;
    }
    return movimentacoes;
  }

  /**
   * Devolve ao estoque o que a baixa `baixaId` tirou. Devolve `[]` se nada foi
   * baixado ou se a devolucao ja foi feita. Produto removido do catalogo depois
   * da baixa e pulado (com log) para nao travar a devolucao das outras pecas.
   */
  async devolverDaOs(
    osId: string,
    baixaId: string,
    itens: ItemDeBaixa[],
  ): Promise<MovimentacaoEstoque[]> {
    if (!itens.length) return [];
    const baixas = await this.estoque.buscarMovimentacoes(
      planejarBaixa(osId, baixaId, itens).map((m) => m.movimentacaoId),
    );
    if (!baixas.length) return [];
    const planejadas = planejarDevolucao(osId, baixaId, baixas);
    const jaDevolvidas = await this.estoque.buscarMovimentacoes(
      planejadas.map((d) => d.movimentacaoId),
    );
    if (jaDevolvidas.length) return [];

    const existentes = await this.produtos.buscarPorIds([
      ...new Set(planejadas.map((d) => d.produtoId)),
    ]);
    const devolucoes = planejadas.filter((d) => existentes.has(d.produtoId));
    const ausentes = planejadas.filter((d) => !existentes.has(d.produtoId));
    if (ausentes.length) {
      this.logger.warn({
        msg: 'devolucao ignorada: produto removido do catalogo depois da baixa',
        osId,
        baixaId,
        produtos: ausentes.map((d) => ({ produtoId: d.produtoId, quantidade: d.quantidade })),
      });
    }
    if (!devolucoes.length) return [];
    try {
      await this.estoque.aplicar(devolucoes);
    } catch (e) {
      if (e instanceof MovimentacaoJaRegistradaError) return [];
      throw e;
    }
    return devolucoes;
  }
}
