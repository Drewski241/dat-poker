# Amazon SES production access — alignment and reapplication

DAT Poker sends **transactional email only** (verification and password reset). SES may deny the first production request if the **public site**, **privacy disclosure**, or **use-case narrative** does not match what reviewers expect. This doc maps [AWS Acceptable Use Policy](https://aws.amazon.com/aup/), [Service Terms](https://aws.amazon.com/serviceterms/), and [SES best practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html) to what we actually do.

## What we do (facts for the form)

| Topic | Practice |
|--------|-----------|
| Mail type | **Transactional only** — email verification at signup, password reset on user request. No newsletters, promotions, or purchased lists. |
| Opt-in | User **creates an account** and **enters their own email** on https://datspiritpoker.com/play. A **one-time code** must be entered before sign-in; that proves inbox ownership. |
| Volume | Closed beta — low volume (tens of accounts, occasional resends). |
| From address | `noreply@datspiritpoker.com` (domain verified in SES with DKIM in Cloudflare). |
| Storage | Email, username, scrypt password hash, verification metadata in `accounts.json` on EC2 (`DAT_ACCOUNTS_PATH`). File mode **600**. Not sold or shared for marketing. |
| Codes | Verification/reset codes stored as **hashes**, short TTL; not logged to clients in production. |
| Gambling | Users must attest age/jurisdiction at sign-in; blocked regions configured server-side. Beta is **invite-style** public signup with compliance attestation — not bulk unsolicited mail about gambling. |
| Contact | https://datspiritpoker.com/feedback and https://datspiritpoker.com/privacy |
| Bounces | Monitor SES reputation metrics; stop sending to hard-bounced addresses (manual review during beta). |

## Likely reasons for an initial denial

AWS does not publish exact criteria. Common issues for small gaming sites:

1. **No public privacy policy URL** (terms referenced one but it was missing).
2. **Real-money / gambling-adjacent** product without clear **transactional-only** email story.
3. **New domain** and **new AWS account** with no sending history.
4. **Website** looks incomplete (no legal pages, unclear operator contact).
5. **Production access form** too vague or sounds like marketing.

## Before you reapply — checklist

- [ ] **Domain verified** in SES (Identities → `datspiritpoker.com` → Verified).
- [ ] **DKIM** (and ideally **SPF/DMARC**) correct in Cloudflare — SES identity details tab.
- [ ] **https://datspiritpoker.com/privacy** live (deploy latest web).
- [ ] **Terms** visible at sign-up; users accept before register/login.
- [ ] **SMTP** working in sandbox to **your own** verified test inbox (proves technical setup).
- [ ] Reapplication text emphasizes **transactional**, **opt-in**, **low volume**, **privacy URL**.
- [ ] Optional: use a **subdomain** for mail (e.g. `noreply@datspiritpoker.com` from verified apex domain is fine; some operators add `mail.datspiritpoker.com` as MAIL FROM — SES wizard can guide).

## Sample reapplication text

Paste and adjust:

> **Website:** https://datspiritpoker.com  
> **Privacy:** https://datspiritpoker.com/privacy  
>  
> We operate a closed-beta online poker platform. Email is **strictly transactional**: (1) one-time email verification when a user registers with their own address, (2) password reset codes when the user requests a reset with username + registered email. Users cannot sign in until verification succeeds. We do not send marketing, newsletters, or third-party lists.  
>  
> Addresses are stored on our application server (Amazon EC2) in an access-restricted account database; passwords are scrypt-hashed. We comply with age/jurisdiction attestation at registration. Expected send volume is under 100 messages/day during beta.  
>  
> We have verified our domain in SES with DKIM. We will monitor bounces and complaints via the SES console.

## If SES denies again

Use a **transactional provider** that does not require AWS production review:

- **Resend** — verify `datspiritpoker.com` in DNS, SMTP to `smtp.resend.com` (see [BETA.md](./BETA.md#email-delivery-one-time-operator-setup)).

Same application code; only `.env` SMTP values change.

## AUP highlights (plain language)

From the AWS AUP — avoid:

- Unsolicited bulk email or harvesting addresses.
- Deceptive subject lines or hiding identity.
- Sending malware or phishing.

We are aligned if we **only** mail people who typed their address on our site for **account security**, with **clear From branding** and **no promotional content**.

## Service terms

Using SES for **fraudulent** or **illegal** content in your jurisdiction is prohibited. Operators must ensure online poker is permitted for their testers’ regions; the product includes blocklists and attestation for that purpose.
