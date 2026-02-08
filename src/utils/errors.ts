/**
 * Error Handling Utilities
 * Provides utilities for formatting and handling errors from Ink compilation
 */

interface InkError {
  lineNumber?: number;
  type?: string;
  message?: string;
  text?: string;
}

type ErrorInput = string | InkError | Error;

/**
 * Formats an error object to a readable string
 * @param error - The error to format
 * @returns A human-readable error message
 */
export function formatError(error: ErrorInput): string {
  if (typeof error === 'string') {
    return error;
  }

  // Handle error objects with various properties
  if (error && typeof error === 'object') {
    const parts: string[] = [];

    const inkError = error as InkError;

    // Add line number if available
    if (inkError.lineNumber !== undefined) {
      parts.push(`Line ${inkError.lineNumber}`);
    }

    // Add error type if available
    if (inkError.type) {
      parts.push(`[${inkError.type}]`);
    }

    // Add the message
    const message = inkError.message || inkError.text || String(error);
    parts.push(message);

    return parts.join(' ');
  }

  return String(error);
}

export interface ErrorHandler {
  handler: (message: ErrorInput, type?: string) => void;
  errors: string[];
  warnings: string[];
}

/**
 * Creates an error handler function for Ink compilation
 * @returns Object containing the handler function and arrays for errors/warnings
 */
export function createErrorHandler(): ErrorHandler {
  const collectedErrors: string[] = [];
  const collectedWarnings: string[] = [];

  const handler = (message: ErrorInput, type?: string): void => {
    const formattedMessage = formatError(message);
    if (type === 'WARNING' || type === 'warning') {
      collectedWarnings.push(formattedMessage);
    } else {
      collectedErrors.push(formattedMessage);
    }
  };

  return {
    handler,
    errors: collectedErrors,
    warnings: collectedWarnings
  };
}
