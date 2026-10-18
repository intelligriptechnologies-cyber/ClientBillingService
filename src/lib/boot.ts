import { parseAuthConfig } from './auth/config';
import { parseStoreConfig } from './store/config';

/** Exits before the server takes a request when sign-in (ADR 0002) or the store (ADR 0001) is not configured, sign-in first. */
export function checkConfigAtBoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exit: (code: number) => never = process.exit,
  log: (message: string) => void = console.error,
): void {
  for (const parse of [parseAuthConfig, parseStoreConfig]) {
    const result = parse(env);
    if (result.ok) continue;
    log(`Refusing to start: ${result.reason}`);
    exit(1);
    return;
  }
}
