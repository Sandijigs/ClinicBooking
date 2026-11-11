import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { getSlots } from "./api";
import type { Booking, Slot } from "./api";
import { SlotList } from "./components/SlotList";
import { BookingForm } from "./components/BookingForm";
import { Confirmation } from "./components/Confirmation";
import { MyBookings } from "./components/MyBookings";

type View =
  | { name: "slots" }
  | { name: "book"; slot: Slot }
  | { name: "confirmed"; slot: Slot; booking: Booking };

export default function App() {
  const [view, setView] = useState<View>({ name: "slots" });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [provider, setProvider] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSlots(await getSlots());
    } catch {
      setError("We couldn't load the appointment slots. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const providers = [...new Set(slots.map((s) => s.provider))].sort();
  const visibleSlots = provider ? slots.filter((s) => s.provider === provider) : slots;

  function backToSlots() {
    setView({ name: "slots" });
    loadSlots(); // availability may have changed
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>Clinic Booking</span>
        </div>
        <p className="tagline">Pick a time that suits you and book in seconds.</p>
      </header>

      <main className="main">
        {view.name === "slots" && (
          <section className="card">
            <div className="card-head">
              <h2>Available appointments</h2>
              <div className="toolbar">
                {providers.length > 1 && (
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    aria-label="Filter by doctor"
                  >
                    <option value="">All doctors</option>
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="secondary" onClick={loadSlots} disabled={loading}>
                  Refresh
                </button>
              </div>
            </div>

            {loading && <p className="empty">Loading slots…</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {!loading && !error && (
              <SlotList slots={visibleSlots} onSelect={(slot) => setView({ name: "book", slot })} />
            )}
          </section>
        )}

        {view.name === "book" && (
          <BookingForm
            slot={view.slot}
            onBack={backToSlots}
            onBooked={(booking) => setView({ name: "confirmed", slot: view.slot, booking })}
          />
        )}

        {view.name === "confirmed" && (
          <Confirmation booking={view.booking} slot={view.slot} onDone={backToSlots} />
        )}

        {view.name === "slots" && <MyBookings />}
      </main>

      <footer className="footer">Clinic Booking · Koya assessment</footer>
    </div>
  );
}
