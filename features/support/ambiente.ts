// Variaveis de teste ANTES de qualquer import do AppModule (o validateEnv roda no import).
import '../../src/test/jest-setup-env';
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { iniciarDynamoDbDeTeste, pararDynamoDbDeTeste } from '../../src/test/dynamodb.container';
import { ServidorHttpFake } from '../../src/test/servidor-http-fake';
import type { MundoExecucao } from './world';

// Logs do Nest/pino so com BDD_LOG=1 (depuracao); senao o relatorio fica limpo.
process.env.LOG_LEVEL = process.env.BDD_LOG ? 'debug' : 'silent';

// Primeira execucao baixa a imagem do DynamoDB Local.
setDefaultTimeout(120_000);

/** Estado compartilhado pela execucao inteira: uma aplicacao e um OS Service fake. */
export const ambiente = {
  app: undefined as INestApplication | undefined,
  /** Mock do OS Service: recebe os callbacks POST /ordens-servico/{n}/eventos. */
  osService: new ServidorHttpFake(),
};

BeforeAll(async () => {
  await ambiente.osService.iniciar();
  process.env.OS_SERVICE_URL = ambiente.osService.url;
  // Uma tentativa por callback: "fora do ar" vira 502 sem esperar o backoff do kit.
  process.env.OS_SERVICE_TENTATIVAS = '1';
  await iniciarDynamoDbDeTeste('bdd-exec-');
  const { AppModule } = await import('../../src/app.module');
  const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = ref.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  ambiente.app = app;
});

AfterAll(async () => {
  await ambiente.app?.close();
  await pararDynamoDbDeTeste();
  await ambiente.osService.parar();
});

// Cada cenario usa a sua OS, o seu veiculo e o seu catalogo: nao dependem uns dos outros.
Before(() => ambiente.osService.limpar());

// Cenario que falha anexa ao relatorio a OS, a ultima resposta HTTP e os callbacks recebidos.
After(function (this: MundoExecucao, { result }) {
  if (result?.status !== Status.FAILED) return;
  this.attach(
    JSON.stringify(
      {
        numeroOS: this.numeroOS,
        ultimaResposta: this.resposta && { status: this.resposta.status, body: this.resposta.body },
        callbacksRecebidos: ambiente.osService.recebidas.map((r) => ({
          method: r.method,
          url: r.url,
          body: r.body,
        })),
      },
      null,
      2,
    ),
    'application/json',
  );
});
