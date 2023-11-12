/**
 * Custom error class for the application.
 * It is used to distinguish errors from the application and errors from the dependencies, uncaught errors, etc.
 */
export class AppError extends Error {
  constructor(message: string | undefined) {
    super(message);
    this.name = "AppError";
  }
}
