import {
  DEFAULT_SERVER,
  getServer,
  getToken,
  serverItem,
  tokenItem,
} from '../../src/config.js';

const server = document.getElementById('server') as HTMLInputElement | null;
const token = document.getElementById('token') as HTMLInputElement | null;
const save = document.getElementById('save');
const regenerate = document.getElementById('regenerate');
const note = document.getElementById('note');

/** Make a new token. The shape matches the token in the shared config. */
function makeToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Turn a failure into short text for the page. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write the result of the last action. */
function report(message: string, failed: boolean): void {
  if (note === null) return;
  note.textContent = message;
  note.classList.toggle('error', failed);
}

async function load(): Promise<void> {
  try {
    if (server !== null) server.value = await getServer();
    if (token !== null) token.value = await getToken();
  } catch (error) {
    report(`Load failed: ${errorText(error)}`, true);
  }
}

save?.addEventListener('click', () => {
  void (async () => {
    const address = server?.value.trim() ?? '';
    const next = address === '' ? DEFAULT_SERVER : address;
    try {
      await serverItem.setValue(next);
      // The token field is read only. Save its value as well. The companion
      // needs the same token that this page shows.
      if (token !== null) await tokenItem.setValue(token.value.trim());
      if (server !== null) server.value = next;
      report('Saved.', false);
    } catch (error) {
      report(`Save failed: ${errorText(error)}`, true);
    }
  })();
});

regenerate?.addEventListener('click', () => {
  void (async () => {
    const made = makeToken();
    try {
      await tokenItem.setValue(made);
      if (token !== null) token.value = made;
      report('New token saved.', false);
    } catch (error) {
      report(`Regenerate failed: ${errorText(error)}`, true);
    }
  })();
});

void load();
