#!/usr/bin/env python3
"""Read-only connection/dump rehearsal. Never stores a durable backup or restores.

Run only from the manually dispatched main-branch GitHub workflow. The two
passwords must be entered by the owner in GitHub Actions Secrets, never in code.
Raw subprocess output (including SQL errors) must never reach public job logs.
"""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
from urllib.parse import quote, urlencode

REPOSITORY = "maekawatsukasa0713-sketch/lti-explore"
CLI_VERSION = "2.121.0"
POSTGRES_IMAGE = "postgres:17.6-bookworm"
ENDPOINTS = {
    "source": ("ozmulwqzybhiekmolvyk", "aws-0-ap-southeast-1.pooler.supabase.com"),
    "target": ("qzowxrmrxyjifoabjryr", "aws-0-ap-northeast-1.pooler.supabase.com"),
}
TABLES = (
    "lti_ai_usage", "lti_paper_bookmarks", "lti_paper_citations",
    "lti_paper_views", "lti_profiles", "lti_provision_batches",
    "lti_records", "lti_schools", "lti_support_messages",
)


class PreflightError(Exception):
    """Only fixed, non-sensitive stage names may appear in this exception."""


def guard_environment(env):
    required = {
        "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_REF": "refs/heads/main",
    }
    if any(env.get(key) != value for key, value in required.items()):
        raise PreflightError("execution-guard")
    for key in ("MIGRATION_SOURCE_DB_PASSWORD", "MIGRATION_TARGET_DB_PASSWORD"):
        value = env.get(key, "")
        if not value or any(c in value for c in "\x00\r\n"):
            raise PreflightError("credentials-guard")
    if not env.get("RUNNER_TEMP") or not Path(env["RUNNER_TEMP"]).is_dir():
        raise PreflightError("temporary-directory-guard")


def connection_url(endpoint, password):
    ref, host = ENDPOINTS[endpoint]
    query = urlencode({
        "sslmode": "require", "connect_timeout": "15",
        "options": "-c default_transaction_read_only=on -c statement_timeout=120000",
    })
    return f"postgresql://postgres.{ref}:{quote(password, safe='')}@{host}:5432/postgres?{query}"


