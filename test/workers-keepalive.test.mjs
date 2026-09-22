// Keepalive (alarm) test: expects wrangler dev on 127.0.0.1:8787.
// A replies to pings and must survive; C stays silent and must be dropped
// after KEEPALIVE_TIMEOUT (60s) with a peer-left broadcast.
// Runtime: ~2 minutes.

const WS_URL = 'ws://127.0.0.1:8787/server/webrtc';

let failures = 0;
function check(label, ok, extra = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
    if (!ok) failures++;
}

function connect(label) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const messages = [];
        ws.addEventListener('message', e => {
            try { messages.push(JSON.parse(e.data)); } catch { /* ignore */ }
            if (label === 'A') {
                const m = JSON.parse(e.data);
                if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
            }
        });
        ws.addEventListener('open', () => resolve({ ws, messages }));
        ws.addEventListener('error', () => reject(new Error(label + ' ws error')));
        setTimeout(() => reject(new Error(label + ' connect timeout')), 5000);
    });
}

function waitFor(messages, pred, label, ms) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        (function poll() {
            const found = messages.find(pred);
            if (found) return resolve({ found, elapsed: Date.now() - started });
            if (Date.now() - started > ms) return reject(new Error('timeout: ' + label));
            setTimeout(poll, 200);
        })();
    });
}

const a = await connect('A');
await sleep(300);
const c = await connect('C');

const cJoined = await waitFor(a.messages, m => m.type === 'peer-joined', 'A sees C join', 5000);
const cId = cJoined.found.peer.id;

// A must receive a keepalive ping within ~40s
const ping = await waitFor(a.messages, m => m.type === 'ping', 'A receives ping', 45000);
check('keepalive ping received', true, `after ${Math.round(ping.elapsed / 1000)}s`);

// C never pongs -> dropped after 60s silence, A must see peer-left for C
const left = await waitFor(a.messages, m => m.type === 'peer-left' && m.peerId === cId, 'A sees C dropped', 90000);
check('silent peer dropped with peer-left', true, `after ${Math.round(left.elapsed / 1000)}s more`);

// A answered pings and must still be connected
check('responsive peer still connected', a.ws.readyState === 1);

a.ws.close();
try { c.ws.close(); } catch { /* already closed by server */ }

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll keepalive checks passed');
process.exit(failures ? 1 : 0);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
