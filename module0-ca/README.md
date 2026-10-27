# Module 0: Pure Certificate Authority (CA) & PKI Simulator

This module is a **pure, authentic implementation of Public Key Infrastructure (PKI)** using **OpenSSL 3.6.3**, demonstrating how Digital Certificates, Trust Chains, Role-based separation, and Digital Signatures work in Web2 (HTTPS/TLS) before exploring how Blockchain eliminates them.

---

## Directory Organization by Role

All generated artifacts are cleanly organized by operational role under `module0-ca/generated/`:

```
module0-ca/generated/
├── ca/                           # 🏛️ Role: Admin (Root Certificate Authority)
│   ├── root_ca.key               # CA Master Private Key
│   ├── root_ca.crt               # CA Self-Signed Root Certificate
│   ├── root_ca.srl               # Serial tracking file
│   ├── fake_ca.key               # (Security test) Rogue CA key
│   └── fake_ca.crt               # (Security test) Rogue CA self-signed cert
│
├── clients/                      # 👤 Role: Client Keystores (Isolated per client)
│   ├── alice/
│   │   ├── alice.key             # Alice's EC Private Key (secp256k1)
│   │   ├── alice.csr             # Alice's Certificate Signing Request
│   │   └── alice.crt             # Alice's CA-Signed X.509 Certificate
│   ├── bob/
│   │   ├── bob.key               # Bob's EC Private Key (secp256k1)
│   │   ├── bob.csr               # Bob's Certificate Signing Request
│   │   └── bob.crt               # Bob's CA-Signed X.509 Certificate
│   └── mallory/
│       └── mallory.key           # Attacker's rogue key (for interception testing)
│
├── messages/                     # 🔒 Encrypted Envelopes & Intermediate Payloads
│   ├── msg_<timestamp>.enc       # S/MIME CMS Encrypted envelopes
│   ├── secret_message.txt        # Plaintext payload
│   └── secret_message.enc        # Encrypted payload
│
├── clients.json                  # Client registry metadata
└── messages.json                 # Inbox delivery metadata
```

---

## 8-Step OpenSSL Commands with Role Subfolders

Navigate to the generated directory root:
```bash
cd module0-ca/generated
```

### Step 1: Create Root Certificate Authority (Admin)
```bash
# 1. Generate CA Private Key
openssl ecparam -name secp256k1 -genkey -noout -out ca/root_ca.key

# 2. Self-sign the Root CA Certificate (valid for 365 days)
openssl req -new -x509 -key ca/root_ca.key -out ca/root_ca.crt -days 365 \
  -subj "/CN=MyRootCA/O=GlobalTrustAuthority/C=ID"
```

### Step 2: Client Alice Generates Key & CSR
```bash
mkdir -p clients/alice
# 1. Alice generates her private key
openssl ecparam -name secp256k1 -genkey -noout -out clients/alice/alice.key

# 2. Alice creates a CSR (contains her public key + identity "CN=Alice")
openssl req -new -key clients/alice/alice.key -out clients/alice/alice.csr \
  -subj "/CN=Alice/O=Users/C=ID"
```

### Step 3: Root CA Signs and Issues Alice's Certificate
```bash
# CA signs alice.csr using ca/root_ca.key and ca/root_ca.crt
openssl x509 -req -in clients/alice/alice.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial \
  -out clients/alice/alice.crt -days 365 -sha256
```

### Step 4: Verify Alice's Certificate Chain
```bash
openssl verify -CAfile ca/root_ca.crt clients/alice/alice.crt
# Output: clients/alice/alice.crt: OK
```

### Step 5: Fake CA Attack Test
```bash
# If an attacker creates an untrusted rogue CA in ca/fake_ca.key:
openssl verify -CAfile ca/root_ca.crt clients/alice/fake_alice.crt
# Output: error 20 at 0 depth lookup: unable to get local issuer certificate
```

### Step 6: Encrypt File for Recipient (Alice -> Bob)
```bash
mkdir -p clients/bob messages

# 1. Bob generates key, CSR, and CA issues bob.crt
openssl ecparam -name secp256k1 -genkey -noout -out clients/bob/bob.key
openssl req -new -key clients/bob/bob.key -out clients/bob/bob.csr -subj "/CN=Bob/O=Users/C=ID"
openssl x509 -req -in clients/bob/bob.csr -CA ca/root_ca.crt -CAkey ca/root_ca.key -CAcreateserial \
  -out clients/bob/bob.crt -days 365 -sha256

# 2. Alice creates plaintext message
echo "Top Secret Financial Report 2026: Approved by Alice" > messages/secret_message.txt

# 3. Alice encrypts the document using Bob's public certificate
openssl cms -encrypt -in messages/secret_message.txt -out messages/secret_message.enc clients/bob/bob.crt
```

### Step 7: Decryption & Interception Attack
```bash
# Scenario A: Hacker Mallory intercepts messages/secret_message.enc and tries to decrypt
mkdir -p clients/mallory
openssl ecparam -name secp256k1 -genkey -noout -out clients/mallory/mallory.key
openssl cms -decrypt -in messages/secret_message.enc -inkey clients/mallory/mallory.key
# Output: Error! Decryption failed. Zero data leaked.

# Scenario B: Bob legitimately decrypts using his private key and certificate
openssl cms -decrypt -in messages/secret_message.enc -inkey clients/bob/bob.key -recip clients/bob/bob.crt
# Output: Top Secret Financial Report 2026: Approved by Alice
```

### Step 8: Digital Signature & Authentication (Sign & Encrypt)
```bash
# 1. Bob signs the document using his private key and certificate (Authenticity + Integrity)
openssl cms -sign -in messages/transfer_order.txt -signer clients/bob/bob.crt -inkey clients/bob/bob.key -out messages/transfer_order.signed -nodetach

# 2. Bob encrypts the signed package using Alice's certificate (Confidentiality)
openssl cms -encrypt -in messages/transfer_order.signed -out messages/transfer_order.enc clients/alice/alice.crt

# 3. Alice decrypts the outer envelope using her private key
openssl cms -decrypt -in messages/transfer_order.enc -inkey clients/alice/alice.key -recip clients/alice/alice.crt -out messages/alice_received.signed

# 4. Alice verifies Bob's digital signature against the Root CA
openssl cms -verify -in messages/alice_received.signed -CAfile ca/root_ca.crt -out messages/alice_received.txt
# Output: CMS Verification successful (Proves author is Bob, zero tampering in transit)
```

---

## Role-Based PKI & Encrypted Inbox Architecture

In the web interface (`http://localhost:3000`), you can switch roles in the top right:
1. **🏛️ Admin (Root CA)**:
   * Initializes and manages Root CA (`ca/root_ca.key`, `ca/root_ca.crt`).
   * Inspects pending client CSRs and signs certificates (`clients/<id>/<id>.crt`).
   * Tests fake CA detection.
2. **👤 Client Perspective (Alice, Bob, etc.)**:
   * **My Identity**: Generates EC private key and request in isolated `clients/<id>/`. Verifies certificate once signed.
   * **Send Document**: Encrypts document with recipient's public certificate and delivers it into `messages/` for the recipient's inbox.
     * Optional **Digital Signature**: signs with sender's private key before encryption.
   * **📬 Inbox**: Receives incoming encrypted documents.
     * **Legitimate Decryption**: Recipient decrypts using their private key and verifies sender signature.
     * **Interception Attack Simulation**: Simulates hacker Mallory attempting decryption (`clients/mallory/mallory.key`) — OpenSSL rejects it immediately.
     * **Tamper Simulation**: Simulates transit modification — OpenSSL catches `digest failure` instantly.
