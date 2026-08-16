import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
} from '@simplewebauthn/browser';
import { auth, type Account, type SessionInfo } from './client';

/**
 * The browser side of the four ceremonies.
 *
 * Every call here is two round trips — options, then the signed response — and
 * the token that comes back never reaches this code: the console's server takes
 * it out of the reply and puts it in an HttpOnly cookie.
 */

export interface Credential {
  id: string;
  nickname: string | null;
  transports: string[];
  backedUp: boolean;
  backupEligible: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SignInResult {
  user: Account;
  recoveryCodes?: string[] | null;
}

export const supportsPasskeys = () => browserSupportsWebAuthn();
export const supportsAutofill = () => browserSupportsWebAuthnAutofill();

/**
 * Turn what the browser threw into something worth reading.
 *
 * The WebAuthn API reports almost everything as NotAllowedError — cancelled,
 * timed out, wrong authenticator, no credential — so the message has to cover
 * the cases without claiming to know which one happened.
 */
export function describeCeremonyError(error: unknown): string {
  const name = (error as { name?: string })?.name;

  if (name === 'NotAllowedError') {
    return 'The request was cancelled or timed out. Try again when the prompt appears.';
  }
  if (name === 'InvalidStateError') {
    return 'This device already holds a passkey for that account. Sign in with it instead.';
  }
  if (name === 'SecurityError') {
    return 'The browser refused the request for this address. The console has to be reached over https, on the domain its passkeys were registered for.';
  }
  if (name === 'AbortError') {
    return 'The request was cancelled.';
  }

  return (error as Error)?.message ?? 'The passkey request failed.';
}

/** Whether the installation still needs its first account. */
export const authState = () => auth.state();

/** The first administrator, gated by the setup password. */
export async function bootstrap(params: {
  username: string;
  displayName: string;
  setupPassword: string;
}): Promise<SignInResult> {
  const options = await auth.call<never>('POST', '/registration/options', params);
  const response = await startRegistration({ optionsJSON: options });

  return await auth.call<SignInResult>('POST', '/registration/verify', { response });
}

/** An invited account, completing its registration. */
export async function acceptInvite(inviteToken: string): Promise<SignInResult> {
  const options = await auth.call<never>('POST', '/registration/options', { inviteToken });
  const response = await startRegistration({ optionsJSON: options });

  return await auth.call<SignInResult>('POST', '/registration/verify', { response });
}

/**
 * Sign in.
 *
 * With `conditional` the request is handed to the browser's autofill: it does
 * not resolve until the user picks a passkey from the address bar's suggestion
 * list, and it never resolves on its own. Hence the AbortController the caller
 * has to hold — leaving one pending blocks the next request.
 */
export async function signIn(options?: {
  conditional?: boolean;
  signal?: AbortSignal;
}): Promise<SignInResult> {
  const optionsJSON = await auth.call<never>('POST', '/authentication/options', {});

  const response = await startAuthentication({
    optionsJSON,
    useBrowserAutofill: options?.conditional === true,
  });

  return await auth.call<SignInResult>('POST', '/authentication/verify', { response });
}

/** Spend a recovery code. The session it returns may only enroll a passkey. */
export async function recover(params: { username: string; code: string }) {
  return await auth.call<{ user: Account; scope: string; remaining: number }>(
    'POST',
    '/recovery/verify',
    params
  );
}

/** Add a passkey to the account this browser is already signed in as. */
export async function enrollPasskey(nickname?: string): Promise<SignInResult> {
  const options = await auth.call<never>('POST', '/credentials', { nickname });
  const response = await startRegistration({ optionsJSON: options });

  return await auth.call<SignInResult>('POST', '/registration/verify', { response, nickname });
}

export const listPasskeys = () => auth.call<{ credentials: Credential[] }>('GET', '/credentials');

export const renamePasskey = (id: string, nickname: string) =>
  auth.call<{ credential: Credential }>('PATCH', `/credentials/${id}`, { nickname });

export const deletePasskey = (id: string) =>
  auth.call<{ deleted: boolean }>('DELETE', `/credentials/${id}`);

export const reissueRecoveryCodes = () => auth.call<{ codes: string[] }>('POST', '/recovery/codes');

export const session = (): Promise<SessionInfo> => auth.session();

// ------------------------------------------------------------------ administration

export interface PersonRow {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  disabled_at: string | null;
  credential_count: number;
}

export interface Invitation {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  expires_at: string;
  created_at: string;
}

export const listPeople = () => auth.call<{ users: PersonRow[] }>('GET', '/users');

export const listInvitations = () => auth.call<{ invites: Invitation[] }>('GET', '/invites');

export const invite = (params: { username: string; displayName?: string; isAdmin?: boolean }) =>
  auth.call<{ invite: Invitation; token: string }>('POST', '/invites', params);

export const revokeInvitation = (id: string) =>
  auth.call<{ revoked: boolean }>('DELETE', `/invites/${id}`);

/** Take every passkey off an account and hand back a fresh set of codes. */
export const resetPerson = (id: string) =>
  auth.call<{ removed: number; codes: string[] }>('POST', `/users/${id}/reset`);

/** The link an invitee opens. The token is in the address because that is all they have. */
export const inviteLink = (token: string) =>
  `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
