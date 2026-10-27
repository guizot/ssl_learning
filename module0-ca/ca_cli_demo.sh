#!/usr/bin/env bash
set -e

# Move into this script's directory and output to generated/
cd "$(dirname "$0")"
mkdir -p generated/ca generated/clients/alice generated/clients/bob generated/clients/mallory generated/messages
cd generated

echo "================================================================="
echo " PURE CERTIFICATE AUTHORITY (CA) DEMO VIA OPENSSL (ROLE SUBFOLDERS)"
echo "================================================================="
echo

# 1. CREATE ROOT CA
echo ">>> STEP 1: Create Root Certificate Authority (ca/root_ca.key & ca/root_ca.crt)"
openssl ecparam -name secp256k1 -genkey -noout -out ca/root_ca.key
openssl req -new -x509 -key ca/root_ca.key -out ca/root_ca.crt -days 365 \
  -subj "/CN=MyRootCA/O=GlobalTrustAuthority/C=ID"

echo "[+] Created: ca/root_ca.key & ca/root_ca.crt (Self-Signed Root Certificate)"
openssl x509 -in ca/root_ca.crt -noout -issuer -subject -dates
echo

# 2. CLIENT (ALICE) CREATES KEY & CSR
echo ">>> STEP 2: Alice generates Private Key and CSR in clients/alice/"
openssl ecparam -name secp256k1 -genkey -noout -out clients/alice/alice.key
openssl req -new -key clients/alice/alice.key -out clients/alice/alice.csr \
  -subj "/CN=Alice/O=Users/C=ID"

echo "[+] Created: clients/alice/alice.key & clients/alice/alice.csr"
echo "Inside clients/alice/alice.csr:"
openssl req -in clients/alice/alice.csr -noout -text | grep -E "Subject:|Public Key Algorithm:"
echo

# 3. ROOT CA ISSUES ALICE'S CERTIFICATE
echo ">>> STEP 3: Root CA signs Alice's CSR and issues X.509 Certificate (clients/alice/alice.crt)"
openssl x509 -req -in clients/alice/alice.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial \
  -out clients/alice/alice.crt -days 365 -sha256

echo "[+] Created: clients/alice/alice.crt"
echo "Inside clients/alice/alice.crt:"
openssl x509 -in clients/alice/alice.crt -noout -issuer -subject
echo

# 4. VERIFY TRUST CHAIN
echo ">>> STEP 4: Verifying Alice's certificate against Root CA"
openssl verify -CAfile ca/root_ca.crt clients/alice/alice.crt
echo

# 5. FAKE CA / UNTRUSTED TEST
echo ">>> STEP 5: Testing an Untrusted / Fake CA certificate"
openssl ecparam -name secp256k1 -genkey -noout -out ca/fake_ca.key
openssl req -new -x509 -key ca/fake_ca.key -out ca/fake_ca.crt -days 365 -subj "/CN=FakeHackerCA"
openssl x509 -req -in clients/alice/alice.csr -CA ca/fake_ca.crt -CAkey ca/fake_ca.key -CAcreateserial \
  -out clients/alice/fake_alice.crt -days 365 -sha256 2>/dev/null

echo "Attempting to verify fake certificate against trusted ca/root_ca.crt:"
if openssl verify -CAfile ca/root_ca.crt clients/alice/fake_alice.crt; then
  echo "ERROR: Should have been rejected!"
else
  echo "[✓] REJECTED as expected! Untrusted CA was caught by OpenSSL."
fi
echo

# 6. ENCRYPT FILE FOR RECIPIENT (ALICE -> BOB VIA OPENSSL CMS)
echo ">>> STEP 6: Alice encrypts a file for Bob using Bob's CA Certificate"
# Bob sets up key, CSR, and CA signs bob.crt
openssl ecparam -name secp256k1 -genkey -noout -out clients/bob/bob.key
openssl req -new -key clients/bob/bob.key -out clients/bob/bob.csr -subj "/CN=Bob/O=Users/C=ID"
openssl x509 -req -in clients/bob/bob.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial \
  -out clients/bob/bob.crt -days 365 -sha256 2>/dev/null

