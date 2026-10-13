import type { TxClient } from '../db';

export interface UserRecord {
  id: number;
  email: string;
}

/** Creates the user on first sign-in; returns the existing one afterwards. */
export async function upsertUserByEmail(tx: TxClient, email: string): Promise<UserRecord> {
  return tx.appUser.upsert({
    where: { email },
    create: { email },
    update: {},
    select: { id: true, email: true },
  });
}

export async function findUserById(tx: TxClient, id: number): Promise<UserRecord | null> {
  return tx.appUser.findUnique({ where: { id }, select: { id: true, email: true } });
}
