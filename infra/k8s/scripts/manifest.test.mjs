// Review-focus invariants on the rendered manifests (ADR-0026). Skips when
// kubectl is not on PATH; CI installs it (Task 4 of the Phase 9 plan).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseAllYaml, parseYaml } from './lib/yaml-lite.mjs';
import { renderHelmChartConfig, renderProd } from './render-prod.mjs';

const k8sDir = fileURLToPath(new URL('..', import.meta.url));
const renderSh = join(k8sDir, 'scripts/render.sh');
const hasKubectl = spawnSync('kubectl', ['version', '--client'], { stdio: 'ignore' }).status === 0;
const SKIP = 'kubectl is not on PATH: manifest tests skipped (CI installs it)';

const POSTGRES_IMAGE =
  'postgres:18-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015';
const SCHEMAS = [
  { service: 'ticket-service', schema: 'tickets', prefix: 'TICKETS' },
  { service: 'payment-service', schema: 'payments', prefix: 'PAYMENTS' },
  { service: 'ledger-service', schema: 'ledger', prefix: 'LEDGER' },
];
const IMAGE_BASE = 'ghcr.io/zainelabdeen/e-ticketing/';

function render(overlay) {
  const out = execFileSync('bash', [renderSh, overlay], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { text: out, docs: parseAllYaml(out) };
}

function renderProdSample() {
  const dir = join(k8sDir, '.rendered', 'validate');
  try {
    execFileSync('node', [
      join(k8sDir, 'scripts/render-prod.mjs'),
      '--target',
      'validate',
      '--host',
      'demo.example.org',
      '--tag',
      'sha-abc1234',
    ]);
    return render(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ofKind = (docs, kind) => docs.filter((d) => d.kind === kind);
const named = (docs, kind, name) => ofKind(docs, kind).find((d) => d.metadata.name === name);
const envOf = (container) => Object.fromEntries((container.env ?? []).map((e) => [e.name, e]));
const podSpec = (workload) => workload.spec.template.spec;
const workloads = (docs) => [...ofKind(docs, 'Deployment'), ...ofKind(docs, 'StatefulSet')];

test(
  'local overlay: workload hardening, probes and resources',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    assert.equal(workloads(docs).length, 6);
    for (const w of workloads(docs)) {
      const spec = podSpec(w);
      assert.equal(w.spec.replicas, 1, `${w.metadata.name} replicas`);
      for (const c of [...spec.containers, ...(spec.initContainers ?? [])]) {
        const where = `${w.metadata.name}/${c.name}`;
        assert.equal(c.securityContext?.runAsNonRoot, true, `${where} runAsNonRoot`);
        assert.equal(
          c.securityContext?.allowPrivilegeEscalation,
          false,
          `${where} allowPrivilegeEscalation`,
        );
        assert.deepEqual(c.securityContext?.capabilities?.drop, ['ALL'], `${where} drop ALL`);
        assert.ok(c.resources?.requests?.cpu && c.resources?.requests?.memory, `${where} requests`);
        assert.ok(c.resources?.limits?.memory, `${where} limits`);
      }
      for (const c of spec.containers) {
        assert.ok(c.livenessProbe, `${w.metadata.name} liveness`);
        assert.ok(c.readinessProbe, `${w.metadata.name} readiness`);
      }
    }
    const pg = podSpec(named(docs, 'StatefulSet', 'postgres')).containers[0];
    assert.equal(pg.image, POSTGRES_IMAGE);
    assert.equal(pg.livenessProbe.exec.command[0], 'pg_isready');
    assert.equal(pg.readinessProbe.exec.command[0], 'pg_isready');
    assert.equal(
      podSpec(named(docs, 'Deployment', 'ticket-service')).terminationGracePeriodSeconds,
      20,
    );
  },
);

test('local overlay: probes use the health endpoints', { skip: !hasKubectl && SKIP }, () => {
  const { docs } = render('local');
  for (const name of ['ticket-service', 'payment-service', 'ledger-service', 'gateway']) {
    const c = podSpec(named(docs, 'Deployment', name)).containers[0];
    assert.equal(c.livenessProbe.httpGet.path, '/health/live', name);
    assert.equal(c.readinessProbe.httpGet.path, '/health/ready', name);
  }
  const web = podSpec(named(docs, 'Deployment', 'web')).containers[0];
  assert.equal(web.livenessProbe.httpGet.path, '/healthz');
  assert.equal(web.readinessProbe.httpGet.path, '/healthz');
});

test('local overlay: gateway env and forbidden keys', { skip: !hasKubectl && SKIP }, () => {
  const { docs, text } = render('local');
  const env = envOf(podSpec(named(docs, 'Deployment', 'gateway')).containers[0]);
  assert.equal(env.TRUST_PROXY.value, '1');
  assert.equal(env.WEB_ORIGIN.value, 'http://localhost:8081');
  assert.equal(env.SWAGGER_ENABLED.value, 'true');
  assert.equal(env.ADMIN_PASSWORD_HASH_B64.valueFrom.secretKeyRef.name, 'eticket-secrets');
  assert.doesNotMatch(text, /RATE_LIMIT_WINDOW_MS/);
  assert.doesNotMatch(text, /ADMIN_PASSWORD_DEV/);
  assert.deepEqual(
    ofKind(docs, 'Secret'),
    [],
    'the Secret is created by apply-secrets.sh, never rendered',
  );
});

test(
  'local overlay: every Service is ClusterIP with the compose ports',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    const services = ofKind(docs, 'Service');
    for (const s of services)
      assert.equal(s.spec.type ?? 'ClusterIP', 'ClusterIP', s.metadata.name);
    const ports = Object.fromEntries(services.map((s) => [s.metadata.name, s.spec.ports[0].port]));
    assert.deepEqual(ports, {
      postgres: 5432,
      'ticket-service': 3001,
      'payment-service': 3002,
      'ledger-service': 3003,
      gateway: 3000,
      web: 8080,
    });
  },
);

test(
  'local overlay: ingress routes /api to the gateway with both middlewares and / to web without',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    const middlewares = 'eticketing-strip-api@kubernetescrd,eticketing-api-ratelimit@kubernetescrd';
    const routes = ofKind(docs, 'Ingress').map((ing) => {
      const [rule] = ing.spec.rules;
      assert.equal(ing.spec.rules.length, 1);
      assert.equal(rule.http.paths.length, 1);
      const [p] = rule.http.paths;
      return {
        path: p.path,
        backend: `${p.backend.service.name}:${p.backend.service.port.number}`,
        middlewares: ing.metadata.annotations['traefik.ingress.kubernetes.io/router.middlewares'],
      };
    });
    routes.sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(routes, [
      { path: '/', backend: 'web:8080', middlewares: undefined },
      { path: '/api', backend: 'gateway:3000', middlewares: middlewares },
    ]);
    const strip = named(docs, 'Middleware', 'strip-api');
    assert.equal(strip.apiVersion, 'traefik.io/v1alpha1');
    assert.deepEqual(strip.spec.stripPrefix.prefixes, ['/api']);
    const limit = named(docs, 'Middleware', 'api-ratelimit').spec.rateLimit;
    assert.deepEqual([limit.average, limit.burst, limit.period], [20, 50, '1s']);
    assert.equal(limit.sourceCriterion.ipStrategy.depth, 0);
    assert.equal(
      docs.some((d) => d.kind === 'Middleware' && d.metadata.name === 'security-headers'),
      false,
      'HSTS must not reach the plain-HTTP local overlay',
    );
  },
);

test(
  'local overlay: DB services run migrate before starting, as the owner role',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    for (const { service, schema, prefix } of SCHEMAS) {
      const spec = podSpec(named(docs, 'Deployment', service));
      const names = spec.initContainers.map((c) => c.name);
      assert.deepEqual(names, ['wait-postgres', 'migrate'], service);
      assert.equal(spec.initContainers[0].image, POSTGRES_IMAGE);
      const migrate = spec.initContainers[1];
      assert.equal(migrate.image, `eticketing/migrate-${schema}:local`);
      const env = envOf(migrate);
      assert.ok(
        env[`${prefix}_OWNER_PASSWORD`].valueFrom.secretKeyRef,
        `${service} owner password from Secret`,
      );
      assert.ok(env.MIGRATION_DATABASE_URL.value.includes(`$(${prefix}_OWNER_PASSWORD)`));
      assert.ok(env.MIGRATION_DATABASE_URL.value.endsWith(`?schema=${schema}`));
      const appEnv = envOf(spec.containers[0]);
      assert.equal(
        appEnv.DATABASE_URL.value,
        `postgresql://${schema}_app:$(${prefix}_APP_PASSWORD)@postgres:5432/eticketing?schema=${schema}`,
      );
      // A $(VAR) reference only expands when VAR is defined earlier in the same container.
      const order = spec.containers[0].env.map((e) => e.name);
      assert.ok(order.indexOf(`${prefix}_APP_PASSWORD`) < order.indexOf('DATABASE_URL'));
    }
    assert.equal(podSpec(named(docs, 'Deployment', 'gateway')).initContainers, undefined);
  },
);

