# Batch waitlist

The waitlist page for Batch at waitlist.batchcampus.com. It is one small Node server that serves `public/index.html` and saves sign-ups to SQLite in `/data`.

## Environment variables

Set these in Coolify. Never put them in the code.

| Variable | Example | What it does |
|---|---|---|
| `SMTP_HOST` | `mail.batchcampus.com` | Your mail server |
| `SMTP_PORT` | `587` | Use 465 for implicit TLS |
| `SMTP_USER` | `hello@batchcampus.com` | Mail login |
| `SMTP_PASS` | *(set in Coolify)* | Mail password |
| `MAIL_FROM` | `Batch <hello@batchcampus.com>` | Sender of both emails |
| `NOTIFY_TO` | `you@batchcampus.com` | Gets an email for each new sign-up |
| `ADMIN_TOKEN` | a long random string | Turns on the CSV export |

If SMTP isn't set, sign-ups are still saved, but no emails go out.

## Export the list

`https://waitlist.batchcampus.com/api/waitlist.csv?token=<ADMIN_TOKEN>`

## Run locally

```bash
npm install
PORT=3000 DATA_DIR=./data node server.js
```
