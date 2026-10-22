# PayPal sandbox wallet proof

Checked: 2026-10-22.

Status: **BLOCKED_MISSING_SANDBOX_CONFIGURATION**. No wallet connection or
saved-payment authorization has been proved. This is not a PayPal denial.

## Observed blocker

- `apps/server/.env` and the process environment have no PayPal app credentials.
- The server's `.env.schema` has no PayPal configuration yet.
- The FreshCart fixture uses `demo-freshcart-not-a-payee`; this is not a verified
  sandbox merchant ID. No actual merchant/buyer account pair is identified.
- `ShopperWallet.paypalVaultIdCiphertext` is a schema field only. Encryption,
  consent callbacks, and wallet connection endpoints are not implemented.

The sandbox account's Vault setting and saved-wallet eligibility cannot be
checked without access to the merchant app. No PayPal API requests were made.
No payment tokens were stored and no simulated success was substituted.

## Documentation checked

PayPal's [save-wallet guide](https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal)
(updated October 14, 2026) describes saving a wallet without a purchase. It calls
for Vault under the sandbox app's Accept payments / Advanced options, buyer
approval, and billing-agreement approval for reference transactions. Those
account-specific permissions remain unverified here.

The candidate is a direct, single-merchant integration using the Payment Method
Tokens v3 API. Sandbox base URL: `https://api-m.sandbox.paypal.com`.

## Request record

These are the next request templates, **not executed requests or example results**.
Uppercase bracketed values must be supplied by configuration or actual responses.

| Step | Request | Actual result / response IDs |
| --- | --- | --- |
| OAuth | `POST /v1/oauth2/token` | Not sent; credentials missing |
| Capability probe / start consent | `POST /v3/vault/setup-tokens` | Not sent; setup token, HTTP status and debug ID unavailable |
| Verify approval | `GET /v3/vault/setup-tokens/<SETUP_TOKEN_ID>` | Not sent; buyer approval unavailable |
| Save wallet | `POST /v3/vault/payment-tokens` | Not sent; payment token and customer ID unavailable |

[OAuth request](https://developer.paypal.com/api/rest/authentication):

```http
POST /v1/oauth2/token
Authorization: Basic <BASE64_OF_SANDBOX_CLIENT_ID_COLON_SECRET>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Candidate [setup request](https://developer.paypal.com/api/payment-tokens/v3/setup-tokens-create/):

```http
POST /v3/vault/setup-tokens
Authorization: Bearer <SERVER_ONLY_ACCESS_TOKEN>
Content-Type: application/json
PayPal-Request-Id: <PERSISTED_SETUP_REQUEST_ID>

{
  "payment_source": {
    "paypal": {
      "description": "Save PayPal for the FreshCart sandbox demo",
      "usage_pattern": "IMMEDIATE",
      "usage_type": "MERCHANT",
      "customer_type": "CONSUMER",
      "permit_multiple_payment_tokens": false,
      "experience_context": {
        "brand_name": "FreshCart",
        "shipping_preference": "NO_SHIPPING",
        "return_url": "<SERVER_RETURN_URL_WITH_ONE_TIME_STATE>",
        "cancel_url": "<SERVER_CANCEL_URL_WITH_ONE_TIME_STATE>"
      }
    }
  }
}
```

A setup response or OAuth scope alone must not be reported as a saved wallet.
After the buyer consents, the server must
[retrieve the setup token](https://developer.paypal.com/api/payment-tokens/v3/setup-tokens-get/)
and verify its approval before the
[payment-token exchange](https://developer.paypal.com/api/payment-tokens/v3/payment-tokens-create/):

```http
POST /v3/vault/payment-tokens
Authorization: Bearer <SERVER_ONLY_ACCESS_TOKEN>
Content-Type: application/json
PayPal-Request-Id: <PERSISTED_EXCHANGE_REQUEST_ID>

{"payment_source":{"token":{"id":"<APPROVED_SETUP_TOKEN_ID>","type":"SETUP_TOKEN"}}}
```

## Implementation gate and next run

1. Configure the merchant app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in
   ignored `apps/server/.env`. Never use client-exposed environment prefixes or
   commit the values. Identify its sandbox merchant account and a separate buyer.
2. Check the sandbox app's Vault setting and wallet eligibility. Record actual
   HTTP statuses, PayPal debug/request IDs, and sanitized error details. If the
   account cannot save wallets, stop and record that exact limitation.
3. If eligible, implement consent with expiring, one-use state bound to the
   authenticated shopper, store, merchant and server-created setup token. A
   browser return URL alone is not proof. Verify setup status server-to-server;
   reject wrong users/tokens, cancellation, expiration and callback replays.
4. Exchange only that verified setup token and validate the actual response.
   Encrypt the token using a dedicated server-only AES-256-GCM key, fresh nonce
   and authenticated shopper/store/merchant binding before writing to MongoDB.
   No key has been generated or encrypted storage implemented in this checkpoint.
5. Exercise the entire flow with the real sandbox account pair; verify encrypted
   persistence and idempotent callbacks. Keep access tokens/secrets out of logs.
   Record real setup/customer IDs and request/debug IDs in restricted evidence.
   Keep raw payment tokens out of Git and ordinary logs.

If webhooks are later used, apply PayPal's
[webhook signature requirements](https://developer.paypal.com/security-guidelines)
before accepting events. No webhook endpoint is added in this checkpoint.

No Orders API authorization, capture, purchase, or subscription is part of this
wallet-saving proof. The account capability check must precede implementation;
this checkpoint intentionally stops at the missing-configuration blocker.
