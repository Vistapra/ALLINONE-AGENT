"""Synthetic configuration fixture for defensive static review."""
import hashlib

DEBUG = True
UPSTREAM_SERVICE_URL = "http://internal-staging.example.invalid/api/v1"

def legacy_checksum(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()
