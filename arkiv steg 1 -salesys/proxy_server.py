#!/usr/bin/env python3
"""
Simple CORS proxy server to forward requests to Salesys API
"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request
import json
import sys
import ssl

class CORSProxyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        SimpleHTTPRequestHandler.end_headers(self)
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def do_POST(self):
        # Check if this is a proxy request
        if self.path.startswith('/proxy/'):
            self.handle_proxy_request()
        else:
            self.send_error(404, "Not found")
    
    def handle_proxy_request(self):
        try:
            # Remove /proxy/ prefix to get the actual URL path
            actual_path = self.path[7:]  # Remove '/proxy/'
            target_url = f"https://app.salesys.se{actual_path}"
            
            print(f"[PROXY] Forwarding to: {target_url}", file=sys.stderr)
            
            # Read the request body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None
            
            # Create the proxied request
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
            if 'Authorization' in self.headers:
                headers['Authorization'] = self.headers['Authorization']
            if 'Content-Type' in self.headers:
                headers['Content-Type'] = self.headers['Content-Type']
            
            req = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method='POST'
            )
            
            # Create SSL context that doesn't verify certificates (for development)
            ssl_context = ssl.create_default_context()
            # ssl_context.check_hostname = False
            # ssl_context.verify_mode = ssl.CERT_NONE
            
            # Make the request
            print(f"[PROXY] Making request...", file=sys.stderr)
            with urllib.request.urlopen(req, context=ssl_context, timeout=10) as response:
                response_data = response.read()
                
                print(f"[PROXY] Success! Status: {response.status}", file=sys.stderr)
                
                # Send response back to client
                self.send_response(response.status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(response_data)
                
        except urllib.error.HTTPError as e:
            # Forward HTTP errors
            print(f"[PROXY] HTTP Error {e.code}: {e.reason}", file=sys.stderr)
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            print(f"[PROXY] Error: {type(e).__name__}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            self.send_error(500, f"Proxy error: {str(e)}")

if __name__ == '__main__':
    PORT = 3000
    server = HTTPServer(('', PORT), CORSProxyHandler)
    print(f"🚀 CORS Proxy Server running at http://localhost:{PORT}")
    print(f"📁 Serving files from: {server.server_name}")
    print(f"🔄 Proxying API requests to: https://app.salesys.se")
    print(f"\nOpen http://localhost:{PORT}/index.html in your browser")
    print("\nPress Ctrl+C to stop the server")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped")
        sys.exit(0)

