export interface LedgerContractTarget {
  baseUrl: string;
  publicApiKey: string;
  internalApiKey: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Runner 2: an external Ledger Service. */
export function ledgerTargetFromEnv(): LedgerContractTarget {
  return {
    baseUrl: required('CONTRACT_LEDGER_BASE_URL'),
    publicApiKey: required('CONTRACT_LEDGER_API_KEY'),
    internalApiKey: required('CONTRACT_LEDGER_INTERNAL_API_KEY'),
  };
}
