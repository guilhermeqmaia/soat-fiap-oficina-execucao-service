import { Produto } from './produto.entity';
import { TipoMovimentacao as T, deltaDoSaldo } from './movimentacao-estoque';
import {
  consolidarPorProduto,
  idMovimentacao,
  planejarBaixa,
  planejarDevolucao,
  validarSaldo,
} from './estoque';
import { EstoqueInsuficienteError } from './errors/estoque-insuficiente.error';
import { ProdutoNaoEncontradoError } from './errors/produto-nao-encontrado.error';
import { DadoInvalidoError } from '../../shared/domain/erros-de-dominio';

const produto = (produtoId: string, quantidadeEstoque: number) =>
  Produto.criar({ produtoId, nome: produtoId, sku: produtoId, preco: 10, quantidadeEstoque });

describe('estoque (dominio)', () => {
  it('deltaDoSaldo: BAIXA subtrai, ENTRADA/DEVOLUCAO somam', () => {
    expect(deltaDoSaldo({ tipo: T.BAIXA, quantidade: 2 })).toBe(-2);
    expect(deltaDoSaldo({ tipo: T.DEVOLUCAO, quantidade: 2 })).toBe(2);
    expect(deltaDoSaldo({ tipo: T.ENTRADA, quantidade: 2 })).toBe(2);
  });

  describe('validarSaldo', () => {
    const produtos = new Map([
      ['p1', produto('p1', 3)],
      ['p2', produto('p2', 0)],
    ]);

    it('aceita quando o saldo cobre a soma de todos os servicos', () => {
      expect(() =>
        validarSaldo(
          [
            { produtoId: 'p1', servicoId: 's1', quantidade: 2 },
            { produtoId: 'p1', servicoId: 's2', quantidade: 1 },
          ],
          produtos,
        ),
      ).not.toThrow();
    });

    it('rejeita quando a soma excede o saldo, listando o que falta', () => {
      try {
        validarSaldo(
          [
            { produtoId: 'p1', servicoId: 's1', quantidade: 2 },
            { produtoId: 'p1', servicoId: 's2', quantidade: 2 },
            { produtoId: 'p2', servicoId: 's2', quantidade: 1 },
          ],
          produtos,
        );
        fail('deveria lancar');
      } catch (e) {
        expect(e).toBeInstanceOf(EstoqueInsuficienteError);
        expect((e as EstoqueInsuficienteError).itens).toEqual([
          { produtoId: 'p1', solicitado: 4, disponivel: 3 },
          { produtoId: 'p2', solicitado: 1, disponivel: 0 },
        ]);
        expect((e as Error).message).toContain('p1 (solicitado 4, disponivel 3)');
      }
    });

    it('rejeita produto inexistente', () => {
      expect(() =>
        validarSaldo([{ produtoId: 'pX', servicoId: 's', quantidade: 1 }], produtos),
      ).toThrow(ProdutoNaoEncontradoError);
    });
  });

  it('mensagem sem saldo conhecido (condicao do banco)', () => {
    expect(
      new EstoqueInsuficienteError([{ produtoId: 'p', solicitado: 1, disponivel: null }]).message,
    ).toBe('Estoque insuficiente: p (solicitado 1)');
  });

  describe('planejarBaixa', () => {
    it('gera uma BAIXA por (produto, servico), agregando repetidos, com id deterministico', () => {
      const movs = planejarBaixa(
        'OS-1',
        'OS-1@v3',
        [
          { produtoId: 'p1', servicoId: 's1', quantidade: 1 },
          { produtoId: 'p1', servicoId: 's1', quantidade: 2 },
          { produtoId: 'p1', servicoId: 's2', quantidade: 1 },
        ],
        new Date('2026-01-01T00:00:00Z'),
      );
      expect(movs).toEqual([
        {
          movimentacaoId: 'BAIXA#OS-1@v3#p1#s1',
          produtoId: 'p1',
          tipo: T.BAIXA,
          quantidade: 3,
          osId: 'OS-1',
          servicoId: 's1',
          data: '2026-01-01T00:00:00.000Z',
        },
        {
          movimentacaoId: 'BAIXA#OS-1@v3#p1#s2',
          produtoId: 'p1',
          tipo: T.BAIXA,
          quantidade: 1,
          osId: 'OS-1',
          servicoId: 's2',
          data: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(consolidarPorProduto(movs).get('p1')).toBe(-4);
    });

    it('mesmo diagnostico gera os mesmos ids; outro diagnostico gera ids novos', () => {
      const itens = [{ produtoId: 'p', servicoId: 's', quantidade: 1 }];
      const ids = (baixaId: string) =>
        planejarBaixa('OS', baixaId, itens).map((m) => m.movimentacaoId);
      expect(ids('OS@v1')).toEqual(ids('OS@v1'));
      expect(ids('OS@v1')).not.toEqual(ids('OS@v5'));
    });

    it('rejeita quantidade nao positiva e baixaId vazio', () => {
      expect(() =>
        planejarBaixa('OS', 'OS@v1', [{ produtoId: 'p', servicoId: 's', quantidade: 0 }]),
      ).toThrow(DadoInvalidoError);
      expect(() => planejarBaixa('OS', ' ', [])).toThrow(DadoInvalidoError);
    });
  });

  describe('planejarDevolucao', () => {
    const baixas = planejarBaixa('OS-1', 'OS-1@v2', [
      { produtoId: 'p1', servicoId: 's1', quantidade: 3 },
      { produtoId: 'p2', servicoId: 's1', quantidade: 1 },
    ]);

    it('uma DEVOLUCAO por BAIXA da OS, ignorando outras OS e entradas', () => {
      const outra = planejarBaixa('OS-2', 'OS-2@v2', [
        { produtoId: 'p1', servicoId: 's1', quantidade: 9 },
      ]);
      const entrada = { ...outra[0], movimentacaoId: 'e', tipo: T.ENTRADA, osId: 'OS-1' };
      const devolucoes = planejarDevolucao('OS-1', 'OS-1@v2', [...baixas, ...outra, entrada]);
      expect(
        devolucoes.map((d) => [d.movimentacaoId, d.produtoId, d.servicoId, d.tipo, d.quantidade]),
      ).toEqual([
        [idMovimentacao(T.DEVOLUCAO, 'OS-1@v2', 'p1', 's1'), 'p1', 's1', T.DEVOLUCAO, 3],
        [idMovimentacao(T.DEVOLUCAO, 'OS-1@v2', 'p2', 's1'), 'p2', 's1', T.DEVOLUCAO, 1],
      ]);
      expect(consolidarPorProduto(devolucoes).get('p1')).toBe(3);
    });

    it('ids deterministicos: planejar de novo gera os mesmos ids (a transacao barra a repeticao)', () => {
      expect(planejarDevolucao('OS-1', 'OS-1@v2', baixas)).toEqual(
        planejarDevolucao('OS-1', 'OS-1@v2', baixas, new Date(0)).map((d) => ({
          ...d,
          data: expect.any(String),
        })),
      );
    });

    it('sem baixas, nada a devolver', () => {
      expect(planejarDevolucao('OS-1', 'OS-1@v2', [])).toEqual([]);
    });

    it('servico nulo vira "-" no id', () => {
      expect(idMovimentacao(T.BAIXA, 'b', 'p', null)).toBe('BAIXA#b#p#-');
    });
  });
});
