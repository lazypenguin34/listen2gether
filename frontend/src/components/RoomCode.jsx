import { useState } from 'react';

/**
 * Shows the room code and a copy-link button. `navigator.clipboard` is
 * unavailable on non-secure origins other than localhost, so this falls
 * back to a hidden-textarea `document.execCommand('copy')` there.
 *
 * @param {{ roomCode: string }} props
 */
export default function RoomCode({ roomCode }) {
    const [copied, setCopied] = useState(false);

    const copyLink = async () => {
        const url = `${window.location.origin}/room/${roomCode}`;
        let ok = false;
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                ok = true;
            }
        } catch {
            ok = false;
        }
        if (!ok) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = url;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                ok = document.execCommand('copy');
                document.body.removeChild(textarea);
            } catch {
                ok = false;
            }
        }
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <span>
            Room {roomCode}{' '}
            <button
                type="button"
                className="btn btn--icon"
                onClick={copyLink}
                aria-label="Copy room link"
                title="Copy room link"
            >
                {copied ? '✓' : '⎘'}
            </button>
            {copied && <span role="status"> Copied</span>}
        </span>
    );
}
