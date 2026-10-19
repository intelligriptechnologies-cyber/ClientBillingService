import { AdditionalServicesRegister } from '@/components/additional-services-register';
import { memberPage } from '@/lib/auth/page-principal';

export default async function AdditionalServicesPage() {
  await memberPage();
  return <section className="page"><header className="page-heading"><div><p className="eyebrow">Contract billing</p><h1>Additional services</h1><p className="subtle">Record dated, contract-scoped charges for inclusion in the correct billing period.</p></div></header><AdditionalServicesRegister /></section>;
}