test('local overlay: no literal secret in any env value', { skip: !hasKubectl && SKIP }, () => {
  const { docs } = render('local');
  const containers = [
    ...workloads(docs).flatMap((w) => [
      ...podSpec(w).containers,
      ...(podSpec(w).initContainers ?? []),
    ]),
    ...podSpec(ofKind(docs, 'CronJob')[0].spec.jobTemplate).containers,
  ];
  for (const c of containers) {
    for (const e of c.env ?? []) {
      if (/PASSWORD|SECRET|API_KEY|HASH|ADMIN_EMAIL/.test(e.name)) {
        assert.ok(e.valueFrom?.secretKeyRef, `${c.name}/${e.name} must come from a Secret`);
        assert.equal(e.value, undefined, `${c.name}/${e.name} has a literal value`);
      }
      if (e.value !== undefined && /:\/\/[^/]*@/.test(e.value)) {
        assert.match(
          e.value,
          /:\/\/[a-z_]+:\$\([A-Z_]+\)@/,
          `${c.name}/${e.name} password must be a $(VAR) reference`,
        );
      }
    }
  }
});

test(
  'local overlay: images are local, never pulled; every workload secret key is an allow-listed name',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    const names = new Set();
    for (const w of ofKind(docs, 'Deployment')) {
      const spec = podSpec(w);
      for (const c of [...spec.containers, ...(spec.initContainers ?? [])]) {
        if (c.image.startsWith('postgres:')) continue;
        assert.match(c.image, /^eticketing\/[a-z-]+:local$/, c.name);
        assert.equal(c.imagePullPolicy, 'Never', `${w.metadata.name}/${c.name}`);
      }
    }
    for (const w of [...workloads(docs), ofKind(docs, 'CronJob')[0]]) {
      const spec = w.kind === 'CronJob' ? podSpec(w.spec.jobTemplate) : podSpec(w);
      for (const c of [...spec.containers, ...(spec.initContainers ?? [])]) {
        for (const e of c.env ?? [])
          if (e.valueFrom?.secretKeyRef) {
            assert.equal(e.valueFrom.secretKeyRef.name, 'eticket-secrets');
            names.add(e.valueFrom.secretKeyRef.key);
          }
      }
    }
    assert.deepEqual([...names].sort(), [
      'ADMIN_EMAIL',
      'ADMIN_PASSWORD_HASH_B64',
      'INTERNAL_API_KEY_LEDGER',
      'INTERNAL_API_KEY_TICKET',
      'JWT_SECRET',
      'LEDGER_APP_PASSWORD',
      'LEDGER_OWNER_PASSWORD',
      'PAYMENTS_APP_PASSWORD',
      'PAYMENTS_OWNER_PASSWORD',
      'POSTGRES_PASSWORD',
      'PUBLIC_API_KEY_LEDGER',
      'PUBLIC_API_KEY_PAYMENT',
      'PUBLIC_API_KEY_TICKET',
      'TICKETS_APP_PASSWORD',
      'TICKETS_OWNER_PASSWORD',
    ]);
  },
);

