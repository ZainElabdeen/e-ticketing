// Confirms a URL really is this project's Gateway before any credential is sent to it.
// /health/ready needs no key and names the three downstream services under `details`
// (also in its 503 body), which no other service on the machine will do.
const SERVICES = ['ticket-service', 'payment-service', 'ledger-service'];

export async function assertGateway(baseUrl) {
  let body;
  try {
    const res = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(5000) });
    body = await res.json();
  } catch {
    body = undefined;
  }
  const details = body?.details;
  if (!details || !SERVICES.every((name) => name in details)) {
    console.error(
      `${baseUrl} is not the e-ticketing Gateway (its /health/ready does not list the three services). ` +
        'Another project may own that port: set GATEWAY_HOST_PORT in infra/.env, or pass the URL explicitly. ' +
        'No credentials were sent.',
    );
    process.exit(2);
  }
}
