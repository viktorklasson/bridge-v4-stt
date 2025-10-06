#!/usr/bin/env python3
"""
Simple webhook test server for testing inbound calls
"""

import http.server
import socketserver
import json
import urllib.request
import threading
import time
from datetime import datetime

class WebhookTestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/webhook/inbound-call':
            self.handle_webhook()
        else:
            self.send_error(404, "Not Found")

    def handle_webhook(self):
        try:
            # Get content length
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)

            # Parse JSON
            webhook_data = json.loads(post_data.decode('utf-8'))

            print("\n🔔 WEBHOOK RECEIVED:")
            print(f"   Call ID: {webhook_data.get('id')}")
            print(f"   From: {webhook_data.get('number', {}).get('caller')}")
            print(f"   To: {webhook_data.get('number', {}).get('called')}")
            print(f"   Status: {webhook_data.get('status')}")

            # Forward to your production server (if running)
            try:
                req = urllib.request.Request(
                    'http://localhost:3000/webhook/inbound-call',
                    data=post_data,
                    headers={'Content-Type': 'application/json'}
                )
                response = urllib.request.urlopen(req)
                print(f"   ✅ Forwarded to production server: {response.getcode()}")

            except Exception as e:
                print(f"   ❌ Failed to forward: {e}")

            # Respond to webhook
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'success': True,
                'message': 'Webhook received and processed',
                'callId': webhook_data.get('id'),
                'timestamp': datetime.now().isoformat()
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"❌ Error processing webhook: {e}")
            self.send_error(400, f"Bad Request: {str(e)}")

    def log_message(self, format, *args):
        # Custom logging to reduce noise
        if 'GET' in format and '/webhook/inbound-call' not in self.path:
            return
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}")

def simulate_webhook_call(target_url, call_id="test-call-123"):
    """Simulate an inbound call webhook"""
    webhook_data = {
        "id": f"c2225ahk{call_id}-3c56hbk-dgkk",
        "url": f"https://api.telnect.com/v1/Calls/c2225ahk{call_id}-3c56hbk-dgkk",
        "source": {
            "dialplan": {"key": "SE", "name": "Sweden", "globalPrefix": "00", "natPrefix": "0", "cc": "46", "areaPrefix": True},
            "asserted": {"scheme": "tel", "user": "0737606800"},
            "caller": {"scheme": "tel", "user": "0737606800"},
            "privacy": False
        },
        "destination": {
            "dialplan": {"key": "SE", "name": "Sweden", "globalPrefix": "00", "natPrefix": "0", "cc": "46", "areaPrefix": True},
            "req": {"scheme": "tel", "user": "0775893847"},
            "to": {"scheme": "tel", "user": "0775893847"}
        },
        "number": {
            "asserted": "0737606800",
            "called": "0775893847",
            "caller": "0737606800"
        },
        "meta": {
            "src_ip": "10.6.66.62",
            "src_port": "5060",
            "auth_centrex_custid": "129738",
            "instance": "pbx02-salessys",
            "node_ip": "10.6.70.158",
            "binding": "default",
            "id": f"c2225ahk{call_id}-3c56hbk-dgkk",
            "node_port": "52001",
            "inbound_trunk": "trunk:centrex",
            "auth_custid": "277360"
        },
        "header": {
            "X-Original-Callid": [f"p65555t{int(time.time())}m205508c32899s4"],
            "X-Accounting-ID": [f"c2225ahk{call_id}-3c56hbk-dgkk"]
        },
        "status": "trying",
        "actions": []
    }

    try:
        data = json.dumps(webhook_data).encode('utf-8')
        req = urllib.request.Request(
            target_url,
            data=data,
            headers={'Content-Type': 'application/json'}
        )

        print(f"\n🚀 SIMULATING WEBHOOK CALL: {call_id}")
        print(f"   Target: {target_url}")
        print(f"   Call ID: {webhook_data['id']}")

        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))

        print(f"   ✅ Response: {response.getcode()} - {result.get('message')}")
        return True

    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return False

def main():
    PORT = 8080

    print("🧪 WEBHOOK TEST SERVER")
    print("=" * 50)
    print(f"📍 Test server running at: http://localhost:{PORT}")
    print(f"📍 Webhook endpoint:       http://localhost:{PORT}/webhook/inbound-call")
    print()
    print("🔧 COMMANDS:")
    print("   1. Start your production server: npm run production")
    print("   2. Test webhook: http://localhost:8080/test.html")
    print("   3. Or run: python3 webhook-test.py simulate")
    print()

    with socketserver.TCPServer(("", PORT), WebhookTestHandler) as httpd:
        print(f"✅ Server running on port {PORT}")
        print("Press Ctrl+C to stop\n")

        # Start a thread to run the test server
        server_thread = threading.Thread(target=httpd.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n👋 Shutting down...")
            httpd.shutdown()

if __name__ == "__main__":
    if len(__import__('sys').argv) > 1 and __import__('sys').argv[1] == 'simulate':
        # Simulate webhook calls
        print("🎯 SIMULATING WEBHOOK CALLS")
        print("=" * 40)

        # Test against our test server
        simulate_webhook_call("http://localhost:8080/webhook/inbound-call", "test-1")
        time.sleep(2)
        simulate_webhook_call("http://localhost:8080/webhook/inbound-call", "test-2")

        # Test against production server if running
        try:
            simulate_webhook_call("http://localhost:3000/webhook/inbound-call", "prod-1")
        except:
            print("   ℹ️  Production server not running, skipping...")

    else:
        main()
