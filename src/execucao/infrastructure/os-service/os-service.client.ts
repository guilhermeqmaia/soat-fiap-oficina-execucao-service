import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClienteHttpInterno,
  HttpInternoError,
  criarEnvelopeHttp,
} from '@guilhermeqmaia/oficina-kit/http';
import { OsServiceRecusouError } from '../../domain/errors/os-service-recusou.error';
import {
  DiagnosticoConcluido,
  OsServiceGateway,
  OsServiceIndisponivelError,
} from '../../application/ports/os-service.gateway';

export const PRODUCER = 'execucao-service';

/** Esperas entre as repeticoes de um callback que o OS devolveu `409` (ms). */
export const BACKOFF_CONFLITO_MS: readonly number[] = [200, 800, 3000];

/**
 * Callbacks para o OS Service (RFC-0008): `POST {OS_SERVICE_URL}/ordens-servico/{numeroOS}/eventos`
 * com o envelope do kit. `ClienteHttpInterno` assina com JWT de servico
 * (`role: SERVICO`), propaga `x-correlation-id` (= numeroOS) e repete so em
 * 5xx/timeout.
 *
 * Respostas do OS:
 * - `409` = a OS/saga foi alterada ao mesmo tempo ("repita o callback"): e transitorio.
 *   Repetimos o POST com o MESMO envelope (o OS deduplica pelo `id`) ate
 *   `BACKOFF_CONFLITO_MS.length` vezes; se persistir -> OsServiceIndisponivelError (502,
 *   a compensacao local roda).
 * - `400`/`404`/demais 4xx = recusa de negocio -> OsServiceRecusouError (409 `{ motivo }`).
 * - timeout/rede/5xx (apos os retries do kit) -> OsServiceIndisponivelError (502).
 */
@Injectable()
export class OsServiceClient implements OsServiceGateway {
  private readonly logger = new Logger(OsServiceClient.name);
  private readonly baseUrl: string;

  constructor(
    @Inject(ClienteHttpInterno) private readonly http: ClienteHttpInterno,
    config: ConfigService,
  ) {
    this.baseUrl = (config.get<string>('OS_SERVICE_URL') ?? '').replace(/\/+$/, '');
  }

  diagnosticoConcluido(evento: DiagnosticoConcluido): Promise<void> {
    return this.enviar(evento.numeroOS, 'execucao.diagnostico-concluido', evento);
  }

  execucaoFinalizada(evento: { numeroOS: string; finalizadaEm: string }): Promise<void> {
    return this.enviar(evento.numeroOS, 'execucao.finalizada', evento);
  }

  private async enviar(numeroOS: string, type: string, data: object): Promise<void> {
    if (!this.baseUrl) {
      this.logger.warn(`OS_SERVICE_URL ausente: callback ${type} da OS ${numeroOS} ignorado (dev)`);
      return;
    }
    const url = `${this.baseUrl}/ordens-servico/${encodeURIComponent(numeroOS)}/eventos`;
    const envelope = criarEnvelopeHttp({ type, data, producer: PRODUCER });
    for (let tentativa = 0; ; tentativa++) {
      try {
        await this.http.post(url, envelope, { correlationId: numeroOS });
        return;
      } catch (e) {
        if (e instanceof HttpInternoError && e.status === 409) {
          const espera = BACKOFF_CONFLITO_MS[tentativa];
          if (espera === undefined) {
            throw new OsServiceIndisponivelError(
              `OS Service respondeu 409 (conflito) ${tentativa + 1} vezes seguidas (callback ${type})`,
              e,
            );
          }
          this.logger.warn(
            `OS Service respondeu 409 ao callback ${type} da OS ${numeroOS}; repetindo em ${espera} ms (tentativa ${tentativa + 2})`,
          );
          await this.aguardar(espera);
          continue;
        }
        if (e instanceof HttpInternoError && e.status !== undefined && e.status < 500) {
          const corpo = (e.body ?? {}) as { motivo?: string; message?: string | string[] };
          const motivo = corpo.motivo ?? [corpo.message ?? 'sem detalhes'].flat().join('; ');
          throw new OsServiceRecusouError(e.status, motivo);
        }
        throw new OsServiceIndisponivelError(`OS Service indisponivel (callback ${type})`, e);
      }
    }
  }

  /** Separado para os testes nao esperarem o backoff real. */
  protected aguardar(ms: number): Promise<void> {
    return new Promise((ok) => setTimeout(ok, ms));
  }
}
