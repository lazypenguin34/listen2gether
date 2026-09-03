import { Link } from 'react-router-dom';

export default function NotFound() {
    return (
        <div className="center-content">
            <div className="card stack">
                <h1>Page not found</h1>
                <p>There's nothing here.</p>
                <Link className="btn btn--primary" to="/">
                    Back home
                </Link>
            </div>
        </div>
    );
}
