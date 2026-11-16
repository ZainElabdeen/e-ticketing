import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bootstrapService, resolveContractFile, runIfMain } from './bootstrap';

describe('resolveContractFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nest-common-contract-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers the built openapi.json next to the dist directory', () => {
    const dist = join(root, 'dist');
    mkdirSync(dist);
    const built = join(root, 'openapi.json');
    writeFileSync(built, '{}');
    expect(resolveContractFile(dist, 'ticket-service')).toBe(built);
  });

  it('falls back to the contracts package copy', () => {
    const dist = join(root, 'dist');
    mkdirSync(dist);
    const contracts = join(root, 'node_modules', '@eticket', 'contracts', 'openapi');
    mkdirSync(contracts, { recursive: true });
    writeFileSync(join(root, 'node_modules', '@eticket', 'contracts', 'package.json'), '{}');
    writeFileSync(join(contracts, 'ledger-service.json'), '{}');
    expect(resolveContractFile(dist, 'ledger-service')).toBe(
      join(contracts, 'ledger-service.json'),
    );
  });
});

describe('bootstrapService', () => {
  it('enables shutdown hooks and listens on 0.0.0.0 at the configured port', async () => {
    const calls: string[] = [];
    const app = {
      enableShutdownHooks: () => calls.push('hooks'),
      get: (token: unknown) => {
        expect(token).toBe(ConfigService);
        return { get: () => 4321 };
      },
      listen: (port: number, host: string) => {
        calls.push(`listen ${port} ${host}`);
        return Promise.resolve();
      },
    } as unknown as INestApplication;
    const create = jest.fn().mockResolvedValue(app);
    await bootstrapService(create);
    expect(create).toHaveBeenCalledWith(process.env);
    expect(calls).toEqual(['hooks', 'listen 4321 0.0.0.0']);
  });
});

describe('runIfMain', () => {
  it('does nothing when the module is not the entry point', () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    runIfMain({} as NodeModule, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs fn when the module is the entry point', () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    runIfMain(require.main as NodeModule, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
