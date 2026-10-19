import SettingsConsole from '@/components/settings-console';
import { memberPage } from '@/lib/auth/page-principal';

export default async function SettingsPage() {
  await memberPage({ admin: true });
  return <SettingsConsole />;
}
