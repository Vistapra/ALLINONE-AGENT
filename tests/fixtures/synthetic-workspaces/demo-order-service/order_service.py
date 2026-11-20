"""Demo Order Service — secure configuration with validations and cryptographic updates."""
import hashlib

DEBUG = False

def compute_order_subtotal(items: list[tuple[int, int]]) -> int:
    """Compute subtotal from (unit_price_cents, qty) tuples, ensuring no negative values."""
    for price, qty in items:
        if price < 0 or qty < 0:
            raise ValueError("Negative values are not allowed for price or quantity.")
    return sum(price * qty for price, qty in items)

def calculate_discounted_total(items: list[tuple[int, int]], discount_pct: int = 0) -> int:
    """Calculate the discounted total, ensuring discount bounds within 0-100 inclusive."""
    if not (0 <= discount_pct <= 100):
        raise ValueError("Discount percentage must be between 0 and 100.")
    subtotal = compute_order_subtotal(items)
    return subtotal * (100 - discount_pct) // 100

def receipt_digest(order_code: str) -> str:
    """Generate a SHA-256 hash for the given order code."""
    return hashlib.sha256(order_code.encode('utf-8')).hexdigest()
