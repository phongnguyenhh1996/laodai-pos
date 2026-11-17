import { LaodaiDB, META, getMeta, type Activation } from '@/sync/db';

export const localDb = new LaodaiDB();

export function getActivation(): Promise<Activation | undefined> {
  return getMeta<Activation>(localDb, META.activation);
}
