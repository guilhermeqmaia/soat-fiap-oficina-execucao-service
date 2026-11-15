import { Role } from '@guilhermeqmaia/oficina-kit/auth';
import { mintServiceToken, mintToken } from '@guilhermeqmaia/oficina-kit/testing';

/** JWT por ator, assinados com o mesmo JWT_SECRET de teste (src/test/jest-setup-env.ts). */
export const tokens = {
  admin: () => `Bearer ${mintToken({ sub: 'adm-bdd', role: Role.ADMIN })}`,
  estoquista: () => `Bearer ${mintToken({ sub: 'est-bdd', role: Role.ESTOQUISTA })}`,
  mecanico: (id: string) => `Bearer ${mintToken({ sub: id, role: Role.MECANICO })}`,
  osService: () => `Bearer ${mintServiceToken({ servico: 'os-service' })}`,
};
