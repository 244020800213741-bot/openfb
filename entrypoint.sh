#!/bin/bash
set -e

# ── Start Xvfb virtual display ──
# Provides a virtual X display so headed Firefox/Camoufox works in a headless container.
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Give Xvfb a moment to initialize
sleep 1

# ── Start x11vnc (VNC server on display :99) ──
# Listens on port 5900, no password, accessible within the container network.
x11vnc -display :99 -rfbport 5900 -nopw -forever -shared -bg -o /var/log/x11vnc.log

# ── Start noVNC (web-based VNC viewer) ──
# Serves a web page on port 6080 that connects to the VNC server.
# Access from your browser at: http://<server-ip>:6080/vnc.html
websockify --web /usr/share/novnc 6080 localhost:5900 &

# Start the NestJS application
exec node dist/main.js
