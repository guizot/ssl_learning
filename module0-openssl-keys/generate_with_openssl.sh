#!/usr/bin/env bash
set -e

# Move into this script's directory and output to generated/
cd "$(dirname "$0")"
mkdir -p generated
cd generated

echo "================================================================="
echo " MODULE 0: UNDERSTANDING KEYS WITH OPENSSL"
echo "================================================================="
echo

# ----------------------------------------------------------------------
# 1. GENERATE A SECP256K1 PRIVATE KEY
# ----------------------------------------------------------------------
echo ">>> STEP 1: Generate a private key using OpenSSL"
echo "Command: openssl ecparam -name secp256k1 -genkey -noout -out alice_private.pem"
openssl ecparam -name secp256k1 -genkey -noout -out alice_private.pem

echo "[+] Generated: alice_private.pem"
echo "Let's see what the PEM file looks like on disk:"
cat alice_private.pem
echo

# ----------------------------------------------------------------------
# 2. INSPECT THE RAW BYTES OF THE PRIVATE KEY
# ----------------------------------------------------------------------
echo ">>> STEP 2: Inspect what is inside that private key"
echo "Command: openssl ec -in alice_private.pem -text -noout"
openssl ec -in alice_private.pem -text -noout
echo
echo "KEY INSIGHT: Look at 'priv:' above."
echo "A private key is NOT magic. It is literally just a 32-byte (256-bit) random number!"
echo

# ----------------------------------------------------------------------
# 3. EXTRACT THE PUBLIC KEY
# ----------------------------------------------------------------------
echo ">>> STEP 3: Derive the Public Key from the Private Key"
echo "Command: openssl ec -in alice_private.pem -pubout -out alice_public.pem"
openssl ec -in alice_private.pem -pubout -out alice_public.pem

echo "[+] Generated: alice_public.pem"
cat alice_public.pem
echo

echo "Let's inspect the raw Public Key coordinates:"
openssl ec -in alice_public.pem -pubin -text -noout
echo
echo "KEY INSIGHT: Look at 'pub:' above."
echo "The public key starts with '04' (uncompressed indicator), followed by:"
echo "  - 32 bytes for the X coordinate on the elliptic curve"
echo "  - 32 bytes for the Y coordinate on the elliptic curve"
echo "  Total: 65 bytes."
echo

# ----------------------------------------------------------------------
# 4. SIGN A MESSAGE WITH OPENSSL
# ----------------------------------------------------------------------
echo ">>> STEP 4: Alice signs a statement using her Private Key"
echo "Hello, I am Alice. I authorize sending 10 coins to Bob." > message.txt

echo "Original message:"
cat message.txt
echo

echo "Signing the message with SHA-256 and alice_private.pem..."
openssl dgst -sha256 -sign alice_private.pem -out signature.bin message.txt
echo "[+] Digital signature created (signature.bin)!"
echo "Signature length: $(wc -c < signature.bin | tr -d ' ') bytes"
echo "Signature (hex): $(xxd -p -c 256 signature.bin 2>/dev/null || od -An -tx1 signature.bin | tr -d ' \n')"
echo

# ----------------------------------------------------------------------
# 5. VERIFY THE SIGNATURE USING ONLY THE PUBLIC KEY
# ----------------------------------------------------------------------
echo ">>> STEP 5: Anyone in the world verifies the signature using alice_public.pem"
echo "Command: openssl dgst -sha256 -verify alice_public.pem -signature signature.bin message.txt"
openssl dgst -sha256 -verify alice_public.pem -signature signature.bin message.txt
echo

# ----------------------------------------------------------------------
# 6. TAMPER DEMONSTRATION
# ----------------------------------------------------------------------
echo ">>> STEP 6: What happens if an attacker modifies the message?"
echo "Attacker changes the message to: 'Hello, I am Alice. I authorize sending 10000 coins to Mallory.'"
echo "Hello, I am Alice. I authorize sending 10000 coins to Mallory." > tampered_message.txt

echo "Verifying the same signature against the tampered message:"
if openssl dgst -sha256 -verify alice_public.pem -signature signature.bin tampered_message.txt; then
    echo "ERROR: Should not pass!"
else
    echo ">> REJECTED! OpenSSL caught the tampering because the signature did not match!"
fi
echo

echo "================================================================="
echo " DONE: OpenSSL demonstrated private keys, public keys, and signatures!"
echo "================================================================="
