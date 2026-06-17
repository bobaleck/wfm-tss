"""
Стандартная классификация статусов Naumen — должна совпадать с
frontend/src/utils/statusClassification.ts. Кастомные статусы (Custom1 и т.п.)
переопределяются индивидуально для каждого проекта через StatusConfig.
"""

STANDARD_WORK = {
    'normal', 'ready', 'available', 'online', 'ringing', 'ringing#voice',
    'speaking', 'speaking#voice', 'inservice', 'wrapup', 'wrapup#voice', 'acw',
}
STANDARD_PAUSE = {
    'break', 'lunch', 'training', 'meeting', 'not_ready', 'dnd', 'busy', 'accident',
}
STANDARD_OFFLINE = {
    'offline', 'logged_out', 'signedoff', 'loggedoff', 'disconnected',
    'away', 'notavailable', 'not_available',
}

# Операторы иногда «зависают» в статусе после звонка, чтобы не уходить на
# паузу формально. Если человек дольше WRAPUP_STALE_SEC сидит в одном из этих
# статусов — это засчитывается как пауза (а не как работа), независимо от
# того, что статус технически "рабочий".
WRAPUP_STATUSES = {'wrapup', 'wrapup#voice', 'acw'}
WRAPUP_STALE_SEC = 600


def is_standard(status: str) -> bool:
    s = status.lower()
    return s in STANDARD_WORK or s in STANDARD_PAUSE or s in STANDARD_OFFLINE


def standard_group(status: str):
    s = status.lower()
    if s in STANDARD_WORK:
        return 'work'
    if s in STANDARD_OFFLINE:
        return 'offline'
    if s in STANDARD_PAUSE:
        return 'pause'
    return None


def build_status_sets(configs: list) -> tuple[list[str], list[str]]:
    """Сливает стандартную классификацию с пользовательскими настройками проекта.
    configs — список StatusConfig (или dict) с полями status_name/classification.
    Возвращает (work_statuses, offline_statuses) в нижнем регистре — статусы,
    не попавшие ни в один из списков, считаются "На паузе" (pause)."""
    work = set(STANDARD_WORK)
    offline = set(STANDARD_OFFLINE)
    for c in configs:
        name = (c.status_name if hasattr(c, 'status_name') else c['status_name']).lower()
        cls = c.classification if hasattr(c, 'classification') else c['classification']
        work.discard(name)
        offline.discard(name)
        if cls == 'work':
            work.add(name)
        elif cls == 'offline':
            offline.add(name)
    return list(work), list(offline)
