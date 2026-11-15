import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ExecucaoAlteradaConcorrentementeError } from '../domain/errors/execucao-alterada-concorrentemente.error';

/**
 * Conflito de versao que sobrou depois das retentativas => 503 + `Retry-After`.
 * Transitorio: o cliente HTTP interno do kit repete 5xx. Nunca 409 `{ motivo }`,
 * que o OS Service le como recusa de negocio.
 */
@Catch(ExecucaoAlteradaConcorrentementeError)
export class ConcorrenciaFilter implements ExceptionFilter {
  catch(exception: ExecucaoAlteradaConcorrentementeError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', '1')
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message: exception.message,
      });
  }
}
