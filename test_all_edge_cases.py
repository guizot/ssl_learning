#!/usr/bin/env python3
"""
Comprehensive Edge-Case Test Suite for ssl_learning Visual Lab
Tests Categories 1 through 6 against the running server on port 3005.
"""

import json
import urllib.request
import urllib.error
import subprocess
import os
import sys
import time

BASE_URL = "http://127.0.0.1:3005"
CA_DIR = "/home/rpi5/Documents/projects/ssl_learning/module0-ca/generated"

def api(endpoint, method="GET", data=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw}

results = []

def record(test_id, category, name, passed, details):
    status_str = "PASS" if passed else "FAIL"
    print(f"[{status_str}] {test_id} - {name}: {details}")
    results.append({
        "id": test_id,
        "category": category,
        "name": name,
        "passed": passed,
        "details": details
    })

# =============================================================================
# SETUP / RESET INITIAL STATE
# =============================================================================
print("\n=== STARTING COMPREHENSIVE EDGE-CASE TEST SUITE ===\n")

# Clean slate
status, _ = api("/api/ca/reset", method="POST")
time.sleep(0.5)

# -----------------------------------------------------------------------------
# KATEGORI 1: Siklus Hidup Root CA & Trust Chain
# -----------------------------------------------------------------------------
# 1.1 Cold Start: Sign without Root CA
# Create client 'cold_alice' without key
status, c_data = api("/api/ca/clients", method="POST", data={"name": "ColdAlice", "generateKey": True})
status_sign, sign_res = api("/api/ca/sign-cert", method="POST", data={"id": c_data["id"]})
record(
    "1.1", "Root CA & Trust", "Sign without Root CA (Graceful 400)",
    status_sign == 400 and "Root CA has not been initialized" in sign_res.get("error", ""),
    f"HTTP {status_sign}: {sign_res.get('error', 'Handled correctly')}"
)

# Initialize Root CA
status_init, init_res = api("/api/ca/init-root", method="POST")
time.sleep(0.5)

# Sign ColdAlice under Root CA 1
status_sign1, sign_res1 = api("/api/ca/sign-cert", method="POST", data={"id": c_data["id"]})
time.sleep(0.5)

# Verify ColdAlice against Root CA 1
status_v1, v1_res = api("/api/ca/verify", method="POST", data={"id": c_data["id"]})
record(
    "1.2a", "Root CA & Trust", "Sign & Verify under Root CA 1",
    v1_res.get("isValid") is True and v1_res.get("keyMatchesCrt") is True,
    f"Valid: {v1_res.get('isValid')}, KeyMatches: {v1_res.get('keyMatchesCrt')}"
)

# 1.2 Re-init Root CA while client is active
status_reinit, _ = api("/api/ca/init-root", method="POST")
time.sleep(0.5)

# Check state of ColdAlice after Re-init Root CA
_, state = api("/api/ca/state")
ca_client = next((c for c in state["clients"] if c["id"] == c_data["id"]), None)
record(
    "1.2b", "Root CA & Trust", "Detect CA Mismatch in State",
    ca_client and ca_client["crtExists"] and not ca_client["crtValid"],
    f"crtExists={ca_client['crtExists']}, crtValid={ca_client['crtValid']}"
)

# 1.3 Verify Trust Chain after Re-init CA (should fail verification)
status_v2, v2_res = api("/api/ca/verify", method="POST", data={"id": c_data["id"]})
record(
    "1.3", "Root CA & Trust", "Verification Fails on Broken Chain",
    v2_res.get("isValid") is False,
    f"isValid={v2_res.get('isValid')}, Output={v2_res.get('opensslLog', {}).get('output', '')[:80]}..."
)

# Re-sign ColdAlice under new CA
api("/api/ca/sign-cert", method="POST", data={"id": c_data["id"]})
time.sleep(0.5)

# -----------------------------------------------------------------------------
# KATEGORI 2: Desinkronisasi Kunci Klien & Artefak Yatim (Orphaned)
# -----------------------------------------------------------------------------
# 2.1 Re-generate Key while Cert exists
# Client re-generates keypair
api("/api/ca/clients", method="POST", data={"id": c_data["id"], "name": "ColdAlice", "generateKey": True})
time.sleep(0.5)

