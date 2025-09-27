import { Worker } from 'near-workspaces';
import fs from 'fs';
import path from 'path';

async function testAPIService() {
  console.log('🧪 Testing API Service with near-workspaces sandbox...\n');

  // 1. Initialize Sandbox
  const worker = await Worker.init();
  console.log('✅ Sandbox initialized');

  // 2. Create Accounts
  const root = worker.rootAccount;
  const ftContractAccount = await root.createSubAccount('ft');
  const masterAccount = await root.createSubAccount('master');
  const userAccount = await root.createSubAccount('user');

  console.log('📝 Accounts created:');
  console.log(`   Contract: ${ftContractAccount.accountId}`);
  console.log(`   Master: ${masterAccount.accountId}`);
  console.log(`   User: ${userAccount.accountId}\n`);

  // 3. Deploy FT Contract
  const wasmPath = path.join(process.cwd(), '../ft/target/near/fungible_token.wasm');
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`FT contract WASM not found at: ${wasmPath}`);
  }

  const wasm = fs.readFileSync(wasmPath);
  await ftContractAccount.deploy(wasm);
  console.log('✅ FT contract deployed');

  // 4. Initialize Contract
  await ftContractAccount.call(
    ftContractAccount.accountId,
    'new_default_meta',
    {
      owner_id: masterAccount.accountId,
      total_supply: '1000000000000000000000000', // 1M tokens
    }
  );
  console.log('✅ FT contract initialized');

  // 5. Check Initial Balance
  let masterBalance = await ftContractAccount.view('ft_balance_of', {
    account_id: masterAccount.accountId
  });
  console.log(`💰 Master balance: ${masterBalance}`);

  // 6. Register User for Storage
  await masterAccount.call(
    ftContractAccount.accountId,
    'storage_deposit',
    { account_id: userAccount.accountId, registration_only: true },
    { attachedDeposit: BigInt('1250000000000000000000') }
  );
  console.log('✅ User registered for storage');

  // 7. Start API Service in background
  console.log('\n🚀 Starting API service...');
  const { spawn } = await import('child_process');

  const apiProcess = spawn('npm', ['run', 'start:sandbox'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEAR_ENV: 'sandbox',
      RPC_URLS: 'http://localhost:27733', // Use the new sandbox port
      MASTER_ACCOUNT_PRIVATE_KEY: 'ed25519:4GvwDSCWMnP2GTX8SD2CAsn7TDAczjGEASGePCs7Nec4JpHUsHFR1rEhFf9vy5H4rBKUfE7sfDnNK8PRVD59HmE6',
      SKIP_STORAGE_CHECK: 'true'
    }
  });

  // Wait for API service to start
  await new Promise((resolve) => {
    let output = '';
    apiProcess.stdout?.on('data', (data) => {
      output += data.toString();
      if (output.includes('Server is running on http://localhost:3000')) {
        console.log('✅ API service started');
        resolve(true);
      }
    });

    apiProcess.stderr?.on('data', (data) => {
      console.log('API stderr:', data.toString());
    });
  });

  // 8. Test API Endpoints
  console.log('\n🧪 Testing API endpoints...');

  const testTransfer = async (receiverId: string, amount: string, description: string) => {
    try {
      const response = await fetch('http://localhost:3000/send-ft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId, amount, memo: `Test: ${description}` })
      });

      const result = await response.json();
      console.log(`   ${description}: ${response.status === 200 ? '✅' : '❌'} ${response.status}`);
      return response.status === 200;
    } catch (error) {
      console.log(`   ${description}: ❌ Error - ${error}`);
      return false;
    }
  };

  // Test single transfers
  const results = [];
  results.push(await testTransfer(userAccount.accountId, '1000000', 'Single transfer 1'));
  results.push(await testTransfer(userAccount.accountId, '2000000', 'Single transfer 2'));
  results.push(await testTransfer(userAccount.accountId, '1500000', 'Single transfer 3'));

  // 9. Verify Final Balances
  const finalUserBalance = await ftContractAccount.view('ft_balance_of', {
    account_id: userAccount.accountId
  });
  const finalMasterBalance = await ftContractAccount.view('ft_balance_of', {
    account_id: masterAccount.accountId
  });

  console.log('\n📊 Final Results:');
  console.log(`   User balance: ${finalUserBalance}`);
  console.log(`   Master balance: ${finalMasterBalance}`);
  console.log(`   Successful transfers: ${results.filter(r => r).length}/${results.length}`);

  // 10. Cleanup
  apiProcess.kill();
  await worker.tearDown();

  if (results.filter(r => r).length === results.length) {
    console.log('\n🎉 All tests passed! API service is working correctly.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed.');
    process.exit(1);
  }
}

testAPIService().catch(console.error);