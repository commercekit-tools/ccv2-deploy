import { setTimeout as sleep } from "node:timers/promises";
import { ActionError, invalidResponse } from "./errors.js";
export interface Runtime {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
}
export const runtime: Runtime = {
  fetch: (...args) => fetch(...args),
  now: () => performance.now(),
  sleep: async (ms, signal) => {
    await sleep(ms, undefined, { signal });
  },
  random: Math.random,
};
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const n = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
export interface Reply {
  status: number;
  body: unknown;
  retryAfterMs: number;
}
export class Http {
  retryCount = 0;
  constructor(
    public rt: Runtime,
    public signal: AbortSignal,
  ) {}
  async once(url: string, init: RequestInit): Promise<Reply> {
    this.signal.throwIfAborted();
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(30000)]);
    try {
      const response = await this.rt.fetch(url, {
        ...init,
        redirect: "error",
        signal,
      });
      const reader = response.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 262144) throw invalidResponse();
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
      }
      let body: unknown = {};
      try {
        body =
          size === 0 && [202, 204].includes(response.status)
            ? {}
            : JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        if (response.ok) throw invalidResponse();
      }
      if (!body || typeof body !== "object") {
        if (response.ok) throw invalidResponse();
        body = {};
      }
      return {
        status: response.status,
        body,
        retryAfterMs: retryAfter(response.headers.get("retry-after")),
      };
    } catch (error) {
      this.signal.throwIfAborted();
      if (error instanceof ActionError) throw error;
      throw new ActionError(
        "REQUEST_FAILED",
        "The API request could not be completed.",
      );
    }
  }
  async safeRequest(url: string, init: RequestInit): Promise<Reply> {
    for (let attempt = 0; ; attempt++) {
      let reply: Reply | undefined;
      try {
        reply = await this.once(url, init);
      } catch (error) {
        if (
          !(error instanceof ActionError) ||
          error.code !== "REQUEST_FAILED" ||
          attempt === 2
        )
          throw error;
      }
      if (reply && ![429, 500, 502, 503, 504].includes(reply.status))
        return reply;
      if (attempt === 2) return reply!;
      this.retryCount++;
      await this.rt.sleep(
        Math.max(
          reply?.retryAfterMs ?? 0,
          1000 * 2 ** attempt + Math.floor(this.rt.random() * 250),
        ),
        this.signal,
      );
    }
  }
}
