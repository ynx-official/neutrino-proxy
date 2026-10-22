"""Exercise smoke-check expectations against actual production output formats."""

import struct
import unittest
from unittest.mock import Mock, patch

from smoke import cleanup_with_retry, management_script, verify_auth_frame


class SmokeTests(unittest.TestCase):
    def test_cleanup_retries_temporary_windows_image_lock(self):
        cleanup = Mock(side_effect=[PermissionError('image still closing'), PermissionError('image still closing'), None])
        with patch('smoke.time.sleep') as sleep:
            cleanup_with_retry(cleanup)
        self.assertEqual(cleanup.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_cleanup_does_not_hide_persistent_permission_failure(self):
        cleanup = Mock(side_effect=PermissionError('still locked'))
        with patch('smoke.time.sleep'), self.assertRaises(PermissionError):
            cleanup_with_retry(cleanup)
        self.assertEqual(cleanup.call_count, 6)

    def test_minified_management_html_does_not_require_quoted_attributes(self):
        self.assertEqual(management_script('<div id=app></div><script src=./static/js/app.js></script>'),
                         './static/js/app.js')

    def test_html_without_management_root_or_script_is_rejected(self):
        for html in ('<script src="app.js"></script>', '<div id="app"></div>'):
            with self.assertRaises(ValueError):
                management_script(html)

    def test_auth_accepts_generated_client_identity(self):
        info = b'ci-smoke-license,generated-client-id'
        verify_auth_frame(struct.pack('>BqI', 2, 0, len(info)) + info)

    def test_auth_rejects_wrong_license_empty_identity_and_invalid_lengths(self):
        for info in (b'wrong-license,client', b'ci-smoke-license,'):
            with self.assertRaises(ValueError):
                verify_auth_frame(struct.pack('>BqI', 2, 0, len(info)) + info)
        with self.assertRaises(ValueError):
            verify_auth_frame(struct.pack('>BqI', 2, 0, 100))


if __name__ == '__main__':
    unittest.main()
