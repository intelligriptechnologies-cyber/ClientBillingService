import { redirect } from 'next/navigation';
import { DemoLogin } from '@/components/demo-login';
import { isDemoMode } from '@/lib/auth/demo-mode';
import { currentPrincipal } from '@/lib/auth/page-principal';

export default async function Home() {
  const principal = await currentPrincipal();
  if (principal?.kind === 'platform' || principal?.kind === 'member') redirect('/dashboard');
  if (principal?.kind === 'chooseTenant') redirect('/select-tenant');
  if (isDemoMode()) return <DemoLogin />;
  return <main className="login-page"><section className="login-card"><p className="eyebrow">Client Billing Service</p><h1>No billing access yet</h1><p className="subtle">Your Authelia sign-in worked, but no tenant has given this account access. Ask a tenant admin to add your email.</p></section></main>;
}
