# Upstream Components — Summary

| Component | Real upstream URL | Installed/checked-out version | License | Local modifications | Distribution strategy |
|---|---|---|---|---|---|
| Hermes Agent (bridge) | https://github.com/wyrtensi/hermes-agent-npm | npm `hermes-agent@0.21.5` | MIT (wyrtensi, 2026) | None | Pinned npm package |
| Hermes Agent (upstream) | https://github.com/NousResearch/hermes-agent | tag `v2026.9.24`, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` | MIT (Nous Research, 2025) | None | Fetched by bridge at install; not vendored |
| Paperclip | https://github.com/paperclipai/paperclip | commit `3dffb2c9` (branch `master`, 3 commits past canary tag `v2026.1119.0`) | MIT (Paperclip AI, 2025) | None (clean checkout) | Pinned git commit reference |
| VulnClaw | https://github.com/Netw0rkNoob/VulnClaw | tag `v0.4.1` = commit `0b34878` (branch `main`) | MIT (UncleC, 2026) | None (clean checkout) | Pinned git tag reference |
| Hermes3D | https://github.com/iamlukethedev/Hermes3D | commit `21215d7` (branch `integration/unified-ai-company`, 6 commits past tag `v1.0.0`) | MIT (Luke The Dev, 2026) code; **assets UNDECLARED** | **23 modified tracked files + 1 new untracked file**, captured as patch | Pinned commit + vendored patch (`upstream/patches/hermes3d-unified-ai-company.patch`) |

Notes:
- Brief's originally-stated commit hashes (Paperclip `c0f132898d`, Hermes3D `dc22e94`) do not match current actual HEADs — baseline was stale, not fabricated; use the real commits above.
- Brief's claim that Hermes Agent was "diinstal dari upstream resmi dengan customization" is only half right: it's installed via an unofficial third-party bridge that itself pins the real official upstream. No local customization found in either layer.
- Hermes3D's "local customization" is real and substantially larger than previously reported in this effort (24 files, not 4) — see PHASE-42-license-compliance.md for the full list and correction note.
