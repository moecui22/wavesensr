#!/bin/bash
# Double-click this to run WaveSensr. Nothing to install: macOS Python, no network.
cd "$(dirname "$0")"
( until curl -s -o /dev/null http://localhost:8777; do sleep 0.5; done; open http://localhost:8777 ) &
echo "WaveSensr — plug the receiver into this Mac by USB, power the sender."
echo "The page opens in a moment. Close this window to stop."
exec /usr/bin/python3 server.py
