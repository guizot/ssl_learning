import crypto from "node:crypto";
import { verifyAddressFromPublicKey } from "./wallet.ts";
import type { Wallet } from "./wallet.ts";

export interface TransactionData {
  from: string;      // Sender wallet address (0x...)
  to: string;        // Recipient wallet address (0x...)
  amount: number;    // Amount of coins
  nonce: number;     // Sequence number to prevent replay attacks
  timestamp: number; // Unix timestamp
}

export interface SignedTransaction {
  data: TransactionData;
  signatureHex: string;
  senderPublicKeyHex: string;
}

/**
 * Serializes the transaction data into a deterministic canonical string.
 * This guarantees both signer and verifier hash the exact same byte sequence.
 */
export function serializeTransaction(tx: TransactionData): string {
  return JSON.stringify({
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
  });
}

/**
 * Hashes the serialized transaction using SHA-256.
 */
export function hashTransaction(tx: TransactionData): Buffer {
  const serialized = serializeTransaction(tx);
  return crypto.createHash("sha256").update(serialized).digest();
}

/**
 * Signs the transaction using the sender's private key.
 *
 * Notice: The private key NEVER leaves the user's computer/wallet.
 * Only the resulting signature and public key are broadcast to the network.
 */
export function signTransaction(wallet: Wallet, to: string, amount: number, nonce: number): SignedTransaction {
  const data: TransactionData = {
    from: wallet.address,
    to,
    amount,
    nonce,
    timestamp: Date.now(),
  };

  const txHash = hashTransaction(data);

  // Sign using ECDSA (Elliptic Curve Digital Signature Algorithm) with SHA-256
  const signature = crypto.sign("SHA256", txHash, wallet.privateKey);

  return {
    data,
    signatureHex: signature.toString("hex"),
    senderPublicKeyHex: wallet.publicKeyHex,
  };
}

export interface VerificationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Verifies a transaction using only math:
 * 1. Is the public key genuinely tied to the sender's address? (No Certificate Authority needed)
 * 2. Did the owner of that private key actually sign this exact data?
 */
export function verifyTransaction(tx: SignedTransaction): VerificationResult {
  // Reconstruct the public key from the hex string
  const rawPubBuffer = Buffer.from(tx.senderPublicKeyHex, "hex");

  // Re-wrap the raw 65-byte uncompressed key into an SPKI DER structure for Node.js crypto
  // ASN.1 header for secp256k1 public key (23 bytes prefix)
  const spkiPrefix = Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex");
  const fullSpkiDer = Buffer.concat([spkiPrefix, rawPubBuffer]);

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({
      key: fullSpkiDer,
      format: "der",
      type: "spki",
    });
  } catch (err) {
    return { isValid: false, reason: "Malformed public key" };
  }

  // Check 1: Does the sender's claimed address match the hash of their public key?
  const addressMatches = verifyAddressFromPublicKey(publicKey, tx.data.from);
  if (!addressMatches) {
    return {
      isValid: false,
      reason: "Address mismatch! The public key does not hash to the 'from' address.",
    };
  }

  // Check 2: Recompute the hash of the transaction data
  const txHash = hashTransaction(tx.data);
  const signatureBuffer = Buffer.from(tx.signatureHex, "hex");

  // Check 3: Mathematically verify the signature against the hash
  const signatureValid = crypto.verify("SHA256", txHash, publicKey, signatureBuffer);
  if (!signatureValid) {
    return {
      isValid: false,
      reason: "Invalid cryptographic signature! The data was tampered with or signed by a different key.",
    };
  }

  return { isValid: true };
}
