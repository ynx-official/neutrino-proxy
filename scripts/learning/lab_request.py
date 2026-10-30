"""Send bounded loopback requests to an active reader lab, or stop that lab cleanly."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import socket
import time

from project_overview import load_session, read_exact, request_stop


def send_one(port, message, timeout, hold_seconds):
    payload = message.encode("utf-8")
    if not payload or len(payload) > 4096:
        raise ValueError("The teaching message must contain 1-4096 UTF-8 bytes")
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid lab port")
    result = {"sent": message, "passed": False}
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout) as connection:
            connection.sendall(payload)
            reply = read_exact(connection, len(payload))
            result.update(outcome="echo" if reply == payload else "mismatch", passed=reply == payload,
                          received=reply.decode("utf-8", errors="replace"), bytes=len(reply))
            if hold_seconds:
                time.sleep(hold_seconds)
    except TimeoutError:
        result["outcome"] = "timeout"
    except EOFError:
        result["outcome"] = "closed_before_echo"
    except (ConnectionRefusedError, ConnectionResetError, ConnectionAbortedError):
        result["outcome"] = "connection_rejected"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-file", type=Path, required=True)
    parser.add_argument("--route", choices=("mapping", "target", "unreachable"), default="mapping")
    parser.add_argument("--message", default="hello-neutrino")
    parser.add_argument("--connections", type=int, default=1, help="Concurrent reader connections (1-4)")
    parser.add_argument("--timeout", type=float, default=3, help="Socket timeout in seconds (1-60)")
    parser.add_argument("--hold-seconds", type=float, default=0, help="Keep each socket after its echo (0-10 seconds)")
    parser.add_argument("--stop", action="store_true", help="Ask only this disposable lab to stop")
    args = parser.parse_args()
    if not 1 <= args.connections <= 4 or not 1 <= args.timeout <= 60 or not 0 <= args.hold_seconds <= 10:
        parser.error("Use 1-4 connections, a 1-60 second timeout and a 0-10 second hold")
    try:
        session = load_session(args.session_file)
        if args.stop:
            request_stop(session)
            print(json.dumps({"outcome": "stop_requested"}))
            return
        key = "rejectedMapping" if args.route == "unreachable" else args.route
        port = session["ports"][key]

        def request(index):
            message = args.message if args.connections == 1 else f"reader-{index + 1}|{args.message}"
            return {"connection": index + 1, **send_one(port, message, args.timeout, args.hold_seconds)}

        with ThreadPoolExecutor(max_workers=args.connections) as executor:
            results = list(executor.map(request, range(args.connections)))
        print(json.dumps({"route": args.route, "results": results}, ensure_ascii=False, indent=2))
        if not all(item["passed"] for item in results):
            raise SystemExit(2)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Lab request failed: {error}\n")


if __name__ == "__main__":
    main()
