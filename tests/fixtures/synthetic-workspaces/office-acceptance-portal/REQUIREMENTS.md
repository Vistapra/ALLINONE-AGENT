# Office Acceptance Portal — Service Requirements
1. Compute deterministic session order totals (`subtotal_cents` + `fee_bps`).
2. Reject negative `subtotal_cents` or out-of-range `fee_bps` (`0..5000`) with `ValueError`.
3. Sign session receipts with SHA-256 (never MD5) and enforce `DEBUG = False` + `https://` gateway URL.
