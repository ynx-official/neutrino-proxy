"""Exercise smoke-check expectations against actual production output formats."""

import struct
import unittest

from smoke import management_script, verify_auth_frame


class SmokeTests(unittest.TestCase):
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
