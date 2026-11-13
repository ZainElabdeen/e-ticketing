import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export type ServiceName = 'ticket-service';

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

interface Operation {
  operationId?: string;
  responses?: Record<string, { content?: { 'application/json'?: { schema?: object } } }>;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

export class ContractValidator {
  private readonly ajv = new Ajv({ strict: false, allErrors: true });
  private readonly compiled = new Map<string, ValidateFunction>();

  private constructor(private readonly operations: Map<string, Operation>) {
    addFormats(this.ajv);
  }

  static load(service: ServiceName): ContractValidator {
    const path = require.resolve(`@eticket/contracts/openapi/${service}.json`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const doc = require(path) as OpenApiDocument;
    const operations = new Map<string, Operation>();
    for (const item of Object.values(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method] as Operation | undefined;
        if (op?.operationId) {
          operations.set(op.operationId, op);
        }
      }
    }
    return new ContractValidator(operations);
  }

  /** Throws an Error listing Ajv errors if status is undocumented for the operation or the body fails its schema. */
  assertResponse(operationId: string, status: number, body: unknown): void {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new Error(`Unknown operationId "${operationId}"`);
    }
    const response = op.responses?.[String(status)];
    if (!response) {
      throw new Error(`${operationId}: status ${status} is not documented in the contract`);
    }
    const schema = response.content?.['application/json']?.schema;
    if (!schema) {
      return;
    }
    const key = `${operationId}:${status}`;
    let validate = this.compiled.get(key);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.compiled.set(key, validate);
    }
    if (!validate(body)) {
      throw new Error(
        `${operationId} ${status}: response body violates the contract: ${this.ajv.errorsText(validate.errors, { dataVar: 'body' })}`,
      );
    }
  }
}
