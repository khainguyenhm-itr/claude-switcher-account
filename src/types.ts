export interface AccountMeta {
  name: string;
  email: string;
  displayName?: string;
  organizationName?: string;
  fingerprint: string;
  savedAt: string;
  oauthAccount?: Record<string, unknown>;
}

export interface AccountView {
  name: string;
  email: string;
  displayName?: string;
  organizationName?: string;
  savedAt: string;
  active: boolean;
}

export interface OauthLabel {
  email: string;
  displayName?: string;
  organizationName?: string;
}

export interface StoreData {
  lastActive?: string;
  accounts: AccountMeta[];
}

export type LogoutBehavior = 'delete-switch' | 'keep-switch' | 'keep' | 'none';

export interface Config {
  logoutBehavior: LogoutBehavior;
}

export interface CredentialStore {
  isAvailable(): boolean;
  readCanonical(): Promise<string>; // '' when no login
  writeCanonical(blob: string): Promise<void>;
  readSaved(name: string): Promise<string>; // '' when not found
  writeSaved(name: string, blob: string): Promise<void>;
  deleteSaved(name: string): Promise<void>;
}
