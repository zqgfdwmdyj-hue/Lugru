#!/usr/bin/env bash
# Nachweis für Marktplatz-Fragebögen („Do you encrypt users' PII?“): zeigt, wie Empfängerdaten
# (Name, Anschrift, Telefon, E-Mail) in der Datenbank stehen – nur Chiffretext, gekürzt.
# Aufruf auf dem Server:  bash /opt/seller-system/deploy/pii-nachweis.sh   → Ausgabe abfotografieren.
set -euo pipefail
cd "$(dirname "$0")/.."

compose() {
  if grep -q "^COMPOSE_FILE=" .env 2>/dev/null; then docker compose "$@"; else docker compose -f docker-compose.yml -f deploy/docker-compose.hetzner.yml "$@"; fi
}

compose exec -T db psql -U seller -d seller -P pager=off <<'SQL'
\echo '=== orders: recipient name + shipping address (AES-256-GCM, "pii:v1.<iv>.<tag>.<ciphertext>") ==='
select left(id::text, 8) || '…' as id, channel,
       left(buyer_name, 36) || '…' as buyer_name_encrypted,
       left(ship_to::text, 46) || '…' as ship_to_encrypted
  from orders where buyer_name is not null or ship_to is not null
 order by created_at desc limit 5;

\echo '=== invoices: buyer name/address/email/VAT-ID sealed in "pii", amounts readable ==='
select number, left(data->>'pii', 40) || '…' as buyer_data_encrypted,
       data ? 'buyer' as plaintext_buyer_present
  from ebay_invoices order by id desc limit 5;

\echo '=== files (shipping labels, documents): binary header ==='
select left(id::text, 8) || '…' as id, mime_type,
       encode(substring(data from 1 for 8), 'escape') as header,
       substring(data from 1 for 8) = '\x504949454e433100'::bytea as encrypted
  from files order by created_at desc limit 5;

\echo '=== summary: rows still in plaintext (should all be 0) ==='
select 'orders' as "table", count(*) filter (where (buyer_name is not null and buyer_name not like 'pii:v1.%') or jsonb_typeof(ship_to) = 'object') as plaintext_rows, count(*) as total from orders
union all select 'cases', count(*) filter (where customer is not null and customer not like 'pii:v1.%'), count(*) from cases
union all select 'customers', count(*) filter (where street not like 'pii:v1.%' or email not like 'pii:v1.%' or contact not like 'pii:v1.%'), count(*) from customers
union all select 'invoices', count(*) filter (where data ? 'buyer'), count(*) from ebay_invoices
union all select 'files', count(*) filter (where substring(data from 1 for 8) <> '\x504949454e433100'::bytea), count(*) from files;
SQL
