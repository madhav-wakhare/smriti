"""API routes, one module per concept."""

from . import (revisits, captures, days, lookup, meta, notes, projects, quotes, report, search, sessions,
               sources, tasks, today, trash)

ROUTERS = [meta.router, projects.router, tasks.router, sources.router, lookup.router, notes.router,
           captures.router, revisits.router, sessions.router, days.router, today.router, report.router,
           search.router, trash.router, quotes.router]
