import { useState } from 'react';

/**
 * The now-playing album art, or a placeholder when there is none / it
 * fails to load.
 *
 * @param {{ src: string|null, alt: string }} props
 */
export default function AlbumArt({ src, alt }) {
    const [failed, setFailed] = useState(false);
    // Adjusting state while rendering (React's documented pattern for
    // resetting derived state when a prop changes) rather than in an effect,
    // so a new `src` gets a fresh chance to load without an extra render.
    const [prevSrc, setPrevSrc] = useState(src);
    if (src !== prevSrc) {
        setPrevSrc(src);
        setFailed(false);
    }

    if (!src || failed) {
        return (
            <div className="album-art album-art--empty" role="img" aria-label={alt}>
                <span>No album art</span>
            </div>
        );
    }

    return <img className="album-art" src={src} alt={alt} onError={() => setFailed(true)} />;
}