def run_private(stage, args, *, cwd, env, input_text=None, timeout=600):
    try:
        result = subprocess.run(
            args, cwd=cwd, env=env, input=input_text, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise PreflightError(stage) from None
    if result.returncode:
        raise PreflightError(stage)
    return result.stdout


def connection_inventory(endpoint, password, directory, env):
    ref, host = ENDPOINTS[endpoint]
    # psql reads the secret from a private, read-only mounted passfile.
    passfile = directory / f"{endpoint}.pgpass"
    escaped = password.replace("\\", "\\\\").replace(":", "\\:")
    passfile.write_text(f"{host}:5432:postgres:postgres.{ref}:{escaped}\n")
    passfile.chmod(0o600)
    names = ",".join("'" + name + "'" for name in TABLES)
    sql = f"""BEGIN READ ONLY;
SELECT json_build_object(
 'pg_major', current_setting('server_version_num')::integer / 10000,
 'read_only', current_setting('transaction_read_only') = 'on',
 'database_ok', current_database() = 'postgres',
 'public_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
 'application_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ({names})),
 'auth_users', (SELECT count(*) FROM auth.users),
 'storage_buckets', (SELECT count(*) FROM storage.buckets),
 'storage_objects', (SELECT count(*) FROM storage.objects));
ROLLBACK;
"""
    args = [
        "docker", "run", "--rm", "-i", "--network", "host",
        "--mount", f"type=bind,source={passfile},target=/run/lti.pgpass,readonly",
        "-e", "PGPASSFILE=/run/lti.pgpass", "-e", "PGSSLMODE=require",
        "-e", "PGCONNECT_TIMEOUT=15",
        "-e", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=120000",
        POSTGRES_IMAGE, "psql", "-X", "-q", "-A", "-t", "-w",
        "-v", "ON_ERROR_STOP=1", "-h", host, "-p", "5432",
        "-U", f"postgres.{ref}", "-d", "postgres",
    ]
    output = run_private(f"{endpoint}-connection", args, cwd=directory, env=env, input_text=sql, timeout=180)
    try:
        value = json.loads(output.strip())
        if not isinstance(value, dict):
            raise ValueError()
        if value["pg_major"] != 17 or not all(value[k] is True for k in ("read_only", "database_ok")):
            raise ValueError()
        for key in ("public_tables", "application_tables", "auth_users", "storage_buckets", "storage_objects"):
            if type(value[key]) is not int or value[key] < 0:
                raise ValueError()
        if endpoint == "target" and any(value[k] for k in ("public_tables", "auth_users", "storage_buckets", "storage_objects")):
            raise ValueError()
        if endpoint == "source" and (value["application_tables"] != len(TABLES) or value["auth_users"] == 0):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise PreflightError(f"{endpoint}-inventory-guard") from None
    # Print only known aggregate counts, never arbitrary fields returned by SQL.
    counts = {key: value[key] for key in ("public_tables", "auth_users", "storage_buckets", "storage_objects")}
    print(f"{endpoint} read-only connection: PASS; counts={json.dumps(counts, sort_keys=True)}", flush=True)


def perform(cli, directory, source_password, target_password, env):
    version = run_private("cli-version", [cli, "--version"], cwd=directory, env=env, timeout=30).strip()
    if version != CLI_VERSION:
        raise PreflightError("cli-version-guard")
    connection_inventory("source", source_password, directory, env)
    connection_inventory("target", target_password, directory, env)
    source_url = connection_url("source", source_password)
    modes = (
        ("roles", ["--role-only"]),
        ("schema", []),
        ("data", ["--data-only", "--use-copy", "-x", "storage.buckets_vectors", "-x", "storage.vector_indexes"]),
    )
    for label, flags in modes:
        path = directory / f"{label}.sql"
        path.touch(mode=0o600)
        run_private(f"{label}-dump", [cli, "db", "dump", "--db-url", source_url, "-f", str(path), *flags], cwd=directory, env=env)
        if not path.is_file() or path.stat().st_size == 0 or path.stat().st_mode & 0o077:
            raise PreflightError(f"{label}-dump-file-guard")
        print(f"{label} temporary dump: PASS; bytes={path.stat().st_size}", flush=True)
    print("Preflight: PASS. No restore/cutover performed; temporary dumps are deleted.", flush=True)


def main():
    directory = None
    stage = "startup"
    os.umask(0o077)
    # Normal job cancellation still reaches finally. The workflow also has an
    # always() cleanup step; the hosted runner is discarded after the job.
    def interrupted(_signum, _frame):
        raise PreflightError("cancelled")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        guard_environment(os.environ)
        if len(sys.argv) != 2 or not Path(sys.argv[1]).is_file():
            raise PreflightError("cli-path-guard")
        source_password = os.environ.pop("MIGRATION_SOURCE_DB_PASSWORD")
        target_password = os.environ.pop("MIGRATION_TARGET_DB_PASSWORD")
        # Neither subprocesses nor Docker inherit migration secrets, PATs, or
        # GitHub tokens. Only platform/runtime variables required by tools pass.
        allowed = ("PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONFIG", "SSL_CERT_FILE", "SSL_CERT_DIR")
        env = {key: os.environ[key] for key in allowed if key in os.environ}
        env.update({"CI": "true", "NO_COLOR": "1"})
        directory = Path(tempfile.mkdtemp(prefix="lti-tokyo-preflight-", dir=os.environ["RUNNER_TEMP"]))
        directory.chmod(0o700)
        stage = "preflight"
        perform(str(Path(sys.argv[1]).resolve()), directory, source_password, target_password, env)
    except PreflightError as error:
        print(f"Preflight: FAIL ({error}). Raw diagnostics suppressed.", flush=True)
        return 1
    except Exception:
        print(f"Preflight: FAIL ({stage}). Raw diagnostics suppressed.", flush=True)
        return 1
    finally:
        if directory is not None:
            shutil.rmtree(directory, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
