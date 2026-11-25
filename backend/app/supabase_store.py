"""Supabase Auth and per-user data access for REX.

The browser owns the Supabase Auth session using the public anon/publishable key.
Private REX API routes validate the user's access token and use that same token
against PostgREST, so the installed RLS policies remain the authorization boundary.
The service-role key is used only for account administration and recovery-code rows.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from typing import Any
from pathlib import Path

import httpx
from fastapi import HTTPException, Request

# Load the root .env before reading configuration; this module is imported before
# main.py's optional local settings loader runs.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_LOCAL_ENV = _PROJECT_ROOT / ".env"
if _LOCAL_ENV.is_file():
    try:
        for _raw in _LOCAL_ENV.read_text(encoding="utf-8").splitlines():
            _line = _raw.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _value = _line.split("=", 1)
                os.environ.setdefault(_key.strip(), _value.strip().strip('"').strip("'"))
    except OSError:
        pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "") or os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_SECRET_KEY", "")
AUTH_EMAIL_DOMAIN = "users.rex.invalid"
USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")

_http = httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
_auth_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_auth_cache_lock = threading.Lock()
_recovery_attempts: dict[str, list[float]] = {}
_recovery_lock = threading.Lock()
_registration_attempts: dict[str, list[float]] = {}
_registration_lock = threading.Lock()


def configured(*, admin: bool = False) -> bool:
    return bool(SUPABASE_URL and SUPABASE_ANON_KEY and (not admin or SUPABASE_SERVICE_ROLE_KEY))


def require_config(*, admin: bool = False) -> None:
    if not configured(admin=admin):
        missing = []
        if not SUPABASE_URL:
            missing.append("SUPABASE_URL")
        if not SUPABASE_ANON_KEY:
            missing.append("SUPABASE_ANON_KEY")
        if admin and not SUPABASE_SERVICE_ROLE_KEY:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        raise HTTPException(503, "Supabase is not configured on the REX server. Missing: " + ", ".join(missing))


def _headers(*, token: str | None = None, admin: bool = False, prefer: str | None = None) -> dict[str, str]:
    require_config(admin=admin)
    key = SUPABASE_SERVICE_ROLE_KEY if admin else SUPABASE_ANON_KEY
    # Supabase's newer sb_publishable_/sb_secret_ keys are API keys, not JWTs;
    # send them only as `apikey`. Legacy anon/service_role keys are JWTs and
    # may also be used as the bearer token when no user session is supplied.
    headers = {"apikey": key}
    bearer = token or (key if key.startswith("eyJ") else None)
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if prefer:
        headers["Prefer"] = prefer
    return headers


def request(path: str, *, method: str = "GET", token: str | None = None,
            admin: bool = False, params: dict[str, Any] | None = None,
            payload: Any = None, prefer: str | None = None) -> Any:
    """Call Supabase Auth or PostgREST and return decoded JSON (or None)."""
    headers = _headers(token=token, admin=admin, prefer=prefer)
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        response = _http.request(
            method,
            f"{SUPABASE_URL}{path}",
            headers=headers,
            params=params,
            json=payload,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Could not reach Supabase. Check the project URL and server network.") from exc
    if response.status_code >= 400:
        try:
            body = response.json()
            detail = body.get("msg") or body.get("message") or body.get("error_description") or body.get("error") or str(body)
        except Exception:
            detail = response.text[:500] or "Supabase request failed"
        # Avoid leaking account enumeration or provider internals in auth errors.
        if path.startswith("/auth/v1/"):
            detail = "Supabase Auth rejected the request. Check the username/password or Supabase Auth configuration."
        raise HTTPException(response.status_code if response.status_code < 500 else 502, str(detail))
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def username_email(username: str) -> str:
    name = (username or "").strip().lower()
    if not USERNAME_RE.fullmatch(name):
        raise HTTPException(400, "Username must be 3–24 characters and use lowercase letters, numbers, or underscores.")
    if not re.fullmatch(r"[a-z0-9.-]{3,120}", AUTH_EMAIL_DOMAIN):
        raise HTTPException(500, "REX_AUTH_EMAIL_DOMAIN is invalid on the server.")
    return f"{name}@{AUTH_EMAIL_DOMAIN}"


def current_user(request_obj: Request) -> dict[str, Any]:
    """Validate the Supabase access token. PostgREST then enforces RLS with it."""
    require_config()
    auth = request_obj.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Please sign in to your REX account.")
    token = token.strip()
    now = time.time()
    with _auth_cache_lock:
        cached = _auth_cache.get(token)
        if cached and cached[0] > now:
            return {**cached[1], "access_token": token}
    user = request("/auth/v1/user", token=token)
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(401, "Your REX session expired. Please sign in again.")
    with _auth_cache_lock:
        if len(_auth_cache) > 2000:
            for old_token, (expires, _) in list(_auth_cache.items())[:500]:
                if expires <= now:
                    _auth_cache.pop(old_token, None)
        _auth_cache[token] = (now + 45, user)
    return {**user, "access_token": token}


def rest(table: str, user: dict[str, Any], *, method: str = "GET",
         params: dict[str, Any] | None = None, payload: Any = None,
         prefer: str | None = None) -> Any:
    return request(f"/rest/v1/{table}", method=method, token=user["access_token"],
                   params=params, payload=payload, prefer=prefer)


def admin_rest(table: str, *, method: str = "GET", params: dict[str, Any] | None = None,
               payload: Any = None, prefer: str | None = None) -> Any:
    return request(f"/rest/v1/{table}", method=method, admin=True,
                   params=params, payload=payload, prefer=prefer)


def _recovery_hash(code: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 260_000
    digest = hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def _recovery_matches(code: str, encoded: str) -> bool:
    try:
        algorithm, raw_iterations, raw_salt, raw_digest = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(raw_iterations)
        if iterations < 100_000 or iterations > 1_000_000:
            return False
        salt = base64.urlsafe_b64decode(raw_salt.encode("ascii"))
        expected = base64.urlsafe_b64decode(raw_digest.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _new_recovery_code() -> str:
    # Readable enough to write down; generated with 96 bits of randomness.
    raw = base64.b32encode(secrets.token_bytes(12)).decode("ascii").rstrip("=")
    return "-".join(raw[i:i + 5] for i in range(0, len(raw), 5))


def _check_recovery_rate_limit(key: str) -> None:
    now = time.time()
    cutoff = now - 15 * 60
    with _recovery_lock:
        recent = [stamp for stamp in _recovery_attempts.get(key, []) if stamp > cutoff]
        if len(recent) >= 5:
            raise HTTPException(429, "Too many recovery attempts. Please wait 15 minutes and try again.")
        recent.append(now)
        _recovery_attempts[key] = recent


def _check_registration_rate_limit(ip_key: str) -> None:
    now = time.time()
    cutoff = now - 15 * 60
    with _registration_lock:
        recent = [stamp for stamp in _registration_attempts.get(ip_key, []) if stamp > cutoff]
        if len(recent) >= 5:
            raise HTTPException(429, "Too many account creation attempts. Please wait 15 minutes and try again.")
        recent.append(now)
        _registration_attempts[ip_key] = recent


def register(username: str, password: str, display_name: str | None = None, attempt_key: str = "unknown") -> dict[str, Any]:
    require_config(admin=True)
    _check_registration_rate_limit(attempt_key)
    name = (username or "").strip().lower()
    email = username_email(name)
    if not isinstance(password, str) or len(password) < 8 or len(password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be 8–72 UTF-8 bytes.")

    existing = admin_rest("profiles", params={"select": "id", "username": f"eq.{name}", "limit": "1"})
    if existing:
        raise HTTPException(409, "That username is already taken.")

    user = request("/auth/v1/admin/users", method="POST", admin=True, payload={
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"rex_username": name},
    })
    user_id = (user or {}).get("id")
    if not user_id:
        raise HTTPException(502, "Supabase created no user ID. Check Auth settings and try again.")

    clean_display = (display_name or name).strip()[:60] or name
    try:
        admin_rest("profiles", method="POST", payload={
            "id": user_id,
            "username": name,
            "display_name": clean_display,
            "avatar_key": "rex-portrait-01",
        }, prefer="return=minimal")
        code = _new_recovery_code()
        admin_rest("account_recovery", method="POST", payload={
            "user_id": user_id,
            "recovery_code_hash": _recovery_hash(code),
            "rotated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }, prefer="resolution=merge-duplicates,return=minimal")
    except Exception:
        # Best-effort rollback prevents an Auth user being stranded without a profile.
        try:
            request(f"/auth/v1/admin/users/{user_id}", method="DELETE", admin=True)
        except Exception:
            pass
        raise
    return {"email": email, "username": name, "recoveryCode": code}


def recover_account(username: str, code: str, new_password: str, attempt_key: str) -> dict[str, Any]:
    require_config(admin=True)
    name = (username or "").strip().lower()
    email = username_email(name)
    _check_recovery_rate_limit(f"{attempt_key}:{name}")
    if not isinstance(code, str) or not code.strip() or len(code) > 80:
        raise HTTPException(400, "Enter your recovery code.")
    if not isinstance(new_password, str) or len(new_password) < 8 or len(new_password.encode("utf-8")) > 72:
        raise HTTPException(400, "New password must be 8–72 UTF-8 bytes.")

    rows = admin_rest("profiles", params={"select": "id", "username": f"eq.{name}", "limit": "1"})
    if not rows:
        raise HTTPException(400, "Username or recovery code is incorrect.")
    user_id = rows[0]["id"]
    recovery = admin_rest("account_recovery", params={
        "select": "recovery_code_hash", "user_id": f"eq.{user_id}", "limit": "1"
    })
    if not recovery or not _recovery_matches(code.strip().upper().replace(" ", ""), recovery[0]["recovery_code_hash"]):
        raise HTTPException(400, "Username or recovery code is incorrect.")

    request(f"/auth/v1/admin/users/{user_id}", method="PUT", admin=True,
            payload={"password": new_password, "email_confirm": True})
    next_code = _new_recovery_code()
    admin_rest("account_recovery", method="POST", payload={
        "user_id": user_id,
        "recovery_code_hash": _recovery_hash(next_code),
        "rotated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }, prefer="resolution=merge-duplicates,return=minimal")
    return {"email": email, "username": name, "recoveryCode": next_code}


def client_profile(user: dict[str, Any]) -> dict[str, Any]:
    rows = rest("profiles", user, params={"select": "username,display_name,avatar_key", "id": f"eq.{user['id']}", "limit": "1"})
    profile = rows[0] if rows else {}
    return {
        "id": user["id"],
        "username": profile.get("username") or (user.get("user_metadata") or {}).get("rex_username") or "listener",
        "displayName": profile.get("display_name") or profile.get("username") or "Listener",
        "avatar": profile.get("avatar_key") or "rex-portrait-01",
    }
