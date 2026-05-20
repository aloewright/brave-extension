// Tests don't run inside workerd, so `cloudflare:workers` doesn't exist.
// Vitest's resolve.alias maps the import to this file. We only need to
// expose names the worker source touches — the test surface never *runs* a
// workflow, only the pure runIngest pipeline that lives next to it.

export class WorkflowEntrypoint<_E = unknown, _P = unknown> {
  protected env: unknown
  constructor(_ctx: unknown, env: unknown) {
    this.env = env
  }
  async run(_event: unknown, _step: unknown): Promise<unknown> {
    throw new Error("WorkflowEntrypoint.run not callable in tests")
  }
}

export interface WorkflowEvent<T> {
  payload: T
}

export interface WorkflowStep {
  do: <R>(name: string, fn: () => Promise<R>) => Promise<R>
}
