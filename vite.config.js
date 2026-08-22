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
        port: 8080,
        // Vite's default is to walk to the next free port when 8080 is taken,
        // print the one it settled on, and carry on. That makes the address
        // undeterminable in advance -- which matters most for the case it is
        // least visible in: a tablet typing the URL by hand off another screen.
        // 8081 is also the automation server's port, so the first drift lands on
        // something already spoken for. Fail on a busy port instead, so whatever
        // is holding it gets dealt with rather than silently routed around.
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