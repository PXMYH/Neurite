// The browser's half of a cloud sync test: the page is given an OAuth client id (as a build that is
// set up has one, js/sync/driveconfig.js), Google's sign-in script is a stand-in that answers with
// a token the fake Google issued, and every call to Google goes to that fake (fake-google.mjs).
// Nothing in the app knows it is under test.
export async function withFakeGoogle(context, fake, { clientId = 'test-client.apps.googleusercontent.com', answer = null } = {}) {
    await context.route('**/js/sync/driveconfig.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: `const DriveConfig = { webClientId: ${JSON.stringify(clientId)} };`,
    }));
    // `answer` may be an error ({error: 'popup_closed'}); otherwise each request gets a new token.
    await context.exposeBinding('__fakeGoogleToken', () => (answer ?? { access_token: fake.issueAccessToken(), expires_in: 3599 }));
    await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: `
            window.__gisRequests = 0;
            window.google = { accounts: { oauth2: {
                initTokenClient(config) {
                    return { requestAccessToken() {
                        window.__gisRequests += 1;
                        window.__fakeGoogleToken().then((res) => setTimeout(() => {
                            if (res.error) config.error_callback?.({ type: res.error });
                            else config.callback({ ...res, scope: config.scope });
                        }, 20));
                    } };
                },
                hasGrantedAllScopes: () => true,
                revoke(token, done) { window.__gisRevoked = token; done?.({ successful: true }); },
            } } };`,
    }));
    await fake.route(context);
}
