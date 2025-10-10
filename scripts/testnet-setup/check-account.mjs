#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';

async function main() {
  dotenv.config({ path: '.env.testnet' });

  const networkId = process.env.NEAR_ENV || 'testnet';
  const accountId = process.argv[2] || process.env.MASTER_ACCOUNT;
  const nodeUrl = process.env.NODE_URL || 'https://rpc.testnet.fastnear.com';

  if (!accountId) {
    throw new Error('Account ID required. Usage: node scripts/check-account.mjs <accountId>');
  }

  console.log(`🔍 Checking account: ${accountId}`);
  console.log(`🌐 Network: ${networkId}`);
  console.log(`🔗 RPC: ${nodeUrl}`);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore: new keyStores.InMemoryKeyStore() },
  });

  try {
    const account = await near.account(accountId);
    const state = await account.state();

    console.log(`✅ Account exists: ${accountId}`);
    console.log(`💰 Balance: ${utils.format.formatNearAmount(state.amount)} NEAR`);
    console.log(`📦 Storage Used: ${state.storage_usage} bytes`);

    // Check access keys
    const accessKeys = await account.getAccessKeys();
    console.log(`🔑 Access Keys: ${accessKeys.length}`);
    accessKeys.forEach((key, i) => {
      console.log(`   ${i + 1}. ${key.public_key} (${key.access_key.permission})`);
    });

  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.log(`❌ Account does not exist: ${accountId}`);
      console.log('💡 This account can be created');
    } else {
      console.error('❌ Error checking account:', error.message);
    }
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});