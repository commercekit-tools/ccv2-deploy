import type { Inputs } from "./inputs.js";
import type { Sanitizer } from "./security.js";
import { Http } from "./http.js";
import { ActionError, invalidResponse } from "./errors.js";
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}
export class TokenManager {
  private token = "";
  private expires = 0;
  constructor(
    private inputs: Inputs,
    private http: Http,
    private safe: Sanitizer,
  ) {}
  async get(force = false): Promise<string> {
    if (!force && this.token && this.http.rt.now() < this.expires)
      return this.token;
    const started = this.http.rt.now();
    const reply = await this.http.safeRequest(this.inputs.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.inputs.clientId,
        client_secret: this.inputs.clientSecret,
        grant_type: "client_credentials",
        resource: this.inputs.resource,
      }).toString(),
    });
    if (reply.status !== 200)
      throw new ActionError(
        [400, 401, 403].includes(reply.status)
          ? "AUTHENTICATION_FAILED"
          : "TOKEN_REQUEST_FAILED",
        "Technical-user authentication failed.",
        reply.status,
      );
    const {
      access_token: token,
      token_type: type,
      expires_in: expiry,
    } = reply.body as Record<string, unknown>;
    if (typeof token === "string") this.safe.add(token);
    if (
      typeof token !== "string" ||
      !token.trim() ||
      token.length > 32768 ||
      /\s/.test(token) ||
      typeof type !== "string" ||
      type.toLowerCase() !== "bearer" ||
      (expiry !== undefined &&
        (!Number.isSafeInteger(expiry) || Number(expiry) <= 0))
    )
      throw invalidResponse();
    this.token = token;
    // Missing expiry: refresh on 401; never request a fresh token for every poll.
    this.expires =
      expiry === undefined
        ? Infinity
        : started +
          Math.max(
            0,
            Number(expiry) * 1000 - Math.min(60000, Number(expiry) * 100),
          );
    return token;
  }
}
