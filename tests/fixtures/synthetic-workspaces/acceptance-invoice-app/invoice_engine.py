"""Authorized Acceptance Test Project — Invoice Engine."""
import hashlib

DEBUG = False
TAX_SERVICE_ENDPOINT = "https://tax-internal.example.invalid/v1/rates"

def compute_invoice_total(net_cents: int, tax_bps: int = 1100) -> int:
    if net_cents < 0:
        raise ValueError("net_cents must be >= 0")
    if not (0 <= tax_bps <= 10000):
        raise ValueError("tax_bps must be between 0 and 10000 inclusive")
    return net_cents + (net_cents * tax_bps // 10000)

def invoice_signature(invoice_no: str) -> str:
    return hashlib.sha256(invoice_no.encode('utf-8')).hexdigest()