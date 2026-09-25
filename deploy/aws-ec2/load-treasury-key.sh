#!/bin/bash
# Load or replace the dedicated treasury Sage spend key on the AWS host.
# Use this after the first withdraw works, or whenever the treasury key
# must be rotated. The secret is never printed.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
#   sudo TREASURY_SAGE_PRIVATE_KEY_FILE=/root/treasury.hex bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
#   sudo SAGE_KEEP_OLD_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
#
# Player Sage stays off this box. Do not paste the secret into chat.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SAGE_LOAD_KEY=1
exec bash "$SCRIPT_DIR/enable-treasury-sage.sh" "$@"
