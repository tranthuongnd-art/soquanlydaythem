import { getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  inMemoryPersistence,
  reauthenticateWithCredential,
  setPersistence,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig);
const provisioningApp =
  getApps().find((a) => a.name === 'account-provisioner') ??
  initializeApp(firebaseConfig, 'account-provisioner');

// CRITICAL: Pass firebaseConfig.firestoreDatabaseId so the app targets the provisioned database
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Secondary in-memory Auth instance so Teachers can provision Student/Parent accounts without signing out
export const provisioningAuth = getAuth(provisioningApp);
void setPersistence(provisioningAuth, inMemoryPersistence);

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const PHONE_AUTH_DOMAIN = 'phone.smartteaching.app';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// Run startup connection validation
void testConnection();

// =========================================================
// PHONE NUMBER & PASSWORD AUTH HELPERS
// =========================================================
export function normalizePhone(raw: string | undefined | null): string {
  const cleaned = (raw ?? '').replace(/[^0-9+]/g, '');
  if (!cleaned) return '';
  let digits = cleaned;
  if (digits.startsWith('+84')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  return digits.replace(/[^0-9]/g, '').slice(0, 15);
}

export function toZaloUrl(rawPhone: string | undefined | null): string | null {
  const digits = normalizePhone(rawPhone);
  if (digits.length < 8) return null;
  return `https://zalo.me/${digits}`;
}

export function phoneToAuthEmail(rawPhone: string | undefined | null): string {
  const digits = normalizePhone(rawPhone);
  if (digits.length < 8) return '';
  return `${digits}@${PHONE_AUTH_DOMAIN}`;
}

export function authEmailToPhone(authEmail: string | undefined | null): string {
  const clean = (authEmail ?? '').trim().toLowerCase();
  if (clean.endsWith(`@${PHONE_AUTH_DOMAIN}`)) {
    return clean.slice(0, -(PHONE_AUTH_DOMAIN.length + 1));
  }
  return '';
}

export function formatPhoneReadable(raw: string | undefined | null): string {
  const digits = normalizePhone(raw);
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return digits || (raw ?? '').trim();
}

export function generateIssuedPassword(length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export interface ProvisionAccountResult {
  status: 'created' | 'already_exists' | 'provider_disabled' | 'invalid' | 'error';
  uid?: string;
  phone: string;
  password: string;
  message: string;
}

/**
 * Provisions a Firebase Auth account (Phone + Issued Password) using an isolated in-memory
 * Auth instance so the currently signed-in Teacher session is NEVER disrupted.
 */
export async function provisionPhoneAccount(input: {
  phone: string;
  password: string;
  displayName: string;
}): Promise<ProvisionAccountResult> {
  const digits = normalizePhone(input.phone);
  const password = input.password.trim();
  if (digits.length < 8) {
    return {
      status: 'invalid',
      phone: digits,
      password,
      message: 'Số điện thoại không hợp lệ (cần ít nhất 8 chữ số).',
    };
  }
  if (password.length < 6) {
    return {
      status: 'invalid',
      phone: digits,
      password,
      message: 'Mật khẩu cấp phải có tối thiểu 6 ký tự.',
    };
  }

  const authEmail = phoneToAuthEmail(digits);
  try {
    const cred = await createUserWithEmailAndPassword(provisioningAuth, authEmail, password);
    const uid = cred.user.uid;
    if (input.displayName.trim()) {
      await updateProfile(cred.user, {
        displayName: input.displayName.trim().slice(0, 120),
      }).catch(() => {});
    }
    await signOut(provisioningAuth).catch(() => {});
    return {
      status: 'created',
      uid,
      phone: digits,
      password,
      message: 'Đã cấp tài khoản đăng nhập mới.',
    };
  } catch (err: unknown) {
    await signOut(provisioningAuth).catch(() => {});
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/email-already-in-use') {
      return {
        status: 'already_exists',
        phone: digits,
        password,
        message: 'Số điện thoại này đã có tài khoản trước đó.',
      };
    }
    if (code === 'auth/operation-not-allowed') {
      return {
        status: 'provider_disabled',
        phone: digits,
        password,
        message: 'Chưa bật đăng nhập Email/Mật khẩu trong Firebase Console.',
      };
    }
    return {
      status: 'error',
      phone: digits,
      password,
      message: err instanceof Error ? err.message : 'Không thể tạo tài khoản lúc này.',
    };
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('Bạn chưa đăng nhập.');
  }
  if (newPassword.trim().length < 6) {
    throw new Error('Mật khẩu mới cần tối thiểu 6 ký tự.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword.trim());
}

// =========================================================
// SANITIZATION HELPERS SYNCED WITH BLUEPRINT & RULES
// =========================================================
export function clampString(value: string | undefined | null, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

export function normalizeEmail(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase().slice(0, 160);
}

export function normalizeEmailList(emails: Array<string | undefined | null>, maxItems: number): string[] {
  const unique = new Set<string>();
  for (const raw of emails) {
    const clean = normalizeEmail(raw);
    if (clean && clean.includes('@')) {
      unique.add(clean);
      if (unique.size >= maxItems) break;
    }
  }
  return Array.from(unique);
}

export function normalizeUidList(uids: Array<string | undefined | null>, maxItems: number): string[] {
  const unique = new Set<string>();
  for (const raw of uids) {
    const clean = (raw ?? '').trim().slice(0, 128);
    if (clean && /^[a-zA-Z0-9_\-]+$/.test(clean)) {
      unique.add(clean);
      if (unique.size >= maxItems) break;
    }
  }
  return Array.from(unique);
}

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 120);
}

export function sanitizeIdSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 60);
}

export function makeDeterministicSessionId(classId: string, sessionDate: string, startTime: string): string {
  const cleanDate = sessionDate.replace(/[^0-9]/g, '');
  const cleanTime = startTime.replace(/[^0-9]/g, '');
  return `${sanitizeIdSegment(classId)}_${cleanDate}_${cleanTime}`.slice(0, 128);
}

export function makeDeterministicPairId(partA: string, partB: string): string {
  return `${sanitizeIdSegment(partA)}_${sanitizeIdSegment(partB)}`.slice(0, 128);
}
