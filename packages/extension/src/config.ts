import { storage } from 'wxt/utils/storage';

/** The default address of the local companion. */
export const DEFAULT_SERVER = 'ws://127.0.0.1:4517';

/** The address of the local companion. */
export const serverItem = storage.defineItem<string>('local:server', {
  fallback: DEFAULT_SERVER,
});

/** The shared token. The companion checks it on every message. */
export const tokenItem = storage.defineItem<string>('local:token', {
  fallback: '',
});

/** Get the token. Make one if it is absent. */
export async function getToken(): Promise<string> {
  const saved = await tokenItem.getValue();
  if (saved) return saved;
  const made = crypto.randomUUID().replace(/-/g, '');
  await tokenItem.setValue(made);
  return made;
}

/** Get the address of the local companion. */
export async function getServer(): Promise<string> {
  const saved = await serverItem.getValue();
  return saved.trim() === '' ? DEFAULT_SERVER : saved.trim();
}
