import { CallbackPendente, ItemDiagnostico } from '../../domain/execucao.entity';

export const OS_SERVICE_GATEWAY = Symbol('OS_SERVICE_GATEWAY');

export interface DiagnosticoConcluido {
  numeroOS: string;
  mecanicoId: string;
  diagnostico: string;
  itens: ItemDiagnostico[];
}

/**
 * Callbacks para o OS Service (orquestrador da saga, RFC-0008):
 * `POST /ordens-servico/{numeroOS}/eventos` com envelope `{ id, type, version,
 * occurredAt, producer, data }` — ver docs/contratos/http-interno.md no os-service.
 */
export interface OsServiceGateway {
  /**
   * Monta (sem enviar) o envelope de `execucao.diagnostico-concluido`. O envelope
   * e guardado na execucao para que um reenvio use o MESMO `id` (o OS deduplica).
   */
  montarDiagnosticoConcluido(evento: DiagnosticoConcluido): CallbackPendente;
  /** Envia um envelope ja montado. `execucao.diagnostico-concluido` — OS gera o orcamento. */
  enviar(envelope: CallbackPendente): Promise<void>;
  /** `execucao.finalizada` — OS vai para AGUARDANDO_PAGAMENTO e cobra. */
  execucaoFinalizada(evento: { numeroOS: string; finalizadaEm: string }): Promise<void>;
}

/**
 * OS Service fora do ar/timeout/5xx (apos retries): resultado AMBIGUO — o OS pode
 * ter aplicado o evento. Quem chama decide se desfaz (finalizar) ou mantem o
 * estado e reenvia o mesmo envelope depois (diagnostico).
 */
export class OsServiceIndisponivelError extends Error {
  constructor(
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = 'OsServiceIndisponivelError';
  }
}
