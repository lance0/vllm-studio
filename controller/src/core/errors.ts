/**
 * HTTP status failure with payload details.
 */
export class HttpStatus extends Error {
  public readonly status: number;
  public readonly detail: string;

  /**
   * Create an HTTP status error.
   * @param status - HTTP status code.
   * @param detail - Error detail message.
   */
  public constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Check whether a value is an HttpStatus instance.
 * @param value - Unknown error value.
 * @returns True if value is HttpStatus.
 */
export const isHttpStatus = (value: unknown): value is HttpStatus =>
  value instanceof HttpStatus;

/**
 * Create a not-found HttpStatus error.
 * @param detail - Error detail message.
 * @returns HttpStatus instance.
 */
export const notFound = (detail: string): HttpStatus => new HttpStatus(404, detail);

/**
 * Create a bad-request HttpStatus error.
 * @param detail - Error detail message.
 * @returns HttpStatus instance.
 */
export const badRequest = (detail: string): HttpStatus => new HttpStatus(400, detail);

/**
 * Create a service-unavailable HttpStatus error.
 * @param detail - Error detail message.
 * @returns HttpStatus instance.
 */
export const serviceUnavailable = (detail: string): HttpStatus => new HttpStatus(503, detail);

/**
 * Safely extract error message from unknown error type.
 * Handles Error objects, strings, and other thrown values.
 * @param error - Unknown error value.
 * @returns Error message string.
 */
export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
};
