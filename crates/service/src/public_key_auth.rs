//! OpenSSH decoding and CFMS signatures. CFMS signs raw challenges, not SSHSIG envelopes.
use base64ct::{Base64, Encoding};
use sha2::{Digest, Sha256};
use signature::{SignatureEncoding, Signer, hazmat::PrehashSigner};
use ssh_key::{
    PrivateKey,
    private::{EcdsaKeypair, KeypairData},
};

pub use ssh_key::PrivateKey as AuthPrivateKey;

fn rsa_private(pair: &ssh_key::private::RsaKeypair) -> Result<rsa::RsaPrivateKey, String> {
    fn integer(value: &ssh_key::Mpint) -> Result<rsa::BigUint, String> {
        Ok(rsa::BigUint::from_bytes_be(
            value.as_positive_bytes().ok_or("publicKey.invalidFile")?,
        ))
    }
    rsa::RsaPrivateKey::from_components(
        integer(pair.public().n())?,
        integer(pair.public().e())?,
        integer(pair.private().d())?,
        vec![integer(pair.private().p())?, integer(pair.private().q())?],
    )
    .map_err(|_| "publicKey.invalidFile".into())
}

pub fn parse(bytes: &[u8]) -> Result<PrivateKey, String> {
    // OpenSSH writes 70-column armor, while Python cryptography writes 64.
    // Decode the armor independently so both standard representations work.
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "publicKey.invalidFile")?
        .trim();
    let body = text
        .strip_prefix("-----BEGIN OPENSSH PRIVATE KEY-----")
        .and_then(|text| text.strip_suffix("-----END OPENSSH PRIVATE KEY-----"))
        .ok_or("publicKey.invalidFile")?;
    let encoded = zeroize::Zeroizing::new(body.split_ascii_whitespace().collect::<String>());
    let decoded =
        zeroize::Zeroizing::new(Base64::decode_vec(&encoded).map_err(|_| "publicKey.invalidFile")?);
    let key = PrivateKey::from_bytes(&decoded).map_err(|_| "publicKey.invalidFile")?;
    match key.algorithm() {
        ssh_key::Algorithm::Ed25519
        | ssh_key::Algorithm::Rsa { .. }
        | ssh_key::Algorithm::Ecdsa { .. } => Ok(key),
        _ => Err("publicKey.unsupportedAlgorithm".into()),
    }
}

/// The server hashes canonical OpenSSH text (without its optional comment), not the SSH blob.
pub fn fingerprint(key: &PrivateKey) -> Result<String, String> {
    let mut public = key.public_key().clone();
    public.set_comment("");
    let text = public.to_openssh().map_err(|_| "publicKey.invalidFile")?;
    Ok(hex::encode(Sha256::digest(text.trim().as_bytes())))
}

pub fn unlock(key: PrivateKey, passphrase: &str) -> Result<PrivateKey, String> {
    if key.is_encrypted() {
        key.decrypt(passphrase)
            .map_err(|_| "publicKey.wrongPassphrase".into())
    } else {
        Ok(key)
    }
}

pub fn decode_challenge(
    data: &serde_json::Value,
    stream_id: u32,
    fingerprint: &str,
    stage: &str,
) -> Result<Vec<u8>, String> {
    let interaction = data["interaction_id"]
        .as_str()
        .ok_or("publicKey.invalidChallenge")?;
    let bytes = Base64::decode_vec(
        data["challenge"]
            .as_str()
            .ok_or("publicKey.invalidChallenge")?,
    )
    .map_err(|_| "publicKey.invalidChallenge")?;
    let details: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "publicKey.invalidChallenge")?;
    if data["method"] != "publickey"
        || data["stage"] != stage
        || details["scope"] != "cfms.auth.publickey"
        || details["stream_id"] != stream_id
        || details["interaction_id"] != interaction
        || details["fingerprint"] != fingerprint
        || details["stage"] != stage
    {
        return Err("publicKey.invalidChallenge".into());
    }
    Ok(bytes)
}

