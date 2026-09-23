import { describeUserAgent } from './peer-info.js';

const KEEPALIVE_INTERVAL_MS = 30 * 1000; // ping every peer this often
const KEEPALIVE_TIMEOUT_MS = 2 * KEEPALIVE_INTERVAL_MS; // drop peers silent for two rounds

// One RoomDO instance per room (client network), replacing the original
// Node server's this._rooms[ip] map. Uses the hibernatable WebSocket API:
// the DO sleeps while connections are idle and is woken by incoming
// messages, closes, or the keepalive alarm.
export class RoomDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
            return new Response('WebSocket required', {
                status: 426,
                headers: { 'Upgrade': 'websocket' },
            });
        }

        const url = new URL(request.url);
        const rtcSupported = url.pathname.includes('webrtc');
        const userName = url.searchParams.get('user');

        // reuse the peer id from the cookie, hand out a new one otherwise
        let peerId = peerIdFromCookie(request.headers.get('Cookie'));
        let setCookie;
        if (!peerId) {
            peerId = crypto.randomUUID();
            setCookie = `peerid=${peerId}; SameSite=Strict; Secure`;
        }
        const name = describeUserAgent(request.headers.get('User-Agent'), peerId, userName);
        const info = { id: peerId, name, rtcSupported, lastBeat: Date.now() };

        const [client, server] = Object.values(new WebSocketPair());
        this.state.acceptWebSocket(server, [peerId]);
        server.serializeAttachment(info);

        // Note: a second tab in the same browser reuses the same cookie and
        // therefore the same peer id. Like the original server we let the
        // old socket live on (no forced close) and just skip own-id sockets
        // below; the old connection disappears naturally when its page
        // unloads, and _leave() then stays quiet because this socket with
        // the same id is still registered.

        // tell the newcomer about everyone else ...
        const others = [];
        for (const ws of this.state.getWebSockets()) {
            if (ws === server) continue;
            const other = ws.deserializeAttachment();
            if (!other || other.id === peerId) continue;
            others.push(peerInfo(other));
        }
        this._send(server, { type: 'peers', peers: others });
        this._send(server, {
            type: 'display-name',
            message: { displayName: name.displayName, deviceName: name.deviceName },
        });

        // ... and everyone else about the newcomer
        const joined = { type: 'peer-joined', peer: peerInfo(info) };
        for (const ws of this.state.getWebSockets()) {
            if (ws !== server) this._send(ws, joined);
        }

        this.state.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);

        const headers = new Headers();
        if (setCookie) headers.append('Set-Cookie', setCookie);
        return new Response(null, { status: 101, webSocket: client, headers });
    }

    async webSocketMessage(ws, message) {
        if (typeof message !== 'string') return; // binary frames are not part of the signaling protocol
        let msg;
        try {
            msg = JSON.parse(message);
        } catch {
            return; // malformed JSON, ignored like in the original server
        }

        const info = ws.deserializeAttachment();
        info.lastBeat = Date.now();
        ws.serializeAttachment(info);

        if (msg.type === 'disconnect') {
            // closing triggers webSocketClose, which broadcasts peer-left
            ws.close(1000, 'disconnect');
            return;
        }

        // relay signaling messages (sdp/ice) to the addressed peer
        if (msg.to) {
            const recipient = this.state.getWebSockets(String(msg.to))[0];
            if (recipient && recipient !== ws) {
                delete msg.to;
                msg.sender = info.id;
                this._send(recipient, msg);
            }
        }
    }

    async webSocketClose(ws) {
        this._leave(ws);
    }

    async webSocketError(ws) {
        ws.close(1011, 'error');
    }

    async alarm() {
        const sockets = this.state.getWebSockets();
        const now = Date.now();
        for (const ws of sockets) {
            const info = ws.deserializeAttachment();
            if (!info) {
                ws.close(1011, 'corrupt state');
                continue;
            }
            if (now - info.lastBeat > KEEPALIVE_TIMEOUT_MS) {
                ws.close(4001, 'keepalive timeout'); // triggers peer-left via webSocketClose
                continue;
            }
            this._send(ws, { type: 'ping' });
        }
        if (sockets.length) {
            this.state.storage.setAlarm(now + KEEPALIVE_INTERVAL_MS);
        }
    }

    _leave(ws) {
        const info = ws.deserializeAttachment();
        if (!info) return;
        // another socket already re-registered this peer id (page reload):
        // not a real departure
        if (this.state.getWebSockets(info.id).some(w => w !== ws)) return;
        const left = { type: 'peer-left', peerId: info.id };
        for (const other of this.state.getWebSockets()) {
            if (other !== ws) this._send(other, left);
        }
    }

    _send(ws, message) {
        try {
            ws.send(JSON.stringify(message));
        } catch (e) {
            console.error('send failed:', e);
        }
    }
}

function peerInfo(info) {
    return {
        id: info.id,
        name: info.name,
        rtcSupported: info.rtcSupported,
    };
}

function peerIdFromCookie(cookieHeader) {
    if (!cookieHeader) return null;
    const m = /(?:^|;\s*)peerid=([^;]+)/.exec(cookieHeader);
    return m ? decodeURIComponent(m[1].trim()) : null;
}
