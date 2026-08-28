import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  }
  
  if (errInfo.error && errInfo.error.toLowerCase().includes("quota")) {
    console.warn("Firestore Quota Exceeded:", errInfo.path);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('firestore-quota-exceeded', {
        detail: { message: "Kuota server harian (Firebase) telah habis. Aplikasi dapat digunakan kembali pada pukul 14.00 WIB atau jam 2 siang." }
      }));
    }
    return;
  }
  console.warn('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Smart TTL Caching Utility to save Firestore Read quota by up to 90%.
 */
export function getLocalCache<T>(key: string, maxAgeMs: number = 30 * 60 * 1000): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'timestamp' in parsed && 'data' in parsed) {
      if (Date.now() - parsed.timestamp < maxAgeMs) {
        return parsed.data as T;
      }
      return null; // expired
    }
    return parsed as T; // legacy un-timestamped cache
  } catch (e) {
    return null;
  }
}

export function setLocalCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.warn("Could not save to localStorage cache:", e);
  }
}

export function clearStudentCaches(nisn?: string, kelas?: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("firas_cache_") || key.startsWith("firas_student_"))) {
        if (!nisn && !kelas) {
          keysToRemove.push(key);
        } else if ((nisn && key.includes(nisn)) || (kelas && key.includes(kelas))) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn("Error clearing student caches:", e);
  }
}

export function clearTeacherCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("firas_cache_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn("Error clearing teacher caches:", e);
  }
}
