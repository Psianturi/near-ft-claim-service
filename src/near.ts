import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'near' });

const normalizeKey = (pk: string): string => {
  let s = (pk || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (!s.startsWith('ed25519:') && !s.startsWith('secp256k1:')) {
    s = `ed25519:${s}`;
  }
  const idx = s.indexOf(':');
  if (idx === -1) return s;
  const curve = s.slice(0, idx);
  let body = s.slice(idx + 1).replace(/\s+/g, '');
  return `${curve}:${body}`;
};

// Singleton pattern for NEAR connection management
class NearConnectionManager {
  private static instance: NearConnectionManager;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // near-api-js properties (sandbox)
  private nearApiJsNear: any = null;
  private nearApiJsAccount: any = null;
  private sandboxAccountPool: Array<{
    account: any;
    near: any;
    publicKey: string;
  }> = [];
  private sandboxAccountActive: number[] = [];
  private sandboxAccountCursor = 0;
  private sandboxMaxPerKey = 1;

  // @eclipseeer/near-api-ts properties (testnet/mainnet)
  private eclipseeerClient: any = null;
  private eclipseeerKeyService: any = null;
  private eclipseeerSigner: any = null;
  private eclipseeerSignerPool: Array<{
    signer: any;
    publicKey: string;
  }> = [];
  private eclipseeerSignerActive: number[] = [];
  private eclipseeerSignerCursor = 0;
  private eclipseeerMaxPerKey = 1;

  private isUsingNearApiJs = false;

  private constructor() {}

  // Try to read validator_key.json produced by near-sandbox and return the secret key for the desired masterAccountId
  private getSandboxKey(masterAccountId: string): string | null {
    try {
      const home = process.env.HOME || '';
      const nearHome = process.env.NEAR_HOME || (home ? path.join(home, '.near') : '');
      const candidates = [
        nearHome ? path.join(nearHome, 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'data', 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'node', 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'node0', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'data', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'node', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'node0', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'sandbox', 'validator_key.json') : '',
      ].filter(Boolean) as string[];

      log.debug({ candidates }, 'Searching sandbox validator keys');

      for (const p of candidates) {
        if (p && fs.existsSync(p)) {
          try {
            const raw = fs.readFileSync(p, 'utf-8');
            const data = JSON.parse(raw);
            const key = data.secret_key || data.private_key || null;
            const accountId = data.account_id || null;
            if (key && accountId === masterAccountId) {
              log.info({ path: p, accountId }, 'Found matching sandbox validator key');
              return key as string;
            } else if (key) {
              log.warn({ path: p, expected: masterAccountId, found: accountId }, 'Validator key account mismatch');
            }
          } catch (e: any) {
            log.warn({ path: p, error: e?.message || e }, 'Failed to read sandbox validator key');
          }
        }
      }
      log.warn({ masterAccountId }, 'No matching sandbox validator key found');
      return null;
    } catch (e: any) {
      log.warn({ error: e?.message || e }, 'Error while searching sandbox validator keys');
      return null;
    }
  }

  static getInstance(): NearConnectionManager {
    if (!NearConnectionManager.instance) {
      NearConnectionManager.instance = new NearConnectionManager();
    }
    return NearConnectionManager.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      log.debug('NEAR connection already initialized, skipping');
      return;
    }

    if (this.initPromise) {
      log.debug('NEAR initialization in progress, waiting');
      return this.initPromise;
    }

    this.initPromise = this._initInternal();
    return this.initPromise;
  }

  private async _initInternal(): Promise<void> {
    try {
      log.info('Starting NEAR connection initialization');

      if (config.networkId === 'sandbox') {
        await this.initNearApiJs();
      } else if (config.networkId === 'testnet' || config.networkId === 'mainnet') {
        await this.initEclipseeerNearApiTs();
      } else {
        throw new Error(`Unsupported networkId: ${config.networkId}. Supported: sandbox, testnet, mainnet`);
      }

      this.initialized = true;
      log.info('NEAR connection initialization completed successfully');
    } catch (error) {
      log.error({ err: error }, 'NEAR connection initialization failed');
      this.initPromise = null;
      throw error;
    }
  }

  // Sandbox: connect using simplified near-api-js approach (like near-ft-claiming-service)
  private async initNearApiJs(): Promise<void> {
    const { connect, keyStores, utils } = await import('near-api-js');

    const masterAccountId = config.masterAccount || 'test.near';
    const nodeUrl = config.nodeUrl || 'http://127.0.0.1:3030';

    const primaryKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY
      ? normalizeKey(process.env.MASTER_ACCOUNT_PRIVATE_KEY)
      : null;
    const keysEnv = process.env.MASTER_ACCOUNT_PRIVATE_KEYS || '';
    const keyStrings = keysEnv
      .split(',')
      .map((value) => normalizeKey(value))
      .filter((value) => value.length > 0);

    if (primaryKey && !keyStrings.includes(primaryKey)) {
      keyStrings.unshift(primaryKey);
    }

    if (keyStrings.length === 0) {
      throw new Error('MASTER_ACCOUNT_PRIVATE_KEY or MASTER_ACCOUNT_PRIVATE_KEYS environment variable is required for sandbox');
    }

    this.sandboxAccountPool = [];
    this.sandboxAccountActive = [];
    this.sandboxAccountCursor = 0;
    this.sandboxMaxPerKey = Math.max(1, parseInt(process.env.SANDBOX_MAX_IN_FLIGHT_PER_KEY || '1', 10));

    for (const key of keyStrings) {
      const keyStore = new keyStores.InMemoryKeyStore();
      const keyPair = utils.KeyPair.fromString(key as any);
      await keyStore.setKey('sandbox', masterAccountId, keyPair);

      const near = await connect({
        networkId: 'sandbox',
        nodeUrl,
        keyStore,
      });

      const account = await near.account(masterAccountId);

      this.sandboxAccountPool.push({
        account,
        near,
        publicKey: keyPair.getPublicKey().toString(),
      });
      this.sandboxAccountActive.push(0);
    }

    this.nearApiJsNear = this.sandboxAccountPool[0]?.near ?? null;
    this.nearApiJsAccount = this.sandboxAccountPool[0]?.account ?? null;

    log.info({
      nodeUrl,
      masterAccountId,
      keyCount: this.sandboxAccountPool.length,
      maxPerKey: this.sandboxMaxPerKey,
    }, 'Sandbox RPC initialized (near-api-js)');

    this.isUsingNearApiJs = true;
    log.info('near-api-js sandbox connection ready');
  }

  // Testnet/Mainnet: keep using @eclipseeer/near-api-ts
  private async initEclipseeerNearApiTs(): Promise<void> {
    const {
      createClient,
      createMemoryKeyService,
      createMemorySigner,
      testnet,
      mainnet,
    } = await import('@eclipseeer/near-api-ts');

    const rpcUrlsEnv = process.env.RPC_URLS;

    const baseHeaders: Record<string, string> = {};
    const fastnearKey = process.env.FASTNEAR_API_KEY;
    const rpcHeadersEnv = process.env.RPC_HEADERS;

    if (rpcHeadersEnv) {
      try {
        const extra = JSON.parse(rpcHeadersEnv);
        if (extra && typeof extra === 'object') {
          Object.assign(baseHeaders, extra as Record<string, string>);
        }
      } catch {
        log.warn('Invalid RPC_HEADERS JSON, ignoring');
      }
    }

    const buildRpcEntry = (url: string) => {
      const headers: Record<string, string> = { ...baseHeaders };
      if (fastnearKey && url.includes('fastnear.com')) {
        headers['Authorization'] = `Bearer ${fastnearKey}`;
        headers['x-api-key'] = fastnearKey;
      }
      return Object.keys(headers).length > 0 ? { url, headers } : { url };
    };

    const probeRpcEntries = async (entries: Array<{ url: string; headers?: Record<string, string> }>) => {
      const working: typeof entries = [];
      for (const entry of entries) {
        const headers = {
          'Content-Type': 'application/json',
          ...(entry.headers ?? {}),
        };
        try {
          const response = await fetch(entry.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'health-check',
              method: 'block',
              params: { finality: 'final' },
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const payload = await response.json();
          if (payload?.error) {
            throw new Error(payload.error?.message || 'RPC error during probe');
          }

          working.push(entry);
        } catch (error: any) {
          log.warn({
            url: entry.url,
            error: error?.message || error,
          }, 'Skipping RPC URL that failed health probe');
        }
      }

      if (working.length === 0) {
        throw new Error('RPC_URLS defined but none passed the health probe');
      }

      return working;
    };

    let network: any;

    if (rpcUrlsEnv) {
      const urls = rpcUrlsEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        throw new Error('RPC_URLS provided but no valid URLs found');
      }
      const entries = urls.map((url) => buildRpcEntry(url));
      const healthyEntries = await probeRpcEntries(entries);
      network = {
        rpcs: {
          regular: healthyEntries,
          archival: healthyEntries,
        },
      };
    } else if (config.nodeUrl) {
      const entry = buildRpcEntry(config.nodeUrl);
      const healthyEntries = await probeRpcEntries([entry]);
      network = {
        rpcs: {
          regular: healthyEntries,
          archival: healthyEntries,
        },
      };
    } else if (config.networkId === 'testnet') {
      network = testnet;
    } else if (config.networkId === 'mainnet') {
      network = mainnet;
    } else {
      throw new Error(`Unsupported networkId: ${config.networkId}. Only testnet and mainnet are supported with @eclipseeer/near-api-ts.`);
    }

    this.eclipseeerClient = createClient({ network });

    log.debug({
      hasMasterAccountPrivateKey: !!process.env.MASTER_ACCOUNT_PRIVATE_KEY,
      hasMasterAccountPrivateKeys: !!process.env.MASTER_ACCOUNT_PRIVATE_KEYS,
    }, 'Environment variables check');

    const parseKeyEntries = (): Array<{ accountId: string; privateKey: string }> => {
      const result: Array<{ accountId: string; privateKey: string }> = [];
      const raw = process.env.MASTER_ACCOUNT_PRIVATE_KEYS?.trim();

      if (raw && raw.length > 0) {
        let normalizedRaw = raw;
        if (
          (normalizedRaw.startsWith('"') && normalizedRaw.endsWith('"')) ||
          (normalizedRaw.startsWith("'") && normalizedRaw.endsWith("'"))
        ) {
          normalizedRaw = normalizedRaw.slice(1, -1).trim();
        }

        if (normalizedRaw.startsWith('[')) {
          try {
            const parsed = JSON.parse(normalizedRaw);
            if (Array.isArray(parsed)) {
              for (const entry of parsed) {
                if (typeof entry === 'string') {
                  const trimmed = entry.trim();
                  if (trimmed) {
                    result.push({ accountId: config.masterAccount, privateKey: trimmed });
                  }
                } else if (entry && typeof entry === 'object') {
                  const privateKey = (entry.private_key || entry.privateKey || entry.key || entry.secretKey || '').toString().trim();
                  const accountId = (entry.account_id || entry.accountId || entry.account || config.masterAccount || '').toString().trim();
                  if (!privateKey) {
                    log.warn({ entry }, 'Skipping key entry without private_key');
                    continue;
                  }
                  result.push({
                    accountId: accountId || config.masterAccount,
                    privateKey,
                  });
                } else {
                  log.warn({ entry }, 'Unrecognized key entry format (expected string or object)');
                }
              }
            } else {
              log.warn('MASTER_ACCOUNT_PRIVATE_KEYS JSON did not parse to an array; falling back to comma parsing');
            }
          } catch (error: any) {
            log.warn({ error: error?.message || error }, 'Failed to parse MASTER_ACCOUNT_PRIVATE_KEYS as JSON; falling back to comma parsing');
          }
        }

        if (result.length === 0) {
          const pieces = normalizedRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const piece of pieces) {
            result.push({ accountId: config.masterAccount, privateKey: piece });
          }
        }
      }

      return result;
    };

    let keyEntries = parseKeyEntries();

    if (keyEntries.length === 0) {
      const single = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
      if (!single || single.trim().length === 0) {
        log.error({
          envKeys: Object.keys(process.env).filter((key) => key.includes('MASTER') || key.includes('PRIVATE')),
        }, 'Missing master account private key environment variables');
        throw new Error(
          'MASTER_ACCOUNT_PRIVATE_KEY or MASTER_ACCOUNT_PRIVATE_KEYS environment variable is required'
        );
      }
      keyEntries = [{ accountId: config.masterAccount, privateKey: single.trim() }];
      log.info('Using MASTER_ACCOUNT_PRIVATE_KEY');
    } else {
      log.info({ keyCount: keyEntries.length }, 'Using MASTER_ACCOUNT_PRIVATE_KEYS');
    }

    const { utils } = await import('near-api-js');

    const resolvedKeyEntries = keyEntries.map(({ accountId, privateKey }) => {
      const normalized = normalizeKey(privateKey);
      const keyPair = utils.KeyPair.fromString(normalized as any);
      return {
        accountId: (accountId && accountId.trim()) || config.masterAccount,
        privateKey: normalized,
        publicKey: keyPair.getPublicKey().toString(),
        keyPair,
      };
    });

    let onChainPublicKeys: Set<string> | null = null;
    try {
      const { accountKeys } = await this.eclipseeerClient.getAccountKeys({
        accountId: config.masterAccount,
      });
      if (Array.isArray(accountKeys)) {
        onChainPublicKeys = new Set(accountKeys.map((key: any) => key.publicKey));
      }
    } catch (error: any) {
      log.warn({ error: error?.message || error }, 'Failed to fetch on-chain keys for master account');
    }

    let filteredKeyEntries = resolvedKeyEntries;

    if (onChainPublicKeys && onChainPublicKeys.size > 0) {
      const missing = filteredKeyEntries.filter((entry) => !onChainPublicKeys!.has(entry.publicKey));
      if (missing.length > 0) {
        log.warn({
          missingPublicKeys: missing.map((entry) => entry.publicKey),
        }, 'Ignoring master keys not registered on-chain');
      }

      const usable = filteredKeyEntries.filter((entry) => onChainPublicKeys!.has(entry.publicKey));
      if (usable.length === 0) {
        log.error({
          desiredPublicKeys: filteredKeyEntries.map((entry) => entry.publicKey),
          onChainPublicKeys: Array.from(onChainPublicKeys.values()),
        }, 'No matching master account keys found on-chain');
        throw new Error('Master account has no matching public keys registered on-chain. Please register at least one key before starting the service.');
      }
      filteredKeyEntries = usable;
    }

    const privateKeys = filteredKeyEntries.map((entry) => entry.privateKey);

    log.debug({
      entries: filteredKeyEntries.map(({ accountId, publicKey }) => ({ accountId, publicKey })),
    }, 'Parsed master account keys');

    const keySources = filteredKeyEntries.map(({ privateKey }) => ({
      privateKey,
    }));

    this.eclipseeerKeyService = await createMemoryKeyService({
      keySources,
    } as any);

    let signingKeys: string[] = [];
    try {
      const keyPairs = (this.eclipseeerKeyService as any).getKeyPairs
        ? (this.eclipseeerKeyService as any).getKeyPairs()
        : {};
      signingKeys = Object.keys(keyPairs);
    } catch {
      signingKeys = [];
    }

    this.eclipseeerSigner = await createMemorySigner({
      signerAccountId: config.masterAccount,
      client: this.eclipseeerClient,
      keyService: this.eclipseeerKeyService,
      ...(signingKeys.length > 0 ? { keyPool: { signingKeys } } : {}),
    } as any);

    this.eclipseeerSignerPool = [];
    this.eclipseeerSignerActive = [];
    this.eclipseeerSignerCursor = 0;
    this.eclipseeerMaxPerKey = Math.max(
      1,
      parseInt(
        process.env.TESTNET_MAX_IN_FLIGHT_PER_KEY ||
          process.env.MAX_IN_FLIGHT_PER_KEY ||
          '4',
        10,
      ),
    );

    for (const { accountId, privateKey, publicKey } of filteredKeyEntries) {
      const keyService = await createMemoryKeyService({
        keySource: {
          privateKey,
        },
      } as any);
      const signer = await createMemorySigner({
        signerAccountId: accountId,
        client: this.eclipseeerClient,
        keyService,
      } as any);
      this.eclipseeerSignerPool.push({
        signer,
        publicKey,
      });
      this.eclipseeerSignerActive.push(0);
    }

    this.isUsingNearApiJs = false;
    const derivedHeaderCount = Object.keys(baseHeaders).length + (fastnearKey ? 2 : 0);

    log.info({
      keyCount: privateKeys.length,
      rpcUrlCount: rpcUrlsEnv ? rpcUrlsEnv.split(',').length : 1,
      headerCount: derivedHeaderCount,
      maxPerKey: this.eclipseeerMaxPerKey,
    }, '@eclipseeer/near-api-ts connection ready');
  }

  getNear(): any {
    if (!this.initialized) {
      throw new Error('NEAR connection not initialized. Call init() first.');
    }

    if (this.isUsingNearApiJs) {
      if (!this.nearApiJsAccount) {
        throw new Error('Sandbox account not initialized');
      }
      return {
        account: this.nearApiJsAccount,
        near: this.nearApiJsNear,
        acquireAccount: () => this.acquireSandboxAccount(),
      };
    } else {
      if (!this.eclipseeerSigner) {
        throw new Error('Testnet signer not initialized');
      }
      return {
        signer: this.eclipseeerSigner,
        client: this.eclipseeerClient,
        acquireSigner: () => this.acquireTestnetSigner(),
      };
    }
  }

  private async acquireSandboxAccount(): Promise<{
    account: any;
    near: any;
    publicKey: string;
    index: number;
    poolSize: number;
    release: () => void;
  }> {
    if (!this.isUsingNearApiJs) {
      throw new Error('Sandbox account pool is only available when using near-api-js');
    }

    if (this.sandboxAccountPool.length === 0) {
      throw new Error('Sandbox account pool not initialized');
    }

    const poolSize = this.sandboxAccountPool.length;

    while (true) {
      for (let i = 0; i < poolSize; i++) {
        const index = (this.sandboxAccountCursor + i) % poolSize;
        const active = this.sandboxAccountActive[index] ?? 0;
        if (active < this.sandboxMaxPerKey) {
          this.sandboxAccountCursor = (index + 1) % poolSize;
          this.sandboxAccountActive[index] = active + 1;
          const slot = this.sandboxAccountPool[index];
          return {
            account: slot.account,
            near: slot.near,
            publicKey: slot.publicKey,
            index,
            poolSize,
            release: () => this.releaseSandboxAccount(index),
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private releaseSandboxAccount(index: number): void {
    if (this.sandboxAccountPool.length === 0) {
      return;
    }

    const active = this.sandboxAccountActive[index] ?? 0;
    const nextActive = Math.max(0, active - 1);
    this.sandboxAccountActive[index] = nextActive;
  }

  private async acquireTestnetSigner(): Promise<{
    signer: any;
    publicKey: string;
    index: number;
    poolSize: number;
    release: () => void;
  }> {
    if (this.isUsingNearApiJs) {
      throw new Error('Testnet signer pool is only available when using @eclipseeer/near-api-ts');
    }

    if (this.eclipseeerSignerPool.length === 0) {
      throw new Error('Testnet signer pool not initialized');
    }

    const poolSize = this.eclipseeerSignerPool.length;

    while (true) {
      for (let i = 0; i < poolSize; i++) {
        const index = (this.eclipseeerSignerCursor + i) % poolSize;
        const active = this.eclipseeerSignerActive[index] ?? 0;
        if (active < this.eclipseeerMaxPerKey) {
          this.eclipseeerSignerCursor = (index + 1) % poolSize;
          this.eclipseeerSignerActive[index] = active + 1;
          const slot = this.eclipseeerSignerPool[index];
          return {
            signer: slot.signer,
            publicKey: slot.publicKey,
            index,
            poolSize,
            release: () => this.releaseTestnetSigner(index),
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private releaseTestnetSigner(index: number): void {
    if (this.eclipseeerSignerPool.length === 0) {
      return;
    }

    const active = this.eclipseeerSignerActive[index] ?? 0;
    const nextActive = Math.max(0, active - 1);
    this.eclipseeerSignerActive[index] = nextActive;
  }

  async cleanup(): Promise<void> {
    // no-op for near-api-js RPC connections
  }
}

// Export singleton instance functions
const connectionManager = NearConnectionManager.getInstance();

export const initNear = () => connectionManager.init();
export const getNear = () => connectionManager.getNear();

// Cleanup function for graceful shutdown
export const cleanupNear = () => connectionManager.cleanup();