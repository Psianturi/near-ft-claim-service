import './polyfills.js';
import { spawn } from 'child_process';
import { config } from './config.js';
import { initNear, getNear } from './near.js';
import { Buffer } from 'node:buffer';

type TestnetNear = {
  signer: {
    signTransaction: (args: any) => Promise<any>;
  };
  client: {
    callContractReadFunction: (args: any) => Promise<any>;
    sendSignedTransaction: (args: any) => Promise<any>;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeJson = ({ rawResult }: { rawResult: number[] }) => {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(rawResult));
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const getTestnetNear = (): TestnetNear => {
  const near = getNear() as any;
  if (!near?.signer || !near?.client) {
    throw new Error('Testnet signer/client not initialized. Check NEAR credentials.');
  }
  return near as TestnetNear;
};


const SERVICE_STARTUP_TIMEOUT_MS = Number.parseInt(
  process.env.SERVICE_STARTUP_TIMEOUT_MS || '90000',
  10,
);


const coerceToBigInt = (value: any): bigint => {
  if (value == null) {
    return 0n;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/"/g, '').trim();
    if (!cleaned) {
      return 0n;
    }
    return BigInt(cleaned);
  }
  if (typeof value === 'object') {
    if ('total' in value) {
      return coerceToBigInt((value as Record<string, unknown>).total);
    }
    if ('available' in value) {
      return coerceToBigInt((value as Record<string, unknown>).available);
    }
    if (Array.isArray(value) && value.length > 0) {
      return coerceToBigInt(value[0]);
    }
  }
  return 0n;
};

const rpcCall = async <T>(method: string, params: any): Promise<T> => {
  const response = await fetch(config.nodeUrl || 'https://rpc.testnet.near.org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'integration-test', method, params }),
  });

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`RPC error: ${JSON.stringify(payload.error)}`);
  }
  return payload.result as T;
};

const fetchFtBalance = async (accountId: string): Promise<bigint> => {
  const result = await rpcCall<any>('query', {
    request_type: 'call_function',
    account_id: config.ftContract,
    method_name: 'ft_balance_of',
    args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64'),
    finality: 'final',
  });

  const decoded = Buffer.from(result.result).toString();
  try {
    return coerceToBigInt(JSON.parse(decoded));
  } catch {
    return coerceToBigInt(decoded);
  }
};

const waitForBalanceIncrease = async (
  accountId: string,
  previous: bigint,
  expectedIncrease: bigint,
): Promise<bigint> => {
  const maxAttempts = 10;
  const target = previous + expectedIncrease;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const current = await fetchFtBalance(accountId);
    if (current >= target) {
      return current;
    }

    console.log(`   ⏳ Waiting for balance update (attempt ${attempt}/${maxAttempts})...`);
    await sleep(3000);
  }

  throw new Error('Balance did not reflect transfer within expected time');
};

