/**
 * Production KvStore backed by @react-native-async-storage/async-storage.
 * Lazy-imported so unit tests (Node-only) can bypass the native binding.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KvStore } from './kv';

export const asyncStorageKv: KvStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};
