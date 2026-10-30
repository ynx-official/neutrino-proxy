"""Run lesson 01.01 against real Java processes and disposable local fixtures.

Requires Python 3.10+ and Java 21. Build the repository's JARs before running.
No third-party Python packages, existing databases or remote targets are used.
"""

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def local_environment(web, tunnel, license_key=""):
    """Override inherited connection settings before starting either Java process."""
    env = dict(os.environ)
    env.update({
        "WEB_PORT": str(web), "OPEN_PORT": str(tunnel), "SSL_PORT": "0",
        "HTTP_PROXY_PORT": "0", "HTTPS_PROXY_PORT": "0",
        "DB_TYPE": "h2", "DB_USER": "sa", "DB_PASSWORD": "",
        "DB_URL": "jdbc:h2:file:./data/learning;MODE=MySQL;AUTO_SERVER=FALSE",
        "SERVER_IP": "127.0.0.1", "SERVER_PORT": str(tunnel),
        "SSL_ENABLE": "false", "LICENSE_KEY": license_key, "CLIENT_ID": "lesson-01-01",
        "LOG_LEVEL": "warn", "TUNNEL_LOG": "false", "CLIENT_LOG": "false", "SERVER_LOG": "false",
    })
    return env


def read_exact(connection, size):
    """Read a TCP byte count without assuming a recv call equals a message."""
    chunks = bytearray()
    while len(chunks) < size:
        chunk = connection.recv(size - len(chunks))
        if not chunk:
            raise EOFError(f"Expected {size} bytes, received {len(chunks)}")
        chunks.extend(chunk)
    return bytes(chunks)


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        try:
            while data := self.request.recv(16384):
                self.request.sendall(data)
        except (OSError, TimeoutError):
            pass


class EchoServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise RuntimeError("The local lab API must not redirect")


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def start_java(stack, jar, home, env, windows_tcp_pipe=False):
    home.mkdir()
    # The external config is owned by this lab, in a new temporary cwd.
    config = ("neutrino:\n  proxy:\n    tunnel:\n      boss-thread-count: 1\n"
              "      work-thread-count: 2\n      thread-count: 2\n    client:\n      udp:\n"
              "        puppet-port-range: ''\n        boss-thread-count: 1\n        work-thread-count: 1\n")
    (home / "app.yml").write_text(config, encoding="utf-8")
    log = stack.enter_context((home / "process.log").open("wb"))
    options = ["-Dfile.encoding=UTF-8"]
    if windows_tcp_pipe:
        if os.name != "nt":
            raise ValueError("Windows TCP pipe compatibility is only available on Windows")
        # A missing AF_UNIX directory makes JDK 21 PipeImpl fall back to TCP.
        # The setting affects only these disposable JVMs; the NIO provider stays unchanged.
        options.append(f"-Djdk.net.unixdomain.tmpdir={home / 'af-unix-disabled'}")
    process = subprocess.Popen([shutil.which("java"), *options, "-jar", str(jar)],
                               cwd=home, env=env, stdout=log, stderr=subprocess.STDOUT,
                               stdin=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    stack.callback(stop_process, process)
    process.lab_log = home / "process.log"
    return process


def retry(action, processes, timeout=45):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        for process in processes:
            if process.poll() is not None:
                tail = process.lab_log.read_text(encoding="utf-8", errors="replace")[-6000:]
                tail = re.sub(r"[a-fA-F0-9]{32}", "[test-value-redacted]", tail)
                raise RuntimeError("A Java process exited before readiness:\n" + tail)
        try:
            return action()
        except (OSError, EOFError, urllib.error.URLError) as error:
            last = error
            time.sleep(0.15)
    raise TimeoutError(f"Local readiness timed out ({type(last).__name__})")


def transfer(port, payload):
    with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
        connection.sendall(payload)
        result = read_exact(connection, len(payload))
    if result != payload:
        raise AssertionError("The proxy changed the payload")
    return result


def expect_rejected(port):
    """A failed target must close/refuse the visitor, rather than silently hang."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
            connection.sendall(b"unreachable-target")
            if connection.recv(1):
                raise AssertionError("A rejected connection returned unexpected bytes")
    except (ConnectionRefusedError, ConnectionResetError, ConnectionAbortedError):
        pass


def run(repo, windows_tcp_pipe=False):
    jars = {role: repo / f"neutrino-proxy-{role}/target/neutrino-proxy-{role}.jar"
            for role in ("server", "client")}
    for jar in jars.values():
        if not jar.is_file():
            raise FileNotFoundError("Build first: mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package")
    if not shutil.which("java"):
        raise RuntimeError("Java 21 must be available on PATH")
    # This public seed account exists only inside the new disposable database.
    user_source = (repo / "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/UserService.java").read_text(encoding="utf-8")
    seed = re.search(r'DEFAULT_PASSWORD\s*=\s*"([^"]+)"', user_source)
    if not seed:
        raise RuntimeError("Fresh-database seed semantics changed; review this lab")
    report = {"lesson": "01.01", "executedAt": datetime.now(timezone.utc).isoformat(),
              "scope": "loopback integration; no NAT or public-network validation",
              "windowsTcpPipeCompat": windows_tcp_pipe, "checks": []}
    checks = report["checks"]
    with tempfile.TemporaryDirectory(prefix="np-learning-") as temporary, ExitStack() as stack:
        folder = Path(temporary)
        # Keep reservations distinct until the environment is assembled.
        reservations = [socket.socket() for _ in range(4)]
        for reservation in reservations:
            stack.callback(reservation.close)
            reservation.bind(("127.0.0.1", 0))
        web, tunnel, mapped, rejected = [item.getsockname()[1] for item in reservations]
        echo = EchoServer(("127.0.0.1", 0), Echo)
        stack.callback(echo.server_close)
        threading.Thread(target=echo.serve_forever, daemon=True).start()
        stack.callback(echo.shutdown)
        blocked = stack.enter_context(socket.socket())
        blocked.bind(("127.0.0.1", 0))  # bound but never listening: deterministic rejection
        report["ports"] = {"management": web, "tunnel": tunnel, "mapping": mapped,
                           "target": echo.server_address[1], "rejectedMapping": rejected}
        for reservation in reservations:
            reservation.close()
        server = start_java(stack, jars["server"], folder / "server", local_environment(web, tunnel), windows_tcp_pipe)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        token = ""

        def api(path, fields=None):
            url = f"http://127.0.0.1:{web}/neutrino-proxy-server{path}"
            data = None if fields is None else urllib.parse.urlencode(fields).encode("utf-8")
            request = urllib.request.Request(url, data=data, headers={"Authorize": token})
            with opener.open(request, timeout=2) as response:
                body = json.load(response)
            if body.get("code") != 0:
                raise RuntimeError(f"Local setup API failed: {path}, code={body.get('code')}")
            return body.get("data")

        token = retry(lambda: api("/login", {"loginName": "admin", "loginPassword": seed[1]}), [server])["token"]
        name = "learning-" + uuid.uuid4().hex[:8]
        api("/license/create", {"name": name, "userId": 1})
        license_info = next(item for item in api("/license/list") if item["name"] == name)
        for port, target in [(mapped, echo.server_address[1]), (rejected, blocked.getsockname()[1])]:
            api("/port-pool/create", {"port": str(port), "groupId": 1})
            api("/port-mapping/create", {"licenseId": license_info["id"], "serverPort": port,
                "clientIp": "127.0.0.1", "clientPort": target, "protocal": "TCP", "description": "learning-only"})
        payload = bytes(range(256)) * 256
        transfer(echo.server_address[1], payload)
        checks.append({"name": "direct_target", "passed": True, "bytes": len(payload)})
        client = start_java(stack, jars["client"], folder / "client",
                            local_environment(web, tunnel, license_info["key"]), windows_tcp_pipe)
        retry(lambda: transfer(mapped, payload), [server, client])
        checks.append({"name": "proxy_roundtrip", "passed": True, "bytes": len(payload),
                       "sha256": hashlib.sha256(payload).hexdigest()})
        # No management requests occur during this or any later transfer check.
        transfer(mapped, b"no-management-request-needed")
        checks.append({"name": "transfer_without_management_calls", "passed": True})
        try:
            expect_rejected(rejected)
            checks.append({"name": "unreachable_target_closes_visitor", "passed": True})
        except TimeoutError:
            # Preserve the failed assertion as evidence; do not report a timeout as success.
            checks.append({"name": "unreachable_target_closes_visitor", "passed": False,
                           "observed": "visitor did not close within 3 seconds", "timeoutSeconds": 3})
        transfer(mapped, b"healthy-mapping-survives-other-target-failure")
        checks.append({"name": "unreachable_target_isolated", "passed": True})
        stop_process(client)
        expect_rejected(mapped)
        checks.append({"name": "client_disconnect", "passed": True})
    report["temporaryStateRemoved"] = not folder.exists()
    report["java"] = subprocess.run([shutil.which("java"), "-version"], capture_output=True, text=True, check=True).stderr.splitlines()[0]
    report["python"] = os.sys.version.split()[0]
    commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
    report["sourceCommit"] = commit.stdout.strip()
    report["jars"] = {role: hashlib.sha256(path.read_bytes()).hexdigest() for role, path in jars.items()}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--report", type=Path, help="Write a credential-free JSON report")
    parser.add_argument("--windows-tcp-pipe", action="store_true",
                        help="Let JDK 21 PipeImpl use its TCP fallback in Windows environments with broken AF_UNIX pipes")
    args = parser.parse_args()
    result = run(args.repo.resolve(), args.windows_tcp_pipe)
    content = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content, encoding="utf-8")
    print(content, end="")
    if not all(check["passed"] for check in result["checks"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
