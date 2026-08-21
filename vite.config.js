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