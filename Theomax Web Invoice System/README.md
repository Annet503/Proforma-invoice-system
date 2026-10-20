# Theomax Proforma Invoice System — Web Edition

This folder contains the browser-based edition of the invoice system. It adapts to desktop and phone screens, creates printable A4 proforma invoices, and can be installed from a secure website as a phone app.

The original VB6 + Microsoft Access desktop project remains separate and unchanged for the lecturer requirement. This web edition uses a Supabase cloud workspace; it does not write directly into the Access `.mdb` file.

## Publish it on the internet

1. Create a Supabase project and confirm email/password sign-in is enabled.
2. In Supabase SQL Editor, run `supabase-setup.sql` from this folder. Row-level security limits each account to its own invoice workspace.
3. Publish the contents of this folder (`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icon.svg`, and `theomax-logo.bmp`) to a static website host that serves HTTPS. HTTPS is needed for phone installation and service workers.
4. Open the published site, choose **Company settings**, enter the Supabase project URL and public `anon` key, and save the cloud connection.
5. Create an account and sign in. Use the same account on the phone and computer. The first sign-in uploads the records already saved in that browser; subsequent invoice/customer/product changes sync to the workspace.

Use only the Supabase public `anon` key in the browser. Never put a `service_role` key in this folder or website. Keep row-level security enabled. Download a backup regularly from **Company settings**.

## Local use

Opening `index.html` directly still works for local browser-only records. Public cloud sync and phone installation require the HTTPS website. When cloud sync is unavailable, changes remain saved in the current browser and the status message reports the sync error.

## Included

- Customer details, invoice dates and quote numbers
- New quotes use the `TMX-001`, `TMX-002`, … numbering format
- Item particulars, item descriptions, quantities, UGX unit prices and calculated totals
- Customer address, phone and email are optional and only appear when provided
- Company contact details and logo
- Saved invoice history, reprinting and PDF output through the device print dialog
- Cloud account sign-in and per-account data isolation
- Responsive phone navigation and installable offline app shell
- Downloadable and restorable JSON backups

## Data notes

The cloud workspace stores the app's invoice, customer, product and company settings as one JSON record per signed-in account. Do not edit records simultaneously on multiple devices; sync changes from one device before editing from another. The cloud workspace is separate from Microsoft Access; it does not automatically sync back into the VB6 desktop database.