_, state2 = api("/api/ca/state")
c_regen = next(c for c in state2["clients"] if c["id"] == c_data["id"])
record(
    "2.1", "Keypair Desync", "Detect Key Mismatch after Key Re-gen",
    c_regen["crtValid"] is True and c_regen["keyMatchesCrt"] is False,
    f"crtValid={c_regen['crtValid']}, keyMatchesCrt={c_regen['keyMatchesCrt']}"
)

# 2.2 Remove Key & CSR while Cert exists (Orphaned Cert)
api("/api/ca/client-remove-file", method="POST", data={"clientId": c_data["id"], "fileType": "key_csr"})
time.sleep(0.3)

_, state3 = api("/api/ca/state")
c_orphaned = next(c for c in state3["clients"] if c["id"] == c_data["id"])
record(
    "2.2", "Keypair Desync", "Orphaned Cert after Key & CSR removed",
    not c_orphaned["keyExists"] and not c_orphaned["csrExists"] and c_orphaned["crtExists"] and not c_orphaned["keyMatchesCrt"],
    f"keyExists={c_orphaned['keyExists']}, csrExists={c_orphaned['csrExists']}, crtExists={c_orphaned['crtExists']}"
)

# 2.3 Remove Cert while Key & CSR exist
# Create Bob with Key & CSR and sign him
_, bob = api("/api/ca/clients", method="POST", data={"name": "Bob", "generateKey": True})
api("/api/ca/sign-cert", method="POST", data={"id": bob["id"]})
time.sleep(0.3)
# Now remove Bob cert only
api("/api/ca/client-remove-file", method="POST", data={"clientId": bob["id"], "fileType": "crt"})
time.sleep(0.3)
_, state4 = api("/api/ca/state")
c_bob = next(c for c in state4["clients"] if c["id"] == bob["id"])
record(
    "2.3", "Keypair Desync", "Remove Cert leaves Key & CSR pending",
    c_bob["keyExists"] and c_bob["csrExists"] and not c_bob["crtExists"],
    f"keyExists={c_bob['keyExists']}, csrExists={c_bob['csrExists']}, crtExists={c_bob['crtExists']}"
)

# Re-sign Bob to healthy state
api("/api/ca/sign-cert", method="POST", data={"id": bob["id"]})
time.sleep(0.3)

# -----------------------------------------------------------------------------
# KATEGORI 3: Enkripsi Dokumen Hibrida & Tanda Tangan Digital (CMS / S/MIME)
# -----------------------------------------------------------------------------
# Setup healthy Alice: re-gen key & CSR, and re-sign
api("/api/ca/clients", method="POST", data={"id": c_data["id"], "name": "ColdAlice", "generateKey": True})
api("/api/ca/sign-cert", method="POST", data={"id": c_data["id"]})
time.sleep(0.5)

# 3.1 Send encrypted doc from Alice to Bob
status_send, send_res = api("/api/ca/send-message", method="POST", data={
    "senderId": c_data["id"],
    "recipientId": bob["id"],
    "title": "Secret Strategy",
    "message": "Top secret cryptographic intelligence payload.",
    "isSigned": True
})
record(
    "3.1", "CMS / S/MIME", "Encrypt & Digitally Sign Document",
    status_send in (200, 201) and send_res.get("success") is True,
    f"Message ID: {send_res.get('message', {}).get('id')}"
)
msg_id = send_res.get("message", {}).get("id")

# 3.2 Decrypt document by Bob (legitimate recipient)
status_dec, dec_res = api("/api/ca/decrypt-inbox-message", method="POST", data={
    "messageId": msg_id,
    "recipientId": bob["id"]
})
record(
    "3.2", "CMS / S/MIME", "Legitimate Recipient Decryption & Verification",
    dec_res.get("success") is True and dec_res.get("signatureValid") is True and "Top secret" in dec_res.get("plaintext", ""),
    f"Decrypted: '{dec_res.get('plaintext')}', SignatureValid: {dec_res.get('signatureValid')}"
)

# 3.3 Decryption Attempt when Key is Missing
# Remove Bob's key
api("/api/ca/client-remove-file", method="POST", data={"clientId": bob["id"], "fileType": "key"})
time.sleep(0.3)
status_dec_fail, dec_fail_res = api("/api/ca/decrypt-inbox-message", method="POST", data={
    "messageId": msg_id,
    "recipientId": bob["id"]
})
record(
    "3.3", "CMS / S/MIME", "Decryption Rejected when Private Key Missing",
    dec_fail_res.get("success") is False and "Missing Private Key" in dec_fail_res.get("error", ""),
    f"Error returned: '{dec_fail_res.get('error')}'"
)

