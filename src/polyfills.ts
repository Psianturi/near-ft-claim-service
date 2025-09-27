// src/polyfills.ts
import * as crypto from 'node:crypto';

// Polyfill globalThis.crypto
if (typeof globalThis.crypto === 'undefined') {
  console.log('🔧 Applying crypto polyfill...');
  Object.defineProperty(globalThis, 'crypto', {
    value: crypto.webcrypto,
    writable: false,
    configurable: true,
  });
} else {
  console.log('✅ globalThis.crypto already exists.');
}