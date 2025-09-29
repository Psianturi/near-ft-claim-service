import { connect, keyStores, utils } from 'near-api-js';

const DEFAULT_ACCOUNTS = [
  'user1.test.near',
  'user2.test.near',
  'user3.test.near',
  'alice.test.near',
  'bob.test.near',
];

async function ensureAccount(near, masterAccount, accountId, keyStore) {
  const provider = near.connection.provider;
  try {
    await provider.query({ request_type: 'view_account', finality: 'final', account_id: accountId });
    console.log(`✅ Account already exists: ${accountId}`);
    return;
  } catch {
    if (!accountId.endsWith(`.${masterAccount.accountId}`)) {
      throw new Error(`Cannot auto-create ${accountId}. Ensure it is a subaccount of ${masterAccount.accountId}`);
    }
    const keyPair = utils.KeyPair.fromRandom('ed25519');
    await keyStore.setKey('sandbox', accountId, keyPair);
    const initialBalance = utils.format.parseNearAmount('5');
    await masterAccount.createAccount(accountId, keyPair.getPublicKey(), initialBalance);
    console.log(`✅ Created account ${accountId} with 5 NEAR`);
  }
}

async function ensureStorage(masterAccount, contractId, accountId) {
  try {
    await masterAccount.functionCall({
      contractId,
      methodName: 'storage_deposit',
      args: { account_id: accountId, registration_only: true },
      gas: '30000000000000',
      attachedDeposit: utils.format.parseNearAmount('0.00125'),
    });
    console.log(`   ↳ Storage registered for ${accountId}`);
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes('already registered')) {
      console.log(`   ↳ Storage already registered for ${accountId}`);
    } else {
      console.log(`   ↳ Storage deposit failed for ${accountId}: ${message}`);
    }
  }
}

async function main() {
  const contractAccountId = process.env.NEAR_CONTRACT_ACCOUNT_ID || 'ft.test.near';
  const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID || 'test.near';
  const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;
  const rawAccounts = process.env.SANDBOX_RECEIVER_LIST;
  const targetAccounts = rawAccounts ? rawAccounts.split(',').map((id) => id.trim()).filter(Boolean) : DEFAULT_ACCOUNTS;

  if (!signerPrivateKey) {
    throw new Error('NEAR_SIGNER_ACCOUNT_PRIVATE_KEY is required');
  }

  console.log('👥 Bootstrapping sandbox receiver accounts...');
  console.log(`🔑 Master account: ${signerAccountId}`);
  console.log(`🎯 Contract: ${contractAccountId}`);
  console.log(`👥 Receivers: ${targetAccounts.join(', ')}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  let signerKeyPair;
  try {
    signerKeyPair = utils.KeyPair.fromString(signerPrivateKey);
  } catch {
    signerKeyPair = utils.KeyPair.fromString(signerPrivateKey.replace(/^ed25519:/, ''));
  }
  await keyStore.setKey('sandbox', signerAccountId, signerKeyPair);

  const near = await connect({
    networkId: 'sandbox',
    nodeUrl: process.env.NEAR_NODE_URL || 'http://127.0.0.1:3030',
    deps: { keyStore },
  });

  const masterAccount = await near.account(signerAccountId);

  for (const accountId of targetAccounts) {
    await ensureAccount(near, masterAccount, accountId, keyStore);
    await ensureStorage(masterAccount, contractAccountId, accountId);
  }

  console.log('✅ Sandbox receiver preparation complete.');
}

main().catch((error) => {
  console.error('❌ Failed to bootstrap sandbox accounts:', error);
  process.exit(1);
});
