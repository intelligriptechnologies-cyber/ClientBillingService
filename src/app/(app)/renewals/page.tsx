import { RenewalDepositRegister } from '@/components/renewal-deposit-register';
import { memberPage } from '@/lib/auth/page-principal';

export default async function RenewalsPage() {
  const member = await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Contract follow-up</p><h1>Renewal Tracker</h1><p className="subtle">Track expiring contracts and renewals for {member.tenantName}.</p></div></header><RenewalDepositRegister /></section>;
}
