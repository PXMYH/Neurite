// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        sourcemap: 'inline',
        target: 'esnext',
        minify: false
    },
    server: {
        // Was 8080, which is the most contended port on a development machine --
        // it collides with anything from a Java container to a throwaway
        // `python3 -m http.server`. 8999 is outside the ranges any of those pick
        // by default, and it is not 8081, the automation server's port.
        //
        // Anything hardcoding this has to move with it. Today that is the CORS
        // allowlist in localhost_servers/start_servers.js and the automation
        // server's defaultNeuriteUrl -- a stale allowlist blocks every proxied AI
        // call in the browser, which surfaces as a CORS error rather than
        // anything mentioning a port.
        port: 8999,
        // Vite's default is to walk to the next free port when 8999 is taken,
        // print the one it settled on, and carry on. That makes the address
        // undeterminable in advance -- which matters most for the case it is
        // least visible in: a tablet typing the URL by hand off another screen.
        // Fail on a busy port instead, so whatever is holding it gets dealt with
        // rather than silently routed around.
        strictPort: true,
        // `vite --host` serves a bare IP fine, but rejects any request whose Host
        // header is a domain name. These two are what a tablet on the same network
        // actually uses: the Bonjour name, which survives a DHCP lease change, and a
        // Tailscale name, which is the cheapest way to get real HTTPS — and HTTPS is
        // a secure context, without which navigator.storage is simply absent.
        // Deliberately narrow: neither suffix resolves from public DNS, so this keeps
        // the DNS-rebinding protection that a blanket allow-all would throw away.
        allowedHosts: ['.local', '.ts.net']
    },
    worker: {
        format: 'es'
    }
});