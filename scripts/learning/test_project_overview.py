"""Verify the lab's isolation and byte-stream assertions without starting Java."""

import os
from contextlib import redirect_stdout
import io
import socket
import tempfile
import json
import time
from pathlib import Path
import unittest
from unittest.mock import patch

from project_overview import local_environment, main, read_exact
import project_overview


class LabBoundariesTest(unittest.TestCase):
    def test_demo_is_explicit_and_full_remains_the_default(self):
        for arguments, mode in [([], "full"), (["--mode", "demo"], "demo")]:
            with self.subTest(mode=mode), patch("sys.argv", ["project_overview.py", *arguments]):
                with patch("project_overview.run", return_value={"checks": [{"passed": True}]}) as run:
                    with redirect_stdout(io.StringIO()):
                        main()
                self.assertEqual(run.call_args.kwargs["mode"], mode)

    def test_debug_requires_an_explicit_managed_session(self):
        error = io.StringIO()
        from contextlib import redirect_stderr
        with patch("sys.argv", ["project_overview.py", "--debug"]), redirect_stderr(error):
            with self.assertRaises(SystemExit) as result:
                main()
        self.assertEqual(result.exception.code, 2)
        self.assertIn("requires --keep-alive", error.getvalue())

    def test_stopped_or_expired_session_is_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            for state, expires in [("stopped", time.time() + 60), ("active", time.time() - 1)]:
                path.write_text(json.dumps({"kind": "neutrino-learning-session", "host": "127.0.0.1",
                                            "state": state, "expiresAt": expires}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    project_overview.load_session(path)

    def test_stop_marker_cannot_write_outside_the_lab_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / ("stop-" + "a" * 32 + ".request")
            with self.assertRaises(ValueError):
                project_overview.request_stop({"sessionId": "a" * 32, "stopFile": str(marker)})
            self.assertFalse(marker.exists())

    def test_active_session_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            original = {"kind": "neutrino-learning-session", "state": "active", "sessionId": "a" * 32}
            path.write_text(json.dumps(original), encoding="utf-8")
            with self.assertRaises(ValueError):
                project_overview.save_session(path, {"sessionId": "b" * 32}, first=True)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), original)

    def test_debug_agent_is_only_available_on_loopback(self):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            with patch("project_overview.subprocess.Popen") as launch:
                launch.return_value.poll.return_value = 0
                project_overview.start_java(stack, Path("teaching.jar"), Path(directory) / "server", {},
                                            debug_port=15005)
                command = launch.call_args.args[0]
                agent = next(option for option in command if option.startswith("-agentlib:jdwp="))
                self.assertIn("address=127.0.0.1:15005", agent)
                self.assertIn("suspend=n", agent)
                self.assertNotIn("address=*", agent)

    def test_known_failure_is_preserved_and_healthy_mapping_is_still_checked(self):
        checks = []
        with patch("project_overview.transfer") as transfer:
            with patch("project_overview.stop_process"):
                with patch("project_overview.expect_rejected", side_effect=[TimeoutError(), None]):
                    project_overview.run_fault_checks(10001, 10002, object(), checks)
        self.assertFalse(next(item for item in checks if item["name"] == "unreachable_target_closes_visitor")["passed"])
        self.assertTrue(next(item for item in checks if item["name"] == "unreachable_target_isolated")["passed"])
        self.assertTrue(transfer.called)

    def test_inherited_database_and_proxy_targets_are_replaced(self):
        with patch.dict(os.environ, {"DB_TYPE": "mysql", "DB_URL": "jdbc:mysql://invalid/test",
                                     "SERVER_IP": "invalid.example", "LICENSE_KEY": "inherited-test-value"}):
            env = local_environment(18080, 19000)
        self.assertEqual(env["DB_TYPE"], "h2")
        self.assertEqual(env["DB_URL"], "jdbc:h2:file:./data/learning;MODE=MySQL;AUTO_SERVER=FALSE")
        self.assertEqual(env["SERVER_IP"], "127.0.0.1")
        self.assertEqual(env["LICENSE_KEY"], "")
        self.assertEqual(env["SSL_ENABLE"], "false")

    def test_tcp_reads_accumulate_fragments(self):
        class Fragments:
            def __init__(self):
                self.parts = iter([b"ab", b"c", b"def"])

            def recv(self, size):
                return next(self.parts)

        self.assertEqual(read_exact(Fragments(), 6), b"abcdef")

    def test_truncated_stream_does_not_count_as_success(self):
        left, right = socket.socketpair()
        with left, right:
            left.sendall(b"ab")
            left.shutdown(socket.SHUT_WR)
            with self.assertRaises(EOFError):
                read_exact(right, 3)

    def test_failed_lab_assertion_keeps_a_nonzero_exit(self):
        output = io.StringIO()
        with patch("sys.argv", ["project_overview.py"]), redirect_stdout(output):
            with patch("project_overview.run", return_value={"checks": [{"passed": False}]}):
                with self.assertRaises(SystemExit) as result:
                    main()
        self.assertEqual(result.exception.code, 1)
        self.assertIn('"passed": false', output.getvalue())


if __name__ == "__main__":
    unittest.main()