test(
  'local overlay: postgres storage, bootstrap script and backup job',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    const sts = named(docs, 'StatefulSet', 'postgres');
    assert.equal(sts.spec.serviceName, 'postgres');
    const claim = sts.spec.volumeClaimTemplates[0].spec;
    assert.equal(claim.storageClassName, 'local-path');
    assert.equal(claim.resources.requests.storage, '10Gi');
    const mount = sts.spec.template.spec.containers[0].volumeMounts.find(
      (m) => m.mountPath === '/docker-entrypoint-initdb.d',
    );
    assert.equal(mount.readOnly, true);
    const cm = named(docs, 'ConfigMap', 'postgres-initdb');
    assert.equal(
      cm.data['00-roles.sh'],
      readFileSync(join(k8sDir, '../postgres/init/00-roles.sh'), 'utf8'),
    );
    const cron = ofKind(docs, 'CronJob')[0];
    assert.equal(cron.spec.schedule, '0 3 * * *');
    assert.equal(cron.spec.concurrencyPolicy, 'Forbid');
    const script = cron.spec.jobTemplate.spec.template.spec.containers[0].command.join(' ');
    assert.match(script, /pg_dump .*-Fc/);
    assert.match(script, /tail -n \+8/);
    assert.equal(cron.spec.jobTemplate.spec.template.spec.containers[0].image, POSTGRES_IMAGE);
    assert.equal(
      named(docs, 'PersistentVolumeClaim', 'backups').spec.storageClassName,
      'local-path',
    );
  },
);

test('every namespaced object lands in eticketing', { skip: !hasKubectl && SKIP }, () => {
  const { docs } = render('local');
  for (const d of docs) {
    if (d.kind === 'Namespace') assert.equal(d.metadata.name, 'eticketing');
    else assert.equal(d.metadata.namespace, 'eticketing', `${d.kind}/${d.metadata.name}`);
  }
});

