export class ActionError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "ActionError";
  }
}
export const invalidResponse = () =>
  new ActionError(
    "INVALID_API_RESPONSE",
    "The API returned an invalid response.",
  );
export const waitTimeout = () =>
  new ActionError(
    "DEPLOYMENT_WAIT_TIMEOUT",
    "The Action stopped waiting. The remote deployment may still continue.",
  );
