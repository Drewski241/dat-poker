#!/bin/bash
# Cancel leftover pending/active Sage offers on-chain so reserved treasury
# DAT becomes selectable and old offer1 strings are invalid. Does not
# re-import the spend key. Wait 1–2 minutes before the next withdraw.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/release-treasury-offers.sh
set -euo pipefail
export SAGE_RELEASE_OFFERS=1
exec bash "$(dirname "$0")/enable-treasury-sage.sh"
