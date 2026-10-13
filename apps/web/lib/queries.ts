'use client';

import {
  type BookingDto,
  BookingDtoSchema,
  ChartDtoSchema,
  ChartSummaryDtoSchema,
  type CreateBookingRequest,
  RunSummaryDtoSchema,
  SessionDtoSchema,
} from '@railway/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, apiRequest, apiRequestNoContent } from './api';

/** Status and "My bookings" are polled (DESIGN_SPEC §11). */
const POLL_MS = 5000;

export const queryKeys = {
  run: ['run'],
  session: ['session'],
  bookings: ['bookings'],
  booking: (pnr: string) => ['bookings', pnr],
  chart: ['chart'],
} as const;

export function useRun() {
  return useQuery({
    queryKey: queryKeys.run,
    queryFn: () => apiRequest('/run', RunSummaryDtoSchema),
    refetchInterval: POLL_MS,
  });
}

/** The signed-in user, or null when signed out (401 is a normal answer here). */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => {
      try {
        return await apiRequest('/session', SessionDtoSchema);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
  });
}

export function useMyBookings(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.bookings,
    queryFn: () => apiRequest('/bookings', z.array(BookingDtoSchema)),
    refetchInterval: POLL_MS,
    enabled,
  });
}

export function useBooking(pnr: string) {
  return useQuery({
    queryKey: queryKeys.booking(pnr),
    queryFn: () => apiRequest(`/bookings/${encodeURIComponent(pnr)}`, BookingDtoSchema),
    refetchInterval: POLL_MS,
    retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
  });
}

export function useChart(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chart,
    queryFn: () => apiRequest('/admin/chart', ChartDtoSchema),
    refetchInterval: POLL_MS,
    enabled,
  });
}

/** After any change, refresh everything that may have moved. */
function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

export function useSignIn() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: (email: string) =>
      apiRequest('/session', SessionDtoSchema, { method: 'POST', body: { email } }),
    onSuccess: invalidateAll,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequestNoContent('/session', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.clear(); // drop the previous user's cached bookings
    },
  });
}

export function useCreateBooking() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      request,
      idempotencyKey,
    }: {
      request: CreateBookingRequest;
      idempotencyKey: string;
    }) =>
      apiRequest('/bookings', BookingDtoSchema, {
        method: 'POST',
        body: request,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: invalidateAll,
  });
}

export function useCancelBooking() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: (pnr: string): Promise<BookingDto> =>
      apiRequest(`/bookings/${encodeURIComponent(pnr)}/cancel`, BookingDtoSchema, {
        method: 'POST',
      }),
    onSuccess: invalidateAll,
  });
}

export function useOpenWindow() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => apiRequest('/admin/window/open', RunSummaryDtoSchema, { method: 'POST' }),
    onSuccess: invalidateAll,
  });
}

export function useCloseWindow() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => apiRequest('/admin/window/close', RunSummaryDtoSchema, { method: 'POST' }),
    onSuccess: invalidateAll,
  });
}

export function usePrepareChart() {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => apiRequest('/admin/chart/prepare', ChartSummaryDtoSchema, { method: 'POST' }),
    onSuccess: invalidateAll,
  });
}
