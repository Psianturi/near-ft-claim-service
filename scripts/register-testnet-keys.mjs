#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveEnvPath() {
  const cliPath = process.argv[2];
  if (cliPath) {
    return path.resolve(process.cwd(), cliPath);
  }
  if (process.env.ENV_FILE) {
    return path.resolve(process.cwd(), process.env.ENV_FILE);
  }
  return path.resolve(__dirname, '..', '.env.testnet');
}

function normalisePrivateKey(raw) {
  if (!raw) return '';
  return raw.trim();
}

async function main() {
  const envPath = resolveEnvPath();
  dotenv.config({ path: envPath });

  const networkId = process.env.NEAR_ENV || 'testnet';
  const accountId = process.env.MASTER_ACCOUNT;
  const masterKeyString = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
  const nodeUrl = process.env.NODE_URL || 'https://rpc.testnet.near.org';

  if (!accountId || !masterKeyString) {
    throw new Error('MASTER_ACCOUNT dan MASTER_ACCOUNT_PRIVATE_KEY wajib diisi.');
  }

  const keyListRaw = process.env.MASTER_ACCOUNT_PRIVATE_KEYS || masterKeyString;
  const privateKeys = keyListRaw
    .split(',')
    .map(normalisePrivateKey)
    .filter(Boolean);

  if (privateKeys.length === 0) {
    throw new Error('Tidak ada kunci privat yang ditemukan di MASTER_ACCOUNT_PRIVATE_KEYS.');
  }

  const keyStore = new keyStores.InMemoryKeyStore();
  const masterKey = utils.KeyPair.fromString(masterKeyString);
  await keyStore.setKey(networkId, accountId, masterKey);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore },
  });

  const account = await near.account(accountId);
  const accessKeys = await account.getAccessKeys();
  const existing = new Set(accessKeys.map((entry) => entry.public_key));

  console.log('🔐 Registrasi akses key full-access (testnet)');
  console.log(`   • Akun: ${accountId}`);
  console.log(`   • RPC: ${nodeUrl}`);
  console.log(`   • Total kunci dari env: ${privateKeys.length}`);

  const added = [];
  const skipped = [];

  for (const rawKey of privateKeys) {
    const keyPair = utils.KeyPair.fromString(rawKey);
    const publicKey = keyPair.getPublicKey().toString();

    if (existing.has(publicKey)) {
      skipped.push(publicKey);
      continue;
    }

    console.log(`   → Menambahkan kunci ${publicKey}`);
    await account.addKey(publicKey);
    added.push(publicKey);
    existing.add(publicKey);
  }

  if (added.length === 0) {
    console.log('✅ Semua kunci sudah terdaftar di on-chain.');
  } else {
    console.log(`✅ Berhasil menambahkan ${added.length} kunci baru.`);
  }

  if (skipped.length > 0) {
    console.log(`ℹ️  ${skipped.length} kunci sudah ada dan dilewati.`);
  }

  console.log('🎉 Registrasi akses key selesai.');
}

main().catch((error) => {
  console.error('❌ Gagal meregistrasi kunci testnet:', error);
  process.exit(1);
});
