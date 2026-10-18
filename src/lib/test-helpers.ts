import type { TenantSettings, TenantSettingsInput } from './tenant-store';

/** What a settings form sends back: the saved settings without the fields the server owns. */
export function settingsInput(settings: TenantSettings): TenantSettingsInput {
  const { updatedAt, stateCode, smtpPasswordSet, ...input } = settings;
  void [updatedAt, stateCode, smtpPasswordSet];
  return input;
}
