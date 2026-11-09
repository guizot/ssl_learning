import crypto from "node:crypto";
import { verifyAddressFromPublicKey, type Wallet } from "../module1-cryptography/wallet.ts";

export const COINBASE_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface TransactionData {
  from: string;      // Sender wallet address (0x...) or COINBASE_ADDRESS
  to: string;        // Recipient wallet address (0x...)
  amount: number;    // Amount of coins
  fee: number;       // Gas fee paid to the miner/validator
  nonce: number;     // Sender sequence number (anti-replay)
  timestamp: number; // Unix timestamp in ms
}

export interface SignedTransaction {
  id: string;        // Transaction Hash (SHA-256)
  data: TransactionData;
  signatureHex: string;
  senderPublicKeyHex: string;
}

/**
 * Serializes the transaction data canonically.
 * Guaranteeing exact byte-for-byte reproducibility across signers and verifiers.
 */
export function serializeTransaction(data: TransactionData): string {
  return JSON.stringify({
    from: data.from,
    to: data.to,
    amount: data.amount,
    fee: data.fee,
    nonce: data.nonce,
    timestamp: data.timestamp,
  });
}

/**
 * Computes the SHA-256 hash of a transaction data payload.
 */
export function hashTransaction(data: TransactionData): Buffer {
  return crypto.createHash("sha256").update(serializeTransaction(data)).digest();
}

/**
 * Signs a transaction using the sender's private key (secp256k1).
 */
export function signTransaction(
  wallet: Wallet,
  to: string,
  amount: number,
  fee: number = 0,
  nonce: number = 0
): SignedTransaction {
  const data: TransactionData = {
    from: wallet.address,
    to,
    amount,
    fee,
    nonce,
    timestamp: Date.now(),
  };

  const txHash = hashTransaction(data);
  const signature = crypto.sign("SHA256", txHash, wallet.privateKey);

  return {
    id: txHash.toString("hex"),
    data,
    signatureHex: signature.toString("hex"),
    senderPublicKeyHex: wallet.publicKeyHex,
  };
}

/**
 * Creates a Coinbase transaction.
 * Minted out of thin air to reward the miner who solves the Proof-of-Work block!
 * Includes the base block reward + total gas fees collected from transactions in that block.
 */
export function createCoinbaseTransaction(
  minerAddress: string,
  blockReward: number,
  totalFees: number
): SignedTransaction {
  const data: TransactionData = {
    from: COINBASE_ADDRESS,
    to: minerAddress,
    amount: blockReward + totalFees,
    fee: 0,
    nonce: 0,
    timestamp: Date.now(),
  };

  const txHash = hashTransaction(data);

  return {
    id: txHash.toString("hex"),
    data,
    signatureHex: "COINBASE_PROTOCOL_MINT",
    senderPublicKeyHex: "COINBASE",
  };
}

/**
 * Verifies a transaction:
 * 1. Coinbase transactions are system-generated and valid by definition.
 * 2. Regular transactions: verifies public key ties to address and signature matches payload.
 */
export function verifyTransaction(tx: SignedTransaction): { isValid: boolean; reason?: string } {
  // Check if coinbase
  if (tx.data.from === COINBASE_ADDRESS) {
    if (tx.signatureHex === "COINBASE_PROTOCOL_MINT") {
      return { isValid: true };
    }
    return { isValid: false, reason: "Invalid coinbase signature marker" };
  }

  // Check valid amount and fee
  if (tx.data.amount <= 0 || Number.isNaN(tx.data.amount)) {
    return { isValid: false, reason: "Transaction amount must be positive" };
  }
  if (tx.data.fee < 0 || Number.isNaN(tx.data.fee)) {
    return { isValid: false, reason: "Gas fee cannot be negative" };
  }

  // Verify transaction ID matches payload hash
  const calculatedHash = hashTransaction(tx.data).toString("hex");
  if (tx.id !== calculatedHash) {
    return { isValid: false, reason: "Transaction ID does not match payload hash (Payload Tampered)" };
  }

  // Verify sender public key matches claimed 'from' address
  try {
    const rawPubBuffer = Buffer.from(tx.senderPublicKeyHex, "hex");
    const spkiPrefix = Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex");
    const fullSpkiDer = Buffer.concat([spkiPrefix, rawPubBuffer]);

    const publicKey = crypto.createPublicKey({
      key: fullSpkiDer,
      format: "der",
      type: "spki",
    });

    if (!verifyAddressFromPublicKey(publicKey, tx.data.from)) {
      return { isValid: false, reason: "Public key does not match sender address" };
    }

    // Verify ECDSA signature
    const txHash = hashTransaction(tx.data);
    const signature = Buffer.from(tx.signatureHex, "hex");
    const isSignatureValid = crypto.verify("SHA256", txHash, publicKey, signature);

    if (!isSignatureValid) {
      return { isValid: false, reason: "Invalid ECDSA signature" };
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, reason: `Cryptographic verification failed: ${err.message}` };
  }
}
