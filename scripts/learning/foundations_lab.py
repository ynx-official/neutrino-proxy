"""Run small Java lessons against the built project classes, using only temporary files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from zipfile import ZipFile


def run(repo):
    jar = repo / "neutrino-proxy-server/target/neutrino-proxy-server.jar"
    source = repo / "scripts/learning/FoundationsLab.java"
    if not jar.is_file():
        raise FileNotFoundError("Build first: mvn -B -pl neutrino-proxy-server -am package")
    java = shutil.which("java")
    if not java:
        raise RuntimeError("Java 21 is required on PATH")
    with tempfile.TemporaryDirectory(prefix="np-foundations-") as temporary:
        home = Path(temporary).resolve()
        classes = home / "classes"
        libraries = home / "lib"
        classes.mkdir(); libraries.mkdir()
        with ZipFile(jar) as archive:
            for entry in archive.infolist():
                if entry.filename.startswith("BOOT-INF/lib/") and entry.filename.endswith(".jar"):
                    target = libraries / Path(entry.filename).name
                elif entry.filename.startswith("BOOT-INF/classes/") and entry.filename.endswith(".class"):
                    target = classes / entry.filename.removeprefix("BOOT-INF/classes/")
                else:
                    continue
                target = target.resolve()
                if not target.is_relative_to(home):
                    raise ValueError("Archive entry escapes the lab directory")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
        # No application resources are extracted and no Solon main is started.
        command = [java, "-Dfile.encoding=UTF-8", "-cp", str(classes) + os.pathsep + str(libraries / "*"), str(source)]
        result = subprocess.run(command, cwd=home, capture_output=True, text=True, encoding="utf-8", timeout=60,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError(result.stderr[-6000:] + result.stdout[-2000:])
        marker = next(line for line in result.stdout.splitlines() if line.startswith("NP_LESSON_RESULT="))
        payload = json.loads(marker.split("=", 1)[1])
        checks = payload["checks"]
    return {"executedAt": datetime.now(timezone.utc).isoformat(), "scope": "direct project-class and JDK checks; no server, database or remote connection",
            "checks": [{"name": name, "passed": True} for name in checks], "observations": payload.get("observations", []),
            "temporaryStateRemoved": not home.exists(),
            "sourceCommit": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
            "serverJarSha256": hashlib.sha256(jar.read_bytes()).hexdigest(),
            "java": subprocess.run([java, "-version"], capture_output=True, text=True, check=True).stderr.splitlines()[0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = run(args.repo.resolve())
    content = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content, encoding="utf-8")
    print(content, end="")


if __name__ == "__main__":
    main()
