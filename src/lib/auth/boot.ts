import { parseAuthConfig } from './config';

export function checkAuthConfigAtBoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exit: (code: number) => never = process.exit,
  log: (message: string) => void = console.error,
): void {
  const result = parseAuthConfig(env);
  if (result.ok) return;
  log(`Refusing to start: ${result.reason}`);
  exit(1);
}
