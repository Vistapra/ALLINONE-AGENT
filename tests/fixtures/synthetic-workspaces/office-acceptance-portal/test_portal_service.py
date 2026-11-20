import unittest
from portal_service import calculate_order_total, sign_receipt_token, DEBUG, GATEWAY_ENDPOINT

class TestPortalService(unittest.TestCase):
    def test_valid_order_total(self):
        """Test calculate_order_total with valid inputs"""
        self.assertEqual(calculate_order_total(20000, 250), 20500)
        self.assertEqual(calculate_order_total(10000, 100), 10100)
        self.assertEqual(calculate_order_total(0, 250), 0)

    def test_negative_subtotal_raises_error(self):
        """Test that negative subtotal_cents raises ValueError"""
        with self.assertRaises(ValueError) as ctx:
            calculate_order_total(-100, 250)
        self.assertIn("subtotal_cents must be non-negative", str(ctx.exception))

    def test_out_of_range_fee_bps_raises_error(self):
        """Test that fee_bps outside [0, 5000] raises ValueError"""
        with self.assertRaises(ValueError) as ctx:
            calculate_order_total(10000, -1)
        self.assertIn("fee_bps must be between 0 and 5000", str(ctx.exception))
        
        with self.assertRaises(ValueError) as ctx:
            calculate_order_total(10000, 5001)
        self.assertIn("fee_bps must be between 0 and 5000", str(ctx.exception))

    def test_debug_is_false(self):
        """Test that DEBUG is set to False"""
        self.assertFalse(DEBUG)

    def test_gateway_endpoint_is_https(self):
        """Test that GATEWAY_ENDPOINT uses HTTPS"""
        self.assertTrue(GATEWAY_ENDPOINT.startswith("https://"))
        self.assertEqual(GATEWAY_ENDPOINT, "https://internal-portal.example.invalid/v1/ledger")

    def test_sign_receipt_token_sha256(self):
        """Test that sign_receipt_token returns 64-character SHA-256 hex digest"""
        token = sign_receipt_token("order-12345")
        self.assertEqual(len(token), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in token))
        # Verify deterministic output
        self.assertEqual(sign_receipt_token("order-12345"), token)

if __name__ == "__main__":
    unittest.main()
