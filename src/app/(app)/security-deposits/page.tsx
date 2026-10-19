import { RenewalDepositRegister } from '@/components/renewal-deposit-register';
import { memberPage } from '@/lib/auth/page-principal';

export default async function SecurityDepositsPage() {
  const member = await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Billing</p><h1>Security Deposits</h1><p className="subtle">Review and settle contract deposits for {member.tenantName}.</p></div></header><RenewalDepositRegister depositsOnly /></section>;
}
