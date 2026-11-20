import unittest
from invoice_engine import compute_invoice_total, invoice_signature, DEBUG, TAX_SERVICE_ENDPOINT

class TestInvoiceEngine(unittest.TestCase):
    def test_compute_total_valid(self):
        self.assertEqual(compute_invoice_total(10000, 1100), 11100)
        self.assertEqual(compute_invoice_total(0, 0), 0)
        self.assertEqual(compute_invoice_total(200, 0), 200)
        self.assertEqual(compute_invoice_total(300, 10000), 600)

    def test_net_cents_negative_raises(self):
        with self.assertRaises(ValueError):
            compute_invoice_total(-1, 1100)

    def test_tax_bps_invalid_raises(self):
        for bps in [-1, 10001]:
            with self.assertRaises(ValueError):
                compute_invoice_total(100, bps)

    def test_debug_is_false(self):
        self.assertFalse(DEBUG)

    def test_tax_service_endpoint_https(self):
        self.assertTrue(TAX_SERVICE_ENDPOINT.startswith("https://"), TAX_SERVICE_ENDPOINT)

    def test_invoice_signature_sha256(self):
        sig = invoice_signature("1234-test")
        self.assertEqual(len(sig), 64)
        # SHA-256 is all lowercase hex
        int(sig, 16)  # Does not raise

if __name__ == "__main__":
    unittest.main()