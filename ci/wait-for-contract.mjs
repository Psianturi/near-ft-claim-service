import { connect, keyStores, utils } from 'near-api-js';

function parseKey(rawKey) {
  if (!rawKey) {
    throw new Error('NEAR_SIGNER_ACCOUNT_PRIVATE_KEY is required');
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

async function waitForContract() {
  const contractId = process.env.NEAR_CONTRACT_ACCOUNT_ID;
  const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID;
  const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;
  const nodeUrl = process.env.NEAR_NODE_URL || 'http://127.0.0.1:3030';
  const attempts = parseInt(process.env.CONTRACT_READY_ATTEMPTS || '20', 10);
  const intervalMs = parseInt(process.env.CONTRACT_READY_INTERVAL_MS || '1500', 10);

  if (!contractId) {
    throw new Error('NEAR_CONTRACT_ACCOUNT_ID is required');
  }
  if (!signerAccountId) {
    throw new Error('NEAR_SIGNER_ACCOUNT_ID is required');
  }

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = parseKey(signerPrivateKey);
  await keyStore.setKey('sandbox', signerAccountId, keyPair);

  const near = await connect({
    networkId: 'sandbox',
    nodeUrl,
    deps: { keyStore },
  });

  const account = await near.account(signerAccountId);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
  const metadata = await account.viewFunction(contractId, 'ft_metadata', {});
  const totalSupply = await account.viewFunction(contractId, 'ft_total_supply', {});
      console.log('✅ Contract metadata available:', metadata?.symbol || 'unknown symbol');
      console.log('✅ Total supply reported:', totalSupply);
      return;
    } catch (error) {
      const message = error?.message || String(error);
      console.log(`⏳ Contract not ready yet (attempt ${attempt}/${attempts}): ${message}`);
      if (attempt === attempts) {
        throw new Error('Timed out waiting for contract readiness');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

waitForContract().catch((error) => {
  console.error('❌ Contract readiness check failed:', error);
  process.exit(1);
});
