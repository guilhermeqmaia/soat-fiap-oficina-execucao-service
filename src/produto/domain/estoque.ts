import { exigirQuantidade, exigirTexto } from '../../shared/domain/validacoes';
import { MovimentacaoEstoque, TipoMovimentacao, deltaDoSaldo } from './movimentacao-estoque';
import { Produto } from './produto.entity';
import { EstoqueInsuficienteError, ItemEmFalta } from './errors/estoque-insuficiente.error';
import { ProdutoNaoEncontradoError } from './errors/produto-nao-encontrado.error';

/** Peca requisitada por um servico de uma OS. */
export interface ItemDeBaixa {
  produtoId: string;
  servicoId: string;
  quantidade: number;
}

/** Soma as quantidades por produto (o mesmo produto pode atender varios servicos). */
export function consolidarPorProduto(
  movimentacoes: Pick<MovimentacaoEstoque, 'produtoId' | 'tipo' | 'quantidade'>[],
): Map<string, number> {
  const total = new Map<string, number>();
  for (const m of movimentacoes) {
    total.set(m.produtoId, (total.get(m.produtoId) ?? 0) + deltaDoSaldo(m));
  }
  return total;
}

/**
 * Valida o saldo (produto existe e cobre a soma pedida por todos os servicos)
 * antes de tocar o banco. A garantia final contra corrida e a
 * `ConditionExpression` da transacao — esta checagem so da a mensagem clara.
 */
export function validarSaldo(itens: ItemDeBaixa[], produtos: Map<string, Produto>): void {
  const pedido = new Map<string, number>();
  for (const item of itens) {
    pedido.set(item.produtoId, (pedido.get(item.produtoId) ?? 0) + item.quantidade);
  }
  const emFalta: ItemEmFalta[] = [];
  for (const [produtoId, quantidade] of pedido) {
    const produto = produtos.get(produtoId);
    if (!produto) throw new ProdutoNaoEncontradoError(produtoId);
    if (!produto.possuiSaldo(quantidade)) {
      emFalta.push({ produtoId, solicitado: quantidade, disponivel: produto.quantidadeEstoque });
    }
  }
  if (emFalta.length) throw new EstoqueInsuficienteError(emFalta);
}

/**
 * Id deterministico de uma movimentacao ligada a um diagnostico: o mesmo
 * (tipo, baixa, produto, servico) gera sempre o mesmo id. Com o
 * `attribute_not_exists(movimentacaoId)` da transacao, repetir uma baixa ou uma
 * devolucao (retry do OS, retry do SDK, chamadas concorrentes) nunca move o saldo
 * duas vezes.
 */
export function idMovimentacao(
  tipo: TipoMovimentacao.BAIXA | TipoMovimentacao.DEVOLUCAO,
  baixaId: string,
  produtoId: string,
  servicoId: string | null,
): string {
  return `${tipo}#${baixaId}#${produtoId}#${servicoId ?? '-'}`;
}

/**
 * Uma movimentacao BAIXA por (produto, servico), para rastrear qual servico
 * consumiu a peca. `baixaId` identifica o fechamento do diagnostico (um por
 * versao da execucao) e entra no id da movimentacao.
 */
export function planejarBaixa(
  osId: string,
  baixaId: string,
  itens: ItemDeBaixa[],
  agora: Date = new Date(),
): MovimentacaoEstoque[] {
  exigirTexto(osId, 'osId');
  exigirTexto(baixaId, 'baixaId');
  const agrupado = new Map<string, ItemDeBaixa>();
  for (const item of itens) {
    exigirQuantidade(item.quantidade, 'quantidade');
    const chave = `${item.produtoId}|${item.servicoId}`;
    const atual = agrupado.get(chave);
    agrupado.set(chave, { ...item, quantidade: (atual?.quantidade ?? 0) + item.quantidade });
  }
  const data = agora.toISOString();
  return [...agrupado.values()].map((item) => ({
    movimentacaoId: idMovimentacao(TipoMovimentacao.BAIXA, baixaId, item.produtoId, item.servicoId),
    produtoId: item.produtoId,
    tipo: TipoMovimentacao.BAIXA,
    quantidade: item.quantidade,
    osId,
    servicoId: item.servicoId,
    data,
  }));
}

/**
 * Devolucao (rollback) de uma baixa: uma DEVOLUCAO para cada BAIXA efetivamente
 * gravada, com a mesma quantidade e id deterministico. Recebe as baixas lidas do
 * banco (leitura consistente por id), nunca o indice por OS, que e eventual.
 */
export function planejarDevolucao(
  osId: string,
  baixaId: string,
  baixas: MovimentacaoEstoque[],
  agora: Date = new Date(),
): MovimentacaoEstoque[] {
  const data = agora.toISOString();
  return baixas
    .filter((b) => b.osId === osId && b.tipo === TipoMovimentacao.BAIXA)
    .map((b) => ({
      movimentacaoId: idMovimentacao(TipoMovimentacao.DEVOLUCAO, baixaId, b.produtoId, b.servicoId),
      produtoId: b.produtoId,
      tipo: TipoMovimentacao.DEVOLUCAO,
      quantidade: b.quantidade,
      osId,
      servicoId: b.servicoId,
      data,
    }));
}
