import { useState } from 'react';

/**
 * Fixed, heavily-blurred backdrop showing the current track's album art.
 * Cross-fades between track changes by keeping two `.ambient__art` layers
 * and toggling which one is `.is-active` — the outgoing layer fades out
 * while the incoming layer fades in via the CSS `opacity` transition.
 *
 * `albumArt === null` fades to nothing (both layers inactive).
 *
 * @param {{ albumArt: string|null }} props
 */
export default function AmbientBackdrop({ albumArt }) {
    // Two slots, each holding either a url or null. `activeSlot` says which
    // slot is currently the "top" (visible) one.
    const [slots, setSlots] = useState([albumArt, null]);
    const [activeSlot, setActiveSlot] = useState(0);

    // Adjusting state while rendering (React's documented pattern for
    // deriving state from a changed prop) rather than in an effect, so the
    // slot swap happens in the same render as the new albumArt shows up.
    const [prevArt, setPrevArt] = useState(albumArt);
    if (albumArt !== prevArt) {
        setPrevArt(albumArt);

        const reduceMotion =
            typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduceMotion) {
            // Skip the cross-fade entirely: put the new art in both slots so
            // there is nothing to transition between.
            setSlots([albumArt, albumArt]);
        } else {
            const nextSlot = activeSlot === 0 ? 1 : 0;
            const nextSlots = [...slots];
            nextSlots[nextSlot] = albumArt;
            setSlots(nextSlots);
            setActiveSlot(nextSlot);
        }
    }

    return (
        <div className="ambient" aria-hidden="true">
            {slots.map((art, i) => (
                <img
                    key={i}
                    className={`ambient__art${i === activeSlot ? ' is-active' : ''}`}
                    src={art || undefined}
                    alt=""
                />
            ))}
            <div className="ambient__scrim" />
        </div>
    );
}
