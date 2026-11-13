export interface ContractTarget {
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

export function targetFromEnv(): ContractTarget {
  return {
    baseUrl: required('CONTRACT_BASE_URL'),
    publicApiKey: required('CONTRACT_API_KEY'),
    internalApiKey: required('CONTRACT_INTERNAL_API_KEY'),
  };
}
