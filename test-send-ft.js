/**
 * Test FT send functionality using @eclipseeer/near-api-ts
 * 
 * Usage:
 *   export NEAR_NETWORK_ID=sandbox
 *   export NEAR_CONTRACT_ACCOUNT_ID=ft.test.near
 *   export NEAR_SIGNER_ACCOUNT_ID=test.near
 *   export NEAR_SIGNER_ACCOUNT_PRIVATE_KEY=ed25519:...
 *   node test-send-ft.js
 */

import { SimpleFTService, createFTServiceFromEnv, parseTokenAmount, formatTokenAmount } from './src/simple-ft-service.ts';

async function testSendFT() {
  console.log('🧪 Testing FT Send functionality...');

  try {
    // Create service from environment variables
    const ftService = createFTServiceFromEnv();
    console.log('✅ FT Service created from environment');

    // Initialize the service
    await ftService.initialize();
    console.log('✅ FT Service initialized');

    // Get contract metadata
    try {
      const metadata = await ftService.client.view({
        accountId: ftService.config.contractId,
        methodName: 'ft_metadata',
        args: {},
      });
      console.log('📋 FT Metadata:', {
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
      });
    } catch (error) {
      console.log('⚠️  Could not fetch metadata:', error.message);
    }

    // Get current balance
    try {
      const balance = await ftService.getBalance();
      const decimals = 24; // Default for most NEAR FT tokens
      const humanBalance = formatTokenAmount(balance, decimals);
      console.log(`💰 Current balance: ${humanBalance} tokens (${balance} yocto)`);
    } catch (error) {
      console.log('⚠️  Could not fetch balance:', error.message);
    }

    // Test receiver account (create a test user)
    const receiverAccountId = `user.${process.env.NEAR_SIGNER_ACCOUNT_ID}`;
    console.log(`🎯 Test receiver: ${receiverAccountId}`);

    // Send a small amount of FT tokens (1 token)
    const decimals = 24;
    const sendAmount = parseTokenAmount('1', decimals); // 1 token
    const memo = 'Test FT transfer via @eclipseeer/near-api-ts';

    console.log(`🚀 Sending ${formatTokenAmount(sendAmount, decimals)} tokens to ${receiverAccountId}...`);
    
    const result = await ftService.sendFT(receiverAccountId, sendAmount, memo);
    console.log('✅ FT transfer completed successfully!');

    // Check receiver balance
    try {
      const receiverBalance = await ftService.getBalance(receiverAccountId);
      const humanReceiverBalance = formatTokenAmount(receiverBalance, decimals);
      console.log(`💰 Receiver balance: ${humanReceiverBalance} tokens (${receiverBalance} yocto)`);
    } catch (error) {
      console.log('⚠️  Could not fetch receiver balance:', error.message);
    }

    return true;

  } catch (error) {
    console.error('❌ FT send test failed:', error);
    return false;
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSendFT()
    .then(success => {
      if (success) {
        console.log('🎉 All tests passed!');
        process.exit(0);
      } else {
        console.log('💥 Tests failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    });
}

export { testSendFT };