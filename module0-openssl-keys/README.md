# Module 0: Understanding Private & Public Keys with OpenSSL

## 1. What Actually Is a Private Key?

A **Private Key** is not a password or a username. It is **literally just a gigantic random number** between $1$ and $2^{256} - 1$.

* That number is 256 bits long (32 bytes).
* The number of possible private keys is roughly $10^{77}$ — which is approximately the **number of atoms in the observable universe**.
* Because this space is so impossibly large, if you generate a truly random 256-bit number, **no one else on Earth will ever generate the same number**.

---

## 2. What Is an Elliptic Curve (`secp256k1`)?

In mathematics, an elliptic curve is an algebraic equation of the form:
$$y^2 = x^3 + 7$$

On this curve, there is a globally agreed-upon starting point called the **Generator Point ($G$)**.

```
         y ^
           |    * *
           |  *     *
           | *       *  <-- Curve: y² = x³ + 7
 ----------+------------> x
           | *       *
           |  *     *
           |    * *
```

---

## 3. What Actually Is a Public Key?

A **Public Key** is a point on that curve with coordinates **$(X, Y)$**.

You calculate your public key by multiplying the Generator Point ($G$) by your private key number ($k$):
$$\text{Public Key} = k \times G$$

### The "One-Way Street" (Discrete Log Problem)
* **Easy ($k \rightarrow \text{Public Key}$)**: Multiplying a point on an elliptic curve by a number takes milliseconds for any computer.
* **Impossible ($\text{Public Key} \rightarrow k$)**: Given the point $(X, Y)$ and the curve, there is **no known mathematical algorithm** to reverse-engineer $k$. Even a supercomputer running for millions of years cannot guess your private key from your public key.

---

## 4. What Is a "Blockchain Account" / "Address"?

In traditional Web2 or banking:
* A bank database creates an account number for you.
* A Certificate Authority (like DigiCert) creates a certificate for you.

In Blockchain:
* **Your Account Number IS your Public Key!**
* To make it shorter and cleaner, Ethereum simply takes the $(X, Y)$ coordinates of your public key, hashes them with SHA3/Keccak-256, and takes the last 20 bytes:
$$\text{Account Address} = \text{0x} + \text{Last 20 Bytes of Hash}(X, Y)$$

---

## 5. What Is a Digital Signature?

When you send money, you don't send your password. You use your **Private Key** to "stamp" the transaction data.

$$\text{Data} + \text{Private Key} \longrightarrow \text{Digital Signature}$$

Anyone with your **Public Key** can verify:
$$\text{Signature} + \text{Data} + \text{Public Key} \longrightarrow \text{True / False}$$

* If anyone tampers with the data $\rightarrow$ Verification fails.
* If someone else tries to sign $\rightarrow$ Verification fails.
* **Your private key is NEVER revealed to anyone.**

---

## Hands-On Commands

Run the OpenSSL CLI demonstration:
```bash
./module0-openssl-keys/generate_with_openssl.sh
```

Run the account derivation script:
```bash
node module0-openssl-keys/pem_to_account.ts
```
