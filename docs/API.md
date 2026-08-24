# API

## `GET /health`

Returns service status and supported chain metadata.

## Bytecode Resolution

Every analysis response contains a `bytecodeResolution` field. Use it to distinguish evidence sources:

- `provided`: caller-supplied runtime bytecode was analyzed.
- `live`: runtime bytecode was fetched explicitly through RPC.
- `missing`: RPC confirmed that no deployed runtime code exists.
- `disabled`: live fetching was not requested; static checks did not use deployed code.
- `unavailable`: RPC was configured but failed, timed out, was malformed, or validation could not complete.
