"""Admin commands (factor 12): python -m smriti migrate | import-arc PATH | import-quotes PATH | import-arc-trash PATH | import-arc-obsidian PATH | import-arc-collections PATH | backup DIR | purge-trash."""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from . import config, db


def cmd_migrate(cfg: config.Config, _args) -> int:
    version = db.migrate(cfg.db_path)
    print(f"Database {cfg.db_path} is at schema version {version}.")
    return 0


def cmd_import_arc(cfg: config.Config, args) -> int:
    from .importer_arc import ImportRefused, run

    db.migrate(cfg.db_path)
    try:
        counts = run(args.path, cfg)
    except ImportRefused as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 1
    print(f"Imported from {args.path} into {cfg.db_path}:")
    width = max(len(k) for k in counts)
    for name, count in counts.items():
        print(f"  {name:<{width}}  {count}")
    return 0


def cmd_import_quotes(cfg: config.Config, args) -> int:
    from .importer_arc import ImportRefused, import_quotes

    db.migrate(cfg.db_path)
    try:
        count = import_quotes(args.path, cfg)
    except ImportRefused as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 1
    print(f"Imported {count} quote(s) from {args.path}.")
    return 0


def cmd_import_trash(cfg: config.Config, args) -> int:
    from .importer_arc import ImportRefused, import_trash

    db.migrate(cfg.db_path)
    try:
        counts = import_trash(args.path, cfg)
    except ImportRefused as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 1
    print(f"Added from {args.path}: " + ", ".join(f"{n} {k}" for k, n in counts.items()))
    return 0


def cmd_import_obsidian(cfg: config.Config, args) -> int:
    from .importer_arc import ImportRefused, import_obsidian_notes

    db.migrate(cfg.db_path)
    try:
        found = import_obsidian_notes(args.path, cfg)
    except ImportRefused as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 1
    print(f"Linked {found} source(s) to the Obsidian notes Arc wrote for them.")
    return 0


def cmd_import_collections(cfg: config.Config, args) -> int:
    from .importer_arc import ImportRefused, import_collections

    db.migrate(cfg.db_path)
    try:
        out = import_collections(args.path, cfg)
    except ImportRefused as exc:
        print(f"Import refused: {exc}", file=sys.stderr)
        return 1
    print(f"{out['collections']} collection(s) from Arc; {out['links']} source(s) put in a collection.")
    return 0


def cmd_backup(cfg: config.Config, args) -> int:
    """A consistent copy made with SQLite's online backup, safe while Smriti runs."""
    folder = Path(args.dir)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"smriti-{datetime.now(cfg.zone).strftime('%Y%m%d-%H%M%S')}.db"
    source = db.connect(cfg.db_path)
    dest = sqlite3.connect(target)
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
    print(f"Backup written: {target} ({target.stat().st_size} bytes)")
    return 0


def cmd_purge_trash(cfg: config.Config, _args) -> int:
    from .routes.trash import purge_expired

    db.migrate(cfg.db_path)
    with db.session(cfg) as conn:
        removed = purge_expired(conn, cfg)
    print(f"Removed {removed} item(s) deleted more than {cfg.trash_days} days ago.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smriti", description="Smriti admin commands")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="apply database migrations").set_defaults(run=cmd_migrate)
    imp = sub.add_parser("import-arc", help="import an Arc database into an empty Smriti database")
    imp.add_argument("path")
    imp.set_defaults(run=cmd_import_arc)
    iq = sub.add_parser("import-quotes", help="copy only the quotes from an Arc database")
    iq.add_argument("path")
    iq.set_defaults(run=cmd_import_quotes)
    tr = sub.add_parser("import-arc-trash", help="add Arc's deleted items (into Smriti's trash) and video thumbnails")
    tr.add_argument("path")
    tr.set_defaults(run=cmd_import_trash)
    ob = sub.add_parser("import-arc-obsidian", help="link sources to the Obsidian notes Arc wrote for them")
    ob.add_argument("path")
    ob.set_defaults(run=cmd_import_obsidian)
    co = sub.add_parser("import-arc-collections", help="bring Arc's collections across and file sources in them")
    co.add_argument("path")
    co.set_defaults(run=cmd_import_collections)
    bak = sub.add_parser("backup", help="copy the database into a folder")
    bak.add_argument("dir")
    bak.set_defaults(run=cmd_backup)
    sub.add_parser("purge-trash", help="remove trash older than SMRITI_TRASH_DAYS").set_defaults(run=cmd_purge_trash)
    args = parser.parse_args(argv)
    return args.run(config.get(), args)


if __name__ == "__main__":
    sys.exit(main())
