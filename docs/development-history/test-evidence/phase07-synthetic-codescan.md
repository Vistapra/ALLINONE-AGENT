# VulnClaw Code Scan Report

- **Path**: `${ALLINONE_HOME}\tests\fixtures\synthetic_app`
- **Files scanned**: 1 (skipped 0)
- **Duration**: 17.2 ms
- **Layers**: L1, L2

## Findings (3)

| Severity | Layer | Rule | File:Line | Evidence |
|---|---|---|---|---|
| Medium | L1 | `unsafe_debug_true` | `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:4` | DEBUG = True |
| Medium | L2 | `weak_crypto` | `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:8` | return hashlib.md5(data).hexdigest() |
| Low | L2 | `insecure_http` | `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:5` | UPSTREAM_SERVICE_URL = "http://internal-staging.example.invalid/api/v1" |

## Details

### 1. [Medium] Debug / unsafe config enabled

- **Rule**: `unsafe_debug_true` (layer L1)
- **Location**: `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:4:1`
- **CWE**: CWE-489
- **Evidence**: `DEBUG = True`
- **Description**: Debug or permissive verification settings enabled in code/config.
- **Fix**: Disable debug mode for production.

### 2. [Medium] Weak cryptographic primitive

- **Rule**: `weak_crypto` (layer L2)
- **Location**: `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:8:20`
- **CWE**: CWE-327
- **Evidence**: `return hashlib.md5(data).hexdigest()`
- **Description**: A deprecated / weak crypto primitive is used.
- **Fix**: Use SHA-256+ / AES-GCM / argon2 for password hashing.

### 3. [Low] Insecure HTTP URL

- **Rule**: `insecure_http` (layer L2)
- **Location**: `${ALLINONE_HOME}\tests\fixtures\synthetic_app\app_settings.py:5:25`
- **CWE**: CWE-319
- **Evidence**: `UPSTREAM_SERVICE_URL = "http://internal-staging.example.invalid/api/v1"`
- **Description**: Plain HTTP endpoint in code — traffic is unencrypted.
- **Fix**: Use HTTPS; for internal traffic consider TLS everywhere.
