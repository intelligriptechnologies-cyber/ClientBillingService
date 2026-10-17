import { redirect } from 'next/navigation';
import { DemoLogin } from '@/components/demo-login';
import { isDemoMode } from '@/lib/auth/demo-mode';
import { getCurrentSession } from '@/lib/session';

export default async function Home() {
  if (await getCurrentSession()) redirect('/dashboard');
  if (!isDemoMode()) return <main className="login-page"><section className="login-card"><p className="eyebrow">Client Billing Service</p><h1>No billing access yet</h1><p className="subtle">Your Authelia sign-in worked, but tenant access is not set up in this build.</p></section></main>;
  return <DemoLogin />;
}
