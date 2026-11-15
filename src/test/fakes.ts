import { randomUUID } from 'crypto';
import { CallbackPendente, Execucao } from '../execucao/domain/execucao.entity';
import { ExecucaoRepository, FiltroExecucoes } from '../execucao/domain/execucao.repository';
import { ExecucaoAlteradaConcorrentementeError } from '../execucao/domain/errors/execucao-alterada-concorrentemente.error';
import {
  DiagnosticoConcluido,
  OsServiceGateway,
} from '../execucao/application/ports/os-service.gateway';
import { Produto } from '../produto/domain/produto.entity';
import { EstoqueRepository, ProdutoRepository } from '../produto/domain/produto.repository';
import { MovimentacaoEstoque, deltaDoSaldo } from '../produto/domain/movimentacao-estoque';
import { consolidarPorProduto } from '../produto/domain/estoque';
import { EstoqueInsuficienteError } from '../produto/domain/errors/estoque-insuficiente.error';
import { ProdutoNaoEncontradoError } from '../produto/domain/errors/produto-nao-encontrado.error';
import { MovimentacaoJaRegistradaError } from '../produto/domain/errors/movimentacao-ja-registrada.error';
import { Servico } from '../servico/domain/servico.entity';
import { ServicoRepository } from '../servico/domain/servico.repository';

export class InMemoryServicoRepository implements ServicoRepository {
  readonly itens = new Map<string, Servico>();
  async salvar(s: Servico) {
    this.itens.set(s.servicoId, Servico.reconstituir(s.toJSON()));
  }
  async buscarPorId(id: string) {
    const s = this.itens.get(id);
    return s ? Servico.reconstituir(s.toJSON()) : null;
  }
  async listar() {
    return [...this.itens.values()];
  }
  async remover(id: string) {
    this.itens.delete(id);
  }
}

/** Produtos + estoque em memoria com a mesma semantica da transacao DynamoDB (tudo ou nada). */
export class InMemoryEstoque implements ProdutoRepository, EstoqueRepository {
  readonly produtos = new Map<string, Produto>();
  readonly movimentacoes: MovimentacaoEstoque[] = [];
  falharProximaAplicacao?: Error;

  async criar(p: Produto) {
    this.produtos.set(p.produtoId, Produto.reconstituir(p.toJSON()));
  }
  async atualizarCadastro(p: Produto) {
    const atual = this.produtos.get(p.produtoId);
    if (!atual) throw new ProdutoNaoEncontradoError(p.produtoId);
    this.produtos.set(
      p.produtoId,
      Produto.reconstituir({ ...p.toJSON(), quantidadeEstoque: atual.quantidadeEstoque }),
    );
  }
  async buscarPorId(id: string) {
    const p = this.produtos.get(id);
    return p ? Produto.reconstituir(p.toJSON()) : null;
  }
  async buscarPorIds(ids: string[]) {
    const m = new Map<string, Produto>();
    for (const id of ids) {
      const p = await this.buscarPorId(id);
      if (p) m.set(id, p);
    }
    return m;
  }
  async buscarPorSku(sku: string) {
    return [...this.produtos.values()].find((p) => p.sku === sku) ?? null;
  }
  async listar() {
    return [...this.produtos.values()];
  }
  async remover(id: string) {
    this.produtos.delete(id);
  }
  async aplicar(movs: MovimentacaoEstoque[]) {
    if (this.falharProximaAplicacao) {
      const e = this.falharProximaAplicacao;
      this.falharProximaAplicacao = undefined;
      throw e;
    }
    const repetida = movs.find((m) =>
      this.movimentacoes.some((x) => x.movimentacaoId === m.movimentacaoId),
    );
    if (repetida) throw new MovimentacaoJaRegistradaError(repetida.movimentacaoId);
    const deltas = consolidarPorProduto(movs);
    for (const [id, delta] of deltas) {
      const p = this.produtos.get(id);
      if (!p) throw new ProdutoNaoEncontradoError(id);
      if (p.quantidadeEstoque + delta < 0)
        throw new EstoqueInsuficienteError([
          { produtoId: id, solicitado: -delta, disponivel: p.quantidadeEstoque },
        ]);
    }
    for (const m of movs) {
      const p = this.produtos.get(m.produtoId)!;
      this.produtos.set(
        m.produtoId,
        Produto.reconstituir({
          ...p.toJSON(),
          quantidadeEstoque: p.quantidadeEstoque + deltaDoSaldo(m),
        }),
      );
      this.movimentacoes.push(m);
    }
  }
  async buscarMovimentacoes(ids: string[]) {
    return this.movimentacoes.filter((m) => ids.includes(m.movimentacaoId));
  }
  async listarPorOs(osId: string) {
    return this.movimentacoes.filter((m) => m.osId === osId);
  }
  async listarPorProduto(produtoId: string) {
    return this.movimentacoes.filter((m) => m.produtoId === produtoId);
  }
  saldo(id: string) {
    return this.produtos.get(id)!.quantidadeEstoque;
  }
}

export class InMemoryExecucaoRepository implements ExecucaoRepository {
  readonly itens = new Map<string, ReturnType<Execucao['toJSON']>>();
  async salvar(e: Execucao) {
    const atual = this.itens.get(e.osId);
    if ((atual?.versao ?? 0) !== e.versao) throw new ExecucaoAlteradaConcorrentementeError(e.osId);
    this.itens.set(e.osId, { ...e.toJSON(), versao: e.versao + 1 });
    e.marcarPersistida();
  }
  async buscarPorOsId(osId: string) {
    const p = this.itens.get(osId);
    return p ? Execucao.reconstituir(p) : null;
  }
  async listar(f: FiltroExecucoes) {
    return [...this.itens.values()]
      .filter(
        (p) =>
          (!f.mecanicoId || p.mecanicoId === f.mecanicoId) &&
          (!f.veiculoId || p.veiculoId === f.veiculoId) &&
          (!f.status || p.status === f.status),
      )
      .map((p) => Execucao.reconstituir(p));
  }
  async remover(osId: string) {
    this.itens.delete(osId);
  }
}

export class FakeOsGateway implements OsServiceGateway {
  readonly diagnosticos: DiagnosticoConcluido[] = [];
  /** Ids dos envelopes enviados (um reenvio repete o id). */
  readonly envelopesEnviados: string[] = [];
  readonly finalizadas: { numeroOS: string; finalizadaEm: string }[] = [];
  falha?: Error;
  montarDiagnosticoConcluido(evento: DiagnosticoConcluido): CallbackPendente {
    return {
      id: randomUUID(),
      type: 'execucao.diagnostico-concluido',
      data: structuredClone(evento),
    };
  }
  async enviar(envelope: CallbackPendente) {
    if (this.falha) throw this.falha;
    this.envelopesEnviados.push(envelope.id);
    this.diagnosticos.push(envelope.data as DiagnosticoConcluido);
  }
  async execucaoFinalizada(evento: { numeroOS: string; finalizadaEm: string }) {
    if (this.falha) throw this.falha;
    this.finalizadas.push(evento);
  }
}