async function testTestnetService() {
  console.log('🌐 Testing API Service on NEAR Testnet...\n');

  const receiverId = (process.env.TEST_RECEIVER_ID || 'psianturi.testnet').trim();
  if (!receiverId) {
    throw new Error('TEST_RECEIVER_ID environment variable is required');
  }
  if (receiverId === config.masterAccount) {
    throw new Error('TEST_RECEIVER_ID must be different from MASTER_ACCOUNT to avoid self-transfers');
  }

  const transferAmountRaw = (process.env.TEST_TRANSFER_AMOUNT || '1000000000000000').trim();
  if (!/^[0-9]+$/.test(transferAmountRaw)) {
    throw new Error('TEST_TRANSFER_AMOUNT must be a positive integer string');
  }
  const transferAmount = BigInt(transferAmountRaw);

  console.log('🚀 Starting API service in testnet mode...');
  const apiProcess = spawn('npm', ['run', 'start:testnet'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEAR_ENV: 'testnet',
      WORKER_COUNT: process.env.WORKER_COUNT || '6',
      CONCURRENCY_LIMIT: process.env.CONCURRENCY_LIMIT || '200',
      QUEUE_SIZE: process.env.QUEUE_SIZE || '1000',
      SKIP_STORAGE_CHECK: 'false',
    },
  });

  let serviceReady = false;
  let stdoutBuffer = '';
  const readinessSignals = [
    'server ready to accept requests',
    'near connection initialized successfully',
    '@eclipseeer/near-api-ts connection ready',
    'http server listening',
  ];
  const readyPromise = new Promise<void>((resolve) => {
    apiProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('API Output:', output.trim());
      stdoutBuffer += output.toLowerCase();
      if (
        !serviceReady &&
        readinessSignals.some((signal) => stdoutBuffer.includes(signal))
      ) {
        serviceReady = true;
        console.log('✅ API service started successfully');
        resolve();
      }
    });
  });
  apiProcess.stderr?.on('data', (data) => {
    console.log('API Error:', data.toString().trim());
  });

  await Promise.race([
    readyPromise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Service startup timeout')),
        SERVICE_STARTUP_TIMEOUT_MS,
      ),
    ),
  ]);

  if (!serviceReady) {
    console.log('❌ Service failed to start');
    apiProcess.kill('SIGINT');
    process.exit(1);
  }

  console.log('\n🧪 Preparing NEAR context...');
  await initNear();
  const near = getTestnetNear();

  console.log(`   Master account: ${config.masterAccount}`);
  console.log(`   FT contract: ${config.ftContract}`);
  console.log(`   Test receiver: ${receiverId}`);
  const startingBalance = await fetchFtBalance(receiverId);
  console.log(`   📊 Starting receiver balance: ${startingBalance.toString()} yocto`);

  const testResults: Array<{ name: string; passed: boolean; details?: string }> = [];

  try {
    console.log('\n🚀 Sending transfer request to /send-ft...');
    const response = await fetch('http://localhost:3000/send-ft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiverId,
        amount: transferAmount.toString(),
        memo: 'Testnet integration test transfer',
      }),
    });

    const body = await response.json().catch(() => ({}));
    console.log(`   Response: ${response.status} ${response.statusText}`);

    if (response.status !== 200) {
      console.log('   ❌ Transfer request failed', body);
      testResults.push({ name: 'Transfer request', passed: false, details: body?.error });
    } else {
      console.log('   ✅ Transfer request accepted');
      testResults.push({ name: 'Transfer request', passed: true });

      try {
  const finalBalance = await waitForBalanceIncrease(receiverId, startingBalance, transferAmount);
        const delta = finalBalance - startingBalance;
        console.log(`   ✅ Receiver balance increased by ${delta.toString()} yocto`);
        testResults.push({ name: 'On-chain balance verification', passed: true });
      } catch (error: any) {
        console.log('   ❌ Balance verification failed:', error?.message || error);
        testResults.push({
          name: 'On-chain balance verification',
          passed: false,
          details: error?.message || String(error),
        });
      }
    }
  } catch (error: any) {
    console.log('   ❌ Unexpected error during transfer:', error?.message || error);
    testResults.push({
      name: 'Transfer request',
      passed: false,
      details: error?.message || String(error),
    });
  }

  try {
    const healthResponse = await fetch('http://localhost:3000/health');
    const healthy = healthResponse.status === 200;
    console.log(`\n🩺 Health check: ${healthResponse.status} ${healthy ? '✅' : '❌'}`);
    testResults.push({ name: 'Health endpoint', passed: healthy });
  } catch (error: any) {
    console.log(`\n🩺 Health check failed: ${error?.message || error}`);
    testResults.push({
      name: 'Health endpoint',
      passed: false,
      details: error?.message || String(error),
    });
  }

  console.log('\n🧹 Cleaning up...');
  apiProcess.kill('SIGINT');

  const passedTests = testResults.filter((r) => r.passed).length;
  const totalTests = testResults.length;

  console.log('\n📊 Testnet Integration Test Results:');
  for (const result of testResults) {
    console.log(`   ${result.passed ? '✅' : '❌'} ${result.name}${result.details ? ` - ${result.details}` : ''}`);
  }
  console.log(`\n   Summary: ${passedTests}/${totalTests} checks passed`);

  const allPassed = passedTests === totalTests;
  if (!allPassed) {
    console.log('\n❌ Some testnet integration checks failed.');
    process.exit(1);
  }

  console.log('\n🎉 Testnet integration test PASSED!');
  console.log('   /send-ft endpoint is operational and confirmed on-chain.');
  process.exit(0);
}

testTestnetService().catch((error) => {
  console.error('Fatal error during test execution:', error);
  process.exit(1);
});