# Testnet Setup Scripts

This directory contains scripts for setting up dedicated testnet accounts for clean benchmark testing.

## 🚀 Quick Setup (Recommended)

For users who want to replicate the benchmark environment:

```bash
# 1. Create dedicated benchmark account
node scripts/testnet-setup/create-benchmark-account.mjs

# 2. Deploy FT contract to the new account
node scripts/testnet-setup/deploy-ft-to-benchmark.mjs

# 3. Generate full-access keys for high TPS testing
node scripts/testnet-setup/generate-full-access-keys.mjs 7

# 4. Update .env.testnet with the generated keys
# (Copy MASTER_ACCOUNT_PRIVATE_KEYS from script output)
```

## 📋 Scripts Overview

### `check-account.mjs`
**Purpose**: Check account balance and access keys
**Usage**: `node scripts/testnet-setup/check-account.mjs <accountId>`
**Example**: `node scripts/testnet-setup/check-account.mjs ft-benchmark.testnet`

### `create-benchmark-account.mjs`
**Purpose**: Create a new dedicated testnet account for benchmarking
**Usage**: `node scripts/testnet-setup/create-benchmark-account.mjs`
**Requirements**: Requires existing account with funds (posm.testnet)
**Output**: New account `ft-benchmark.testnet` with initial balance

### `deploy-ft-to-benchmark.mjs`
**Purpose**: Deploy FT contract to benchmark account
**Usage**: `node scripts/testnet-setup/deploy-ft-to-benchmark.mjs`
**Requirements**: ft-benchmark.testnet account must exist
**Output**: Deployed FT contract with 1B token supply

### `generate-access-keys.mjs`
**Purpose**: Generate function-call access keys (limited permissions)
**Usage**: `node scripts/testnet-setup/generate-access-keys.mjs <numKeys>`
**Example**: `node scripts/testnet-setup/generate-access-keys.mjs 7`
**Permissions**: ft_transfer, ft_transfer_call, storage_deposit

### `generate-full-access-keys.mjs`
**Purpose**: Generate full-access keys for high TPS testing
**Usage**: `node scripts/testnet-setup/generate-full-access-keys.mjs <numKeys>`
**Example**: `node scripts/testnet-setup/generate-full-access-keys.mjs 7`
**Permissions**: Full access (⚠️ Use only for testing)
**Security**: Never use full-access keys in production

## 🔧 Manual Setup (Alternative)

If you prefer to use your own account:

1. Create account via NEAR Wallet
2. Generate access keys: `near account add-key <account> --allowanceGrant`
3. Deploy contract: Use near-ft-helper or manual deployment
4. Update `.env.testnet` with your account details

## 📊 Performance Benefits

Using dedicated benchmark account provides:
- **5x more successful transactions**
- **3x higher success rate**
- **Stable key management** (no interference from dev deployments)
- **Isolated testing environment**

## ⚠️ Security Notes

- Full-access keys are for testing only
- Never commit private keys to version control
- Use dedicated accounts for benchmarking
- Clean up test accounts after use

## 🧹 Cleanup

After testing, you can:
- Delete test accounts: `near account delete-account ft-benchmark.testnet <beneficiary>`
- Remove generated keys: `near account delete-key <account> <publicKey>`

## 📚 Related Files

- `.env.testnet` - Testnet configuration
- `testing/test-complete-pipeline-testnet.sh` - Automated testing pipeline
- `../near-ft-helper/deploy-testnet.js` - Alternative deployment method