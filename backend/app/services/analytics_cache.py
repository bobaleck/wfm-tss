"""PostgreSQL-only shared cache for historical Naumen analytics.

The cache intentionally does not operate on SQLite. Production responses are
stored in the WFM PostgreSQL database, shared by all users, refreshed in the
background every ten minutes and removed after 31 days of inactivity.
Live monitoring endpoints do not call this service.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from fastapi.encoders import jsonable_encoder

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.models.audit import AnalyticsCache


@dataclass
class _RefreshJob:
    namespace: str
    partner_uuid: Optional[str]
    compute: Callable[[], Any]
    last_used_at: datetime


_registry: dict[str, _RefreshJob] = {}
_key_locks: dict[str, threading.Lock] = {}
_refreshing: set[str] = set()
_state_lock = threading.Lock()


def is_enabled() -> bool:
    """Cache is allowed only for the production PostgreSQL WFM database."""
    return bool(settings.ANALYTICS_CACHE_ENABLED) and engine.dialect.name == "postgresql"


def runtime_info() -> dict[str, Any]:
    return {
        "enabled": is_enabled(),
        "backend": engine.dialect.name,
        "ttl_seconds": int(settings.ANALYTICS_CACHE_TTL_SECONDS),
        "retention_days": int(settings.ANALYTICS_CACHE_RETENTION_DAYS),
        "registered_keys": len(_registry) if is_enabled() else 0,
    }


def _utcnow() -> datetime:
    return datetime.utcnow()


def _make_key(namespace: str, partner_uuid: Optional[str], params: dict[str, Any]) -> str:
    material = json.dumps(
        jsonable_encoder({"namespace": namespace, "partner_uuid": partner_uuid, "params": params}),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _lock_for(cache_key: str) -> threading.Lock:
    with _state_lock:
        return _key_locks.setdefault(cache_key, threading.Lock())


def _register(
    cache_key: str,
    namespace: str,
    partner_uuid: Optional[str],
    compute: Callable[[], Any],
) -> _RefreshJob:
    with _state_lock:
        job = _registry.get(cache_key)
        if job is None:
            job = _RefreshJob(
                namespace=namespace,
                partner_uuid=partner_uuid,
                compute=compute,
                last_used_at=_utcnow(),
            )
            _registry[cache_key] = job
        else:
            # Keep object identity stable while a first fill/background refresh
            # is running. Replacing the object on every cache hit would make
            # concurrent callers discard each other's valid refresh results.
            job.compute = compute
            job.last_used_at = _utcnow()
        return job


def _within_retention(row: AnalyticsCache, now: datetime) -> bool:
    cutoff = now - timedelta(days=max(1, int(settings.ANALYTICS_CACHE_RETENTION_DAYS)))
    return bool(row.fetched_at and row.fetched_at >= cutoff)


def _touch_if_needed(db, row: AnalyticsCache, now: datetime) -> None:
    # Avoid a PostgreSQL UPDATE for every page view. Hourly granularity is
    # enough for 31-day retention while keeping cache hits read-mostly.
    if not row.last_accessed_at or row.last_accessed_at < now - timedelta(hours=1):
        row.last_accessed_at = now
        db.commit()


def _store(cache_key: str, job: _RefreshJob, payload: Any) -> Any:
    encoded = jsonable_encoder(payload)
    now = _utcnow()
    expires = now + timedelta(seconds=max(1, int(settings.ANALYTICS_CACHE_TTL_SECONDS)))
    db = SessionLocal()
    try:
        row = db.query(AnalyticsCache).filter(AnalyticsCache.cache_key == cache_key).first()
        if row is None:
            row = AnalyticsCache(
                cache_key=cache_key,
                namespace=job.namespace,
                partner_uuid=job.partner_uuid,
                payload=encoded,
                fetched_at=now,
                expires_at=expires,
                last_accessed_at=now,
            )
            db.add(row)
        else:
            row.namespace = job.namespace
            row.partner_uuid = job.partner_uuid
            row.payload = encoded
            row.fetched_at = now
            row.expires_at = expires
            row.last_accessed_at = now
            row.last_error = None
        db.commit()
        return copy.deepcopy(encoded)
    finally:
        db.close()


def _record_error(cache_key: str, error: Exception) -> None:
    db = SessionLocal()
    try:
        row = db.query(AnalyticsCache).filter(AnalyticsCache.cache_key == cache_key).first()
        if row:
            row.last_error = str(error)[:500]
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _refresh_worker(cache_key: str) -> None:
    try:
        with _state_lock:
            job = _registry.get(cache_key)
        if not job:
            return
        with _lock_for(cache_key):
            try:
                value = job.compute()
                # Settings may have invalidated this key while Naumen was
                # answering. Do not resurrect a snapshot built with old rules.
                with _state_lock:
                    if _registry.get(cache_key) is not job:
                        return
                _store(cache_key, job, value)
            except Exception as exc:
                _record_error(cache_key, exc)
    finally:
        with _state_lock:
            _refreshing.discard(cache_key)


def _start_refresh(cache_key: str) -> None:
    with _state_lock:
        if cache_key in _refreshing or cache_key not in _registry:
            return
        _refreshing.add(cache_key)
    threading.Thread(target=_refresh_worker, args=(cache_key,), daemon=True).start()


def cached_call(
    namespace: str,
    partner_uuid: Optional[str],
    params: dict[str, Any],
    compute: Callable[[], Any],
) -> Any:
    """Return a shared cached value or compute it.

    Fresh rows are returned immediately. A stale row younger than the retention
    window is returned as a safe fallback while one background thread refreshes
    it. A first-ever request is computed synchronously so callers keep their
    existing HTTP error semantics when Naumen has never been reached.
    """
    if not is_enabled():
        return compute()

    cache_key = _make_key(namespace, partner_uuid, params)
    job = _register(cache_key, namespace, partner_uuid, compute)
    now = _utcnow()

    try:
        db = SessionLocal()
        try:
            row = db.query(AnalyticsCache).filter(AnalyticsCache.cache_key == cache_key).first()
            if row and row.expires_at and row.expires_at > now:
                _touch_if_needed(db, row, now)
                return copy.deepcopy(row.payload)
            if row and _within_retention(row, now):
                _touch_if_needed(db, row, now)
                stale = copy.deepcopy(row.payload)
                _start_refresh(cache_key)
                return stale
        finally:
            db.close()
    except Exception:
        # Cache infrastructure must never make analytics less available.
        return compute()

    # Serialize first fill per key so ten simultaneous users cause one Naumen
    # query, not ten identical ones.
    with _lock_for(cache_key):
        now = _utcnow()
        db = SessionLocal()
        try:
            row = db.query(AnalyticsCache).filter(AnalyticsCache.cache_key == cache_key).first()
            if row and row.expires_at and row.expires_at > now:
                return copy.deepcopy(row.payload)
        finally:
            db.close()
        value = compute()
        with _state_lock:
            if _registry.get(cache_key) is not job:
                return jsonable_encoder(value)
        try:
            return _store(cache_key, job, value)
        except Exception:
            # The Naumen result is valid even if the optional snapshot cannot
            # be persisted (for example, during a rolling schema rollout).
            return jsonable_encoder(value)


def refresh_due_entries() -> None:
    """APScheduler hook: refresh active expired keys and purge old snapshots."""
    if not is_enabled():
        return
    now = _utcnow()
    cutoff = now - timedelta(days=max(1, int(settings.ANALYTICS_CACHE_RETENTION_DAYS)))

    db = SessionLocal()
    try:
        db.query(AnalyticsCache).filter(AnalyticsCache.last_accessed_at < cutoff).delete(
            synchronize_session=False,
        )
        db.commit()
        due_keys = {
            row[0] for row in db.query(AnalyticsCache.cache_key).filter(
                AnalyticsCache.expires_at <= now,
                AnalyticsCache.last_accessed_at >= cutoff,
            ).all()
        }
    finally:
        db.close()

    with _state_lock:
        old_registry = [key for key, job in _registry.items() if job.last_used_at < cutoff]
        for key in old_registry:
            _registry.pop(key, None)
            _key_locks.pop(key, None)
        registered_due = [key for key in due_keys if key in _registry]
    for key in registered_due:
        _start_refresh(key)


def invalidate_partner(partner_uuid: str) -> None:
    if not is_enabled():
        return
    db = SessionLocal()
    try:
        db.query(AnalyticsCache).filter(AnalyticsCache.partner_uuid == partner_uuid).delete(
            synchronize_session=False,
        )
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    with _state_lock:
        keys = [key for key, job in _registry.items() if job.partner_uuid == partner_uuid]
        for key in keys:
            _registry.pop(key, None)
            _key_locks.pop(key, None)
            _refreshing.discard(key)


def invalidate_all() -> None:
    if not is_enabled():
        return
    db = SessionLocal()
    try:
        db.query(AnalyticsCache).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    with _state_lock:
        _registry.clear()
        _key_locks.clear()
        _refreshing.clear()
