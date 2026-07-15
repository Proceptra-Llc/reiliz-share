# Sanitization Checklist

Use this checklist before granting any external access or adding new material to this repository.

## Prohibited content

- Production source-code snapshots
- Database exports or backups
- Customer, lead, tenant, employee, or pilot-user records
- Phone numbers, email addresses, street addresses, message content, call transcripts, or calendar details
- API keys, tokens, passwords, private keys, client secrets, webhook URLs, or signed URLs
- Cloud, vendor, or telephony account identifiers
- Personal account ownership and recovery details
- Production environment variables
- Internal security findings that have not been remediated
- Complete internal roadmaps, pricing strategy, or proprietary decision history

## Review steps

1. Confirm the file was authored for sharing and was not copied with Git history from the production repository.
2. Search the complete file contents for secret-like and personal-data patterns.
3. Inspect screenshots manually, including browser chrome, tabs, notifications, and account avatars.
4. Replace real identifiers with unmistakable placeholders.
5. Confirm examples cannot be executed against production systems.
6. Confirm no links grant access to private files, dashboards, recordings, or temporary signed assets.
7. Have a second reviewer inspect any artifact derived from production material.

## Suggested pattern search

```text
TOKEN
SECRET
PASSWORD
AUTH
API_KEY
PRIVATE_KEY
CLIENT_SECRET
WEBHOOK
ACCOUNT_SID
@gmail.com
@proceptra.com
phone
email
address
tenant
customer
```

A match is not automatically unsafe, but every match must be reviewed.
