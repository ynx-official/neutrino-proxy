"""Start the unpacked Java/native distributions using only temporary local fixtures."""

import argparse
from contextlib import contextmanager
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from release import ROOT, java_distribution_suffix, parse_version, unpack_bundle


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def cleanup_with_retry(cleanup):
    """Windows can release an executable's image handle shortly after process exit."""
    for attempt in range(6):
        try:
            cleanup()
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.2 * 2 ** attempt)


@contextmanager
def temporary_bundle_directory():
    temp = tempfile.TemporaryDirectory(prefix="np-")
    folder = Path(temp.name).resolve()
    if folder.parent != Path(tempfile.gettempdir()).resolve():
        raise ValueError("Unexpected smoke-test temporary directory")
    try:
        yield folder
    finally:
        cleanup_with_retry(temp.cleanup)


@contextmanager
def running_bundle(archive, env):
    # Solon 2.7's external-config lookup does not decode spaces in file URLs.
    # Launcher cwd/argument handling with spaces is covered separately.
    with temporary_bundle_directory() as folder:
        unpack_bundle(archive, folder)
        homes = list(folder.iterdir())
        if len(homes) != 1 or not homes[0].is_dir():
            raise ValueError(f"Unexpected distribution layout: {archive}")
        home = homes[0]
        command = ["cmd.exe", "/d", "/c", "start.cmd"] if os.name == "nt" else ["sh", "./start.sh"]
        container = None
        if image := os.environ.get("NP_SMOKE_CONTAINER_IMAGE"):
            if os.name == "nt":
                raise ValueError("CentOS userspace smoke requires a Linux Docker host")
            container = "np-smoke-" + uuid.uuid4().hex
            command = ["docker", "run", "--rm", "--init", "--name", container, "--platform", "linux/amd64",
                       "--network", "host", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                       "--user", f"{os.getuid()}:{os.getgid()}",
                       "--mount", f"type=bind,src={home},dst=/bundle", "--workdir", "/bundle"]
            for key, value in env.items():
                command += ["--env", f"{key}={value}"]
            command += [image, "sh", "./start.sh"]
        with (folder / "smoke.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=home, env={**os.environ, **env}, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
            try:
                yield process, folder / "smoke.log"
            except Exception:
                print((folder / "smoke.log").read_text(encoding="utf-8", errors="replace")[-16000:])
                raise
            finally:
                if container:
                    subprocess.run(["docker", "rm", "--force", container], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, check=False, timeout=30)
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    import signal
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        os.killpg(process.pid, signal.SIGKILL)
                    process.kill()
                    process.wait(timeout=10)


def management_script(html):
    """Read both quoted and minified attributes emitted by webpack's HTML plugin."""
    class Page(HTMLParser):
        has_app = False
        scripts = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if attrs.get("id") == "app":
                self.has_app = True
            if tag == "script" and attrs.get("src"):
                self.scripts.append(attrs["src"])

    page = Page()
    page.scripts = []
    page.feed(html)
    if not page.has_app or not page.scripts:
        raise ValueError("Server response does not contain the built management UI")
    return page.scripts[0]


def verify_auth_frame(frame):
    """The legacy config may generate a client ID rather than reading CLIENT_ID."""
    if len(frame) < 13 or frame[0] != 2:
        raise ValueError("Expected client authentication frame")
    info_length = struct.unpack(">I", frame[9:13])[0]
    if info_length > len(frame) - 13:
        raise ValueError("Authentication info length exceeds frame size")
    info = frame[13:13 + info_length].decode("utf-8")
    license_key, separator, client_id = info.partition(",")
    if license_key != "ci-smoke-license" or not separator or not client_id:
        raise ValueError("Unexpected authentication credentials from packaged client")


def smoke_server(archive):
    web, tunnel, ssl = free_port(), free_port(), free_port()
    settings = {
        "WEB_PORT": str(web), "OPEN_PORT": str(tunnel), "SSL_PORT": str(ssl),
        "HTTP_PROXY_PORT": "0", "HTTPS_PROXY_PORT": "0", "DB_TYPE": "h2", "DB_USER": "sa",
        "DB_PASSWORD": "", "DB_URL": "jdbc:h2:file:./data/smoke;MODE=MySQL;AUTO_SERVER=FALSE",
    }
    # Never use the developer's configured database or a repository-local data directory.
    with running_bundle(archive, settings) as (process, _):
        url = f"http://127.0.0.1:{web}/neutrino-proxy-server/"
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Server exited with {process.returncode}")
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    html = response.read().decode("utf-8")
                script = management_script(html)
                from urllib.parse import urljoin
                with urllib.request.urlopen(urljoin(url, script), timeout=5) as response:
                    if len(response.read()) < 20:
                        raise RuntimeError("Management UI JavaScript asset is missing")
                with socket.create_connection(("127.0.0.1", tunnel), timeout=2):
                    pass
                print(f"PASS server startup, management UI and tunnel listener: {archive.name}")
                return
            except (OSError, urllib.error.URLError):
                time.sleep(0.5)
        raise TimeoutError("Server did not become ready within 90 seconds")


def read_exact(connection, size):
    content = bytearray()
    while len(content) < size:
        data = connection.recv(size - len(content))
        if not data:
            raise RuntimeError("Client closed the connection before sending authentication")
        content.extend(data)
    return bytes(content)


def smoke_client(archive):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(1)
        settings = {"SERVER_IP": "127.0.0.1", "SERVER_PORT": str(listener.getsockname()[1]),
                    "SSL_ENABLE": "false", "LICENSE_KEY": "ci-smoke-license", "CLIENT_ID": "ci-smoke-client"}
        with running_bundle(archive, settings) as (process, log):
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"Client exited with {process.returncode}")
                try:
                    connection, _ = listener.accept()
                    break
                except socket.timeout:
                    continue
            else:
                raise TimeoutError("Client did not connect to local fixture")
            with connection:
                connection.settimeout(10)
                length = struct.unpack(">I", read_exact(connection, 4))[0]
                if not 13 <= length <= 2_097_148:
                    raise RuntimeError("Invalid authentication frame length")
                frame = read_exact(connection, length)
                verify_auth_frame(frame)
                info = json.dumps({"code": 0, "msg": "success", "licenseKey": "ci-smoke-license"}).encode()
                connection.sendall(struct.pack(">IBqI", 13 + len(info), 2, 0, len(info)) + info)
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Client exited while handling authentication success")
                    if 'Auth result:' in log.read_text(encoding="utf-8", errors="replace"):
                        print(f"PASS client local authentication handshake: {archive.name}")
                        return
                    time.sleep(0.2)
                raise TimeoutError("Client did not handle authentication success")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--kind", choices=("jar", "native"), required=True)
    parser.add_argument("--platform", choices=("any", "linux-x64", "linux-x64-musl-static", "windows-x64"), required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "release-assets")
    args = parser.parse_args()
    version = parse_version(args.tag)
    suffix = java_distribution_suffix(args.kind, args.platform)
    smoke_server(args.output / f"neutrino-proxy-server-{version}-{suffix}.zip")
    smoke_client(args.output / f"neutrino-proxy-client-{version}-{suffix}.zip")


if __name__ == "__main__":
    main()
