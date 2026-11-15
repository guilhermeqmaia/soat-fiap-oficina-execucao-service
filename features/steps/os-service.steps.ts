import { strict as assert } from 'assert';
import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { ambiente } from '../support/ambiente';
import { aguardarAte } from '../support/polling';
import { CallbackRecebido, MundoExecucao } from '../support/world';

// O OS Service fake responde 200 por padrao; estes steps programam falhas e recusas.
const RESPOSTAS_FORA_DO_AR = 20;

Given(
  'que o OS Service está fora do ar respondendo {int}',
  function (this: MundoExecucao, status: number) {
    ambiente.osService.responder(
      ...Array.from({ length: RESPOSTAS_FORA_DO_AR }, () => ({ status })),
    );
  },
);

Given(
  'que o OS Service recusa o diagnóstico com status HTTP {int} e motivo {string}',
  function (this: MundoExecucao, status: number, motivo: string) {
    ambiente.osService.responder({ status, body: { motivo } });
  },
);

When('o OS Service volta ao ar', function () {
  ambiente.osService.limparRespostas();
});

const callbacksDoTipo = (mundo: MundoExecucao, type: string) =>
  mundo.callbacks().filter((c) => c.type === type);

async function aguardarCallbacks(mundo: MundoExecucao, type: string, qtd: number) {
  return aguardarAte(
    `${qtd} callback(s) "${type}" para ${mundo.numeroOS}`,
    () => callbacksDoTipo(mundo, type),
    (lista) => lista.length >= qtd,
  );
}

Then(
  'o OS Service recebe o callback {string} com os itens:',
  async function (this: MundoExecucao, type: string, t: DataTable) {
    const [callback] = await aguardarCallbacks(this, type, 1);
    assert.equal(callback.producer, 'execucao-service');
    assert.equal(callback.data.numeroOS, this.numeroOS);
    assert.equal(callback.data.mecanicoId, this.mecanicoId);
    const itens = (callback.data.itens as Record<string, unknown>[]).map((i) => ({
      tipo: i.tipo,
      nome: i.nome,
      quantidade: i.quantidade,
      precoUnitario: i.precoUnitario,
    }));
    const esperados = t.hashes().map((l) => ({
      tipo: l.tipo,
      nome: l.nome,
      quantidade: Number(l.quantidade),
      precoUnitario: l.precoUnitario,
    }));
    assert.deepEqual(itens, esperados);
  },
);

Then('o OS Service recebeu os callbacks na ordem:', function (this: MundoExecucao, t: DataTable) {
  assert.deepEqual(
    this.callbacks().map((c) => c.type),
    t.hashes().map((l) => l.type),
  );
});

Then('o OS Service não recebeu nenhum callback', function (this: MundoExecucao) {
  assert.deepEqual(this.callbacks(), []);
});

Then(
  'o OS Service recebeu {int} vezes o mesmo envelope {string}',
  async function (this: MundoExecucao, vezes: number, type: string) {
    const recebidos: CallbackRecebido[] = await aguardarCallbacks(this, type, vezes);
    assert.equal(recebidos.length, vezes);
    // Reenvio = o envelope pendente gravado na execucao: mesmo id (o OS deduplica por ele).
    for (const envelope of recebidos.slice(1)) assert.deepEqual(envelope, recebidos[0]);
  },
);

Then(
  'os callbacks chegam com o JWT de serviço e o número da OS como correlação',
  function (this: MundoExecucao) {
    const requisicoes = this.requisicoesDeCallback();
    assert.ok(requisicoes.length > 0, 'nenhum callback recebido');
    for (const r of requisicoes) {
      const jwt = String(r.headers.authorization).replace(/^Bearer /, '');
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      assert.equal(payload.role, 'SERVICO');
      assert.equal(payload.sub, 'execucao-service');
      assert.equal(r.headers['x-correlation-id'], this.numeroOS);
    }
  },
);
