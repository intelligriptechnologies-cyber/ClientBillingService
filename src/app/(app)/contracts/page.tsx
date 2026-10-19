import { ContractRegister } from '@/components/contract-register';
import { memberPage } from '@/lib/auth/page-principal';

export default async function ContractsPage() {
  const member = await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Tenant billing</p><h1>Contracts</h1><p className="subtle">Manage recurring billing commitments, schedules, renewal terms, and security deposits for {member.tenantName}.</p></div></header><ContractRegister /></section>;
}
