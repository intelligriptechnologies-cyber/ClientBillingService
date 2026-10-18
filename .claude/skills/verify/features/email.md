# Email delivery

A tenant admin or user sends an issued invoice to the customer by email with the invoice PDF attached. Every attempt, sent, failed or not configured, is written to a per-invoice delivery log that the invoice detail page lists. Email payment reminders go out through the same mailer when SMTP is set up.

## Sub-features

- `email-send` sends the invoice PDF to the customer's billing address, or to addresses typed in the dialog, with an editable message.
- `email-delivery-log` lists every attempt for the invoice with time, recipients, subject, status and failure reason.
- `email-not-configured` answers a clear result, and logs it, while the tenant has no SMTP host or From address.
- `email-reminder` emails a payment reminder when SMTP is set up and otherwise says the reminder was recorded, not sent.
- `email-smtp-test` checks the saved SMTP settings (see `settings-templates.md`).

## How to get to it (user POV)

- Open an invoice at `/invoices/<id>` and choose `Send by email` (hidden on void invoices). The dialog is named `Send invoice by email`. The `Deliveries` panel on the same page shows the log.
- Choose `Email reminder` on `Reports`, `Pending Payments`.
- API used by the pages: `POST /api/invoices/<id>/send` with `{to?, cc?, message?}` (200 sent, 409 not configured, 502 failed, 400 bad address, 404 unknown or other tenant's invoice, 409 void), `GET /api/invoices/<id>/deliveries`, `POST /api/pending-payments/<id>/reminders`, `POST /api/settings/smtp-test`.

## Driving it with control-billing

Preconditions:

- `control-billing doctor` reports `ok: true`. The instance runs with `CLIENT_BILLING_MAIL_TRANSPORT=capture`, so nothing leaves the machine; messages are appended to `mail-capture.json` in the same folder as the sqlite file (the `dbPath` printed by `up`).
- You ran `control-billing login nexio-admin`. Invoice `NEX-2026-001` is issued. No SMTP host is saved yet.

- **Not configured.** Run `control-billing api POST /api/invoices/nexio-invoice-001/send '{}'`. The status is `409` and the body has `status: "not-configured"` and the text `Email is not set up`. `db "SELECT status,error FROM delivery_log WHERE invoice_id='nexio-invoice-001'"` shows one `not-configured` row.
- **Configure.** Run `control-billing api GET /api/settings`, then `PUT /api/settings` with that settings object plus `smtpHost` `smtp.nexio.test`, `smtpFrom` `billing@nexio.test`, `smtpUser` `billing` and `smtpPassword` `secret` (use `--body-file`). The response has `smtpPasswordSet: true` and never the password.
- **Send through the UI.** Run `control-billing snapshot /invoices/nexio-invoice-001`, then in a `run` script choose `Send by email`. In the dialog `Send invoice by email` the `To` textbox holds `billing@nexio.example`. Fill the `Message` textbox and choose `Send email`. The element with role `status` reads `NEX-2026-001 was emailed to billing@nexio.example.` and the `Deliveries` panel gains a row with status `sent`.
- **Read the captured message.** Open `mail-capture.json` next to the sqlite file. The last entry has `to`, `from` `billing@nexio.test`, the subject `Invoice NEX-2026-001 from Nexio Hyper (...)` and one attachment `NEX-2026-001.pdf` whose `contentBase64` starts `JVBERi0` (`%PDF-`).
- **Delivery log.** `control-billing api GET /api/invoices/nexio-invoice-001/deliveries` returns `deliveries` newest first and `defaults` (`to`, `subject`, `message`, `configured`). Second view: `db "SELECT status,to_address,subject,attempted_by FROM delivery_log WHERE invoice_id='nexio-invoice-001'"`.
- **Refusals.** `POST .../send '{"to":"nope"}'` answers `400` with a message that starts `To:`. After voiding an invoice, `POST .../send` answers `409`. `--as evo-admin` on either route answers `404`.
- **Reminder.** `control-billing api POST /api/pending-payments/nexio-invoice-001/reminders '{"channel":"email"}'` returns the reminder with `delivery: "sent"` and `message` `Email reminder sent to ...`. With `{"channel":"whatsapp"}` it returns `delivery: "recorded"` and a message that says `recorded, not sent`.
- **Proof.** Save the API bodies, the `db` rows and a screenshot of the `Deliveries` panel (`control-billing screenshot /invoices/nexio-invoice-001 email/deliveries.png`). Include the captured message JSON (without opening any real mailbox).

## Gotchas

- Capture mode still needs a saved SMTP host and a valid From address. Without them every send is `not-configured`, on purpose, so the unconfigured path can be driven too.
- The `Message` textbox's accessible name starts with `Message` and then repeats its text, so match it with `/^Message/`, not an exact name.
- No real SMTP server is reached by the isolated instance. Delivery to a real mailbox is not proven by anything in this recipe.
- The SMTP password is write-only. If an API or page ever returns it, that is a bug.
