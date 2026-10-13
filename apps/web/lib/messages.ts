import { ApiError, type ClientErrorCode } from './api';

/** Stable error codes from the API → words for people (DESIGN_SPEC §11). */
export const ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  BOOKING_CLOSED: 'The booking window is closed.',
  CHART_LOCKED: 'The chart is prepared and locked; bookings can no longer change.',
  WINDOW_STILL_OPEN: 'Close the booking window before preparing the chart.',
  INVALID_WINDOW_TRANSITION: 'That action is not possible in the current state.',
  VALIDATION_FAILED: 'Please check the details you entered.',
  NOT_FOUND: 'Booking not found.',
  UNAUTHENTICATED: 'Please sign in.',
  FORBIDDEN: 'Only admins can do that.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  BAD_RESPONSE: 'The server sent an unexpected response. Please refresh.',
};

export function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? ERROR_MESSAGES[error.code]
    : 'Something went wrong. Please try again.';
}
