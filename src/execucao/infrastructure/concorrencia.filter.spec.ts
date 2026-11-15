import { ConcorrenciaFilter } from './concorrencia.filter';
import { ExecucaoAlteradaConcorrentementeError } from '../domain/errors/execucao-alterada-concorrentemente.error';

describe('ConcorrenciaFilter', () => {
  it('responde 503 com Retry-After (transitorio, o kit do OS repete) e nunca 409 { motivo }', () => {
    const json = jest.fn();
    const res = { setHeader: jest.fn(), status: jest.fn(), json };
    res.setHeader.mockReturnValue(res);
    res.status.mockReturnValue(res);
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    new ConcorrenciaFilter().catch(
      new ExecucaoAlteradaConcorrentementeError('OS-1'),
      host as never,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(res.status).toHaveBeenCalledWith(503);
    const corpo = json.mock.calls[0][0];
    expect(corpo).toMatchObject({ statusCode: 503 });
    expect(corpo).not.toHaveProperty('motivo');
  });
});
