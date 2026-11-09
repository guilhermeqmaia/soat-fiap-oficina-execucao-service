import { ConfigService } from '@nestjs/config';
import { ClienteHttpInterno } from '@guilhermeqmaia/oficina-kit/http';
import { BACKOFF_CONFLITO_MS, OsServiceClient } from './os-service.client';
import { OsServiceIndisponivelFilter } from './os-service-indisponivel.filter';
import { OsServiceIndisponivelError } from '../../application/ports/os-service.gateway';
import { OsServiceRecusouError } from '../../domain/errors/os-service-recusou.error';
import { ServidorHttpFake } from '../../../test/servidor-http-fake';

const os = new ServidorHttpFake();
const http = new ClienteHttpInterno({
  servico: 'execucao-service',
  jwtSecret: process.env.JWT_SECRET!,
  tentativas: 2,
  backoffMs: [1],
});
/** Nao espera o backoff real dos 409; registra as esperas pedidas. */
class OsServiceClientSemEspera extends OsServiceClient {
  readonly esperas: number[] = [];
  protected override aguardar(ms: number): Promise<void> {
    this.esperas.push(ms);
    return Promise.resolve();
  }
}
const cliente = (url = `${os.url}/`) =>
  new OsServiceClientSemEspera(http, new ConfigService({ OS_SERVICE_URL: url }));
const diagnostico = {
  numeroOS: 'OS 1',
  mecanicoId: 'mec-1',
  diagnostico: 'ok',
  itens: [
    {
      tipo: 'SERVICO' as const,
      referenciaId: 's1',
      nome: 'x',
      quantidade: 1,
      precoUnitario: '1.00',
    },
  ],
};

describe('OsServiceClient (callbacks RFC-0008)', () => {
  beforeAll(() => os.iniciar());
  afterEach(() => os.limpar());
  afterAll(() => os.parar());

  it('POST /ordens-servico/{numero}/eventos com envelope, JWT de servico e correlation id', async () => {
    await cliente().diagnosticoConcluido(diagnostico);
    const [r] = os.recebidas;
    expect(r).toMatchObject({
      method: 'POST',
      url: '/ordens-servico/OS%201/eventos',
      body: {
        type: 'execucao.diagnostico-concluido',
        version: 1,
        producer: 'execucao-service',
        data: diagnostico,
      },
    });
    expect((r.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers.authorization).toMatch(/^Bearer .+/);
    expect(r.headers['x-correlation-id']).toBe('OS 1');
  });

  it('execucao.finalizada', async () => {
    await cliente().execucaoFinalizada({ numeroOS: '7', finalizadaEm: '2026-01-01T00:00:00.000Z' });
    expect(os.recebidas[0].body).toMatchObject({
      type: 'execucao.finalizada',
      data: { numeroOS: '7', finalizadaEm: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('400/404 viram OsServiceRecusouError sem retry (usa `motivo` ou `message`)', async () => {
    os.responder({ status: 404, body: { motivo: 'OS nao encontrada' } });
    await expect(cliente().diagnosticoConcluido(diagnostico)).rejects.toEqual(
      new OsServiceRecusouError(404, 'OS nao encontrada'),
    );
    expect(os.recebidas).toHaveLength(1);
    os.responder({ status: 404, body: { message: ['nao achei'] } });
    await expect(cliente().diagnosticoConcluido(diagnostico)).rejects.toThrow('nao achei');
    os.responder({ status: 400 });
    await expect(cliente().diagnosticoConcluido(diagnostico)).rejects.toThrow('sem detalhes');
  });

  it('409 e transitorio: repete o MESMO envelope com backoff e passa quando o OS aceita', async () => {
    os.responder({ status: 409, body: { motivo: 'repita o callback' } }, { status: 200 });
    const c = cliente();
    await expect(c.diagnosticoConcluido(diagnostico)).resolves.toBeUndefined();
    expect(os.recebidas).toHaveLength(2);
    expect(os.recebidas[1].body).toEqual(os.recebidas[0].body);
    expect(c.esperas).toEqual([BACKOFF_CONFLITO_MS[0]]);
  });

  it('409 persistente (4x) vira OsServiceIndisponivelError (502, compensacao local)', async () => {
    os.responder({ status: 409 }, { status: 409 }, { status: 409 }, { status: 409 });
    const c = cliente();
    const erro = await c.diagnosticoConcluido(diagnostico).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OsServiceIndisponivelError);
    expect((erro as Error).message).toMatch(/409.*4 vezes/);
    expect(os.recebidas).toHaveLength(4);
    expect(new Set(os.recebidas.map((r) => (r.body as { id: string }).id)).size).toBe(1);
    expect(c.esperas).toEqual([...BACKOFF_CONFLITO_MS]);
  });

  it('5xx: retry e depois OsServiceIndisponivelError; 5xx seguido de sucesso passa', async () => {
    os.responder({ status: 503 }, { status: 503 });
    await expect(cliente().diagnosticoConcluido(diagnostico)).rejects.toBeInstanceOf(
      OsServiceIndisponivelError,
    );
    expect(os.recebidas).toHaveLength(2);
    os.responder({ status: 500 }, { status: 200 });
    await expect(cliente().diagnosticoConcluido(diagnostico)).resolves.toBeUndefined();
  });

  it('aguardar() real espera via setTimeout', async () => {
    jest.useFakeTimers();
    const real = new OsServiceClient(http, new ConfigService({ OS_SERVICE_URL: os.url }));
    const espera = (real as unknown as { aguardar(ms: number): Promise<void> }).aguardar(200);
    await jest.advanceTimersByTimeAsync(200);
    await expect(espera).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it('sem OS_SERVICE_URL o callback e ignorado (dev)', async () => {
    await expect(cliente('').diagnosticoConcluido(diagnostico)).resolves.toBeUndefined();
    expect(os.recebidas).toEqual([]);
  });
});

describe('OsServiceIndisponivelFilter', () => {
  it('responde 502', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new OsServiceIndisponivelFilter().catch(new OsServiceIndisponivelError('fora'), host as never);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 502, message: 'fora' }),
    );
  });
});
