---
sidebar_position: 4
---

# Authentication

Abroad supports API keys for server-to-server requests and JWT bearer tokens for wallet/user scoped flows.

## API keys

Add the `X-API-Key` header to every HTTP request. Keep this key secret and never expose it client-side.

```http
GET /transaction/123 HTTP/1.1
Host: api.abroad.finance
X-API-Key: your_api_key_here
Content-Type: application/json
```

## Bearer token (JWT)

Some endpoints also accept a bearer token (for example, if you obtained a SEP JWT via `/walletAuth`). Include it as the `Authorization` header:

```http
GET /protected-resource HTTP/1.1
Host: api.abroad.finance
Authorization: Bearer your_jwt_token
Content-Type: application/json
```

## Errors & troubleshooting

- Missing or invalid credentials return `401 Unauthorized`.
- If an endpoint requires an API key, make sure the header name is exactly `X-API-Key`.
- When using bearer auth, ensure the token is not expired and the `Bearer ` prefix is present.

```json
{
  "message": "Invalid API Key"
}
```
