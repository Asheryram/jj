#!/usr/bin/env sh
# Run the API locally against `jdc_live_copy` (a restored dump of production)
# with the real Paystack key, and everything else that could reach the outside
# world switched off. Overrides apply to this process only; `.env` is untouched.
#
#   sh scripts/start-live-copy.sh
#
# Paystack transfers are real: an agent payout or refund approved here pays
# real money that production never hears about. See PAYSTACK_TREASURY_ONLY below.
set -e
cd "$(dirname "$0")/.."

LOCAL="postgresql://jdc:jdc_dev_password@localhost:5433/jdc_live_copy"

export DATABASE_URL="$LOCAL"
export DIRECT_URL="$LOCAL"
export LIVE_DATABASE_URL=""
export LIVE_ANALYTICS_DATABASE_URL=""
export ANALYTICS_DATABASE_URL=""

# Suppliers simulated, never a real bundle purchase.
export DATAHUB_LIVE=false
export DATAHUB_API_KEY=""
export DATAHUB_WEBHOOK_SECRET=""
export GMPL_LIVE=false
export GMPL_SECRET=""

# No real email to real customers or agents, no AI calls.
export RESEND_API_KEY=""
export SMTP_HOST=""
export SMTP_USER=""
export SMTP_PASS=""
export GROQ_API_KEY=""

# Uncomment to block every Paystack transfer except the treasury's own (TRS-).
# export PAYSTACK_TREASURY_ONLY=1
export PORT=3001
export PUBLIC_APP_URL="http://localhost:5173"
export CORS_ORIGINS="http://localhost:5173"

exec node dist/main.js
