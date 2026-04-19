"""DID signature utilities for hybrid OAuth2 + DID authentication.

This module provides utilities for signing and verifying requests using
DID-based cryptographic signatures for enhanced security.
"""

from __future__ import annotations as _annotations

import json
import time
from typing import Any, Dict, Optional

from bindu.utils.logging import get_logger

logger = get_logger("bindu.utils.did_signature")


def create_signature_payload(
    body: str | bytes, did: str, timestamp: Optional[int] = None
) -> Dict[str, Any]:
    """Create the signature payload a signer or verifier should sign.

    The returned dict is serialized with ``json.dumps(..., sort_keys=True)``
    by the caller and passed to Ed25519. Signer and verifier MUST agree
    on the exact bytes, which means they MUST agree on how ``body`` was
    serialized to bytes before this function is called.

    Only ``str`` and ``bytes`` are accepted. Passing ``dict`` used to
    be supported with an implicit ``json.dumps(body, sort_keys=True)``
    canonicalization, but that hid a serious footgun: a caller who
    signed a dict got one signature, and the verifier on the server
    side (which receives raw wire bytes, not a dict) got another for
    the same logical body. The mismatch surfaced as
    ``crypto_mismatch`` with no diagnostic hint about why.

    The fix: callers must serialize their body to bytes *once* and use
    those exact bytes for both the signing payload AND the HTTP body
    they send on the wire. If you have a dict and need to sign it,
    serialize it explicitly::

        body_bytes = json.dumps(data).encode("utf-8")
        headers    = sign_request(body_bytes, did, did_extension)
        httpx.post(url, content=body_bytes, headers=headers)

    Args:
        body: Request body as a string or bytes. Dict inputs raise
            ``TypeError`` — see above.
        did: Client's DID
        timestamp: Unix timestamp (defaults to current time)

    Returns:
        Signature payload dict ``{"body": str, "did": str, "timestamp": int}``

    Raises:
        TypeError: If ``body`` is not ``str`` or ``bytes``.
    """
    if timestamp is None:
        timestamp = int(time.time())

    if isinstance(body, bytes):
        body_str = body.decode("utf-8")
    elif isinstance(body, str):
        body_str = body
    else:
        raise TypeError(
            f"body must be str or bytes, got {type(body).__name__}. "
            "If you have a dict, serialize it to bytes with "
            "json.dumps(data).encode('utf-8') and use the same bytes "
            "for both signing and the HTTP body."
        )

    return {"body": body_str, "timestamp": timestamp, "did": did}


def sign_request(
    body: str | bytes, did: str, did_extension, timestamp: Optional[int] = None
) -> Dict[str, str]:
    """Sign a request with a DID private key.

    See :func:`create_signature_payload` for the signer/verifier
    contract — notably, ``body`` must be the exact bytes (or string)
    that will appear on the wire. Dict inputs are rejected to prevent
    a class of bugs where the signing and sending paths disagree on
    canonicalization.

    Args:
        body: Request body as a string or bytes.
        did: Client's DID
        did_extension: DIDExtension instance with private key
        timestamp: Unix timestamp (defaults to current time)

    Returns:
        Dict with signature headers (X-DID, X-DID-Signature, X-DID-Timestamp)

    Raises:
        TypeError: If ``body`` is not ``str`` or ``bytes``.
    """
    payload = create_signature_payload(body, did, timestamp)
    payload_str = json.dumps(payload, sort_keys=True)

    signature = did_extension.sign_message(payload_str)

    return {
        "X-DID": did,
        "X-DID-Signature": signature,
        "X-DID-Timestamp": str(payload["timestamp"]),
    }


def verify_signature(
    body: str | bytes | dict,
    signature: str,
    did: str,
    timestamp: int,
    public_key: str,
    max_age_seconds: int = 300,
) -> bool:
    """Verify DID signature on a request.

    Args:
        body: Request body
        signature: DID signature from X-DID-Signature header
        did: Client's DID from X-DID header
        timestamp: Timestamp from X-DID-Timestamp header
        public_key: Client's public key (multibase encoded)
        max_age_seconds: Maximum age of request in seconds (default 5 minutes)

    Returns:
        True if signature is valid, False otherwise
    """
    try:
        # Check timestamp to prevent replay attacks
        current_time = int(time.time())
        if abs(current_time - timestamp) > max_age_seconds:
            logger.warning(
                f"Request timestamp too old: {timestamp} vs {current_time} "
                f"(max age: {max_age_seconds}s)"
            )
            return False

        # Reconstruct signature payload
        payload = create_signature_payload(body, did, timestamp)
        payload_str = json.dumps(payload, sort_keys=True)

        # Verify signature with public key
        import base58
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError

        # Decode the base58-encoded public key and signature
        try:
            public_key_bytes = base58.b58decode(public_key)
            signature_bytes = base58.b58decode(signature)

            # Create verify key from public key bytes
            verify_key = VerifyKey(public_key_bytes)

            # Verify the signature
            verify_key.verify(payload_str.encode("utf-8"), signature_bytes)
            is_valid = True
        except (BadSignatureError, ValueError, TypeError, Exception) as e:
            logger.debug(f"Signature verification failed: {e}")
            is_valid = False

        if not is_valid:
            logger.warning(f"Invalid DID signature for {did}")

        return is_valid

    except (ImportError, UnicodeEncodeError, ValueError, TypeError) as e:
        logger.error(f"Failed to verify DID signature: {e}")
        return False


def extract_signature_headers(headers: dict) -> Optional[Dict[str, Any]]:
    """Extract DID signature headers from request.

    Args:
        headers: Request headers dict

    Returns:
        Dict with did, signature, timestamp or None if missing
    """
    did = headers.get("X-DID") or headers.get("x-did")
    signature = headers.get("X-DID-Signature") or headers.get("x-did-signature")
    timestamp_str = headers.get("X-DID-Timestamp") or headers.get("x-did-timestamp")

    if not all([did, signature, timestamp_str]):
        return None

    # Type narrowing: timestamp_str is guaranteed to be truthy here
    assert timestamp_str is not None
    try:
        timestamp = int(timestamp_str)
    except (ValueError, TypeError):
        logger.warning(f"Invalid timestamp format: {timestamp_str}")
        return None

    return {"did": did, "signature": signature, "timestamp": timestamp}