echo "Original message:"
echo "Top Secret Financial Report 2026: Approved by Alice" > messages/secret_message.txt
cat messages/secret_message.txt

echo "Alice encrypts messages/secret_message.txt using clients/bob/bob.crt (OpenSSL CMS):"
openssl cms -encrypt -in messages/secret_message.txt -out messages/secret_message.enc clients/bob/bob.crt
echo "[+] Created: messages/secret_message.enc (Encrypted envelope)"
echo "Ciphertext size: $(wc -c < messages/secret_message.enc) bytes"
echo

# 7. INTERCEPTION ATTACK VS. LEGITIMATE DECRYPT
echo ">>> STEP 7: Interception Attack vs. Legitimate Decryption"

echo "[7A] Hacker Mallory intercepts the file and tries to decrypt with clients/mallory/mallory.key:"
openssl ecparam -name secp256k1 -genkey -noout -out clients/mallory/mallory.key
if openssl cms -decrypt -in messages/secret_message.enc -inkey clients/mallory/mallory.key 2>/dev/null; then
  echo "ERROR: Mallory should NOT be able to decrypt!"
else
  echo "[✓] ACCESS DENIED! Mallory's private key does not match bob.crt. Zero data leakage."
fi
echo

echo "[7B] Bob legitimately decrypts using clients/bob/bob.key and clients/bob/bob.crt:"
DECRYPTED_TEXT=$(openssl cms -decrypt -in messages/secret_message.enc -inkey clients/bob/bob.key -recip clients/bob/bob.crt)
echo "[✓] SUCCESS! Bob decrypted the message:"
echo "\"$DECRYPTED_TEXT\""
echo

# 8. DIGITAL SIGNATURE + ENCRYPTION (SIGN & ENCRYPT / AUTHENTICATION)
echo ">>> STEP 8: Digital Signature (Bob signs with bob.key + bob.crt, then encrypts for Alice)"
echo "Official Wire Transfer Order: $1,000,000 from Bob" > messages/transfer_order.txt

# 8A. Bob signs the document (Authenticity & Integrity)
openssl cms -sign -in messages/transfer_order.txt -signer clients/bob/bob.crt -inkey clients/bob/bob.key -out messages/transfer_order.signed -nodetach
echo "[+] Bob signed messages/transfer_order.txt with clients/bob/bob.key and clients/bob/bob.crt"

# 8B. Bob encrypts the signed package using clients/alice/alice.crt (Confidentiality)
openssl cms -encrypt -in messages/transfer_order.signed -out messages/transfer_order.enc clients/alice/alice.crt
echo "[+] Bob encrypted the signed package using clients/alice/alice.crt"

# 8C. Alice decrypts the envelope with clients/alice/alice.key
openssl cms -decrypt -in messages/transfer_order.enc -inkey clients/alice/alice.key -recip clients/alice/alice.crt -out messages/alice_received.signed

# 8D. Alice verifies Bob's digital signature against ca/root_ca.crt
echo "Alice verifies the digital signature against ca/root_ca.crt:"
if openssl cms -verify -in messages/alice_received.signed -CAfile ca/root_ca.crt -out messages/alice_received.txt 2>/dev/null; then
  echo "[✓] CMS VERIFICATION SUCCESSFUL! Authenticated by Root CA."
  echo "Plaintext content: \"$(cat messages/alice_received.txt)\""
else
  echo "ERROR: Signature verification failed!"
fi
echo

echo
echo "================================================================="
echo " DONE: All files generated cleanly in role-based folders:"
echo " - ca/       (Root CA files)"
echo " - clients/  (Per-client isolated folders: alice/, bob/, mallory/)"
echo " - messages/ (Encrypted envelopes & payloads)"
echo "================================================================="
