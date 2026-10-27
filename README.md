# Blockchain Fundamentals & Industry Standards

A progressive, hands-on path from foundational cryptography to industry-standard Smart Contract engineering using **TypeScript** and **Solidity**.

---

## Roadmap

- [x] **Module 0: Understanding Keys with OpenSSL (The Bare Metal Concept)**
  - What a Private Key actually is (a 256-bit random number)
  - What a Public Key actually is (a point on elliptic curve `secp256k1`)
  - Generating and inspecting `.pem` keys using OpenSSL CLI
  - Digital signatures with OpenSSL CLI and verifying integrity
  - Deriving a real blockchain account address from an OpenSSL key
- [x] **Module 1: Cryptography & Wallets in Code (The Zero-CA Model)**
  - Elliptic Curve (`secp256k1`) keypair generation via OpenSSL / Node `crypto`
  - Deriving public addresses without a Certificate Authority (CA)
  - Canonical transaction serialization & SHA-256 hashing
  - Digital signatures (ECDSA) and preventing tampering / impersonation attacks
- [ ] **Module 2: The Blockchain Mental Model (Blocks, Nonces & Mining)**
  - Linking blocks with cryptographic hashes (hash pointers)
  - Tamper-evident ledger & chain validation
  - Proof of Work (mining) & state transitions
- [ ] **Module 3: Industry-Standard Smart Contracts (Foundry / Hardhat + Solidity)**
  - Setting up the professional Web3 toolchain
  - Writing Solidity smart contracts (State variables, functions, modifiers, events)
  - Unit testing contracts using TypeScript / Solidity
  - Deploying to a local test network
- [ ] **Module 4: Interacting with Smart Contracts via TypeScript (`viem`)**
  - Reading contract state and executing transactions from frontend/backend TypeScript code

---

## Running Module 1

```bash
node module1-cryptography/demo.ts
```
