import type { Slot } from "../api";
import { formatDay, formatTimeRange, hasStarted } from "../format";

type Props = {
  slots: Slot[];
  onSelect: (slot: Slot) => void;
};

export function SlotList({ slots, onSelect }: Props) {
  if (slots.length === 0) {
    return <p className="empty">No appointment slots yet. Please check back later.</p>;
  }

  // Group slots by day so the list is easier to scan
  const days = new Map<string, Slot[]>();
  for (const slot of slots) {
    const day = formatDay(slot.start);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }

  return (
    <div className="days">
      {[...days.entries()].map(([day, daySlots]) => (
        <section key={day} className="day">
          <h3 className="day-title">{day}</h3>
          <ul className="slot-grid">
            {daySlots.map((slot) => {
              const past = hasStarted(slot.start);
              const bookable = slot.available && !past;
              const label = past ? "Past" : slot.available ? "Available" : "Booked";
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    className="slot"
                    disabled={!bookable}
                    onClick={() => onSelect(slot)}
                  >
                    <span className="slot-time">{formatTimeRange(slot.start, slot.end)}</span>
                    <span className="slot-provider">{slot.provider}</span>
                    <span className={`badge ${bookable ? "badge-open" : "badge-closed"}`}>{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
