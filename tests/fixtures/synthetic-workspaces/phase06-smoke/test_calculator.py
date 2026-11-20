import unittest

from calculator import add_numbers, multiply_numbers


class TestCalculator(unittest.TestCase):
    def test_add_numbers_positive(self):
        self.assertEqual(add_numbers(2, 3), 5)

    def test_add_numbers_negative(self):
        self.assertEqual(add_numbers(-4, 1), -3)

    def test_multiply_numbers(self):
        self.assertEqual(multiply_numbers(6, 7), 42)

    def test_multiply_numbers_zero(self):
        self.assertEqual(multiply_numbers(9, 0), 0)


if __name__ == "__main__":
    unittest.main()
