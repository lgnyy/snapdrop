import { RoomDO } from './room.js';

export { RoomDO };

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // WebSocket signaling endpoint (ws(s)://host/server/webrtc or
        // /server/fallback). Everything else is served from the static
        // assets in client/.
        if (url.pathname.startsWith('/server')) {
            if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
                return new Response('WebSocket required', {
                    status: 426,
                    headers: { 'Upgrade': 'websocket' },
                });
            }
            const room = roomKeyFromRequest(request);
            const stub = env.ROOM.get(env.ROOM.idFromName(room));
            return stub.fetch(request);
        }

        return new Response('Not Found', { status: 404 });
    },
};

// One room per client network. On Cloudflare the visitor IP arrives in
// CF-Connecting-IP; IPv6 addresses are truncated to their /64 prefix so
// devices on the same network still see each other.
function roomKeyFromRequest(request) {
    const ip = request.headers.get('CF-Connecting-IP')
        || (request.headers.get('X-Forwarded-For') || '').split(/\s*,\s*/)[0]
        || 'local';
    if (ip.includes(':')) {
        return ip.split(':').slice(0, 4).join(':');
    }
    return ip;
}
