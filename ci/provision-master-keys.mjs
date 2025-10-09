import { connect, keyStores, utils } from 'near-api-js';

const log = (...args) => console.error(...args);

function normalizeKey(rawKey) {
  if (!rawKey) {
    throw new Error('Missing master account private key');
  }
  try {
    return utils.KeyPair.fromString(rawKey);
  } catch (error) {
    if (rawKey.startsWith('ed25519:')) {
      throw error;
    }
    return utils.KeyPair.fromString(`ed25519:${rawKey}`);
  }
}

function parsePrivateKeys(masterPrivateKey, extraKeysRaw) {
  const keys = new Map();
  const mainKeyPair = normalizeKey(masterPrivateKey);
  keys.set(mainKeyPair.getPublicKey().toString(), {
    privateKey: mainKeyPair.toString(),
    keyPair: mainKeyPair,
  });

  if (!extraKeysRaw) {
    return keys;
  }

  let normalized = extraKeysRaw.trim();
  if (!normalized) {
    return keys;
  }

  if ((normalized.startsWith("'") && normalized.endsWith("'")) || (normalized.startsWith('"') && normalized.endsWith('"'))) {
    normalized = normalized.slice(1, -1).trim();
  }

  const candidateKeys = [];
  if (normalized.startsWith('[')) {
    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string' && entry.trim()) {
            candidateKeys.push(entry.trim());
          } else if (entry && typeof entry === 'object' && typeof entry.private_key === 'string') {
            candidateKeys.push(entry.private_key.trim());
          } else if (entry && typeof entry === 'object' && typeof entry.privateKey === 'string') {
            candidateKeys.push(entry.privateKey.trim());
          }
        }
      }
    } catch (error) {
      log('⚠️  Failed to parse MASTER_ACCOUNT_PRIVATE_KEYS as JSON:', error?.message || error);
    }
  }

  if (candidateKeys.length === 0) {
    candidateKeys.push(...normalized.split(',').map((piece) => piece.trim()).filter(Boolean));
  }

  for (const candidate of candidateKeys) {
    try {
      const keyPair = normalizeKey(candidate);
      keys.set(keyPair.getPublicKey().toString(), {
        privateKey: keyPair.toString(),
        keyPair,
      });
    } catch (error) {
      log('⚠️  Skipping invalid key:', candidate, error?.message || error);
    }
  }

  return keys;
}

function parseDesiredCount(rawCount) {
  const parsed = Number.parseInt(rawCount || '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 12;
  }
  return Math.min(parsed, 64);
}

async function ensureKeyOnChain(masterAccount, desiredPublicKey, keyPair) {
  try {
    await masterAccount.addKey(keyPair.getPublicKey());
    log(`🔑 Registered access key ${desiredPublicKey}`);
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes('already exists')) {
      log(`ℹ️  Access key already exists on chain: ${desiredPublicKey}`);
    } else {
      throw error;
    }
  }
}

async function main() {
  const networkId = process.env.NEAR_NETWORK_ID || 'sandbox';
  const nodeUrl = process.env.NEAR_NODE_URL || process.env.NODE_URL || 'http://127.0.0.1:3030';
  const masterAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID || process.env.MASTER_ACCOUNT;
  const masterPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY || process.env.MASTER_ACCOUNT_PRIVATE_KEY;
  const extraPrivateKeys = process.env.MASTER_ACCOUNT_PRIVATE_KEYS;
  const desiredCount = parseDesiredCount(process.env.SANDBOX_KEY_POOL_SIZE || process.env.KEY_POOL_SIZE);

  if (!masterAccountId) {
    throw new Error('NEAR_SIGNER_ACCOUNT_ID or MASTER_ACCOUNT must be provided');
  }
  if (!masterPrivateKey) {
    throw new Error('NEAR_SIGNER_ACCOUNT_PRIVATE_KEY or MASTER_ACCOUNT_PRIVATE_KEY is required');
  }

  log(`🔐 Provisioning master key pool for ${masterAccountId} (target ${desiredCount})`);

  const keyStore = new keyStores.InMemoryKeyStore();
  const signerKeyPair = normalizeKey(masterPrivateKey);
  await keyStore.setKey(networkId, masterAccountId, signerKeyPair);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore },
  });

  const masterAccount = await near.account(masterAccountId);
  const existingAccessKeys = await masterAccount.getAccessKeys();
  const existingPublicKeys = new Set(
    existingAccessKeys.map((key) => key.public_key || key.publicKey).filter(Boolean)
  );

  const keyMap = parsePrivateKeys(masterPrivateKey, extraPrivateKeys);

  // Ensure all known keys are on-chain
  for (const [publicKey, { keyPair }] of keyMap.entries()) {
    if (!existingPublicKeys.has(publicKey)) {
      await ensureKeyOnChain(masterAccount, publicKey, keyPair);
      existingPublicKeys.add(publicKey);
    } else {
      log(`ℹ️  Key already registered: ${publicKey}`);
    }
  }

  while (keyMap.size < desiredCount) {
    const newKeyPair = utils.KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();
    await ensureKeyOnChain(masterAccount, publicKey, newKeyPair);
    keyMap.set(publicKey, {
      privateKey: newKeyPair.toString(),
      keyPair: newKeyPair,
    });
  }

  const keysForEnv = Array.from(keyMap.values()).map((entry) => entry.privateKey);
  const keyCount = keysForEnv.length;
  const perKeyEnv = Number.parseInt(process.env.SANDBOX_MAX_IN_FLIGHT_PER_KEY || '', 10);
  const autoPerKey = Math.max(6, Math.min(24, Math.floor(192 / keyCount) || 12));
  const effectivePerKey = Number.isNaN(perKeyEnv) || perKeyEnv <= 0 ? autoPerKey : perKeyEnv;

  log(`✅ Key pool ready with ${keyCount} keys (per-key concurrency ${effectivePerKey})`);

  const lines = [];
  lines.push(`export MASTER_ACCOUNT_PRIVATE_KEYS='${JSON.stringify(keysForEnv)}'`);
  lines.push(`export SANDBOX_KEY_POOL_SIZE='${keyCount}'`);
  if (Number.isNaN(perKeyEnv) || perKeyEnv <= 0) {
    lines.push(`export SANDBOX_MAX_IN_FLIGHT_PER_KEY='${effectivePerKey}'`);
  }
  const globalInFlight = Number.parseInt(process.env.MAX_IN_FLIGHT || '', 10);
  const recommendedGlobal = effectivePerKey * keyCount;
  if (Number.isNaN(globalInFlight) || globalInFlight < recommendedGlobal) {
    lines.push(`export MAX_IN_FLIGHT='${recommendedGlobal}'`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error) => {
  console.error('❌ Failed to provision master keys:', error?.message || error);
  process.exit(1);
});
