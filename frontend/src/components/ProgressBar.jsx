import { useEffect, useRef } from 'react';
import { effectivePositionMs, formatTime, progressRatio } from '../lib/playback.js';

/**
 * A real-time playback progress bar. Drives its own `requestAnimationFrame`
 * loop rather than re-rendering on an interval, so the fill tracks smoothly;
 * the loop stops whenever the room is paused or the component unmounts.
 *
 * @param {{ room: import('../lib/config.js').PublicRoom|null, clockOffsetMs: number }} props
 */
export default function ProgressBar({ room, clockOffsetMs }) {
    const fillRef = useRef(null);
    const timesRef = useRef(null);
    const rafRef = useRef(null);

    const lastTimesTextRef = useRef(null);

    useEffect(() => {
        if (!room) return undefined;

        const tick = () => {
            const ratio = progressRatio(room, clockOffsetMs);
            if (fillRef.current) {
                fillRef.current.style.width = `${ratio * 100}%`;
            }
            if (timesRef.current) {
                const positionMs = effectivePositionMs(room, clockOffsetMs);
                const text = `${formatTime(positionMs)} / ${formatTime(room.durationMs)}`;
                // formatTime only changes once a second; skip the DOM write
                // on the ~59/60 frames where it hasn't.
                if (text !== lastTimesTextRef.current) {
                    lastTimesTextRef.current = text;
                    timesRef.current.textContent = text;
                }
            }
            if (room.status === 'playing') {
                rafRef.current = requestAnimationFrame(tick);
            }
        };

        tick();

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [room, clockOffsetMs]);

    const positionMs = effectivePositionMs(room, clockOffsetMs);
    const durationMs = room?.durationMs || 0;
    const initialRatio = progressRatio(room, clockOffsetMs) * 100;

    return (
        <div className="progress">
            <div
                className="progress__track"
                role="progressbar"
                aria-label="Playback progress"
                aria-valuenow={Math.round(positionMs / 1000)}
                aria-valuemin={0}
                aria-valuemax={Math.round(durationMs / 1000)}
            >
                <div ref={fillRef} className="progress__fill" style={{ width: `${initialRatio}%` }} />
            </div>
            {durationMs > 0 && (
                <div ref={timesRef} className="progress__times">
                    {formatTime(positionMs)} / {formatTime(durationMs)}
                </div>
            )}
        </div>
    );
}
