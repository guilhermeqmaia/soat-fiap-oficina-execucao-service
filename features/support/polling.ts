const TIMEOUT_MS = Number(process.env.BDD_TIMEOUT_MS ?? 10_000);
const INTERVALO_MS = Number(process.env.BDD_INTERVALO_MS ?? 100);

/**
 * Polling com timeout (sem sleep fixo): repete `consulta` ate `condicao` ser verdadeira.
 * Devolve o ultimo valor lido; se estourar o tempo, falha com a descricao e o ultimo valor.
 */
export async function aguardarAte<T>(
  descricao: string,
  consulta: () => Promise<T> | T,
  condicao: (valor: T) => boolean,
): Promise<T> {
  const limite = Date.now() + TIMEOUT_MS;
  let ultimo = await consulta();
  while (!condicao(ultimo)) {
    if (Date.now() > limite) {
      throw new Error(
        `Tempo esgotado (${TIMEOUT_MS} ms) esperando ${descricao}. Ultimo valor: ${JSON.stringify(ultimo)}`,
      );
    }
    await new Promise((ok) => setTimeout(ok, INTERVALO_MS));
    ultimo = await consulta();
  }
  return ultimo;
}
