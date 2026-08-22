#!/usr/bin/env python3
"""
OpenFB — Camoufox Remote Server Launcher
========================================
Starts a Camoufox browser instance and exposes a Playwright-compatible
WebSocket endpoint that the Node.js engine connects to.

Usage:
    python scripts/camoufox-launcher/launch_server.py
    python scripts/camoufox-launcher/launch_server.py --port 1234 --ws-path openfb
    python scripts/camoufox-launcher/launch_server.py --headless virtual --os windows --humanize

Environment variables (all optional, override with CLI flags):
    CAMOUFOX_HEADLESS, CAMOUFOX_HUMANIZE, CAMOUFOX_OS, CAMOUFOX_PROXY,
    CAMOUFOX_GEOIP, CAMOUFOX_LOCALE, CAMOUFOX_WINDOW_SIZE
"""

import argparse
import json
import os
import sys
import signal


def parse_args():
    parser = argparse.ArgumentParser(
        description="Launch a Camoufox remote Playwright server for OpenFB"
    )
    parser.add_argument(
        "--port", type=int, default=None,
        help="WebSocket server port (default: random)"
    )
    parser.add_argument(
        "--ws-path", type=str, default=None,
        help="WebSocket URL path (default: random)"
    )
    parser.add_argument(
        "--headless", type=str, default=None,
        choices=["true", "false", "virtual"],
        help="Headless mode (true | false | virtual)"
    )
    parser.add_argument(
        "--humanize", type=str, default=None,
        help="Human-like cursor movement (true | false | max-seconds-float)"
    )
    parser.add_argument(
        "--os", type=str, default=None,
        help="OS for fingerprint (windows | macos | linux | comma-separated)"
    )
    parser.add_argument(
        "--proxy", type=str, default=None,
        help="Proxy URL: protocol://user:pass@host:port"
    )
    parser.add_argument(
        "--geoip", type=str, default=None,
        help="GeoIP IP address or 'auto'"
    )
    parser.add_argument(
        "--locale", type=str, default=None,
        help="Locale, e.g. en-US"
    )
    parser.add_argument(
        "--window", type=str, default=None,
        help="Window size WxH (e.g. 1280x720)"
    )
    parser.add_argument(
        "--user-data-dir", type=str, default=None,
        help="Persistent profile directory"
    )
    parser.add_argument(
        "--addons", type=str, nargs="*", default=None,
        help="Paths to Firefox addon directories"
    )
    parser.add_argument(
        "--block-images", action="store_true",
        help="Block image requests to save bandwidth"
    )
    parser.add_argument(
        "--block-webrtc", action="store_true",
        help="Block WebRTC entirely"
    )
    return parser.parse_args()


def env_or_none(env_key, cli_value):
    """Return CLI value if set, otherwise fall back to environment variable."""
    if cli_value is not None:
        return cli_value
    return os.environ.get(env_key)


def build_proxy(proxy_str):
    """Convert a proxy URL string into a Playwright proxy dict."""
    if not proxy_str:
        return None
    from urllib.parse import urlparse
    parsed = urlparse(proxy_str)
    proxy = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
    if parsed.username:
        proxy["username"] = parsed.username
    if parsed.password:
        proxy["password"] = parsed.password
    return proxy


def build_window(window_str):
    """Convert 'WxH' string into a (width, height) tuple."""
    if not window_str:
        return None
    parts = window_str.lower().split("x")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        return (int(parts[0]), int(parts[1]))
    return None


def parse_humanize(val):
    """Parse humanize option: 'true' → True, 'false' → False, float string → float."""
    if val is None:
        return None
    if val.lower() == "true":
        return True
    if val.lower() == "false":
        return False
    try:
        return float(val)
    except ValueError:
        return None


def main():
    args = parse_args()

    try:
        from camoufox.server import launch_server
    except ImportError:
        print(
            "[openfb] ERROR: camoufox is not installed.\n"
            "  Install it with:  pip install -U \"camoufox[geoip]\"\n"
            "  Then download the browser:  python -m camoufox fetch",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── Merge env + CLI args ──
    headless_str = env_or_none("CAMOUFOX_HEADLESS", args.headless)
    headless = None
    if headless_str == "virtual":
        headless = "virtual"
    elif headless_str == "true":
        headless = True
    elif headless_str == "false":
        headless = False

    os_val = env_or_none("CAMOUFOX_OS", args.os)
    os_list = os_val.split(",") if os_val else None

    proxy_str = env_or_none("CAMOUFOX_PROXY", args.proxy)
    proxy = build_proxy(proxy_str)

    geoip_str = env_or_none("CAMOUFOX_GEOIP", args.geoip)
    geoip = None
    if geoip_str:
        geoip = "auto" if geoip_str.lower() == "auto" else geoip_str

    locale = env_or_none("CAMOUFOX_LOCALE", args.locale)
    window = build_window(env_or_none("CAMOUFOX_WINDOW_SIZE", args.window))
    humanize = parse_humanize(env_or_none("CAMOUFOX_HUMANIZE", args.humanize))
    user_data_dir = env_or_none("CAMOUFOX_USER_DATA_DIR", args.user_data_dir)

    # ── Build kwargs (only pass non-None values) ──
    kwargs = {}
    if headless is not None:
        kwargs["headless"] = headless
    if humanize is not None:
        kwargs["humanize"] = humanize
    if os_list:
        kwargs["os"] = os_list
    if proxy:
        kwargs["proxy"] = proxy
    if geoip is not None:
        kwargs["geoip"] = geoip
    if locale:
        kwargs["locale"] = locale
    if window:
        kwargs["window"] = window
    if args.port:
        kwargs["port"] = args.port
    if args.ws_path:
        kwargs["ws_path"] = args.ws_path
    if user_data_dir:
        kwargs["persistent_context"] = True
        kwargs["user_data_dir"] = user_data_dir
    if args.addons:
        kwargs["addons"] = args.addons
    if args.block_images:
        kwargs["block_images"] = True
    if args.block_webrtc:
        kwargs["block_webrtc"] = True

    print(f"[openfb] Launching Camoufox remote server with options:")
    safe_kwargs = {k: v for k, v in kwargs.items() if k != "proxy"}
    if proxy:
        safe_kwargs["proxy"] = {"server": proxy["server"], "username": "***"}
    print(json.dumps(safe_kwargs, indent=2, default=str))
    sys.stdout.flush()

    # ── Launch server (blocking) ──
    server = launch_server(**kwargs)

    # ── Graceful shutdown ──
    def shutdown(signum, frame):
        print(f"\n[openfb] Received signal {signum}, shutting down Camoufox server...")
        try:
            server.close()
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Keep the process alive
    print("[openfb] Camoufox server is running. Press Ctrl+C to stop.")
    signal.pause()


if __name__ == "__main__":
    main()
