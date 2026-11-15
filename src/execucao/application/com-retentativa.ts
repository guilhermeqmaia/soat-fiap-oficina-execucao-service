import { ExecucaoAlteradaConcorrentementeError } from '../domain/errors/execucao-alterada-concorrentemente.error';

/** Tentativas de um caso de uso chamado pelo OS Service antes de responder 503. */
export const TENTATIVAS_CONCORRENCIA = 3;

/**
 * Repete `operacao` (que precisa reler a execucao a cada tentativa) quando o
 * lock otimista acusa escrita concorrente. Os comandos do OS Service sao
 * idempotentes, entao a releitura resolve: quem chegou depois ve o efeito de
 * quem chegou antes e devolve o mesmo resultado.
 */
export async function comRetentativa<T>(
  operacao: () => Promise<T>,
  tentativas = TENTATIVAS_CONCORRENCIA,
): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await operacao();
    } catch (e) {
      if (!(e instanceof ExecucaoAlteradaConcorrentementeError) || tentativa >= tentativas) throw e;
    }
  }
}
