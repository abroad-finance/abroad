# Confidential-token conformance vectors

Copied verbatim from OpenZeppelin's `stellar-contracts`, path
`packages/tokens/src/confidential/circuits/lib/testdata/`, at commit
`9b5ed96f67aa28a8be73c538f7bfdef65925c6bc` (2026-07-31).

They are the protocol's own cross-language contract: an off-chain implementation
is conformant *iff* it reproduces every output for the documented inputs. Upstream
generates them from the Noir library itself (`nargo test print_fixtures`), so they
are not our expectations of the protocol — they are the protocol's.

Shared inputs, as documented upstream: `sk = 0xdead`, `addr_f = 0xbeef`,
`sigma = 0x01`, `v = 1000`, `r = 42`, `v_transfer = 100`, `r_e = 0xfeedface`,
`s = 0x12345`, with `H` the Pedersen generator at index 1.

If a vector here ever stops matching upstream, the protocol changed and
`confidentialGrumpkin.ts` must be revisited before the deposit path is trusted.
