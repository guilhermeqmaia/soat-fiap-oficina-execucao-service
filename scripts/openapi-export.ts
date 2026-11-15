import '../src/test/jest-setup-env';
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml');
import { AppModule } from '../src/app.module';

/**
 * US-F4-15: gera o `openapi.yaml` publicado no hub (`docs/contratos/openapi/execucao-service.yaml`)
 * sem DynamoDB (`preview` nao instancia os providers). Mesmo documento do Swagger em `/api/docs`.
 */
async function exportar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  const config = new DocumentBuilder()
    .setTitle('oficina-execucao-service')
    .setDescription(
      'Execucao de OS: atribuicao de mecanico, diagnostico, catalogo de servicos/produtos e estoque (DynamoDB)',
    )
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addServer('http://oficina-execucao-service:3002', 'DNS interno do cluster')
    .addBearerAuth()
    .build();
  const documento = SwaggerModule.createDocument(app, config);
  // /health e /metrics vem do kit, sem decorator: declara-se aqui que sao publicas.
  for (const caminho of Object.values(documento.paths)) {
    for (const operacao of Object.values(caminho)) {
      if (typeof operacao === 'object' && operacao && 'responses' in operacao) {
        operacao.security ??= [];
      }
    }
  }
  writeFileSync('openapi.yaml', yaml.dump(documento, { noRefs: true }));
  await app.close();
}

void exportar();
