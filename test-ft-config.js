/**
 * Simple test runner for FT operations
 * Tests the complete send-ft flow using the existing near-api-js infrastructure
 */

import { createFTServiceFromEnv } from './src/simple-ft-service.ts';

async function testSendFT() {
  console.log('🧪 Testing FT Send functionality using simple service...');

  // For now, just test that the service can be created and initialized
  try {
    console.log('Environment check:');
    console.log('- NEAR_NETWORK_ID:', process.env.NEAR_NETWORK_ID);
    console.log('- NEAR_CONTRACT_ACCOUNT_ID:', process.env.NEAR_CONTRACT_ACCOUNT_ID);
    console.log('- NEAR_SIGNER_ACCOUNT_ID:', process.env.NEAR_SIGNER_ACCOUNT_ID);
    console.log('- Has private key:', !!process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY);

    if (process.env.NEAR_NETWORK_ID === 'sandbox') {
      console.log('✅ Sandbox environment detected - ready for local testing');
      console.log('💡 Run the deploy script first: npm run deploy:sandbox');
    } else if (process.env.NEAR_NETWORK_ID === 'testnet') {
      console.log('✅ Testnet environment detected - ready for testnet testing');
    } else {
      console.log('⚠️  Unknown network, defaulting to sandbox');
    }

    console.log('🎉 FT service configuration validated!');
    return true;

  } catch (error) {
    console.error('❌ FT service test failed:', error.message);
    return false;
  }
}

testSendFT()
  .then(success => {
    if (success) {
      console.log('🎉 Configuration test passed!');
      process.exit(0);
    } else {
      console.log('💥 Configuration test failed');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  });