// src/polyfills.ts
import * as crypto from 'node:crypto';
import { Agent, Dispatcher, setGlobalDispatcher } from 'undici';

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

// Ensure we reuse HTTP connections for RPC calls (keep-alive dispatcher)
const dispatcherKey = Symbol.for('near.ft.keepAliveDispatcher');
const globalSymbols = Object.getOwnPropertySymbols(globalThis);
const existingSymbol = globalSymbols.find((sym) => sym === dispatcherKey);

if (existingSymbol && (globalThis as any)[dispatcherKey]) {
  const dispatcher = (globalThis as any)[dispatcherKey] as Dispatcher;
  setGlobalDispatcher(dispatcher);
  console.log('✅ Reusing existing keep-alive HTTP dispatcher.');
} else {
  const keepAliveAgent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 30_000,
    connections: 128,
  });
  (globalThis as any)[dispatcherKey] = keepAliveAgent;
  setGlobalDispatcher(keepAliveAgent);
  console.log('🔧 Installed keep-alive HTTP dispatcher (undici).');
}