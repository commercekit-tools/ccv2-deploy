import { redactTransportText } from "@commercekit-tools/ccv2-client";
import {
  sanitizeBoundedText,
  stripAngleBracketText,
  redactJwtLikeTokens,
  sanitizeErrorMessage,
  redactKnownSecrets,
} from "@commercekit-tools/notification-contract";
export class Sanitizer {
  private secrets = new Set<string>();
  constructor(private mask: (value: string) => void) {}
  add(value: string) {
    if (!value) return;
    this.mask(value);
    this.secrets.add(value);
  }
  text(value: string, max = 1000): string {
    // Keep Deploy's plain-text/URL/JWT disclosure policy atop shared redaction.
    const text = redactJwtLikeTokens(
      stripAngleBracketText(redactTransportText(value, [...this.secrets])),
    );
    return text.trim()
      ? sanitizeBoundedText(
          sanitizeErrorMessage(text, [...this.secrets]),
          max,
        ).trim()
      : "";
  }
  error(value: string): string {
    return this.text(value) || sanitizeErrorMessage("");
  }
  contains(value: string): boolean {
    return redactKnownSecrets(value, [...this.secrets]) !== value;
  }
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
