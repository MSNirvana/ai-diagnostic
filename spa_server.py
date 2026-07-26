"""Small dependency-free SPA static server for production systemd units."""
from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


class SPARequestHandler(SimpleHTTPRequestHandler):
    server_version = "GGOOSPA/1.0"

    def translate_path(self, request_path: str) -> str:
        relative = unquote(urlsplit(request_path).path).lstrip("/")
        candidate = (self.server.dist_root / relative).resolve()
        try:
            candidate.relative_to(self.server.dist_root)
        except ValueError:
            return str(self.server.dist_root / "index.html")
        if candidate.is_file():
            return str(candidate)
        return str(self.server.dist_root / "index.html")

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3200)
    parser.add_argument("--dist", type=Path, required=True)
    args = parser.parse_args()

    dist_root = args.dist.resolve()
    if not (dist_root / "index.html").is_file():
        raise SystemExit(f"Missing SPA entrypoint: {dist_root / 'index.html'}")
    server = ThreadingHTTPServer((args.host, args.port), SPARequestHandler)
    server.dist_root = dist_root
    print(f"Serving {dist_root} on {args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
