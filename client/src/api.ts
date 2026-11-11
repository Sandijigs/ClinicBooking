// Small helpers for talking to our API from the browser.
// The page calls /api/..., and the server adds the API key itself,
// so the key never appears in the browser.

export type Slot = {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
};

export type Booking = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
};

export class ApiError extends Error {
  status: number;
  retryAfter: number | null;

  constructor(status: number, message: string, retryAfter: number | null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    throw new ApiError(
      response.status,
      data.error ?? `Request failed (${response.status})`,
      retryAfter ? Number(retryAfter) : null
    );
  }
  return data as T;
}

export function getSlots(provider?: string) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request<{ slots: Slot[] }>(`/slots${query}`).then((r) => r.slots);
}

export function createBooking(
  input: { slot_id: string; name: string; email: string },
  idempotencyKey: string
) {
  return request<Booking>("/bookings", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function cancelBooking(id: string) {
  return request<Booking>(`/bookings/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getMyBookings(email: string, cursor?: string | null) {
  const params = new URLSearchParams({ email, limit: "5" });
  if (cursor) params.set("cursor", cursor);
  return request<{ bookings: Booking[]; next_cursor: string | null }>(`/bookings?${params}`);
}
