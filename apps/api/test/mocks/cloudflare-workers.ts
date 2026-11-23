export class DurableObject<E = unknown> {
  protected ctx: DurableObjectState;
  protected env: E;
  constructor(ctx: DurableObjectState, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<E = unknown> {
  protected ctx: ExecutionContext;
  protected env: E;
  constructor(ctx: ExecutionContext, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}

export const env: Record<string, unknown> = {};
