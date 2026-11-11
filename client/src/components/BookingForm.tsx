import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createBooking } from "../api";
import type { Booking, Slot } from "../api";
import { formatDay, formatTimeRange } from "../format";

type Props = {
  slot: Slot;
  onBooked: (booking: Booking) => void;
  onBack: () => void;
};

export function BookingForm({ slot, onBooked, onBack }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One Idempotency-Key per booking attempt: if the network drops and the
  // visitor presses "Confirm" again, the server won't create a second booking.
  const idempotencyKey = useRef(crypto.randomUUID());

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const booking = await createBooking(
        { slot_id: slot.id, name, email },
        idempotencyKey.current
      );
      onBooked(booking);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429 && err.retryAfter) {
          setError(`Too many attempts. Please try again in ${err.retryAfter} seconds.`);
        } else if (err.status === 409) {
          setError("Sorry, someone has just booked this slot. Please pick another one.");
        } else {
          setError(err.message);
        }
        // The details may change before the next try, so use a fresh key
        idempotencyKey.current = crypto.randomUUID();
      } else {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <button type="button" className="link-button" onClick={onBack}>
        ← Back to slots
      </button>
      <h2>Book this appointment</h2>
      <div className="summary">
        <div>
          <span className="summary-label">With</span>
          <span>{slot.provider}</span>
        </div>
        <div>
          <span className="summary-label">When</span>
          <span>
            {formatDay(slot.start)}, {formatTimeRange(slot.start, slot.end)}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="form">
        <label>
          Full name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Obi"
            autoComplete="name"
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ada@example.com"
            autoComplete="email"
            required
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Booking…" : "Confirm booking"}
        </button>
      </form>
    </div>
  );
}
