import { useState } from 'react';
import { requestToken, storeToken } from '../lib/ytmd.js';

/**
 * "Connect YTMD to sync playback" button + pairing flow for a listener who
 * wants their local YouTube Music Desktop player to follow the room.
 *
 * @param {{ onConnected: (token: string) => void }} props
 */
export default function ConnectYtmd({ onConnected }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const connect = async () => {
        setPending(true);
        setError(null);
        try {
            const token = await requestToken();
            storeToken(token);
            onConnected(token);
        } catch (err) {
            console.error('YTMD pairing failed', err);
            setError(
                'Could not pair with YouTube Music Desktop. Open the YTMD app, approve the pairing ' +
                    'request there, and make sure the Companion Server is enabled in its settings.'
            );
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="stack" style={{ '--stack-gap': 'var(--space-3)' }}>
            <button type="button" className="btn btn--primary" onClick={connect} disabled={pending}>
                {pending ? 'Connecting…' : 'Connect YTMD to sync playback'}
            </button>
            {error && <div className="alert alert--error">{error}</div>}
        </div>
    );
}
