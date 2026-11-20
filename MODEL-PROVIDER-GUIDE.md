# Model Provider Guide

ALLINONE-AGENT's Hermes workers call out to a model provider through two integration-level
settings in `config\platform.local.env`:

```
HERMES_API_URL=
HERMES_MODEL=
HERMES_API_KEY=
CUSTOM_API_KEY=
```

These are passed through to each agent's isolated Hermes worker profile
(`profiles\pc<role>\.env` under `ALLINONE_HERMES_HOME`) — see
[config/paperclip-agent-profile.example.env](config/paperclip-agent-profile.example.env) and
`docs/legacy-platform-docs/PAPERCLIP-INTEGRATION.md` for how that passthrough actually works.
Hermes Agent itself is a pinned-upstream dependency (not vendored into this repo — see
`upstream/components.lock.json`); its own deeper configuration (`config.yaml`, provider plugins)
is documented in its own installation, not duplicated here.

## Supported configuration — by evidence, not by endorsement

**`combo/X`** is preserved as a documented example because the reference installation this
project was consolidated from used it. It is listed here **as one configuration a prior user
happened to run**, not as a recommended, validated, or default provider. This project does not
assert that `combo/X` is correct, available, or appropriately priced for your use — if you use
it, that's your own configuration choice, verified by you.

**Any OpenAI-compatible HTTP API** should work in principle, since `HERMES_API_URL` /
`HERMES_MODEL` is a base-URL-and-model-name pair rather than a hardcoded provider integration.
This has not been tested end-to-end against a live, non-reference provider by this project —
treat it as a reasonable expectation, not a verified claim, until you've confirmed it in your own
environment.

## Configuring a provider

1. Set `HERMES_API_URL` to your provider's API base URL.
2. Set `HERMES_MODEL` to the model identifier your provider expects.
3. Set `HERMES_API_KEY` (or `CUSTOM_API_KEY`, depending on which integration point reads it —
   check `docs/legacy-platform-docs/PAPERCLIP-INTEGRATION.md` section 3 for which env var each
   adapter surface actually consumes) to your provider's API key. **Never commit this value or
   paste it into a chat/log** — treat it exactly like the Telegram bot token.
4. Run `.\health.ps1` after `.\start.ps1` to see whether the configured endpoint is reachable.

## Known gap: no automated connectivity verification yet

Neither `install.ps1` nor `setup.ps1` currently calls your configured provider to confirm the
base URL/model/key actually work (Phase 46 status: `[NOT VERIFIED]`). Today, the only way to
confirm connectivity is to start the platform and watch for a successful agent run, or to check
provider-side logs/dashboards yourself. A scripted connectivity check (e.g. a minimal
completion request against `HERMES_API_URL`) is a reasonable future improvement, not yet built —
don't assume one exists.

## Token usage and pricing

This project does not track or estimate your token usage or cost — that's your provider's own
dashboard/billing. `config\platform.local.env.example` includes optional
`PLATFORM_REF_*_USD_PER_1M` fields used only for local cost-estimation *displays*, if you choose
to fill them in; leaving them blank is fine and does not block anything from working.
