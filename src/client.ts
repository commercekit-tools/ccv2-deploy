import {
  createCcv2Client,
  TechnicalUserTokenManager,
  Ccv2TransportError,
  type Ccv2RequestOptions,
  type Ccv2Response,
} from "@commercekit-tools/ccv2-client";
import type { Inputs } from "./inputs.js";
import type { Runtime } from "./runtime.js";
import type { Sanitizer } from "./security.js";
import { ActionError, invalidResponse, waitTimeout } from "./errors.js";

// Only Action error translation and dependency wiring live here; all transport/auth
// behavior is owned by the pinned, framework-independent package.
export class DeployClient {
  readonly tokens: TechnicalUserTokenManager;
  private readonly shared;
  private authenticationFailure: unknown;
  constructor(
    public rt: Runtime,
    public signal: AbortSignal,
    input: Inputs,
    safe: Sanitizer,
    onProgress: () => void = () => {},
  ) {
    // Shared Retry-After dates need epoch time; the Action retains a monotonic clock.
    const epoch = Date.now() - rt.now();
    const dependencies: Runtime = {
      ...rt,
      now: () => epoch + rt.now(),
      fetch: (...args) => rt.fetch(...args),
      maskSecret: (value) => safe.add(value),
    };
    this.tokens = new TechnicalUserTokenManager(
      {
        tokenEndpoint: input.tokenEndpoint,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        resource: input.resource,
      },
      {
        runtime: dependencies,
        retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
      },
    );
    this.shared = createCcv2Client({
      baseUrl: input.apiBaseUrl,
      tokens: {
        invalidate: () => this.tokens.invalidate(),
        get: async (signal) => {
          try {
            return await this.tokens.get(signal);
          } catch (error) {
            this.authenticationFailure = error;
            throw error;
          }
        },
      },
      runtime: {
        ...dependencies,
        fetch: (...args) => {
          if (new URL(String(args[0])).pathname.endsWith("/progress"))
            onProgress();
          return rt.fetch(...args);
        },
      },
      secrets: [
        input.tokenEndpoint,
        input.clientId,
        input.clientSecret,
        input.resource,
      ],
    });
  }
  async authenticate() {
    try {
      return await this.tokens.get(this.signal);
    } catch (error) {
      throw this.authError(error);
    }
  }
  private authError(error: unknown): ActionError {
    this.signal.throwIfAborted();
    if (error instanceof Ccv2TransportError && error.code === "HTTP_ERROR")
      return new ActionError(
        [400, 401, 403].includes(error.status!)
          ? "AUTHENTICATION_FAILED"
          : "TOKEN_REQUEST_FAILED",
        "Technical-user authentication failed.",
        error.status,
      );
    return transportError(error);
  }
  async request(
    path: string,
    options: Ccv2RequestOptions,
  ): Promise<Ccv2Response> {
    this.authenticationFailure = undefined;
    try {
      return await this.shared.request(path, {
        ...options,
        signal: this.signal,
        timeoutMs: 30000,
        maxResponseBytes: 262144,
        retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
        refreshOn401: true,
      });
    } catch (error) {
      this.signal.throwIfAborted();
      if (this.authenticationFailure)
        throw this.authError(this.authenticationFailure);
      throw error;
    }
  }
}
export function transportError(error: unknown): ActionError {
  if (error instanceof Ccv2TransportError) {
    if (
      ["INVALID_RESPONSE", "RESPONSE_TOO_LARGE", "INVALID_TOKEN"].includes(
        error.code,
      )
    )
      return invalidResponse();
    if (error.code === "DEADLINE") return waitTimeout();
  }
  return new ActionError(
    "REQUEST_FAILED",
    "The API request could not be completed.",
  );
}
