#!/bin/bash
# Delete leftover pending/active Sage offers so reserved treasury DAT
# becomes selectable again. Does not re-import the spend key.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/release-treasury-offers.sh
set -euo pipefail
export SAGE_RELEASE_OFFERS=1
exec bash "$(dirname "$0")/enable-treasury-sage.sh"
