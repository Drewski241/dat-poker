# Create the DAT POKER GitHub Repository

Follow these steps once. Total time: about 5 minutes.

---

## Part 1 — Create the empty repo on GitHub

1. **Sign in** to GitHub as `Drewski241` (or your org account).

2. Open **New repository**:  
   **https://github.com/new**

3. Fill in the form:

   | Field | Value |
   |-------|--------|
   | **Owner** | `Drewski241` (or your org) |
   | **Repository name** | `dat-poker` |
   | **Description** | `DAT POKER — Chia blockchain poker with DAT Governance Token funding` |
   | **Visibility** | Public *or* Private (your choice) |

4. **Important:** leave these **unchecked**:
   - Add a README file  
   - Add .gitignore  
   - Choose a license  

   (This project already includes README, `.gitignore`, and MIT `LICENSE`.)

5. Click **Create repository**.

6. You should see a page titled **“Quick setup”** with a URL like:  
   `https://github.com/Drewski241/dat-poker.git`  
   Keep this tab open.

---

## Part 2 — Push the DAT POKER code

The full codebase is on a **temporary export branch** of SCROPION-TRADER (migration only):

`https://github.com/Drewski241/SCROPION-TRADER/tree/dat-poker-export`

### On your computer (Terminal / PowerShell)

```bash
# 1) Clone the export branch
git clone -b dat-poker-export https://github.com/Drewski241/SCROPION-TRADER.git dat-poker
cd dat-poker

# 2) Point at your NEW repo
git remote set-url origin https://github.com/Drewski241/dat-poker.git

# 3) Rename branch to main (if needed)
git branch -M main

# 4) Push everything
git push -u origin main
```

### If GitHub asks you to sign in

- **HTTPS:** use a [Personal Access Token](https://github.com/settings/tokens) as the password, not your GitHub password.
- **SSH:** use `git@github.com:Drewski241/dat-poker.git` instead of HTTPS for `origin`.

---

## Part 3 — Verify on GitHub

1. Open **https://github.com/Drewski241/dat-poker**
2. Confirm you see:
   - `README.md` titled **DAT POKER**
   - `packages/`, `services/`, `docs/`
   - `docs/DAT_TOKEN.md`
3. Optional: **Settings → General → Repository name** should be `dat-poker`.

---

## Part 4 — Clean up SCROPION-TRADER (recommended)

After `dat-poker` is live:

1. **Close** the old poker PR on SCROPION-TRADER (if still open):  
   https://github.com/Drewski241/SCROPION-TRADER/pull/2 — close **without merging**.

2. **Delete** temporary export branches (GitHub → SCROPION-TRADER → Branches):

   - `chia-poker-export` (old name)
   - `dat-poker-export` (after you’ve pushed to `dat-poker`)

   Or from terminal:

   ```bash
   git push origin --delete chia-poker-export
   git push origin --delete dat-poker-export
   ```

SCROPION-TRADER should only contain your trader bot again.

---

## Part 5 — Connect Cursor Cloud Agent

1. In Cursor, open **Cloud Agent** / background agent settings.
2. Point the workspace repository to:  
   **`https://github.com/Drewski241/dat-poker`**
3. New tasks will run against DAT POKER only.

---

## Part 6 — Local development

```bash
git clone https://github.com/Drewski241/dat-poker.git
cd dat-poker
cp .env.example .env
# Edit .env — set DAT_GOVERNANCE_TOKEN_ASSET_ID

corepack enable
pnpm install
pnpm build
pnpm test
pnpm dev:api
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Repository not found` | Create the empty `dat-poker` repo first (Part 1). |
| `rejected – non-fast-forward` | New repo must be empty; don’t add README on GitHub. |
| `Permission denied` | Use PAT or SSH keys for GitHub auth. |
| Wrong code on `main` | Ensure you cloned branch `dat-poker-export`, not SCROPION-TRADER `main`. |

---

## After the repo exists

Reply in Cursor with your repo URL (`https://github.com/Drewski241/dat-poker`) and your **DAT Governance Token asset ID** (if you want it pre-filled in `.env.example`). We can continue with wallet buy-in integration and the web client in the correct repository.
