// BDD (US-F4-14): cenarios Gherkin em pt-BR (features/*.feature) executados pelo Cucumber
// contra o AppModule real + DynamoDB Local (testcontainers) + OS Service fake.
// tsconfig.bdd.json tambem quando chamado direto (`npx cucumber-js ...`).
process.env.TS_NODE_PROJECT ??= 'tsconfig.bdd.json';

module.exports = {
  default: {
    // Sem `paths`: o padrao do Cucumber ja e features/**/*.feature e um caminho na linha de
    // comando (ex.: features/diagnostico.feature:41) roda so aquele arquivo/cenario.
    requireModule: ['ts-node/register'],
    require: ['features/support/**/*.ts', 'features/steps/**/*.ts'],
    format: ['progress', 'html:reports/cucumber.html', 'json:reports/cucumber.json'],
  },
};
