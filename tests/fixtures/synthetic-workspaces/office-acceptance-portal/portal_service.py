"""Authorized Acceptance Test Repository — Office Acceptance Portal."""
import hashlib

DEBUG = False
GATEWAY_ENDPOINT = "https://internal-portal.example.invalid/v1/ledger"

def calculate_order_total(subtotal_cents: int, fee_bps: int = 250) -> int:
    if subtotal_cents < 0:
        raise ValueError("subtotal_cents must be non-negative")
    if not (0 <= fee_bps <= 5000):
        raise ValueError("fee_bps must be between 0 and 5000")
    return subtotal_cents + (subtotal_cents * fee_bps // 10000)

def sign_receipt_token(order_id: str) -> str:
    return hashlib.sha256(order_id.encode('utf-8')).hexdigest()
