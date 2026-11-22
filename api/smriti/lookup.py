"""Outbound lookups with the standard library: link previews (Open Graph) and Open Library books.

Short timeouts, size caps, and best effort: a failed link lookup still returns what the URL says.
SMRITI_LOOKUP=off turns every network call off.
"""

import html
import json
import re
import urllib.parse
import urllib.request

from .config import Config

TIMEOUT = 4.0
_UA = "Mozilla/5.0 (compatible; Smriti/1.0; personal tracker)"
_META = re.compile(r"<meta\s+[^>]*>", re.I)
_ATTR = re.compile(r'([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')')
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_YOUTUBE = re.compile(r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/))([\w-]{11})")


class LookupFailed(Exception):
    """The remote service could not be reached."""


def youtube_id(url: str | None) -> str | None:
    m = _YOUTUBE.search(url or "")
    return m.group(1) if m else None


def is_video(url: str | None) -> bool:
    return bool(url) and ("youtube.com/" in url or "youtu.be/" in url)


def site_of(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").removeprefix("www.")


def _clean(text: str | None, limit: int) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", html.unescape(text)).strip()[:limit]


def _get(url: str, limit: int, accept: str = "*/*") -> tuple[bytes, str, str, str]:
    """Fetch url; returns (body, media type, charset, final url)."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        media = resp.headers.get_content_type() if resp.headers.get("Content-Type") else "text/html"
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read(limit), media, charset, resp.geturl()


def offline_link(url: str) -> dict:
    """What we know from the URL alone."""
    video = youtube_id(url)
    return {
        "title": "",
        "site": "YouTube" if video else site_of(url),
        "author": "",
        "summary": "",
        "image": f"https://i.ytimg.com/vi/{video}/hqdefault.jpg" if video else None,
        "kind": "video" if is_video(url) else "article",
    }


def _youtube(url: str, video: str) -> dict:
    result = offline_link(url)
    api = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(
        f"https://www.youtube.com/watch?v={video}", safe="")
    try:
        data = json.loads(_get(api, 200_000, "application/json")[0])
        result["title"] = _clean(data.get("title"), 300)
        result["author"] = _clean(data.get("author_name"), 120)
    except Exception:
        pass
    return result


def _meta_tags(head: str) -> dict[str, str]:
    meta: dict[str, str] = {}
    for tag in _META.findall(head):
        attrs = {m[0].lower(): (m[2] or m[3]) for m in _ATTR.findall(tag)}
        name = (attrs.get("property") or attrs.get("name") or "").lower()
        if name and "content" in attrs and name not in meta:
            meta[name] = attrs["content"]
    return meta


def link(url: str, cfg: Config) -> dict:
    """{title, site, author, summary, image, kind} for a web page. Never raises."""
    result = offline_link(url)
    if not cfg.lookup or urllib.parse.urlparse(url).scheme not in ("http", "https"):
        return result
    if video := youtube_id(url):
        return _youtube(url, video)
    try:
        raw, media, charset, final_url = _get(url, 1_500_000, "text/html,*/*;q=0.8")
    except Exception:
        return result
    if "html" not in media:
        return result
    try:
        page = raw.decode(charset, errors="replace")
    except LookupError:  # unknown charset name
        page = raw.decode("utf-8", errors="replace")
    end = page.lower().find("</head>")
    head = page[: end + 7] if end >= 0 else page[:300_000]
    meta = _meta_tags(head)
    title_tag = _TITLE.search(head)

    result["title"] = _clean(meta.get("og:title") or meta.get("twitter:title")
                             or (title_tag.group(1) if title_tag else ""), 300)
    result["site"] = _clean(meta.get("og:site_name"), 120) or site_of(final_url)
    author = _clean(meta.get("author") or meta.get("article:author") or meta.get("twitter:creator"), 120)
    result["author"] = "" if author.startswith("http") else author
    summary = _clean(meta.get("og:description") or meta.get("description") or meta.get("twitter:description"), 500)
    result["summary"] = "" if summary.lower() == result["title"].lower() else summary
    image = meta.get("og:image") or meta.get("twitter:image")
    result["image"] = urllib.parse.urljoin(final_url, html.unescape(image)) if image else None
    return result


def books(query: str) -> list[dict]:
    """Open Library search: [{title, author, year, total, image, ref}]. Raises LookupFailed when unreachable."""
    url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode({
        "q": query, "limit": 8,
        "fields": "key,title,author_name,first_publish_year,number_of_pages_median,cover_i"})
    try:
        docs = json.loads(_get(url, 2_000_000, "application/json")[0]).get("docs", [])
    except Exception as exc:
        raise LookupFailed(str(exc)) from exc
    return [
        {
            "title": d["title"],
            "author": ", ".join((d.get("author_name") or [])[:2]),
            "year": d.get("first_publish_year"),
            "total": d.get("number_of_pages_median"),
            "image": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg" if d.get("cover_i") else None,
            "ref": (d.get("key") or "").removeprefix("/works/") or None,
        }
        for d in docs if d.get("title")
    ]
