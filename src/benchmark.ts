import fetch from 'node-fetch';
import { pathToFileURL } from 'url';

const API_URL = 'http://localhost:3000/send-ft';
const TOTAL_REQUESTS = 60000;
const CONCURRENCY = 100;

export const sendRequest = async (i: number): Promise<boolean> => {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            receiverId: `receiver-${i}.testnet`,
            amount: '1', // 1 yoctoNEAR
            memo: `benchmark test ${i}`,
        }),
    });
    if (!response.ok) {
        console.error(`Request ${i} failed with status ${response.status}`);
        const errorBody = await response.text();
        console.error(`Error body: ${errorBody}`);
    }
    return response.ok;
};

export const runBenchmark = async (): Promise<void> => {
    console.log(`Starting benchmark with ${TOTAL_REQUESTS} requests and concurrency ${CONCURRENCY}...`);
    const startTime = Date.now();
    let successfulRequests = 0;
    let failedRequests = 0;
    const promises: Promise<boolean>[] = [];
    for (let i = 0; i < TOTAL_REQUESTS; i++) {
        promises.push(sendRequest(i));
        if (promises.length >= CONCURRENCY) {
            const results = await Promise.all(promises);
            results.forEach(success => success ? successfulRequests++ : failedRequests++);
            promises.length = 0;
        }
    }
    if (promises.length > 0) {
        const results = await Promise.all(promises);
        results.forEach(success => success ? successfulRequests++ : failedRequests++);
    }
    const endTime = Date.now();
    const durationInSeconds = (endTime - startTime) / 1000;
    const tps = successfulRequests / durationInSeconds;
    console.log('\n--- Benchmark Results ---');
    console.log(`Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`Successful Requests: ${successfulRequests}`);
    console.log(`Failed Requests: ${failedRequests}`);
    console.log(`Total Time: ${durationInSeconds.toFixed(2)} seconds`);
    console.log(`Transactions Per Second (TPS): ${tps.toFixed(2)}`);
    console.log('-------------------------\n');
};

const getInvokedScriptUrl = (): string | undefined => {
    if (!process.argv[1]) {
        return undefined;
    }
    try {
        return pathToFileURL(process.argv[1]).href;
    } catch (error) {
        console.warn('Unable to resolve invoked script URL', error);
        return undefined;
    }
};

const isDirectExecution = getInvokedScriptUrl() === import.meta.url;

if (isDirectExecution) {
    runBenchmark().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
