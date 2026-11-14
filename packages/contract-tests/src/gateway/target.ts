export interface GatewayContractTarget {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Runner 2: an external Gateway, with the real admin credentials. */
export function gatewayTargetFromEnv(): GatewayContractTarget {
  return {
    baseUrl: required('CONTRACT_GATEWAY_BASE_URL'),
    adminEmail: required('CONTRACT_ADMIN_EMAIL'),
    adminPassword: required('CONTRACT_ADMIN_PASSWORD'),
  };
}
