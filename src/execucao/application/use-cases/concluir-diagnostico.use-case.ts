import { Inject, Injectable } from '@nestjs/common';
import { DomainError, UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { AuthenticatedUser } from '@guilhermeqmaia/oficina-kit/auth';
import { Execucao, ExecucaoProps } from '../../domain/execucao.entity';
import { EXECUCAO_REPOSITORY, ExecucaoRepository } from '../../domain/execucao.repository';
import { OsServiceRecusouError } from '../../domain/errors/os-service-recusou.error';
import { EstoqueService } from '../../../produto/application/services/estoque.service';
import {
  OS_SERVICE_GATEWAY,
  OsServiceGateway,
  OsServiceIndisponivelError,
} from '../ports/os-service.gateway';
import { carregarExecucao, exigirResponsavel } from '../execucao.helpers';

export interface ConcluirDiagnosticoInput {
  osId: string;
  diagnostico: string;
  ator?: AuthenticatedUser;
}

/**
 * Fecha o diagnostico: consolida servicos+pecas, da BAIXA no estoque (uma
 * TransactWriteItems — tudo ou nada, sem saldo negativo, ids deterministicos) e
 * envia o callback `execucao.diagnostico-concluido` (o OS gera o orcamento).
 *
 * 1. grava AGUARDANDO_APROVACAO + `baixaId` + o envelope do callback como
 *    pendente (o lock otimista impede dois fechamentos simultaneos);
 * 2. baixa no estoque — recusada (ex.: falta peca): volta o estado anterior;
 *    erro de infra: mantem o estado (a repeticao do POST conclui, a baixa e idempotente);
 * 3. callback ao OS:
 *    - OK: limpa o pendente;
 *    - recusa (4xx): devolve as pecas e reabre o diagnostico;
 *    - timeout/5xx: resultado ambiguo (o OS pode ter aplicado). Mantem tudo e
 *      responde 502; o mecanico repete o POST e o MESMO envelope e reenviado (o OS
 *      deduplica pelo id). Nada e devolvido enquanto o OS pode ter gerado o orcamento.
 */
@Injectable()
export class ConcluirDiagnosticoUseCase implements UseCase<ConcluirDiagnosticoInput, Execucao> {
  constructor(
    @Inject(EXECUCAO_REPOSITORY) private readonly repo: ExecucaoRepository,
    @Inject(OS_SERVICE_GATEWAY) private readonly os: OsServiceGateway,
    private readonly estoque: EstoqueService,
  ) {}

  async execute({ osId, diagnostico, ator }: ConcluirDiagnosticoInput): Promise<Execucao> {
    const execucao = await carregarExecucao(this.repo, osId);
    exigirResponsavel(execucao, ator);
    if (execucao.aguardandoConfirmacaoDoOs) await this.garantirBaixa(execucao);
    else await this.fechar(execucao, diagnostico);
    await this.confirmarNoOs(execucao);
    return execucao;
  }

  private async fechar(execucao: Execucao, diagnostico: string): Promise<void> {
    const anterior = execucao.toJSON();
    execucao.concluirDiagnostico(diagnostico);
    execucao.registrarCallbackPendente(
      this.os.montarDiagnosticoConcluido({
        numeroOS: execucao.osId,
        mecanicoId: execucao.mecanicoId as string,
        diagnostico: execucao.diagnostico as string,
        itens: execucao.itensDoDiagnostico(),
      }),
    );
    await this.repo.salvar(execucao);
    try {
      await this.baixar(execucao);
    } catch (erro) {
      // Recusa do estoque (falta peca, produto inexistente): nada foi baixado, volta.
      // Erro de infra: a baixa pode ter sido gravada; mantem baixaId + pendente e a
      // repeticao do POST conclui de forma idempotente (nunca perde a referencia).
      if (erro instanceof DomainError) await this.restaurar(execucao, anterior);
      throw erro;
    }
  }

  /**
   * Repeticao com callback pendente: a baixa e idempotente (ja feita = no-op). So
   * falha se o processo caiu entre gravar a execucao e baixar e agora falta peca:
   * nesse caso o diagnostico e reaberto (nada foi baixado nem enviado).
   */
  private async garantirBaixa(execucao: Execucao): Promise<void> {
    try {
      await this.baixar(execucao);
    } catch (erro) {
      if (erro instanceof DomainError) {
        execucao.reabrirDiagnostico();
        await this.repo.salvar(execucao);
      }
      throw erro;
    }
  }

  private async confirmarNoOs(execucao: Execucao): Promise<void> {
    try {
      await this.os.enviar(execucao.callbackPendente!);
    } catch (erro) {
      if (erro instanceof OsServiceRecusouError) {
        await this.estoque.devolverDaOs(
          execucao.osId,
          execucao.baixaId as string,
          execucao.itensDeEstoque(),
        );
        execucao.reabrirDiagnostico();
        await this.repo.salvar(execucao);
        throw erro;
      }
      if (erro instanceof OsServiceIndisponivelError) {
        throw new OsServiceIndisponivelError(
          `${erro.message}. Diagnostico registrado e pecas baixadas; repita POST /execucao/ordens/${execucao.osId}/diagnostico para reenviar a confirmacao ao OS Service`,
          erro.causa,
        );
      }
      throw erro;
    }
    execucao.confirmarCallback();
    await this.repo.salvar(execucao);
  }

  private baixar(execucao: Execucao) {
    return this.estoque.baixarParaOs(
      execucao.osId,
      execucao.baixaId as string,
      execucao.itensDeEstoque(),
    );
  }

  private async restaurar(execucao: Execucao, anterior: ExecucaoProps): Promise<void> {
    await this.repo.salvar(Execucao.reconstituir({ ...anterior, versao: execucao.versao }));
  }
}
