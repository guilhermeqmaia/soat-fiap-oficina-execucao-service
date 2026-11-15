# language: pt
Funcionalidade: Liberação das reservas quando o orçamento é reprovado ou a OS é cancelada
  Como OS Service, na compensação da saga
  Quero cancelar a execução e devolver ao estoque as peças baixadas no diagnóstico
  Para que o estoque volte ao saldo anterior, mesmo que o comando chegue repetido

  Contexto:
    Dado que o catálogo tem os serviços:
      | nome          | precoBase |
      | Troca de óleo | 100       |
      | Revisão       | 50        |
    E que o estoque tem os produtos:
      | nome      | preco | quantidade |
      | Óleo 5W30 | 30    | 5          |
    E que o mecânico vai usar na OS:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | 3          |
      | Revisão       | Óleo 5W30 | 2          |

  Esquema do Cenário: <motivo>: as peças voltam ao estoque uma única vez
    Dado que a execução está com status "AGUARDANDO_APROVACAO"
    E o saldo de "Óleo 5W30" é 0
    Quando o OS Service libera as reservas com o motivo "<motivo>"
    Então a resposta tem status HTTP 200
    E a resposta lista 2 devoluções
    E a execução fica com status "CANCELADA"
    E o saldo de "Óleo 5W30" é 5

    Quando o OS Service libera as reservas com o motivo "<motivo>"
    Então a resposta tem status HTTP 200
    E a resposta lista 0 devoluções
    E o saldo de "Óleo 5W30" é 5
    E a OS tem as movimentações de estoque:
      | tipo      | quantidade |
      | BAIXA     | 3          |
      | BAIXA     | 2          |
      | DEVOLUCAO | 3          |
      | DEVOLUCAO | 2          |

    Exemplos:
      | motivo                           |
      | Orçamento reprovado pelo cliente |
      | OS cancelada pelo atendente      |

  Esquema do Cenário: Cancelamento com a execução em <status> devolve só o que foi baixado
    Dado que a execução está com status "<status>"
    Quando o OS Service libera as reservas com o motivo "OS cancelada"
    Então a resposta tem status HTTP 200
    E a resposta lista <devolucoes> devoluções
    E a execução fica com status "CANCELADA"
    E o saldo de "Óleo 5W30" é 5

    Exemplos:
      | status               | devolucoes |
      | NA_FILA              | 0          |
      | ATRIBUIDA            | 0          |
      | EM_DIAGNOSTICO       | 0          |
      | AGUARDANDO_APROVACAO | 2          |
      | EM_EXECUCAO          | 2          |

  Cenário: Execução cancelada não pode ser iniciada
    Dado que a execução está com status "CANCELADA"
    Quando o OS Service inicia a execução
    Então a resposta tem status HTTP 409
    E a resposta traz o motivo "CANCELADA"
    E o saldo de "Óleo 5W30" é 5

  Cenário: Execução já finalizada não devolve as peças usadas no conserto
    Dado que a execução está com status "EXECUTADA"
    Quando o OS Service libera as reservas com o motivo "OS cancelada"
    Então a resposta tem status HTTP 409
    E a execução continua com status "EXECUTADA"
    E o saldo de "Óleo 5W30" é 0

  Cenário: Liberar as reservas de uma OS que nunca chegou à Execução
    Quando o OS Service libera as reservas de uma OS que nunca foi enfileirada
    Então a resposta tem status HTTP 200
    E a resposta lista 0 devoluções
