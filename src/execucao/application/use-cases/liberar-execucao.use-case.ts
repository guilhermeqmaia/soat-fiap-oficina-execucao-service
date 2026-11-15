import { Inject, Injectable } from '@nestjs/common';
import { UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { Execucao } from '../../domain/execucao.entity';
import { MovimentacaoEstoque } from '../../../produto/domain/movimentacao-estoque';
import { EXECUCAO_REPOSITORY, ExecucaoRepository } from '../../domain/execucao.repository';
import { EstoqueService } from '../../../produto/application/services/estoque.service';
import { comRetentativa } from '../com-retentativa';

export interface LiberarExecucaoOutput {
  execucao: Execucao | null;
  devolucoes: MovimentacaoEstoque[];
}

/**
 * `execucao.liberar-reservas` (OS Service — OS cancelada / orcamento
 * reprovado): devolve ao estoque o que a baixa do diagnostico tirou e marca
 * CANCELADA. Idempotente e seguro com chamadas repetidas ou simultaneas: a
 * devolucao usa ids deterministicos (a segunda tentativa nao devolve de novo) e
 * acontece ANTES de gravar o cancelamento, entao uma queda no meio e corrigida
 * pela proxima chamada. `200` mesmo sem execucao ou sem pecas baixadas; `409`
 * so se a execucao ja foi EXECUTADA (pecas usadas no conserto).
 */
@Injectable()
export class LiberarExecucaoUseCase implements UseCase<
  { osId: string; motivo?: string },
  LiberarExecucaoOutput
> {
  constructor(
    @Inject(EXECUCAO_REPOSITORY) private readonly repo: ExecucaoRepository,
    private readonly estoque: EstoqueService,
  ) {}

  execute({ osId }: { osId: string; motivo?: string }): Promise<LiberarExecucaoOutput> {
    return comRetentativa(async () => {
      const execucao = await this.repo.buscarPorOsId(osId);
      if (!execucao) return { execucao: null, devolucoes: [] };
      execucao.exigirCancelavel();
      const devolucoes =
        execucao.estoqueBaixado && execucao.baixaId
          ? await this.estoque.devolverDaOs(osId, execucao.baixaId, execucao.itensDeEstoque())
          : [];
      if (execucao.cancelar()) await this.repo.salvar(execucao);
      return { execucao, devolucoes };
    });
  }
}
