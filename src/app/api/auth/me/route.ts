import { readAuthConfig } from '@/lib/auth/config';
import { parseForwardedIdentity } from '@/lib/auth/forwarded';
import { passwordIdentity } from '@/lib/auth/password';

// Shows what the forwarded headers resolve to. Group membership is not mapped to a tenant yet (ADR 0002, unit A7).
export function GET(request: Request) {
  const result = readAuthConfig();
  if (result.ok && result.config.mode === 'password') {
    const user = passwordIdentity(result.config.usersFile, request.headers);
    if (!user) return Response.json({ message: 'Unauthorized.' }, { status: 401 });
    return Response.json({ identity: { username: user.username, email: user.email, name: user.name } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!result.ok || result.config.mode !== 'authelia') return Response.json({ message: 'Not found.' }, { status: 404 });
  const parsed = parseForwardedIdentity(request.headers, result.config);
  if (!parsed.ok) return Response.json({ message: parsed.reason }, { status: parsed.status });
  return Response.json({ principal: parsed.access, identity: parsed.identity });
}
