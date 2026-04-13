# Noctua Mail Deployment Reference

Quick reference for deploying Noctua Mail in any environment.

## Prerequisites

### Runtime
- **Bun**

### Infrastructure
- **Persistent storage** for SQLite database and email attachments
- **HTTPS/TLS** for secure connections
- **Network access** to IMAP/SMTP servers

## Required Environment Variables

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SESSION_SEAL_KEY` | 32-byte hex key for session encryption | `openssl rand -hex 32` | ✅ Yes |
| `IMAP_SECRET_KEY` | 32-byte hex key for IMAP credential encryption | `openssl rand -hex 32` | ✅ Yes |
| `PORT` | HTTP port to listen on | `3654` | No (default: 3654) |
| `NOCTUA_DATA_DIR` | Directory for SQLite DB and attachments | `/app/.data/` | No (default: `.data/`) |
| `IMAP_CREDENTIALS_STORAGE` | Where to store IMAP credentials | `cookie`, `db`, or `both` | No (default: both) |

## Generating Secrets

```bash
# Generate SESSION_SEAL_KEY
openssl rand -hex 32

# Generate IMAP_SECRET_KEY
openssl rand -hex 32
```

**Important:** Use different keys for different environments (dev, staging, prod).

## Deployment Methods

### Docker (Recommended)

**Build image:**
```bash
docker build -t noctua-mail .
```

Worker subprocesses are started by API routes and execute TypeScript entrypoints from `./scripts` at runtime. In `output: 'standalone'` builds, those files must be included explicitly by Next's trace configuration in [next.config.ts](/Users/paul/src/mywebmail/next.config.ts). Do not rely on incidental file tracing to pull them into `.next/standalone`.

**Verify Docker worker packaging:**
```bash
bun run test:docker-workers
```

This rebuilds the Docker runtime image and confirms that the worker entrypoints resolve inside the container.

**Run container:**
```bash
docker run -d \
  --name noctua-mail \
  -p 3654:3654 \
  -v /path/to/data:/app/.data \
  -e SESSION_SEAL_KEY="your_key_here" \
  -e IMAP_SECRET_KEY="your_key_here" \
  noctua-mail
```

### Standalone (Bun)

**Install dependencies:**
```bash
bun install
```

**Build:**
```bash
bun run build
```

**Verify standalone worker packaging:**
```bash
bun run test:standalone-workers
```

This verifies that the standalone output contains the required worker entrypoints and their traced local runtime dependencies.

**Run:**
```bash
export SESSION_SEAL_KEY="your_key_here"
export IMAP_SECRET_KEY="your_key_here"
export NOCTUA_DATA_DIR="/path/to/data/"
bun --bun .next/standalone/server.js
```

## Storage Requirements & Architecture

### Database Architecture

Noctua Mail uses a **master + sharded database architecture**:

| Database | Path | Contains | Backup Priority |
|----------|------|----------|----------------|
| **Master DB** | `$NOCTUA_DATA_DIR/mail.db` | Users, accounts, credentials, control-plane data | **Critical** |
| **Account DBs** | `$NOCTUA_DATA_DIR/db/accounts/<accountId>.db` | Messages, folders, threads, FTS index (per account) | **Critical** |

### Cache Directories (Regenerable)

| Directory | Path | Purpose | Backup Priority |
|-----------|------|---------|----------------|
| **Email sources** | `$NOCTUA_DATA_DIR/sources/<accountId>/` | Raw .eml files (cache) | Optional¹ |
| **Attachments** | `$NOCTUA_DATA_DIR/attachments/<accountId>/` | Binary attachment files (cache) | Optional¹ |

¹ **Cache directories are regenerable** - These files are re-fetched from IMAP servers on demand if missing. You can safely delete them to reclaim space; they'll be recreated automatically when accessed.

### Storage Size Estimates

| Component | Size Estimate |
|-----------|---------------|
| Master DB | ~1-10MB (scales with user/account count) |
| Account DB (per account) | ~10MB per 10k messages + attachments metadata |
| Source cache (per account) | ~1-2KB per message (if cached) |
| Attachment cache (per account) | Varies widely by email usage |

**Minimum:** 1GB storage
**Recommended:** 10GB+ depending on email volume

### WAL Files (Temporary)

SQLite generates temporary files in WAL mode:
- `.db-wal` (Write-Ahead Log)
- `.db-shm` (Shared Memory)

These are auto-managed and should be included in backups if the app is running.

**For complete storage architecture details, see [STORAGE.md](STORAGE.md)**

## Network & Firewall

### Inbound (Application)
- Port 3654 (HTTP) - or your configured `PORT`
- Typically behind reverse proxy (nginx, Caddy, Traefik)

### Outbound (IMAP/SMTP)
- Port 143 (IMAP)
- Port 993 (IMAPS)
- Port 25 (SMTP)
- Port 587 (Submission)
- Port 465 (SMTPS)

## Reverse Proxy (HTTPS)

Noctua Mail runs HTTP only. Use a reverse proxy for HTTPS:

**Caddy example:**
```
mail.example.com {
    reverse_proxy localhost:3654
}
```

**nginx example:**
```nginx
server {
    listen 443 ssl http2;
    server_name mail.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3654;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Health Checks

**Endpoint:** `GET /`
**Expected:** HTTP 200 with HTML response

**Docker health check:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3654/ || exit 1
```

## Backup & Restore

See [STORAGE.md](STORAGE.md) for detailed information about which data is stored where.

### What to Backup

**Critical (must backup):**
- Master DB: `mail.db` (+ `.db-wal`, `.db-shm` if app is running)
- Account DBs: `db/accounts/*.db` (+ `-wal`, `-shm` files)

**Optional (regenerable cache):**
- Sources: `sources/` (re-fetched from IMAP on demand)
- Attachments: `attachments/` (re-fetched from IMAP on demand)

### Full Backup (including cache)

```bash
# Stop application (recommended for consistency)
tar czf noctua-backup-$(date +%Y%m%d).tar.gz /path/to/noctua/data/
```

### Database-Only Backup (minimal, excludes cache)

```bash
# Stop application (recommended)
cd /path/to/noctua/data
tar czf noctua-db-backup-$(date +%Y%m%d).tar.gz \
  mail.db mail.db-wal mail.db-shm \
  db/
```

**Cache directories (`sources/`, `attachments/`) are excluded** - they'll be regenerated from IMAP.

### Restore

```bash
# Stop application
# Extract backup
tar xzf noctua-backup-20260211.tar.gz -C /path/to/noctua/data/
# Start application
```

### Important Notes

- **WAL mode:** If app is running during backup, include `.db-wal` and `.db-shm` files. Otherwise they can be omitted.
- **Cache regeneration:** Missing `sources/` or `attachments/` files are automatically re-downloaded from IMAP servers when needed.
- **Space savings:** Database-only backups are much smaller (excludes potentially large attachment cache).
- **IMAP requirement:** Cache regeneration requires IMAP access. Ensure credentials are valid before restoring database-only backups.
