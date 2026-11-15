/**
 * Lock otimista (`versao`): outra requisicao alterou a execucao no meio do caminho.
 * NAO e recusa de negocio: o caso de uso e repetido (`comRetentativa`) e, se o
 * conflito persistir, a resposta e 503 — o cliente HTTP do OS Service repete 5xx,
 * enquanto um 409 `{ motivo }` viraria `execucao.recusada` e cancelaria a OS.
 */
export class ExecucaoAlteradaConcorrentementeError extends Error {
  constructor(readonly osId: string) {
    super(`Execucao da OS ${osId} foi alterada por outra operacao; tente novamente`);
    this.name = 'ExecucaoAlteradaConcorrentementeError';
  }
}
