import crypto from "node:crypto";

export interface Wallet {
  name: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicKeyHex: string;
  address: string;
}

/**
 * Creates a new crypto wallet using the secp256k1 elliptic curve (the same curve used by Bitcoin & Ethereum).
 *
 * In traditional Web2 (OpenSSL/TLS):
 *   You generate a keypair -> send a CSR to a Certificate Authority (DigiCert, Let's Encrypt) -> CA signs a certificate.
 *
 * In Blockchain (Web3):
 *   You generate a keypair -> Address = Hash(PublicKey).
 *   NO Certificate Authority needed. The public key itself is mathematically tied to the address!
 */
export function createWallet(name: string): Wallet {
  // 1. Generate an Elliptic Curve (EC) keypair using the secp256k1 curve
  // Under the hood, Node.js calls OpenSSL's EC_KEY_generate_key with NID_secp256k1.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });

  // 2. Export public key to raw uncompressed bytes (65 bytes: 0x04 + 32-byte X + 32-byte Y)
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = spkiDer.subarray(spkiDer.length - 65);
  const publicKeyHex = rawPublicKey.toString("hex");

  // 3. Derive Address: Hash the public key and take the last 20 bytes (Ethereum-style address derivation)
  // We hash the (X, Y) coordinates without the 0x04 prefix byte
  const coordinates = rawPublicKey.subarray(1);
  const hash = crypto.createHash("sha3-256").update(coordinates).digest();
  const address = "0x" + hash.subarray(hash.length - 20).toString("hex");

  return {
    name,
    privateKey,
    publicKey,
    publicKeyHex,
    address,
  };
}

/**
 * Verifies that a given public key corresponds to a given wallet address.
 */
export function verifyAddressFromPublicKey(publicKey: crypto.KeyObject, address: string): boolean {
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = spkiDer.subarray(spkiDer.length - 65);
  const coordinates = rawPublicKey.subarray(1);
  const hash = crypto.createHash("sha3-256").update(coordinates).digest();
  const derivedAddress = "0x" + hash.subarray(hash.length - 20).toString("hex");

  return derivedAddress.toLowerCase() === address.toLowerCase();
}
