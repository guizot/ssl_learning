import { createWallet } from "./wallet.ts";
import { signTransaction, verifyTransaction } from "./transaction.ts";
import type { SignedTransaction } from "./transaction.ts";

console.log("===============================================================");
console.log(" MODULE 1: CRYPTOGRAPHY & WALLETS (THE ZERO-CA FOUNDATION)");
console.log("===============================================================\n");

// -----------------------------------------------------------------------------
// STEP 1: Generate Wallets (Private Key -> Public Key -> Address)
// -----------------------------------------------------------------------------
console.log("--- 1. GENERATING WALLETS (secp256k1 Elliptic Curve via OpenSSL) ---");
console.log("In Web2: You need DigiCert or Let's Encrypt (a CA) to vouch for you.");
console.log("In Web3: Math alone guarantees identity. Your Address = Hash(Public Key).\n");

const alice = createWallet("Alice");
const bob = createWallet("Bob");
const mallory = createWallet("Mallory (Attacker)");

console.log(`[+] Alice's Wallet Created:`);
console.log(`    Address (Public ID) : ${alice.address}`);
console.log(`    Public Key (Hex)    : ${alice.publicKeyHex.slice(0, 30)}... [${alice.publicKeyHex.length / 2} bytes]`);
console.log(`    Private Key         : [KEEP SECRET! Stored in wallet only]\n`);

console.log(`[+] Bob's Wallet Created:`);
console.log(`    Address (Public ID) : ${bob.address}\n`);

console.log(`[+] Mallory's Wallet Created:`);
console.log(`    Address (Public ID) : ${mallory.address}\n`);

// -----------------------------------------------------------------------------
// STEP 2 & 3: Alice creates and signs a transaction to Bob
// -----------------------------------------------------------------------------
console.log("--- 2. ALICE SENDS 15 COINS TO BOB ---");
const nonce = 0; // First transaction from Alice's account
const signedTx = signTransaction(alice, bob.address, 15, nonce);

console.log("Transaction Details:");
console.log(JSON.stringify(signedTx.data, null, 2));
console.log(`\nAlice's ECDSA Signature:`);
console.log(`${signedTx.signatureHex}\n`);

// -----------------------------------------------------------------------------
// STEP 4: Network Node Verifies the Transaction
// -----------------------------------------------------------------------------
console.log("--- 3. NETWORK VALIDATION (Zero-Trust) ---");
console.log("A miner or validator receives the transaction. Can they verify it without trusting Alice?");

const validResult = verifyTransaction(signedTx);
if (validResult.isValid) {
  console.log(">>> RESULT:  TRANSACTION IS VALID! Verified cryptographically with no central server.");
} else {
  console.log(`>>> RESULT: ❌ REJECTED: ${validResult.reason}`);
}
console.log();

// -----------------------------------------------------------------------------
// STEP 5: Attack Scenario 1 - Mallory intercepts and tampers with the AMOUNT
// -----------------------------------------------------------------------------
console.log("--- 4. ATTACK SCENARIO 1: TAMPERING WITH THE AMOUNT ---");
console.log("Mallory intercepts the transaction and changes amount from 15 to 1,500 coins.");

const tamperedAmountTx: SignedTransaction = {
  ...signedTx,
  data: {
    ...signedTx.data,
    amount: 1500, // Altered!
  },
};

const attack1Result = verifyTransaction(tamperedAmountTx);
console.log(`>>> Tampered Verification Result: ${attack1Result.isValid ? " VALID" : "❌ REJECTED"}`);
console.log(`    Reason: ${attack1Result.reason}\n`);

// -----------------------------------------------------------------------------
// STEP 6: Attack Scenario 2 - Mallory redirects the funds to herself
// -----------------------------------------------------------------------------
console.log("--- 5. ATTACK SCENARIO 2: HIJACKING THE RECIPIENT ---");
console.log("Mallory intercepts the transaction and changes recipient from Bob to Mallory.");

const hijackedRecipientTx: SignedTransaction = {
  ...signedTx,
  data: {
    ...signedTx.data,
    to: mallory.address, // Altered!
  },
};

const attack2Result = verifyTransaction(hijackedRecipientTx);
console.log(`>>> Hijacked Verification Result: ${attack2Result.isValid ? " VALID" : "❌ REJECTED"}`);
console.log(`    Reason: ${attack2Result.reason}\n`);

// -----------------------------------------------------------------------------
// STEP 7: Attack Scenario 3 - Mallory tries to impersonate Alice
// -----------------------------------------------------------------------------
console.log("--- 6. ATTACK SCENARIO 3: IDENTITY SPOOFING ---");
console.log("Mallory signs a transaction transferring coins FROM Alice, but signs it with Mallory's own key.");

// Mallory tries to spend Alice's money by signing with Mallory's key
const spoofedTx = signTransaction(mallory, bob.address, 50, 0);
spoofedTx.data.from = alice.address; // Mallory claims this is from Alice!

const attack3Result = verifyTransaction(spoofedTx);
console.log(`>>> Spoofed Verification Result: ${attack3Result.isValid ? " VALID" : "❌ REJECTED"}`);
console.log(`    Reason: ${attack3Result.reason}\n`);

// -----------------------------------------------------------------------------
// SUMMARY & THE BRIDGE TO MODULE 2
// -----------------------------------------------------------------------------
console.log("===============================================================");
console.log(" SUMMARY & KEY TAKEAWAYS");
console.log("===============================================================");
console.log("1. No Certificate Authority (CA):");
console.log("   In Web2 (OpenSSL/TLS), a CA tells you whose public key it is.");
console.log("   In Web3, the public key IS the identity (hashed into the address).");
console.log("2. Integrity & Non-Repudiation:");
console.log("   Changing even 1 character in a transaction invalidates the ECDSA signature.");
console.log("3. What's Missing? (Why we need Module 2):");
console.log("   Cryptographic signatures prove *who authorized a transaction*.");
console.log("   BUT they do NOT solve the Double-Spending problem (e.g. Alice sends her");
console.log("   only 15 coins to Bob AND simultaneously sends those same 15 coins to Charlie).");
console.log("   To solve that, we bundle transactions into BLOCKS linked by hashes (Blockchain)!");
console.log("===============================================================\n");