test(
  'prod overlay: pinned tag, host, TLS resolver, no swagger',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs, text } = renderProdSample();
    for (const w of ofKind(docs, 'Deployment')) {
      const spec = podSpec(w);
      for (const c of [...spec.containers, ...(spec.initContainers ?? [])]) {
        if (c.image.startsWith('postgres:')) continue;
        assert.ok(c.image.startsWith(IMAGE_BASE), c.image);
        assert.ok(c.image.endsWith(':sha-abc1234'), c.image);
        assert.equal(c.imagePullPolicy, undefined);
      }
    }
    assert.doesNotMatch(text, /:latest\b/);
    const gateway = envOf(podSpec(named(docs, 'Deployment', 'gateway')).containers[0]);
    assert.equal(gateway.WEB_ORIGIN.value, 'https://demo.example.org');
    assert.equal(gateway.TRUST_PROXY.value, '1');
    for (const { service } of SCHEMAS) {
      assert.equal(
        envOf(podSpec(named(docs, 'Deployment', service)).containers[0]).SWAGGER_ENABLED.value,
        'false',
        service,
      );
    }
    assert.equal(gateway.SWAGGER_ENABLED.value, 'false');
    const ingresses = ofKind(docs, 'Ingress');
    assert.equal(ingresses.length, 2);
    for (const ing of ingresses) {
      assert.equal(ing.spec.rules[0].host, 'demo.example.org');
      assert.deepEqual(ing.spec.tls, [{ hosts: ['demo.example.org'] }]);
      assert.equal(
        ing.metadata.annotations['traefik.ingress.kubernetes.io/router.tls.certresolver'],
        'le',
      );
      assert.equal(
        ing.metadata.annotations['traefik.ingress.kubernetes.io/router.entrypoints'],
        'websecure',
      );
    }
    assert.match(
      named(docs, 'Ingress', 'api').metadata.annotations[
        'traefik.ingress.kubernetes.io/router.middlewares'
      ],
      /eticketing-strip-api@kubernetescrd,eticketing-api-ratelimit@kubernetescrd/,
    );
    assert.equal(
      named(docs, 'Ingress', 'web').metadata.annotations[
        'traefik.ingress.kubernetes.io/router.middlewares'
      ],
      'eticketing-security-headers@kubernetescrd',
    );
    const hsts = named(docs, 'Middleware', 'security-headers');
    assert.equal(hsts.metadata.namespace, 'eticketing');
    assert.deepEqual(hsts.spec.headers, {
      stsSeconds: 15552000,
      stsIncludeSubdomains: false,
      stsPreload: false,
      forceSTSHeader: false,
    });
    assert.doesNotMatch(
      named(docs, 'Ingress', 'api').metadata.annotations[
        'traefik.ingress.kubernetes.io/router.middlewares'
      ],
      /security-headers/,
    );
  },
);

test('Traefik HelmChartConfig keeps the client IP and issues certificates', () => {
  const text = renderHelmChartConfig({ acmeEmail: 'ops@example.org' });
  const [doc] = parseAllYaml(text);
  assert.equal(doc.kind, 'HelmChartConfig');
  assert.equal(doc.metadata.name, 'traefik');
  assert.equal(doc.metadata.namespace, 'kube-system');
  const values = parseYaml(doc.spec.valuesContent);
  assert.equal(values.service.spec.externalTrafficPolicy, 'Local');
  assert.deepEqual(values.ports.web.http.redirections.entryPoint, {
    to: 'websecure',
    scheme: 'https',
    permanent: true,
  });
  assert.equal(values.ports.web.redirections, undefined, 'old key is ignored by chart 41.x');
  assert.equal(values.persistence.enabled, true);
  assert.equal(values.persistence.path, '/data');
  assert.equal(values.podSecurityContext.fsGroup, 65532);
  const acme = values.certificatesResolvers.le.acme;
  assert.equal(acme.email, 'ops@example.org');
  assert.ok(
    acme.storage.startsWith(`${values.persistence.path}/`),
    'acme.json lives on the persistent path',
  );
  assert.equal(acme.httpChallenge.entryPoint, 'web');
});

test(
  'rendered ConfigMap keeps 00-roles.sh intact through the parser',
  { skip: !hasKubectl && SKIP },
  () => {
    const { docs } = render('local');
    const cm = named(docs, 'ConfigMap', 'postgres-initdb');
    assert.equal(
      cm.data['00-roles.sh'],
      readFileSync(join(k8sDir, '../postgres/init/00-roles.sh'), 'utf8'),
    );
  },
);

test('renderProd output matches what the CLI writes (sanity)', () => {
  assert.match(renderProd({ host: 'demo.example.org', tag: 'sha-abc1234' }), /sha-abc1234/);
});
