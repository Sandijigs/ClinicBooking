import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getMyBookings } from "../api";
import type { Booking } from "../api";

export function MyBookings() {
  const [email, setEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(forEmail: string, cursor: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await getMyBookings(forEmail, cursor);
      setBookings((current) => (cursor ? [...current, ...page.bookings] : page.bookings));
      setNextCursor(page.next_cursor);
      setSearchedEmail(forEmail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    load(email.trim(), null);
  }

  return (
    <section className="card">
      <h2>My bookings</h2>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          aria-label="Your email"
          required
        />
        <button type="submit" className="secondary" disabled={loading}>
          Find
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {searchedEmail && bookings.length === 0 && !loading && (
        <p className="empty">No bookings found for {searchedEmail}.</p>
      )}

      {bookings.length > 0 && (
        <ul className="booking-list">
          {bookings.map((b) => (
            <li key={b.id}>
              <span className="mono">{b.slot_id}</span>
              <span>{new Date(b.created_at).toLocaleString()}</span>
              <span className={`badge ${b.status === "confirmed" ? "badge-open" : "badge-closed"}`}>
                {b.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && searchedEmail && (
        <button
          type="button"
          className="link-button"
          disabled={loading}
          onClick={() => load(searchedEmail, nextCursor)}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
