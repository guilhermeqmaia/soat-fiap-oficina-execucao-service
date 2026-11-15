# language: pt
Funcionalidade: Execução da OS do enfileiramento à finalização
  Como Execução Service, participante da saga orquestrada pelo OS Service
  Quero receber a OS, registrar o diagnóstico do mecânico e executar o serviço aprovado
  Para que o OS Service gere o orçamento e conclua a OS com o estoque correto

  Contexto:
    Dado que o catálogo tem os serviços:
      | nome          | precoBase |
      | Troca de óleo | 100       |
      | Revisão       | 50        |
    E que o estoque tem os produtos:
      | nome      | preco | quantidade |
      | Óleo 5W30 | 30    | 5          |

  Cenário: Caminho feliz com baixa no estoque e callbacks para o OS Service
    Quando o OS Service enfileira a OS
    Então a resposta tem status HTTP 201
    E a execução fica com status "NA_FILA"

    Quando o mecânico "mec-1" assume a OS
    Então a execução fica com status "ATRIBUIDA"

    Quando o mecânico vincula os serviços e as peças:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | 2          |
      | Revisão       | Óleo 5W30 | 1          |
    Então a execução fica com status "EM_DIAGNOSTICO"
    E o saldo de "Óleo 5W30" é 5

    Quando o mecânico conclui o diagnóstico "Óleo vencido e filtro saturado"
    Então a resposta tem status HTTP 200
    E a execução fica com status "AGUARDANDO_APROVACAO"
    E o valor total do orçamento é 240
    E o saldo de "Óleo 5W30" é 2
    E a OS tem as movimentações de estoque:
      | tipo  | quantidade |
      | BAIXA | 2          |
      | BAIXA | 1          |
    E o OS Service recebe o callback "execucao.diagnostico-concluido" com os itens:
      | tipo    | nome          | quantidade | precoUnitario |
      | SERVICO | Troca de óleo | 1          | 100.00        |
      | PRODUTO | Óleo 5W30     | 2          | 30.00         |
      | SERVICO | Revisão       | 1          | 50.00         |
      | PRODUTO | Óleo 5W30     | 1          | 30.00         |

    Quando o OS Service inicia a execução
    Então a resposta tem status HTTP 200
    E a execução fica com status "EM_EXECUCAO"

    Quando o mecânico finaliza a execução
    Então a resposta tem status HTTP 200
    E a execução fica com status "EXECUTADA"
    E o saldo de "Óleo 5W30" é 2
    E o OS Service recebeu os callbacks na ordem:
      | type                           |
      | execucao.diagnostico-concluido |
      | execucao.finalizada            |
    E os callbacks chegam com o JWT de serviço e o número da OS como correlação

  Cenário: Comandos repetidos do OS Service são idempotentes
    Dado que o mecânico vai usar na OS:
      | servico       | produto   | quantidade |
      | Troca de óleo | Óleo 5W30 | 1          |
    E que a execução está com status "AGUARDANDO_APROVACAO"
    Quando o OS Service enfileira a OS
    Então a resposta tem status HTTP 201
    E a execução continua com status "AGUARDANDO_APROVACAO"
    Quando o OS Service inicia a execução
    E o OS Service inicia a execução
    Então a resposta tem status HTTP 200
    E a execução fica com status "EM_EXECUCAO"
    E o saldo de "Óleo 5W30" é 4
