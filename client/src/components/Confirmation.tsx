import { useState } from "react";
import { ApiError, cancelBooking } from "../api";
import type { Booking, Slot } from "../api";
import { formatDay, formatTimeRange } from "../format";

type Props = {
  booking: Booking;
  slot: Slot;
  onDone: () => void;
};

export function Confirmation({ booking: initial, slot, onDone }: Props) {
  const [booking, setBooking] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = booking.status === "cancelled";

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      setBooking(await cancelBooking(booking.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't reach the server.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="card">
      <div className={`status-banner ${cancelled ? "status-cancelled" : "status-confirmed"}`}>
        {cancelled ? "Booking cancelled" : "You're booked in"}
      </div>
      <h2>{cancelled ? "This appointment was cancelled" : "Appointment confirmed"}</h2>

      <dl className="details">
        <dt>Patient</dt>
        <dd>{booking.name}</dd>
        <dt>Email</dt>
        <dd>{booking.email}</dd>
        <dt>Doctor</dt>
        <dd>{slot.provider}</dd>
        <dt>When</dt>
        <dd>
          {formatDay(slot.start)}, {formatTimeRange(slot.start, slot.end)}
        </dd>
        <dt>Status</dt>
        <dd className="capitalize">{booking.status}</dd>
        <dt>Booking reference</dt>
        <dd className="mono">{booking.id}</dd>
      </dl>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={onDone}>
          Back to slots
        </button>
        {!cancelled && (
          <button type="button" className="secondary" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel booking"}
          </button>
        )}
      </div>
    </div>
  );
}
