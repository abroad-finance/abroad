---
sidebar_position: 2
---

# Authentication

Abroad uses API Keys to authenticate requests. You must include your API key in the header of every request.

## API Key

To authenticate, add the `X-API-Key` header to your HTTP requests.

```http
GET /transaction/123 HTTP/1.1
Host: api.abroad.com
X-API-Key: your_api_key_here
```

> **Security Note**: Your API Key carries many privileges, so be sure to keep it secret! Do not share your secret API keys in publicly accessible areas such as GitHub, client-side code, and so forth.

## Bearer Token (JWT)

Some endpoints may require a Bearer token, which is typically used for user-scoped actions or when interacting with specific services that require a session.

```http
GET /protected-resource HTTP/1.1
Host: api.abroad.com
Authorization: Bearer your_jwt_token
```

## Errors

If you provide an invalid or expired key, the API will return a `401 Unauthorized` error.

```json
{
  "message": "Invalid API Key"
}
```
