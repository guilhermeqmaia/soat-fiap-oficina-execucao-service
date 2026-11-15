/**
 * A transacao de estoque foi recusada porque uma das movimentacoes (id
 * deterministico) ja existe: a mesma baixa/devolucao ja foi aplicada antes.
 * Nao e erro de negocio: quem chama trata como "ja feito" (idempotencia).
 */
export class MovimentacaoJaRegistradaError extends Error {
  constructor(readonly movimentacaoId: string) {
    super(`Movimentacao ${movimentacaoId} ja registrada`);
    this.name = 'MovimentacaoJaRegistradaError';
  }
}
