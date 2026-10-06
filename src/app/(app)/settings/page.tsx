'use client';

import { FormEvent, useState } from 'react';
import { PageTitle } from '@/components/ui';
import { useBilling } from '@/state/billing-store';

export default function Settings() {
  const { settings, role, updateSettings } = useBilling(); const [message, setMessage] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const result = await updateSettings({ businessName: String(data.get('name')), currencyCode: String(data.get('currency')).toUpperCase(), invoiceNumberPrefix: String(data.get('prefix')).toUpperCase(), defaultPaymentTermsDays: Number(data.get('terms')) }); setMessage(result ?? 'Settings saved.'); };
  if (role !== 'admin') return <section className="page"><PageTitle eyebrow="Administration" title="Settings"/><p className="notice">Settings are available to the admin role only. Switch roles in the navigation to review this prototype screen.</p></section>;
  return <section className="page"><PageTitle eyebrow="Administration" title="Billing settings"/><form className="panel" style={{ padding: 20, maxWidth: 720 }} onSubmit={submit}><div className="form-grid"><div className="field"><label htmlFor="settings-name">Business name</label><input id="settings-name" className="input" name="name" defaultValue={settings.businessName} required/></div><div className="field"><label htmlFor="settings-currency">Currency code</label><input id="settings-currency" className="input" name="currency" defaultValue={settings.currencyCode} maxLength={3} required/></div><div className="field"><label htmlFor="settings-prefix">Invoice number prefix</label><input id="settings-prefix" className="input" name="prefix" defaultValue={settings.invoiceNumberPrefix} required/></div><div className="field"><label htmlFor="settings-terms">Default payment terms (days)</label><input id="settings-terms" className="input" name="terms" type="number" min="0" defaultValue={settings.defaultPaymentTermsDays} required/></div></div>{message && <p className="notice" role="status">{message}</p>}<button className="button button-primary" style={{ marginTop: 18 }}>Save settings</button></form></section>;
}