# Restore Bob's key and re-sign
api("/api/ca/clients", method="POST", data={"id": bob["id"], "name": "Bob", "generateKey": True})
api("/api/ca/sign-cert", method="POST", data={"id": bob["id"]})
time.sleep(0.5)

# Send new message to test tampering
_, send_res2 = api("/api/ca/send-message", method="POST", data={
    "senderId": c_data["id"],
    "recipientId": bob["id"],
    "title": "Tamper Test Doc",
    "message": "Original unadulterated payload.",
    "isSigned": True
})
msg_id2 = send_res2["message"]["id"]

# 3.4 Simulate Tampering Ciphertext
status_tamper, tamper_res = api("/api/ca/tamper-inbox-message", method="POST", data={
    "messageId": msg_id2,
    "recipientId": bob["id"]
})
record(
    "3.4", "CMS / S/MIME", "Tampered Message Detected & Rejected",
    tamper_res.get("tamperDetected") is True,
    f"TamperDetected: {tamper_res.get('tamperDetected')}, OpenSSLLog: {tamper_res.get('opensslLog', {}).get('command', '')[:50]}"
)

# -----------------------------------------------------------------------------
# KATEGORI 4: Simulasi Serangan Mallory (Untrusted Rogue CA)
# -----------------------------------------------------------------------------
# 4.1 Mallory Attack Simulation against Alice
status_atk, atk_res = api("/api/ca/verify", method="POST", data={"id": c_data["id"], "isFake": True})
record(
    "4.1", "Rogue CA Detection", "Untrusted CA Signature Rejected by Root CA",
    atk_res.get("isValid") is False,
    f"isValid={atk_res.get('isValid')}, Output: {atk_res.get('opensslLog', {}).get('output', '')[:70]}..."
)

# -----------------------------------------------------------------------------
# KATEGORI 5: Integritas State, Reset, & Pembersihan Data
# -----------------------------------------------------------------------------
# 5.1 Delete specific client
api("/api/ca/client/" + c_data["id"], method="DELETE")
time.sleep(0.3)
_, state_del = api("/api/ca/state")
record(
    "5.1", "State Integrity", "Delete Client Wipes Data & Removes from Store",
    not any(c["id"] == c_data["id"] for c in state_del["clients"]),
    f"Remaining clients: {[c['id'] for c in state_del['clients']]}"
)

# 5.2 Reset All Data
status_rst, _ = api("/api/ca/reset", method="POST")
time.sleep(0.5)
_, state_rst = api("/api/ca/state")
record(
    "5.2", "State Integrity", "Reset All Wipes Keys, Certs, and Messages",
    len(state_rst["clients"]) == 0 and not state_rst["rootCaExists"],
    f"Clients count={len(state_rst['clients'])}, rootCaExists={state_rst['rootCaExists']}"
)

# -----------------------------------------------------------------------------
# KATEGORI 6: Input Validasi & Karakter Khusus
# -----------------------------------------------------------------------------
# 6.1 Special Characters in Client Name
status_spec, spec_res = api("/api/ca/clients", method="POST", data={
    "name": "PT. Bank Mandiri (Persero) Tbk. / Cabang Utama",
    "generateKey": False
})
_, state_spec = api("/api/ca/state")
spec_client = next((c for c in state_spec["clients"] if c["id"] == spec_res["id"]), None)
record(
    "6.1", "Input Validation", "Sanitize Special Characters in Client ID",
    spec_client is not None and not any(ch in spec_client["id"] for ch in [" ", "/", "(", ")", "."]),
    f"Raw Input -> Safe ID: '{spec_client['id'] if spec_client else 'none'}'"
)

# SUMMARY
print("\n" + "="*70)
passed_count = sum(1 for r in results if r["passed"])
total_count = len(results)
print(f"TEST SUITE SUMMARY: {passed_count}/{total_count} PASSED")
print("="*70)

if passed_count == total_count:
    sys.exit(0)
else:
    sys.exit(1)
