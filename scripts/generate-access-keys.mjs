#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';

async function main() {
  dotenv.config({ path: '.env.testnet' });

  const networkId = process.env.NEAR_ENV || 'testnet';
  const accountId = 'ft-benchmark.testnet';
  const privateKey = 'ed25519:2WywpuXdKxar1b8XUhJhUC7LujDiT3hvuxbcpMTT3uYRaXGzijR2VNR1xxJkU5nA7ZD3qBxMFnzt86mzPUQKjoxA';
  const nodeUrl = process.env.NODE_URL || 'https://rpc.testnet.fastnear.com';

  const numKeys = parseInt(process.argv[2]) || 7; // Default 7 keys for high TPS

  console.log('🔑 Generating access keys for benchmark account...');
  console.log(`   • Account: ${accountId}`);
  console.log(`   • Keys to generate: ${numKeys}`);
  console.log(`   • Network: ${networkId}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  const masterKeyPair = utils.KeyPair.fromString(privateKey);
  await keyStore.setKey(networkId, accountId, masterKeyPair);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore },
  });

  const account = await near.account(accountId);

  // Get existing keys
  const existingKeys = await account.getAccessKeys();
  const existingPublicKeys = new Set(existingKeys.map(k => k.public_key));

  console.log(`   • Existing keys: ${existingKeys.length}`);

  const generatedKeys = [];
  const addedKeys = [];

  for (let i = 0; i < numKeys; i++) {
    // Generate new key pair
    const newKeyPair = utils.KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();

    if (existingPublicKeys.has(publicKey)) {
      console.log(`   → Key ${i + 1}: Already exists, skipping`);
      continue;
    }

    console.log(`   → Adding key ${i + 1}/${numKeys}: ${publicKey.slice(0, 20)}...`);

    try {
      // Add function-call access key (not full access for security)
      await account.addKey(publicKey, accountId, [
        'ft_transfer',
        'ft_transfer_call',
        'storage_deposit'
      ], '300000000000000');

      generatedKeys.push(newKeyPair.toString());
      addedKeys.push(publicKey);

      console.log(`     ✅ Added successfully`);
    } catch (error) {
      console.log(`     ❌ Failed to add: ${error.message}`);
    }
  }

  console.log('');
  console.log('🎉 Access key generation completed!');
  console.log(`   • Keys added: ${addedKeys.length}`);
  console.log(`   • Total keys now: ${existingKeys.length + addedKeys.length}`);
  console.log('');

  if (generatedKeys.length > 0) {
    console.log('🔐 Generated Private Keys (add to .env.testnet):');
    console.log('MASTER_ACCOUNT_PRIVATE_KEYS=' + generatedKeys.join(','));
    console.log('');
    console.log('⚠️  IMPORTANT: Save these private keys securely!');
    console.log('   They will be needed for high-TPS testing.');
  } else {
    console.log('ℹ️  No new keys were generated (all requested keys already exist)');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});