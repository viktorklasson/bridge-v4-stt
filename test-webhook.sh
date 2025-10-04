#!/bin/bash
# Test webhook for inbound call

echo "🧪 Sending test webhook to production server..."

curl -X POST http://localhost:3000/webhook/inbound-call \
  -H "Content-Type: application/json" \
  -d '{
  "id": "c2225ahk-test-call-id-3c56hbk-dgkk",
  "url": "https://api.telnect.com/v1/Calls/c2225ahk-test-call-id-3c56hbk-dgkk",
  "source": {
    "dialplan": {"key": "SE", "name": "Sweden", "cc": "46"},
    "asserted": {"scheme": "tel", "user": "0737606800"},
    "caller": {"scheme": "tel", "user": "0737606800"}
  },
  "destination": {
    "dialplan": {"key": "SE", "name": "Sweden", "cc": "46"},
    "req": {"scheme": "tel", "user": "0775893847"},
    "to": {"scheme": "tel", "user": "0775893847"}
  },
  "number": {
    "asserted": "0737606800",
    "called": "0775893847",
    "caller": "0737606800"
  },
  "status": "trying"
}'

echo ""
echo "✅ Webhook sent!"

