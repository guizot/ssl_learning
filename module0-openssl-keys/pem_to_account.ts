import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("===============================================================");
console.log(" CONVERTING AN OPENSSL KEY INTO A BLOCKCHAIN ACCOUNT / ADDRESS ");
console.log("===============================================================\n");

const genPemPath = path.join(__dirname, "generated", "alice_public.pem");
const rootPemPath = path.join(__dirname, "alice_public.pem");
const pemPath = fs.existsSync(genPemPath) ? genPemPath : rootPemPath;

if (!fs.existsSync(pemPath)) {
  console.error("❌ alice_public.pem not found in generated/ folder. Run ./generate_with_openssl.sh or use the UI first!");
  process.exit(1);
}

const pemContent = fs.readFileSync(pemPath, "utf-8");
console.log("1. Reading OpenSSL Public Key from alice_public.pem:");
console.log(pemContent.trim());
console.log();

// Parse the PEM using Node crypto
const pubKeyObj = crypto.createPublicKey(pemContent);

// Export to DER (binary) format to extract the uncompressed 65 bytes
const derBuffer = pubKeyObj.export({ type: "spki", format: "der" });

// The uncompressed key is the last 65 bytes (0x04 + 32-byte X + 32-byte Y)
const uncompressedKey = derBuffer.subarray(derBuffer.length - 65);
const prefix = uncompressedKey[0];
const xCoord = uncompressedKey.subarray(1, 33);
const yCoord = uncompressedKey.subarray(33, 65);

console.log("2. Deconstructing the Public Key:");
console.log(`   Prefix byte : 0x0${prefix.toString(16)} (0x04 means uncompressed point)`);
console.log(`   X coordinate: ${xCoord.toString("hex")}`);
console.log(`   Y coordinate: ${yCoord.toString("hex")}`);
console.log(`   Total raw key bytes: ${uncompressedKey.length} bytes`);
console.log();

// Blockchain Address derivation:
// Take the 64 bytes of (X, Y) coordinates, hash them, and take the last 20 bytes.
const coordinates = uncompressedKey.subarray(1);
const hash = crypto.createHash("sha3-256").update(coordinates).digest();
const rawAddress = hash.subarray(hash.length - 20);
const accountAddress = "0x" + rawAddress.toString("hex");

console.log("3. Deriving the Blockchain Account (Address):");
console.log("   Formula: Address = 0x + Last_20_Bytes( Hash( X_coord + Y_coord ) )");
console.log(`   Hash (32 bytes): ${hash.toString("hex")}`);
console.log();
console.log("===============================================================");
console.log(`>>> YOUR BLOCKCHAIN ACCOUNT (ADDRESS):`);
console.log(`    ${accountAddress}`);
console.log("===============================================================");
console.log("\nWhat did we just prove?");
console.log("1. An 'Account' in blockchain is NOT created in a database or bank.");
console.log("2. You can generate an account completely offline on an airplane using OpenSSL!");
console.log("3. Anyone who knows your address can send you coins.");
console.log("4. ONLY the person with alice_private.pem can authorize spending those coins.");
console.log();
