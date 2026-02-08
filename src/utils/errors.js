/**
 * Error Handling Utilities
 * Provides utilities for formatting and handling errors from Ink compilation
 */

/**
 * Formats an error object to a readable string
 * @param {string|Object} error - The error to format
 * @returns {string} A human-readable error message
 */
export function formatError(error) {
  if (typeof error === 'string') {
    return error;
  }

  // Handle error objects with various properties
  if (error && typeof error === 'object') {
    const parts = [];

    // Add line number if available
    if (error.lineNumber !== undefined) {
      parts.push(`Line ${error.lineNumber}`);
    }

    // Add error type if available
    if (error.type) {
      parts.push(`[${error.type}]`);
    }

    // Add the message
    const message = error.message || error.text || String(error);
    parts.push(message);

    return parts.join(' ');
  }

  return String(error);
}

/**
 * Creates an error handler function for Ink compilation
 * @returns {Object} Object containing the handler function and arrays for errors/warnings
 */
export function createErrorHandler() {
  const collectedErrors = [];
  const collectedWarnings = [];

  const handler = (message, type) => {
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
