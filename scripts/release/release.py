"""Build deterministic distribution layouts and validate the complete release set."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[2]
VERSION = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"


def parse_version(tag):
    """Only allow portable, numeric release versions derived from v-prefixed tags."""
    if not re.fullmatch("v" + VERSION, tag):
        raise ValueError("Tag must be vMAJOR.MINOR.PATCH (optionally -rc.1); for example v2.1.0")
    version = tag[1:]
    if any(int(part) > 65535 for part in version.split("-")[0].split(".")):
        raise ValueError("Version components must fit the Windows installer range 0..65535")
    if "-" in version and any(part.isdigit() and len(part) > 1 and part.startswith("0")
                               for part in version.split("-", 1)[1].split(".")):
        raise ValueError("Numeric prerelease identifiers cannot contain leading zeroes")
    return version


def replace_once(path, pattern, replacement):
    source = path.read_text(encoding="utf-8")
    source, count = re.subn(pattern, replacement, source, count=1, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"Version field missing: {path}")
    path.write_text(source, encoding="utf-8", newline="\n")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def prepare_versions(root, version):
    """Update only the CI checkout; synchronize lockfiles before locked builds."""
    parse_version("v" + version)
    replace_once(root / "pom.xml", r"<revision>[^<]+</revision>", f"<revision>{version}</revision>")
    for module in ("server", "client"):
        replace_once(root / f"neutrino-proxy-{module}/src/main/resources/app.yml",
                     r"^    version: .+$", f"    version: {version}")
    replace_once(root / "neutrino-proxy-server/src/main/resources/app.yml",
                 r'^(solon\.staticfiles\.mappings:\n)  - path: "/"\n    repository: [^\n]+',
                 r'\1  - path: "/"\n    repository: "classpath:static/"')


def require_file(path):
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"Required build output missing or empty: {path}")
    return path


def launchers(binary, kind):
    if kind == "jar":
        unix_command = f'exec "$JAVA" -Dfile.encoding=UTF-8 -jar "./{binary}" "$@"'
        windows_command = f'"%JAVA%" -Dfile.encoding=UTF-8 -jar "%~dp0{binary}" %*'
        unix_setup = 'JAVA=java\nif [ -n "${JAVA_HOME:-}" ]; then JAVA="$JAVA_HOME/bin/java"; fi\n'
        windows_setup = 'set "JAVA=java"\r\nif defined JAVA_HOME set "JAVA=%JAVA_HOME%\\bin\\java.exe"\r\n'
    else:
        unix_command = f'exec "./{binary}" "$@"'
        windows_command = f'"%~dp0{binary}" %*'
        unix_setup = windows_setup = ""
    # Resolve relative config and logs against the installation, regardless of caller cwd.
    unix = '#!/bin/sh\nset -eu\ncd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n'
    unix += unix_setup + unix_command + "\n"
    windows = '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n' + windows_setup
    windows += windows_command + '\r\nexit /b %errorlevel%\r\n'
    return unix, windows


def zip_directory(directory, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as bundle:
        for source in sorted(directory.rglob("*")):
            if source.is_file():
                info = zipfile.ZipInfo(source.relative_to(directory.parent).as_posix())
                info.create_system = 3
                executable = source.suffix == ".sh" or source.name in ("neutrino-proxy-server", "neutrino-proxy-client")
                info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(info, source.read_bytes())
    return destination


def package_java(root, output, module, kind, platform, version):
    parse_version("v" + version)
    name = f"neutrino-proxy-{module}"
    suffix = ".jar" if kind == "jar" else ".exe" if platform == "windows-x64" else ""
    source = require_file(root / name / "target" / (name + suffix))
    layout = f"{name}-{version}-{java_distribution_suffix(kind, platform)}"
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp) / layout
        directory.mkdir()
        shutil.copy2(source, directory / source.name)
        # A partial app-copy.yml contains empty YAML maps that can erase protocol defaults.
        # Distribute the complete build-resolved baseline, including the injected app version.
        shutil.copy2(require_file(root / name / "target/classes/app.yml"), directory / "app.yml")
        shutil.copy2(require_file(root / "LICENSE"), directory / "LICENSE")
        unix, windows = launchers(source.name, kind)
        if kind == "jar" or platform != "windows-x64":
            (directory / "start.sh").write_text(unix, encoding="utf-8", newline="\n")
        if kind == "jar" or platform == "windows-x64":
            (directory / "start.cmd").write_bytes(windows.encode("utf-8"))
        return zip_directory(directory, output / (layout + ".zip"))


def unpack_bundle(archive, destination):
    """Restore executable bits explicitly, since Python zip extraction drops them."""
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            target = (destination / info.filename).resolve()
            if not target.is_relative_to(destination) or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError(f"Unsafe archive member: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(bundle.read(info))
                target.chmod(info.external_attr >> 16 & 0o777 or 0o644)


def expected_assets(version):
    files = [f"neutrino-proxy-{module}-{version}-jdk21.zip" for module in ("server", "client")]
    files += [f"neutrino-proxy-{module}-{version}-{platform}-native.zip"
              for platform in ("linux-x64", "windows-x64") for module in ("server", "client")]
    files += [f"neutrino-proxy-{module}-{version}-linux-x64-musl-static.zip" for module in ("server", "client")]
    return files


def java_distribution_suffix(kind, platform):
    """Keep archive names identical across packaging and runtime checks."""
    if kind == "jar":
        return "jdk21"
    return platform if platform == "linux-x64-musl-static" else platform + "-native"


def validate_linux_static(output, version, tests_skipped=False, report=None, require_runtime=True):
    """Bind mandatory ELF inspection evidence to the exact archives being published."""
    if report is None:
        report = json.loads(require_file(output / "build-info/linux-musl-compatibility.json").read_text(encoding="utf-8"))
    if report.get("version") != version or report.get("linkage") != "static-musl" or report.get("elf_inspection") != "passed":
        raise ValueError("Missing static musl inspection evidence")
    expected = {name for name in expected_assets(version) if "musl-static" in name}
    archives = report.get("archives", [])
    if len(archives) != len(expected) or {item["name"] for item in archives} != expected:
        raise ValueError("Static inspection archive list mismatch")
    for item in archives:
        if (item.get("architecture") != "x86_64" or item.get("interpreter") is not None
                or item.get("needed_libraries") != [] or item.get("glibc_versions") != []
                or not re.fullmatch("[0-9a-f]{64}", item.get("binary_sha256", ""))):
            raise ValueError("Linux musl output is not fully static")
        if hashlib.sha256(require_file(output / item["name"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Static archive checksum does not match inspection evidence")
    runtime = report.get("runtime", {}).get("centos7_container")
    if require_runtime and runtime != ("skipped_by_request" if tests_skipped else "passed"):
        raise ValueError("CentOS 7 userspace smoke result does not match the test policy")
    return report


def record_build(output, label):
    versions = {}
    for tool, args in (("java", ["-version"]), ("mvn", ["--version"]), ("node", ["--version"]),
                       ("npm", ["--version"]),
                       ("readelf", ["--version"]), ("x86_64-linux-musl-gcc", ["--version"])):
        executable = shutil.which(tool)
        if executable:
            result = subprocess.run([executable, *args], capture_output=True, text=True, timeout=30)
            versions[tool] = (result.stdout + result.stderr).strip()
    write_json(output / "build-info" / (label + ".json"), {
        "runner_os": os.environ.get("RUNNER_OS", os.name), "tools": versions,
    })


def assemble(output, version, commit, run_url):
    expected = set(expected_assets(version))
    present = {path.name for path in output.iterdir() if path.is_file()}
    present -= {"SHA256SUMS", "release-manifest.json"}
    if expected != present:
        raise ValueError(f"Release assets mismatch: missing={sorted(expected - present)}, extra={sorted(present - expected)}")
    tests_skipped = os.environ.get("SKIP_TESTS") == "true"
    compatibility = validate_linux_static(output, version, tests_skipped)
    assets = [{"name": name, "size": require_file(output / name).stat().st_size,
               "sha256": hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in sorted(expected)]
    builds = {path.stem: json.loads(path.read_text(encoding="utf-8"))
              for path in sorted((output / "build-info").glob("*.json"))}
    write_json(output / "release-manifest.json", {
        "version": version, "tag": "v" + version, "commit": commit, "workflow_run": run_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tests_skipped": tests_skipped, "linux_compatibility": compatibility,
        "builds": builds, "assets": assets,
    })
    names = sorted(expected | {"release-manifest.json"})
    (output / "SHA256SUMS").write_text("".join(
        f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n" for name in names
    ), encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "java", "assemble", "record"))
    parser.add_argument("--tag", required=True)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "release-assets")
    parser.add_argument("--module", choices=("server", "client"))
    parser.add_argument("--kind", choices=("jar", "native"))
    parser.add_argument("--platform", choices=("any", "linux-x64", "linux-x64-musl-static", "windows-x64"))
    parser.add_argument("--label")
    parser.add_argument("--commit")
    parser.add_argument("--run-url", default="")
    args = parser.parse_args()
    version = parse_version(args.tag)
    if args.command == "prepare":
        prepare_versions(args.root, version)
    elif args.command == "java":
        if not args.module or not args.kind or (args.kind == "native" and args.platform not in ("linux-x64", "linux-x64-musl-static", "windows-x64")):
            parser.error("java requires --module, --kind and (for native) --platform")
        print(package_java(args.root, args.output, args.module, args.kind, args.platform, version))
    elif args.command == "record":
        if not args.label or not re.fullmatch(r"[a-z0-9-]+", args.label):
            parser.error("record requires an alphanumeric --label")
        record_build(args.output, args.label)
    else:
        if not args.commit:
            parser.error("assemble requires --commit")
        assemble(args.output, version, args.commit, args.run_url)


if __name__ == "__main__":
    main()
