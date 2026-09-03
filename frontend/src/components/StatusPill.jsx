/**
 * Small status indicator: offline (host disconnected) takes priority over
 * playing/paused, since neither of those is meaningful without a host.
 *
 * @param {{ status: 'playing'|'paused', hostConnected: boolean }} props
 */
export default function StatusPill({ status, hostConnected }) {
    if (!hostConnected) {
        return <span className="pill pill--offline">Host offline</span>;
    }
    if (status === 'playing') {
        return <span className="pill pill--playing">Playing</span>;
    }
    return <span className="pill pill--paused">Paused</span>;
}
