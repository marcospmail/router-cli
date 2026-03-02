import Conf from 'conf';

const config = new Conf({
  projectName: 'router-cli',
  schema: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
});

export interface Credentials {
  username: string;
  password: string;
}

export function getCredentials(): Credentials | undefined {
  const username = config.get('username') as string | undefined;
  const password = config.get('password') as string | undefined;
  if (!username || !password) return undefined;
  return { username, password };
}

export function saveCredentials(creds: Credentials): void {
  config.set('username', creds.username);
  config.set('password', creds.password);
}

export function clearCredentials(): void {
  config.delete('username');
  config.delete('password');
}
