import { DEFAULT_SERVER, getServer, getToken, serverItem } from '../../src/config.js';

const server = document.getElementById('server') as HTMLInputElement | null;
const token = document.getElementById('token') as HTMLInputElement | null;
const save = document.getElementById('save');
const note = document.getElementById('note');

async function load(): Promise<void> {
  if (server !== null) server.value = await getServer();
  if (token !== null) token.value = await getToken();
}

save?.addEventListener('click', () => {
  void (async () => {
    const value = server?.value.trim() ?? '';
    await serverItem.setValue(value === '' ? DEFAULT_SERVER : value);
    if (note !== null) note.textContent = 'Saved.';
  })();
});

void load();
