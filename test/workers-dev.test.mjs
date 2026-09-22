// Integration test for the Cloudflare Workers port of Snapdrop/webdrop.
// Run with the dev server up: npx wrangler dev --port 8787
// Then: node test/workers-dev.test.mjs
// Uses Node >= 22 (global WebSocket client).

import net from 'node:net';

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/server/webrtc`;

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let failures = 0;
function check(label, ok, extra = '') {
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${label}${extra ? '  (' + extra + ')' : ''}`);
    if (!ok) failures++;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, headers) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const messages = [];
        ws.addEventListener('message', e => {
            try { messages.push(JSON.parse(e.data)); } catch { /* ignore */ }
        });
        ws.addEventListener('open', () => resolve({ ws, messages }));
        ws.addEventListener('error', () => reject(new Error('ws error')));
        setTimeout(() => reject(new Error('ws connect timeout')), 5000);
    });
}

function waitFor(messages, pred, label) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        (function poll() {
            const found = messages.find(pred);
            if (found) return resolve(found);
            if (Date.now() - started > 5000) return reject(new Error('timeout waiting for: ' + label));
            setTimeout(poll, 50);
        })();
    });
}

function rawUpgrade() {
    return new Promise((resolve, reject) => {
        const s = net.connect(PORT, '127.0.0.1');
        let data = '';
        s.on('connect', () => s.write(
            'GET /server/webrtc HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${PORT}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            'Sec-WebSocket-Version: 13\r\n\r\n'
        ));
        s.on('data', d => {
            data += d;
            if (data.includes('\r\n\r\n')) { s.destroy(); resolve(data); }
        });
        s.on('error', reject);
        setTimeout(() => reject(new Error('raw upgrade timeout')), 5000);
    });
}

// --- 1. static assets ---
{
    const page = await fetch(BASE + '/');
    const body = await page.text();
    check('GET / serves index.html', page.ok && /<!DOCTYPE html>/i.test(body));

    const script = await fetch(BASE + '/scripts/network.js');
    check('GET /scripts/network.js serves asset', script.ok);

    const missing = await fetch(BASE + '/no-such-page');
    check('GET unknown path returns 404', missing.status === 404);

    const notWs = await fetch(BASE + '/server/webrtc');
    check('GET /server/webrtc without Upgrade returns 426', notWs.status === 426);
}

// --- 2. upgrade handshake sets peerid cookie ---
{
    const res = await rawUpgrade();
    check('raw upgrade returns 101', res.startsWith('HTTP/1.1 101'), res.split('\r\n')[0]);
    check('upgrade sets peerid cookie', /set-cookie:\s*peerid=[0-9a-f-]+/i.test(res));
}

// --- 3. room join / presence / relay ---
{
    const a = await connect(WS_URL);
    await sleep(200); // let A fully settle before B joins

    const b = await connect(WS_URL);

    const aJoined = await waitFor(a.messages, m => m.type === 'peer-joined', 'A sees peer-joined');
    const bPeers = await waitFor(b.messages, m => m.type === 'peers', 'B sees peers list');
    const bId = aJoined.peer.id;

    check('peer info has name fields', !!aJoined.peer.name && !!aJoined.peer.name.displayName && !!aJoined.peer.name.deviceName,
        `displayName="${aJoined.peer.name.displayName}" deviceName="${aJoined.peer.name.deviceName}"`);
    check('rtcSupported derived from url', aJoined.peer.rtcSupported === true);

    const aName = await waitFor(a.messages, m => m.type === 'display-name', 'A display-name');
    check('A receives its display-name', !!aName.message.displayName, `"${aName.message.displayName}"`);

    // the dev room may contain leftover peers (e.g. browser tabs), so learn
    // A's id from the sender field of a relayed message instead of guessing
    // from the peers list
    a.ws.send(JSON.stringify({ type: 'signal', to: bId, sdp: { type: 'offer', sdp: 'x' } }));
    const aToB = await waitFor(b.messages, m => m.type === 'signal' && m.sdp, 'B receives relayed signal');
    const aId = aToB.sender;
    check('relay A->B, B learns sender id', !!aId);
    check('B peers list contains A', bPeers.peers.some(p => p.id === aId), `${bPeers.peers.length} peer(s) in room`);
    check('A sees distinct peer join', aId !== bId, `A=${aId.slice(0, 8)}.. B=${bId.slice(0, 8)}..`);

    // relay the other direction
    b.ws.send(JSON.stringify({ type: 'signal', to: aId, ice: { candidate: 'y' } }));
    const bToA = await waitFor(a.messages, m => m.type === 'signal' && m.ice, 'A receives relayed ice');
    check('signal relayed with sender id', bToA.sender === bId);
    check('signal "to" stripped', !('to' in bToA));

    // unknown recipient must not crash the room
    b.ws.send(JSON.stringify({ type: 'signal', to: 'no-such-peer', ice: { candidate: 'y' } }));
    await sleep(200);
    check('room survives unknown recipient', b.ws.readyState === 1);

    // malformed JSON must be ignored
    b.ws.send('{not json');
    await sleep(200);
    check('room survives malformed JSON', b.ws.readyState === 1);

    // graceful disconnect announces peer-left
    a.ws.send(JSON.stringify({ type: 'disconnect' }));
    await waitFor(b.messages, m => m.type === 'peer-left' && m.peerId === aId, 'B sees peer-left');
    check('peer-left broadcast on disconnect', true);

    a.ws.close();
    b.ws.close();
}

// --- 4. display name is stable for the same peer id ---
{
    const describe = await import('../src/peer-info.js');
    const n1 = describe.describeUserAgent(CHROME_UA, 'uuid-1');
    const n2 = describe.describeUserAgent(CHROME_UA, 'uuid-1');
    const n3 = describe.describeUserAgent(CHROME_UA, 'uuid-2');
    check('displayName stable per peer id', n1.displayName === n2.displayName && n1.displayName !== n3.displayName,
        `"${n1.displayName}" vs "${n3.displayName}"`);
    check('deviceName from UA', n1.os === 'Windows' && n1.browser === 'Chrome' && /Windows Chrome/.test(n1.deviceName), n1.deviceName);

    const ios = describe.describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'uuid-3');
    check('iOS UA parsed', ios.os === 'iOS' && ios.model === 'iPhone' && ios.type === 'mobile' && ios.browser === 'Safari', ios.deviceName);

    const android = describe.describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'uuid-4');
    check('Android UA parsed', android.os === 'Android' && android.model === 'Pixel 8' && android.type === 'mobile', android.deviceName);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
