# language: pt
Funcionalidade: Conclusão do diagnóstico com baixa de estoque e callback ao OS Service
  Como mecânico
  Quero concluir o diagnóstico com os serviços e as peças necessárias
  Para que as peças sejam baixadas do estoque e o OS Service gere o orçamento

  Regras (RFC-0008):
  - estoque insuficiente recusa o diagnóstico sem baixar nada;
  - OS Service fora do ar (5xx) é resultado ambíguo: a baixa fica e o mecânico repete;
  - OS Service recusa (4xx): as peças voltam e o diagnóstico é reaberto.

  Contexto:
    Dado que o catálogo tem os serviços:
      | nome          | precoBase |
      | Troca de óleo | 100       |
      | Revisão       | 50        |
    E que o estoque tem os produtos:
      | nome      | preco | quantidade |
      | Óleo 5W30 | 30    | 5          |
    E que a execução está com status "ATRIBUIDA"

  Esquema do Cenário: Estoque insuficiente recusa o diagnóstico sem baixar nada (<troca> + <revisao> de 5)
    Dado que o mecânico vinculou os serviços e as peças:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | <troca>    |
      | Revisão       | Óleo 5W30 | <revisao>  |
    Quando o mecânico conclui o diagnóstico "Óleo vencido"
    Então a resposta tem status HTTP 409
    E a resposta traz o motivo "Estoque insuficiente"
    E o saldo de "Óleo 5W30" é 5
    E a OS não tem movimentações de estoque
    E o OS Service não recebeu nenhum callback
    E a execução continua com status "EM_DIAGNOSTICO"

    Exemplos:
      | troca | revisao |
      | 4     | 2       |
      | 6     | 1       |
      | 3     | 3       |

  Esquema do Cenário: OS Service fora do ar (HTTP <status>) mantém a baixa e o mecânico repete o diagnóstico
    Dado que o mecânico vinculou os serviços e as peças:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | 2          |
      | Revisão       | Óleo 5W30 | 1          |
    E que o OS Service está fora do ar respondendo <status>
    Quando o mecânico conclui o diagnóstico "Óleo vencido"
    Então a resposta tem status HTTP 502
    E o saldo de "Óleo 5W30" é 2
    E a execução continua com status "AGUARDANDO_APROVACAO"

    Quando o OS Service volta ao ar
    E o mecânico repete o diagnóstico "Óleo vencido"
    Então a resposta tem status HTTP 200
    E o OS Service recebeu 2 vezes o mesmo envelope "execucao.diagnostico-concluido"
    E o saldo de "Óleo 5W30" é 2
    E a OS tem as movimentações de estoque:
      | tipo  | quantidade |
      | BAIXA | 2          |
      | BAIXA | 1          |
    E a execução fica com status "AGUARDANDO_APROVACAO"

    Exemplos:
      | status |
      | 500    |
      | 503    |
      | 504    |

  Esquema do Cenário: OS Service recusa o diagnóstico (HTTP <status>): peças devolvidas e diagnóstico reaberto
    Dado que o mecânico vinculou os serviços e as peças:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | 2          |
      | Revisão       | Óleo 5W30 | 1          |
    E que o OS Service recusa o diagnóstico com status HTTP <status> e motivo "<motivo>"
    Quando o mecânico conclui o diagnóstico "Óleo vencido"
    Então a resposta tem status HTTP 409
    E a resposta traz o motivo "<motivo>"
    E o saldo de "Óleo 5W30" é 5
    E a OS tem as movimentações de estoque:
      | tipo      | quantidade |
      | BAIXA     | 2          |
      | BAIXA     | 1          |
      | DEVOLUCAO | 2          |
      | DEVOLUCAO | 1          |
    E a execução fica com status "EM_DIAGNOSTICO"

    Exemplos:
      | status | motivo                         |
      | 400    | Itens do diagnóstico inválidos |
      | 404    | OS não encontrada              |
      | 422    | OS já cancelada                |
