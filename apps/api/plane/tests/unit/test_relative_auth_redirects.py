from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
from types import SimpleNamespace
from django.test import SimpleTestCase, RequestFactory, override_settings
from plane.utils.path_validator import get_safe_redirect_url, get_relative_redirect_url
from plane.authentication.views.app.signout import SignOutAuthEndpoint
from plane.authentication.views.app.email import SignInAuthEndpoint


@override_settings(WEB_URL='http://canonical.invalid:5110', APP_BASE_URL='')
class RelativeAuthRedirectTests(SimpleTestCase):
    def test_browser_redirect_never_uses_configured_origin(self):
        for base, path in [('http://canonical.invalid:5110', '/'), ('http://canonical.invalid:5110/god-mode/', '/god-mode/'), ('http://canonical.invalid:5110/spaces/', '/spaces/')]:
            with self.subTest(base=base):
                result = get_safe_redirect_url(base, '/ai-strategy/?tab=one&sort=two')
                parts = urlsplit(result)
                self.assertEqual(parts.scheme, '')
                self.assertEqual(parts.netloc, '')
                self.assertEqual(parts.path, path)
                self.assertEqual(parse_qs(parts.query)['next_path'], ['/ai-strategy/?tab=one&sort=two'])

    def test_errors_and_untrusted_next_paths_cannot_change_origin(self):
        for target in ['//attacker.invalid', 'https://attacker.invalid/task', '\\\\attacker.invalid', '/%2f%2fattacker.invalid', '/../../outside']:
            result = get_safe_redirect_url('http://canonical.invalid:5110', target, {'error_message': 'a&b=1'})
            self.assertTrue(result.startswith('/'))
            self.assertFalse(result.startswith('//'))
            self.assertEqual(urlsplit(result).netloc, '')
            self.assertEqual(parse_qs(urlsplit(result).query)['error_message'], ['a&b=1'])

    def test_empty_next_path_still_returns_same_origin_root(self):
        self.assertEqual(get_safe_redirect_url('http://canonical.invalid:5110'), '/')

    def test_app_signout_failure_redirect_is_relative_for_any_request_host(self):
        for host in ['lan.invalid:5110', 'proxy.invalid:6110']:
            request = RequestFactory().post('/auth/sign-out/', HTTP_HOST=host)
            with patch('plane.authentication.views.app.signout.User.objects.get', side_effect=RuntimeError('no session')):
                response = SignOutAuthEndpoint.as_view()(request)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response['Location'], '/')

    def test_direct_browser_destination_keeps_mount_path_and_query_only(self):
        self.assertEqual(get_relative_redirect_url('http://canonical.invalid:5110/spaces/anchor/issues/?tab=all'), '/spaces/anchor/issues/?tab=all')
        for value in ['http://canonical.invalid:5110//evil.invalid', '//evil.invalid', 'https://evil.invalid/task']:
            result = get_relative_redirect_url(value)
            self.assertEqual(urlsplit(result).netloc, '')
            self.assertFalse(result.startswith('//'))

    def test_password_signin_returns_local_redirect_for_arbitrary_fronting_host(self):
        for host in ['lan.invalid:5110', 'forwarder.invalid:6110']:
            request = RequestFactory().post('/auth/sign-in/', {'email': 'reader@example.invalid', 'password': 'fixture-password', 'next_path': '/ai-strategy/'}, HTTP_HOST=host)
            with patch('plane.authentication.views.app.email.Instance.objects.first', return_value=SimpleNamespace(is_setup_done=True)), patch('plane.authentication.views.app.email.User.objects.filter') as users, patch('plane.authentication.views.app.email.EmailProvider') as provider, patch('plane.authentication.views.app.email.user_login'):
                users.return_value.first.return_value = SimpleNamespace(id='reader')
                provider.return_value.authenticate.return_value = SimpleNamespace(id='reader')
                response = SignInAuthEndpoint.as_view()(request)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(urlsplit(response['Location']).netloc, '')
            self.assertEqual(parse_qs(urlsplit(response['Location']).query)['next_path'], ['/ai-strategy/'])
