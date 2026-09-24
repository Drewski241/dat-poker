#!/bin/bash
# Paste this entire box into EC2 Launch instance → Advanced details → User data.
# Leave “User data already base64 encoded” unchecked.
set -euxo pipefail
export DAT_POKER_REPO_REF="${DAT_POKER_REPO_REF:-cursor/aws-ec2-first-server-6971}"
export DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"
curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/${DAT_POKER_REPO_REF}/deploy/aws-ec2/user-data.sh" | bash
