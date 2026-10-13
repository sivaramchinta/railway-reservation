import { SignInRequestSchema } from '@railway/shared';
import { prisma } from '../db';
import { findUserById, upsertUserByEmail, type UserRecord } from '../repositories/userRepository';
import { parseOrThrow } from './validation';

/** Demo-grade sign-in by email (DESIGN_SPEC §1): creates the user on first use. */
export async function signIn(input: unknown): Promise<UserRecord> {
  const { email } = parseOrThrow(SignInRequestSchema, input, 'Invalid sign-in request');
  return upsertUserByEmail(prisma, email);
}

export async function findUser(id: number): Promise<UserRecord | null> {
  return findUserById(prisma, id);
}
