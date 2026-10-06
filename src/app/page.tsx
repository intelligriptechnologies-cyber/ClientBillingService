import { redirect } from 'next/navigation';
import { DemoLogin } from '@/components/demo-login';
import { getCurrentSession } from '@/lib/session';

export default async function Home() {
  if (await getCurrentSession()) redirect('/dashboard');
  return <DemoLogin />;
}