pub fn sign(key: &PrivateKey, message: &[u8]) -> Result<String, String> {
    let result: Result<Vec<u8>, signature::Error> = match key.key_data() {
        KeypairData::Ed25519(pair) => {
            use ed25519_dalek::Signer as _;
            Ok(ed25519_dalek::SigningKey::from_bytes(pair.private.as_ref())
                .sign(message)
                .to_bytes()
                .to_vec())
        }
        KeypairData::Rsa(pair) => {
            let private = rsa_private(pair)?;
            rsa::pkcs1v15::SigningKey::<sha2_legacy::Sha256>::new(private)
                .try_sign(message)
                .map(|sig| sig.to_vec())
        }
        KeypairData::Ecdsa(pair) => {
            let digest = Sha256::digest(message);
            match pair {
                EcdsaKeypair::NistP256 { private, .. } => {
                    let signing = p256::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    let sig: p256::ecdsa::Signature = signing
                        .sign_prehash(&digest)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
                EcdsaKeypair::NistP384 { private, .. } => {
                    let signing = p384::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    let sig: p384::ecdsa::Signature = signing
                        .sign_prehash(&digest)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
                EcdsaKeypair::NistP521 { private, .. } => {
                    let signing = p521::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    // SHA-256 is the server's digest even on P-521. Left-pad its integer.
                    let mut padded = [0u8; 66];
                    padded[34..].copy_from_slice(&digest);
                    let sig: p521::ecdsa::Signature = signing
                        .sign_prehash(&padded)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
            }
        }
        _ => return Err("publicKey.unsupportedAlgorithm".into()),
    };
    result
        .map(|bytes| Base64::encode_string(&bytes))
        .map_err(|_| "publicKey.signingFailed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use signature::{Verifier, hazmat::PrehashVerifier};

    fn vectors() -> Vec<serde_json::Value> {
        // Synthetic keys and signatures generated with the server's Python cryptography library.
        serde_json::from_str(include_str!("../tests/fixtures/auth-keys.json")).unwrap()
    }
    fn verify(key: &PrivateKey, message: &[u8], signature: &[u8]) -> bool {
        let digest = Sha256::digest(message);
        match key.key_data() {
            KeypairData::Ed25519(pair) => {
                ed25519_dalek::VerifyingKey::from_bytes(pair.public.as_ref())
                    .unwrap()
                    .verify_strict(
                        message,
                        &ed25519_dalek::Signature::from_slice(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Rsa(pair) => {
                let private = rsa_private(pair).unwrap();
                rsa::pkcs1v15::VerifyingKey::<sha2_legacy::Sha256>::new(rsa::RsaPublicKey::from(
                    &private,
                ))
                .verify(
                    message,
                    &rsa::pkcs1v15::Signature::try_from(signature).unwrap(),
                )
                .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP256 { private, .. }) => {
                p256::ecdsa::SigningKey::from_slice(private.as_slice())
                    .unwrap()
                    .verifying_key()
                    .verify_prehash(
                        &digest,
                        &p256::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP384 { private, .. }) => {
                p384::ecdsa::SigningKey::from_slice(private.as_slice())
                    .unwrap()
                    .verifying_key()
                    .verify_prehash(
                        &digest,
                        &p384::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP521 { private, .. }) => {
                let signing = p521::ecdsa::SigningKey::from_slice(private.as_slice()).unwrap();
                let mut padded = [0u8; 66];
                padded[34..].copy_from_slice(&digest);
                p521::ecdsa::VerifyingKey::from(&signing)
                    .verify_prehash(
                        &padded,
                        &p521::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            _ => false,
        }
    }
    #[test]
    fn canonical_fingerprints_and_raw_signatures_match_the_server_on_every_curve() {
        for vector in vectors() {
            let key = parse(vector["private_key"].as_str().unwrap().as_bytes()).unwrap();
            assert_eq!(fingerprint(&key).unwrap(), vector["fingerprint"]);
            let message = Base64::decode_vec(vector["message"].as_str().unwrap()).unwrap();
            let python_signature =
                Base64::decode_vec(vector["server_signature"].as_str().unwrap()).unwrap();
            assert!(
                verify(&key, &message, &python_signature),
                "server signature: {}",
                vector["name"]
            );
            let signature = Base64::decode_vec(&sign(&key, &message).unwrap()).unwrap();
            assert!(
                verify(&key, &message, &signature),
                "client signature: {}",
                vector["name"]
            );
            assert!(!verify(&key, b"tampered challenge", &signature));
        }
    }
    #[test]
    fn encrypted_openssh_keys_require_the_correct_passphrase_and_retain_identity() {
        for vector in vectors() {
            let key = parse(vector["encrypted_key"].as_str().unwrap().as_bytes()).unwrap();
            assert!(key.is_encrypted());
            assert!(unlock(key.clone(), "wrong").is_err());
            let unlocked = unlock(key, "test-passphrase")
                .unwrap_or_else(|error| panic!("{}: {error}", vector["name"]));
            assert_eq!(fingerprint(&unlocked).unwrap(), vector["fingerprint"]);
        }
    }
    #[test]
    fn public_files_and_non_openssh_formats_are_rejected() {
        assert!(parse(b"-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----").is_err());
        assert!(parse(vectors()[0]["public_key"].as_str().unwrap().as_bytes()).is_err());
    }
    #[test]
    fn challenges_are_bound_to_the_stream_key_stage_and_interaction() {
        let challenge = serde_json::json!({"scope":"cfms.auth.publickey", "stream_id":7,"fingerprint":"abc","stage":"login","interaction_id":"step-1","nonce":"test"});
        let data = serde_json::json!({"method":"publickey","stage":"login","interaction_id":"step-1","challenge":Base64::encode_string(&serde_json::to_vec(&challenge).unwrap())});
        assert!(decode_challenge(&data, 7, "abc", "login").is_ok());
        assert!(decode_challenge(&data, 9, "abc", "login").is_err());
        assert!(decode_challenge(&data, 7, "different-key", "login").is_err());
        assert!(decode_challenge(&data, 7, "abc", "mfa").is_err());
        let mut replay = data.clone();
        replay["interaction_id"] = "step-2".into();
        assert!(decode_challenge(&replay, 7, "abc", "login").is_err());
    }
}
