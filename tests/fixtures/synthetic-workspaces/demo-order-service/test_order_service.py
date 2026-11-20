import unittest
from order_service import compute_order_subtotal, calculate_discounted_total, receipt_digest

class TestOrderService(unittest.TestCase):
    def test_subtotal_basic(self):
        self.assertEqual(compute_order_subtotal([(1000, 2), (500, 1)]), 2500)

    def test_subtotal_negative_values(self):
        with self.assertRaises(ValueError):
            compute_order_subtotal([(1000, -1)])
        with self.assertRaises(ValueError):
            compute_order_subtotal([(-1000, 1)])

    def test_discounted_total(self):
        self.assertEqual(calculate_discounted_total([(1000, 2), (500, 1)], 20), 2000)
        self.assertEqual(calculate_discounted_total([(200, 5)], 50), 500)

    def test_invalid_discount(self):
        with self.assertRaises(ValueError):
            calculate_discounted_total([(1000, 1)], -10)
        with self.assertRaises(ValueError):
            calculate_discounted_total([(1000, 1)], 101)

    def test_receipt_digest_sha256(self):
        # SHA-256 of "order123" is 64 hex chars
        digest = receipt_digest("order123")
        self.assertEqual(len(digest), 64)
        # Ensure it's not the MD5 of "order123" (which is 32 chars)
        self.assertNotEqual(len(digest), 32)

if __name__ == "__main__":
    unittest.main()
