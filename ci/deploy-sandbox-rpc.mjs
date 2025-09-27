/**
 * Deploy FT contract to sandbox using simplified near-api-js approach
 * Based on near-ft-claiming-service pattern
 *
 * Required env:
 *   - NEAR_CONTRACT_ACCOUNT_ID (FT contract account)
 *   - NEAR_SIGNER_ACCOUNT_ID (master account with keys)
 *   - NEAR_SIGNER_ACCOUNT_PRIVATE_KEY (ed25519:...)
 */
import { connect, keyStores, utils } from 'near-api-js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Deploy script started...');

  // Load environment variables
  const contractAccountId = process.env.NEAR_CONTRACT_ACCOUNT_ID || 'test.near';
  const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID || 'test.near';
  const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;

  if (!signerPrivateKey) {
    throw new Error('NEAR_SIGNER_ACCOUNT_PRIVATE_KEY is required');
  }

  // Check if WASM file exists
  const wasmPath = path.resolve(process.cwd(), 'fungible_token.wasm');
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`fungible_token.wasm not found at: ${wasmPath}`);
  }

  console.log(`📦 Deploying contract to: ${contractAccountId}`);
  console.log(`🔑 Using signer: ${signerAccountId}`);

  // Setup key store with simplified approach (like near-ft-claiming-service)
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = utils.KeyPair.fromString(signerPrivateKey);
  await keyStore.setKey('sandbox', signerAccountId, keyPair);

  // Connect to NEAR
  const near = await connect({
    networkId: 'sandbox',
    nodeUrl: 'http://127.0.0.1:3030',
    deps: { keyStore },
  });

  // Get account handle
  const account = await near.account(signerAccountId);

  // Read WASM file
  const wasm = fs.readFileSync(wasmPath);
  console.log(`📄 WASM file size: ${wasm.length} bytes`);

  try {
    // Deploy contract using simplified approach
    console.log('🔨 Deploying contract...');
    await account.deployContract(wasm);
    console.log('✅ Contract deployed successfully!');

    // Initialize contract with minimal parameters (like near-ft-claiming-service)
    console.log('⚙️ Initializing contract...');
    await account.functionCall({
      contractId: contractAccountId,
      methodName: 'new_default_meta',
      args: {
        owner_id: signerAccountId,
        total_supply: '1000000000000000000000000' // 1M tokens with 18 decimals
      },
      gas: '300000000000000', // 300 TGas
      attachedDeposit: '0'
    });
    console.log('✅ Contract initialized successfully!');

  } catch (error) {
    const message = error?.message || String(error);
    console.error('❌ Deployment failed:', message);
    throw error;
  }

  console.log('🎉 FT contract deployment completed!');
  console.log(`   - Contract: ${contractAccountId}`);
  console.log(`   - Owner: ${signerAccountId}`);
}

main().catch((err) => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});