#!/usr/bin/env node

import { connect, keyStores, utils } from 'near-api-js';
import fs from 'fs';

async function createSandboxAccount() {
  console.log('🔧 Creating new sandbox account for clean testing...');

  // Connect to sandbox
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = utils.KeyPair.fromString('ed25519:8uj7qDoNUFy8aqENiULVyH3A79dNvTaz9Zc18wY9c8Wp');
  await keyStore.setKey('sandbox', 'test.near', keyPair);

  const near = await connect({
    networkId: 'sandbox',
    nodeUrl: 'http://127.0.0.1:3030',
    keyStore,
  });

  const masterAccount = await near.account('test.near');

  // Create new benchmark account
  const newAccountId = `ft-sandbox-${Date.now()}.test.near`;
  console.log(`📝 Creating account: ${newAccountId}`);

  try {
    // Create account with initial balance
    const result = await masterAccount.functionCall({
      contractId: 'test.near',
      methodName: 'create_account',
      args: {
        new_account_id: newAccountId,
        new_public_key: keyPair.getPublicKey().toString(),
      },
      gas: '300000000000000',
      attachedDeposit: utils.format.parseNearAmount('10'), // 10 NEAR
    });

    console.log('✅ Account created successfully');
    console.log(`🎯 New account: ${newAccountId}`);
    console.log(`🔑 Public key: ${keyPair.getPublicKey().toString()}`);
    console.log(`🔐 Private key: ${keyPair.toString()}`);

    // Update .env file
    const envPath = '.env';
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Replace the master account settings
    envContent = envContent.replace(
      /MASTER_ACCOUNT=.*/,
      `MASTER_ACCOUNT=${newAccountId}`
    );
    envContent = envContent.replace(
      /MASTER_ACCOUNT_PRIVATE_KEY=.*/,
      `MASTER_ACCOUNT_PRIVATE_KEY=${keyPair.toString()}`
    );
    envContent = envContent.replace(
      /MASTER_ACCOUNT_PRIVATE_KEYS=.*/,
      `MASTER_ACCOUNT_PRIVATE_KEYS=${keyPair.toString()}`
    );
    envContent = envContent.replace(
      /FT_CONTRACT=.*/,
      `FT_CONTRACT=${newAccountId}`
    );

    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env file updated with new account');

    return newAccountId;
  } catch (error) {
    console.error('❌ Failed to create account:', error.message);
    throw error;
  }
}

createSandboxAccount().catch(console.error);